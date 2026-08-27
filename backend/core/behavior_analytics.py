import time
import numpy as np
from typing import Dict, List, Tuple, Optional
from shapely.geometry import Point, Polygon, LineString

class BehaviorAnalyticsEngine:
    """
    Real-Time Behavior Analytics & ROI Overlap Monitoring Engine.
    Features:
    1. ROI Area Overlap Ratio (Default threshold = 5.0% overlap or contact point inside)
    2. Temporal Hysteresis Filter (Chống nhiễu rung frame: cần >= 5 frame liên tiếp để chuyển CARFULL, >= 8 frame liên tiếp để về EMPTY)
    3. Trạng thái vị trí: CARFULL (Có hàng/xe) | EMPTY (Trống)
    4. Tripwire Line Crossing (Directional crossing counter: In/Out)
    5. Dwell Time / Loitering
    """
    def __init__(self):
        # cam_id -> list of parsed rules
        self.rules: Dict[str, List[dict]] = {}
        
        # Tripwire cumulative counters: rule_id -> { "in": int, "out": int }
        self.tripwire_counts: Dict[str, dict] = {}
        
        # Track history for line crossing: (cam_id, global_id) -> list of (timestamp, (x, y))
        self.track_positions: Dict[Tuple[str, int], List[Tuple[float, Tuple[float, float]]]] = {}
        
        # Dwell tracking: (cam_id, rule_id, global_id) -> first_seen_timestamp
        self.zone_occupancy: Dict[Tuple[str, str, int], float] = {}
        
        # Hysteresis state filter for ROI noise cancellation: (cam_id, rule_id) -> dict
        # { "status": "EMPTY"|"CARFULL", "occ_frames": int, "empty_frames": int, "occupant_ids": list }
        self.roi_states_filter: Dict[Tuple[str, str], dict] = {}
        
        # Active alert cooldown to avoid duplicate alert flooding: (cam_id, rule_id, global_id) -> last_alert_time
        self.alert_cooldowns: Dict[Tuple[str, str, int], float] = {}

    def set_rules(self, cam_id: str, rules_list: List[dict]):
        """
        Update rule configurations for a camera.
        """
        parsed_rules = []
        for r in rules_list:
            rule_type = r.get("type") or r.get("rule_type") or "intrusion"
            rule_id = r.get("id", f"rule_{len(parsed_rules)+1}")
            points = r.get("points", [])  # normalized [[x,y]...]
            target_objects = [str(t).lower() for t in r.get("target_objects", ["rack", "delivery-robot", "robot", "person"])]
            threshold = float(r.get("threshold", 5.0))  # Default 5.0% overlap
            
            rule_obj = {
                "id": rule_id,
                "type": rule_type,
                "name": r.get("name", rule_id),
                "points": points,
                "target_objects": target_objects,
                "threshold": threshold,
                "direction": r.get("direction", "both")
            }
            
            if rule_type in ("intrusion", "dwell_time", "density") and len(points) >= 3:
                try:
                    poly = Polygon(points)
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                    rule_obj["polygon"] = poly
                except Exception:
                    rule_obj["polygon"] = None
            elif rule_type == "tripwire" and len(points) >= 2:
                try:
                    rule_obj["line"] = LineString(points[:2])
                except Exception:
                    rule_obj["line"] = None
                    
            parsed_rules.append(rule_obj)
            if rule_id not in self.tripwire_counts:
                self.tripwire_counts[rule_id] = {"in": 0, "out": 0}
                
        self.rules[cam_id] = parsed_rules

    def process_frame(self, cam_id: str, objects: List[dict]) -> Tuple[List[dict], Dict[str, dict], List[dict]]:
        """
        Evaluates current detections against active camera rules.
        Returns:
          - triggered_events: list of alert event dicts
          - tripwire_stats: updated tripwire counters for the camera
          - roi_states: list of ROI status dicts (status: CARFULL / EMPTY)
        """
        now = time.time()
        triggered_events = []
        cam_rules = self.rules.get(cam_id, [])
        
        roi_states: List[dict] = []
        if not cam_rules:
            return triggered_events, self.get_tripwire_stats(cam_id), roi_states
            
        current_gids_in_frame = set()
        
        # Prepare Bounding Box Polygons for all detected objects
        obj_polygons = []
        for obj in objects:
            gid = obj["id"]
            current_gids_in_frame.add(gid)
            x, y, w, h = obj["x"], obj["y"], obj["w"], obj["h"]
            obj_cls = (obj.get("class") or "object").lower()
            
            # Bottom-center ground contact point
            bottom_center = (round(x + w / 2.0, 4), round(y + h, 4))
            pt_geom = Point(bottom_center[0], bottom_center[1])
            
            # 2D Bounding Box Polygon in normalized space
            bbox_poly = Polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
            if not bbox_poly.is_valid:
                bbox_poly = bbox_poly.buffer(0)
                
            obj_polygons.append({
                "id": gid,
                "class": obj_cls,
                "bbox": [x, y, w, h],
                "bottom_center": bottom_center,
                "pt_geom": pt_geom,
                "bbox_poly": bbox_poly
            })
            
            # Update trajectory for line crossing
            pos_key = (cam_id, gid)
            if pos_key not in self.track_positions:
                self.track_positions[pos_key] = []
            self.track_positions[pos_key].append((now, bottom_center))
            if len(self.track_positions[pos_key]) > 20:
                self.track_positions[pos_key].pop(0)

        # Process each rule for this camera
        for rule in cam_rules:
            rule_id = rule["id"]
            rule_type = rule["type"]
            target_objects = rule.get("target_objects", [])
            threshold = float(rule.get("threshold", 5.0))
            poly = rule.get("polygon")
            
            # --- 1. ROI OCCUPANCY MONITORING (CARFULL / EMPTY with Noise Filter) ---
            if rule_type in ("intrusion", "dwell_time", "density") and poly is not None and poly.area > 0:
                roi_area = poly.area
                raw_occupant_ids = []
                max_overlap_ratio = 0.0
                
                for o in obj_polygons:
                    # Check class filtering
                    if target_objects and len(target_objects) > 0:
                        matched = any(t in o["class"] or o["class"] in t for t in target_objects)
                        if not matched:
                            continue
                            
                    try:
                        inter_area = poly.intersection(o["bbox_poly"]).area
                        overlap_ratio = (inter_area / roi_area) * 100.0
                    except Exception:
                        overlap_ratio = 0.0
                        
                    if overlap_ratio > max_overlap_ratio:
                        max_overlap_ratio = overlap_ratio
                        
                    if overlap_ratio >= threshold or poly.contains(o["pt_geom"]):
                        raw_occupant_ids.append(o["id"])
                
                # Instantaneous frame occupancy condition
                instant_occupied = len(raw_occupant_ids) > 0 or max_overlap_ratio >= threshold
                
                # Temporal Hysteresis Filter (Chống nhiễu rung lắc)
                state_key = (cam_id, rule_id)
                if state_key not in self.roi_states_filter:
                    self.roi_states_filter[state_key] = {
                        "status": "EMPTY",
                        "occ_frames": 0,
                        "empty_frames": 0,
                        "occupant_ids": []
                    }
                filter_state = self.roi_states_filter[state_key]
                
                if instant_occupied:
                    filter_state["occ_frames"] += 1
                    filter_state["empty_frames"] = 0
                    filter_state["occupant_ids"] = raw_occupant_ids
                    # Cần >= 5 frame liên tiếp để chuyển sang CARFULL (chống noise 1-2 frame)
                    if filter_state["occ_frames"] >= 5 and filter_state["status"] != "CARFULL":
                        filter_state["status"] = "CARFULL"
                        
                        # Trigger Alarm Event
                        cooldown_key = (cam_id, rule_id, raw_occupant_ids[0] if raw_occupant_ids else 0)
                        if now - self.alert_cooldowns.get(cooldown_key, 0) > 3.0:
                            self.alert_cooldowns[cooldown_key] = now
                            occ_str = ", ".join([f"#{i}" for i in raw_occupant_ids])
                            triggered_events.append({
                                "cam_id": cam_id,
                                "global_id": raw_occupant_ids[0] if raw_occupant_ids else 0,
                                "rule_id": rule_id,
                                "rule_type": "intrusion",
                                "severity": "critical",
                                "description": f"🚨 Ô vị trí '{rule['name']}' chuyển sang CÓ HÀNG (CARFULL) bởi {occ_str}",
                                "timestamp": int(now * 1000)
                            })
                else:
                    filter_state["empty_frames"] += 1
                    filter_state["occ_frames"] = 0
                    # Cần >= 8 frame liên tiếp trống để chuyển về EMPTY (chống mất nhận diện tạm thời khi bị che khuất)
                    if filter_state["empty_frames"] >= 8 and filter_state["status"] != "EMPTY":
                        filter_state["status"] = "EMPTY"
                        filter_state["occupant_ids"] = []

                roi_states.append({
                    "roi_id": rule_id,
                    "name": rule["name"],
                    "status": filter_state["status"],  # "CARFULL" | "EMPTY"
                    "occupant_ids": filter_state["occupant_ids"],
                    "polygon": rule["points"],
                    "rule_type": rule_type
                })

            # --- 2. TRIPWIRE / LINE CROSSING ---
            elif rule_type == "tripwire" and rule.get("line"):
                line_geom = rule["line"]
                for o in obj_polygons:
                    pos_key = (cam_id, o["id"])
                    if len(self.track_positions.get(pos_key, [])) >= 2:
                        prev_pos = self.track_positions[pos_key][-2][1]
                        motion_seg = LineString([prev_pos, o["bottom_center"]])
                        
                        if motion_seg.intersects(line_geom):
                            p1 = rule["points"][0]
                            p2 = rule["points"][1]
                            line_vec = (p2[0] - p1[0], p2[1] - p1[1])
                            motion_vec = (o["bottom_center"][0] - prev_pos[0], o["bottom_center"][1] - prev_pos[1])
                            
                            cross_prod = line_vec[0] * motion_vec[1] - line_vec[1] * motion_vec[0]
                            direction = "in" if cross_prod > 0 else "out"
                            
                            cooldown_key = (cam_id, rule_id, o["id"])
                            if now - self.alert_cooldowns.get(cooldown_key, 0) > 2.0:
                                self.alert_cooldowns[cooldown_key] = now
                                self.tripwire_counts[rule_id][direction] = self.tripwire_counts[rule_id].get(direction, 0) + 1
                                
                                triggered_events.append({
                                    "cam_id": cam_id,
                                    "global_id": o["id"],
                                    "rule_id": rule_id,
                                    "rule_type": "tripwire",
                                    "severity": "info",
                                    "direction": direction,
                                    "description": f"Vượt vạch ảo '{rule['name']}' ({direction.upper()}) bởi đối tượng #{o['id']}",
                                    "counts": dict(self.tripwire_counts[rule_id]),
                                    "bbox": o["bbox"],
                                    "timestamp": int(now * 1000)
                                })

        # Cleanup expired track positions
        self._cleanup(now, current_gids_in_frame, cam_id)
        
        return triggered_events, self.get_tripwire_stats(cam_id), roi_states

    def _cleanup(self, now: float, current_gids: set, cam_id: str):
        keys_to_del = [k for k in self.track_positions.keys() if k[0] == cam_id and k[1] not in current_gids]
        for k in keys_to_del:
            self.track_positions.pop(k, None)
            
        zone_keys_to_del = [k for k in self.zone_occupancy.keys() if k[0] == cam_id and k[2] not in current_gids]
        for k in zone_keys_to_del:
            self.zone_occupancy.pop(k, None)

    def get_tripwire_stats(self, cam_id: str) -> Dict[str, dict]:
        cam_rules = self.rules.get(cam_id, [])
        stats = {}
        for r in cam_rules:
            if r["type"] == "tripwire":
                rid = r["id"]
                stats[rid] = {
                    "name": r["name"],
                    "in": self.tripwire_counts.get(rid, {}).get("in", 0),
                    "out": self.tripwire_counts.get(rid, {}).get("out", 0)
                }
        return stats

# Global singleton
behavior_engine = BehaviorAnalyticsEngine()
