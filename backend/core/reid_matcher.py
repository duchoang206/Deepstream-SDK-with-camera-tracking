import time
import numpy as np
from typing import Dict, List, Optional, Tuple
from scipy.optimize import linear_sum_assignment
from core.camera_calibrator import camera_calibrator

class GlobalTrack:
    def __init__(self, global_id: int, obj_class: str, initial_cam_id: str, initial_bbox: List[float], floor_pos: Tuple[float, float], feature_vector: Optional[np.ndarray] = None):
        self.global_id = global_id
        self.obj_class = obj_class
        self.last_cam_id = initial_cam_id
        self.last_bbox = initial_bbox  # [x, y, w, h] normalized 0..1
        self.floor_pos = floor_pos     # (X_floor_meter, Y_floor_meter)
        self.last_seen = time.time()
        self.first_seen = self.last_seen
        self.feature_vector = feature_vector
        # List of (timestamp, cam_id, bbox, floor_pos)
        self.history: List[Tuple[float, str, List[float], Tuple[float, float]]] = [(self.last_seen, initial_cam_id, initial_bbox, floor_pos)]
        self.alpha = 0.85  # EMA weight for feature updates

    def update(self, cam_id: str, bbox: List[float], floor_pos: Tuple[float, float], feature_vector: Optional[np.ndarray] = None):
        self.last_cam_id = cam_id
        self.last_bbox = bbox
        
        # Spatial EMA smoothing filter to eliminate pixel jitter and coordinate fluttering
        smooth_w = 0.70
        prev_fx, prev_fy = self.floor_pos
        smooth_fx = smooth_w * prev_fx + (1.0 - smooth_w) * floor_pos[0]
        smooth_fy = smooth_w * prev_fy + (1.0 - smooth_w) * floor_pos[1]
        self.floor_pos = (round(float(smooth_fx), 4), round(float(smooth_fy), 4))
        self.last_seen = time.time()
        
        if feature_vector is not None:
            if self.feature_vector is None:
                self.feature_vector = feature_vector
            else:
                norm_feat = feature_vector / (np.linalg.norm(feature_vector) + 1e-6)
                self.feature_vector = self.alpha * self.feature_vector + (1.0 - self.alpha) * norm_feat
                self.feature_vector = self.feature_vector / (np.linalg.norm(self.feature_vector) + 1e-6)
                
        self.history.append((self.last_seen, cam_id, bbox, self.floor_pos))
        if len(self.history) > 120:
            self.history.pop(0)

