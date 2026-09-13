import json
import numpy as np
from typing import Dict, List, Optional, Tuple

class CameraCalibrator:
    """
    2D-to-Floor-Map Spatial Homography Calibration Toolkit.
    Maps pixel coordinates (normalized 0..1 or pixel space) from camera view
    to a common 2D floor plan coordinate space (0..1 or real-world meters).
    """
    def __init__(self):
        # cam_id -> 3x3 Homography Matrix (numpy ndarray)
        self.homographies: Dict[str, np.ndarray] = {}
        # cam_id -> Calibration points {"src_points": [[x,y]...], "dst_points": [[x,y]...]}
        self.configs: Dict[str, dict] = {}

    def set_calibration(self, cam_id: str, src_points: List[List[float]], dst_points: List[List[float]], 
                        cam_x: Optional[float] = None, cam_y: Optional[float] = None, 
                        cam_z: Optional[float] = None, yaw: Optional[float] = None) -> bool:
        """
        Compute and store the 3x3 Homography Matrix from at least 4 corresponding points.
        src_points: 4 points in camera normalized coords [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
        dst_points: 4 points in floor plan coords [[X0,Y0], [X1,Y1], [X2,Y2], [X3,Y3]]
        """
        if len(src_points) < 4 or len(dst_points) < 4:
            return False
            
        src_pts = np.array(src_points[:4], dtype=np.float32)
        dst_pts = np.array(dst_points[:4], dtype=np.float32)
        
        try:
            # Solve Homography: H * src = dst using Direct Linear Transformation (DLT)
            H = self._compute_homography_dlt(src_pts, dst_pts)
            if H is not None:
                # Check for singular or highly ill-conditioned matrix
                cond = np.linalg.cond(H)
                if np.isinf(cond) or np.isnan(cond) or cond > 1e7:
                    print(f"[CameraCalibrator] Warning: Matrix for {cam_id} is ill-conditioned (cond={cond:.2e})")

                self.homographies[cam_id] = H
                
                # Compute reprojection error for quality check
                reproj_err = self.calculate_reprojection_error(src_pts, dst_pts, H)
                
                # Calculate FOV polygon by projecting the 4 corners of the video frame
                frame_corners = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
                fov_polygon = []
                for cx, cy in frame_corners:
                    pt = np.array([cx, cy, 1.0], dtype=np.float32)
                    floor_pt = np.dot(H, pt)
                    if abs(floor_pt[2]) > 1e-7:
                        fov_polygon.append([
                            float(np.clip(floor_pt[0] / floor_pt[2], 0.0, 1.0)),
                            float(np.clip(floor_pt[1] / floor_pt[2], 0.0, 1.0))
                        ])
                    else:
                        fov_polygon.append([cx, cy])
                
                self.configs[cam_id] = {
                    "src_points": src_points,
                    "dst_points": dst_points,
                    "matrix": H.tolist(),
                    "reprojection_error": round(float(reproj_err), 4),
                    "cam_x": cam_x,
                    "cam_y": cam_y,
                    "cam_z": cam_z,
                    "yaw": yaw,
                    "fov_polygon": fov_polygon
                }
                return True
        except Exception as e:
            print(f"[CameraCalibrator] Failed to compute homography for {cam_id}: {e}")
            
        return False

    def calculate_reprojection_error(self, src: np.ndarray, dst: np.ndarray, H: np.ndarray) -> float:
        """Calculate mean Euclidean distance error between ground truth dst points and projected src points."""
        errors = []
        for i in range(len(src)):
            p = np.array([src[i][0], src[i][1], 1.0], dtype=np.float32)
            proj = np.dot(H, p)
            if abs(proj[2]) > 1e-7:
                px, py = proj[0] / proj[2], proj[1] / proj[2]
                err = np.hypot(px - dst[i][0], py - dst[i][1])
                errors.append(err)
        return float(np.mean(errors)) if errors else 0.0

    def _compute_homography_dlt(self, src: np.ndarray, dst: np.ndarray) -> Optional[np.ndarray]:
        """Compute 3x3 Homography matrix using SVD."""
        A = []
        for i in range(4):
            x, y = src[i][0], src[i][1]
            u, v = dst[i][0], dst[i][1]
            A.append([-x, -y, -1,  0,  0,  0, x * u, y * u, u])
            A.append([ 0,  0,  0, -x, -y, -1, x * v, y * v, v])
        A = np.array(A, dtype=np.float32)
        
        # SVD: A = U * S * Vh
        _, _, Vh = np.linalg.svd(A)
        H = Vh[-1].reshape((3, 3))
        
        # Normalize so that H[2, 2] == 1
        if abs(H[2, 2]) > 1e-7:
            H = H / H[2, 2]
        return H

    def camera_to_floor(self, cam_id: str, x: float, y: float) -> Tuple[float, float]:
        """
        Transform a 2D camera ground point (e.g. bottom-center of bounding box)
        to the Floor Plan coordinates (X_floor, Y_floor) normalized [0..1].
        """
        if cam_id not in self.homographies:
            # Fallback default: return original normalized coordinates
            return (round(float(x), 4), round(float(y), 4))
            
        H = self.homographies[cam_id]
        pt = np.array([x, y, 1.0], dtype=np.float32)
        floor_pt = np.dot(H, pt)
        
        # Homogeneous normalization
        if abs(floor_pt[2]) > 1e-7:
            fx = float(floor_pt[0] / floor_pt[2])
            fy = float(floor_pt[1] / floor_pt[2])
        else:
            fx, fy = x, y
            
        # Clamp to non-negative normalized coordinates
        fx = max(0.0, min(1.0, fx))
        fy = max(0.0, min(1.0, fy))
        return (round(fx, 4), round(fy, 4))

    def batch_camera_to_floor(self, cam_id: str, points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        """Transform multiple camera points efficiently."""
        return [self.camera_to_floor(cam_id, p[0], p[1]) for p in points]

    def get_config(self, cam_id: str) -> Optional[dict]:
        return self.configs.get(cam_id)

    def load_from_db_records(self, records: List[dict]):
        for r in records:
            cam_id = r.get("cam_id")
            src = r.get("src_points")
            dst = r.get("dst_points")
            cam_x = r.get("cam_x")
            cam_y = r.get("cam_y")
            cam_z = r.get("cam_z")
            yaw = r.get("yaw")
            if cam_id and src and dst:
                self.set_calibration(cam_id, src, dst, cam_x, cam_y, cam_z, yaw)

# Global singleton
camera_calibrator = CameraCalibrator()