class GlobalReIDMatcher:
    """
    Multi-Target Multi-Camera (MTMC) Fusion Engine for Industrial Floor Tracking.
    Fuses local single-camera tracks into unique Global IDs using:
    1. Homography 2D Floor Plan Space Proximity (Meters)
    2. Hungarian Global Assignment Optimization
    3. Re-ID Appearance Feature Consistency
    4. Active Track Clustering & Fusion
    """
    def __init__(self, sim_threshold: float = 0.60, max_floor_dist: float = 2.5, max_time_gap: float = 10.0):
        self.sim_threshold = sim_threshold
        self.max_floor_dist = max_floor_dist  # Spatial distance threshold in METERS (2.5m)
        self.max_time_gap = max_time_gap      # Memory time gap for Re-ID (10s)
        self.next_global_id = 1
        self.gallery: Dict[int, GlobalTrack] = {}                  # global_id -> GlobalTrack
        self.local_to_global_map: Dict[Tuple[str, int], int] = {} # (cam_id, local_id) -> global_id
        self.last_cleanup = time.time()

    def _cleanup_old_tracks(self):
        now = time.time()
        if now - self.last_cleanup < 3.0:
            return
        self.last_cleanup = now
        expired_ids = [gid for gid, track in self.gallery.items() if now - track.last_seen > self.max_time_gap]
        for gid in expired_ids:
            del self.gallery[gid]
            
        active_gids = set(self.gallery.keys())
        self.local_to_global_map = {
            k: v for k, v in self.local_to_global_map.items() if v in active_gids
        }

    def process_camera_detections(self, cam_id: str, detections: List[dict]) -> List[dict]:
        """
        Input:
          detections: list of dicts { local_id, class, bbox: [x,y,w,h], confidence, feature (optional) }
        Returns:
          augmented detections with unique 'global_id', smoothed 'floor_x', 'floor_y'.
        """
        self._cleanup_old_tracks()
        now = time.time()
        augmented = []
        unmatched_dets = []
        
        for det in detections:
            local_id = det["local_id"]
            obj_class = det.get("class", "object")
            key = (cam_id, local_id)
            bbox = det["bbox"]
            
            # Extract Bottom-center ground contact point of bounding box
            cx = bbox[0] + bbox[2] / 2.0
            cy = bbox[1] + bbox[3]
            floor_x, floor_y = camera_calibrator.camera_to_floor(cam_id, cx, cy)
            det["floor_x"] = floor_x
            det["floor_y"] = floor_y
            
            # 1. Check if local track already has an assigned Global ID
            if key in self.local_to_global_map:
                gid = self.local_to_global_map[key]
                if gid in self.gallery:
                    # Check if there is another older active track of SAME class closer to this position
                    # to merge duplicate Global IDs if multiple cameras observed the same object
                    merged_gid = self._find_matching_gallery_track(obj_class, floor_x, floor_y, det.get("feature"), exclude_gid=gid)
                    if merged_gid is not None and merged_gid < gid:
                        # Merge to older global ID
                        gid = merged_gid
                        self.local_to_global_map[key] = gid
                    
                    self.gallery[gid].update(cam_id, bbox, (floor_x, floor_y), det.get("feature"))
                    det_copy = dict(det)
                    det_copy["global_id"] = gid
                    det_copy["floor_x"] = self.gallery[gid].floor_pos[0]
                    det_copy["floor_y"] = self.gallery[gid].floor_pos[1]
                    augmented.append(det_copy)
                    continue

            unmatched_dets.append(det)

        if not unmatched_dets:
            return augmented

        # 2. MTMC Hungarian Matching across candidate gallery tracks
        candidate_gids = [
            gid for gid, track in self.gallery.items()
            if (now - track.last_seen <= self.max_time_gap)
        ]

        if candidate_gids and unmatched_dets:
            num_dets = len(unmatched_dets)
            num_cands = len(candidate_gids)
            cost_matrix = np.ones((num_dets, num_cands), dtype=np.float32) * 10.0
            
            # Vectorized feature and spatial matrix extraction
            det_coords = np.array([[d["floor_x"], d["floor_y"]] for d in unmatched_dets], dtype=np.float32)
            cand_coords = np.array([self.gallery[gid].floor_pos for gid in candidate_gids], dtype=np.float32)
            
            # Pairwise spatial Euclidean distance in metric space: (num_dets, num_cands)
            diff = det_coords[:, np.newaxis, :] - cand_coords[np.newaxis, :, :]
            spatial_dists = np.hypot(diff[:, :, 0], diff[:, :, 1])

            for i, det in enumerate(unmatched_dets):
                det_class = det.get("class", "")
                det_feat = det.get("feature")
                if det_feat is not None:
                    det_feat = det_feat / (np.linalg.norm(det_feat) + 1e-6)
                    
                for j, gid in enumerate(candidate_gids):
                    track = self.gallery[gid]
                    # Class mismatch penalty (must match class: e.g. robot only matches robot)
                    if det_class and track.obj_class and det_class != track.obj_class:
                        cost_matrix[i, j] = 99.0
                        continue

                    # Spatial Distance on Metric Floor Plan (Meters)
                    floor_dist = spatial_dists[i, j]
                    
                    # Visual Appearance Distance
                    visual_dist = 1.0
                    if det_feat is not None and track.feature_vector is not None:
                        sim = float(np.dot(det_feat, track.feature_vector))
                        visual_dist = 1.0 - max(0.0, sim)
                    
                    # Fused cost
                    if det_feat is not None and track.feature_vector is not None:
                        fused_cost = 0.6 * visual_dist + 0.4 * (floor_dist / self.max_floor_dist)
                    else:
                        fused_cost = floor_dist / self.max_floor_dist
                        
                    cost_matrix[i, j] = fused_cost

            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            assigned_rows = set()
            
            for r, c in zip(row_ind, col_ind):
                cost = cost_matrix[r, c]
                if cost <= 1.0:  # Valid match within max_floor_dist (2.5m)
                    det = unmatched_dets[r]
                    gid = candidate_gids[c]
                    self.gallery[gid].update(cam_id, det["bbox"], (det["floor_x"], det["floor_y"]), det.get("feature"))
                    self.local_to_global_map[(cam_id, det["local_id"])] = gid
                    det_copy = dict(det)
                    det_copy["global_id"] = gid
                    det_copy["floor_x"] = self.gallery[gid].floor_pos[0]
                    det_copy["floor_y"] = self.gallery[gid].floor_pos[1]
                    augmented.append(det_copy)
                    assigned_rows.add(r)
                    
            unmatched_dets = [d for idx, d in enumerate(unmatched_dets) if idx not in assigned_rows]

        # 3. Create new Global ID for remaining truly unmatched detections
        for det in unmatched_dets:
            gid = self.next_global_id
            self.next_global_id += 1
            
            feat = det.get("feature")
            if feat is not None:
                feat = feat / (np.linalg.norm(feat) + 1e-6)
                
            obj_class = det.get("class", "object")
            self.gallery[gid] = GlobalTrack(gid, obj_class, cam_id, det["bbox"], (det["floor_x"], det["floor_y"]), feat)
            self.local_to_global_map[(cam_id, det["local_id"])] = gid
            
            det_copy = dict(det)
            det_copy["global_id"] = gid
            augmented.append(det_copy)

        return augmented

    def _find_matching_gallery_track(self, obj_class: str, fx: float, fy: float, feat: Optional[np.ndarray] = None, exclude_gid: Optional[int] = None) -> Optional[int]:
        now = time.time()
        best_gid = None
        min_dist = self.max_floor_dist
        
        for gid, track in self.gallery.items():
            if gid == exclude_gid:
                continue
            if now - track.last_seen > self.max_time_gap:
                continue
            if obj_class and track.obj_class and obj_class != track.obj_class:
                continue
                
            dist = np.hypot(fx - track.floor_pos[0], fy - track.floor_pos[1])
            if dist < min_dist:
                min_dist = dist
                best_gid = gid
                
        return best_gid

    def get_track_history(self, global_id: int) -> Optional[dict]:
        track = self.gallery.get(global_id)
        if not track:
            return None
        return {
            "global_id": track.global_id,
            "class": track.obj_class,
            "last_camera": track.last_cam_id,
            "first_seen": track.first_seen,
            "last_seen": track.last_seen,
            "current_floor_pos": track.floor_pos,
            "trajectory": [
                {"timestamp": h[0], "cam_id": h[1], "bbox": h[2], "floor_pos": h[3]}
                for h in track.history
            ]
        }

# Global singleton with 2.5 meter fusion threshold
global_reid = GlobalReIDMatcher(sim_threshold=0.60, max_floor_dist=2.5, max_time_gap=10.0)
