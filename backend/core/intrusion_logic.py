import time
from enum import Enum
from typing import List, Tuple, Dict, Optional
from shapely.geometry import Point, Polygon

class ZoneState(str, Enum):
    SAFE = "SAFE"
    WARNING = "WARNING"
    INTRUDED = "INTRUDED"

class IntrusionDetector:
    """
    Intrusion detection logic with Polygon spatial math,
    alert cooldown timers, and multi-object zone intersection evaluation.
    """
    def __init__(self, default_cooldown: float = 3.0):
        self.default_cooldown = default_cooldown
        # (zone_id, track_id) -> last alert timestamp
        self._alert_cooldowns: Dict[Tuple[str, int], float] = {}

    def create_polygon(self, points: List[List[float]]) -> Polygon:
        """
        Convert list of [x, y] coordinates into a validated Shapely Polygon.
        """
        if len(points) < 3:
            raise ValueError("Polygon must have at least 3 points")
        poly = Polygon(points)
        if not poly.is_valid:
            poly = poly.buffer(0)
        return poly

    def check_intrusion_point(self, point: Tuple[float, float], polygon: Polygon) -> bool:
        """
        Check if a single point (e.g., bottom-center ground contact) is inside polygon.
        """
        p = Point(point[0], point[1])
        return polygon.contains(p)

    def check_intrusion_bbox(self, bbox: List[float], polygon: Polygon, spatial_method: str = "center_bottom") -> bool:
        """
        Check if a bounding box [x1, y1, x2, y2] intrudes into the polygon.
        spatial_method: 'center_bottom', 'center', or 'bbox_intersects'.
        """
        x1, y1, x2, y2 = bbox
        
        if spatial_method == "center_bottom":
            center_x = (x1 + x2) / 2.0
            bottom_y = y2
            return self.check_intrusion_point((center_x, bottom_y), polygon)
        elif spatial_method == "center":
            center_x = (x1 + x2) / 2.0
            center_y = (y1 + y2) / 2.0
            return self.check_intrusion_point((center_x, center_y), polygon)
        elif spatial_method == "bbox_intersects":
            bbox_poly = Polygon([
                (x1, y1),
                (x2, y1),
                (x2, y2),
                (x1, y2)
            ])
            return polygon.intersects(bbox_poly)
        return False

    def should_trigger_alert(self, zone_id: str, track_id: int, cooldown: Optional[float] = None) -> bool:
        """Rate-limit alerts per zone and object ID."""
        now = time.time()
        cd = cooldown if cooldown is not None else self.default_cooldown
        key = (zone_id, track_id)
        last_time = self._alert_cooldowns.get(key, 0.0)
        
        if now - last_time >= cd:
            self._alert_cooldowns[key] = now
            return True
        return False

    def evaluate_zone_objects(self, zone_id: str, polygon: Polygon, objects: List[dict]) -> Tuple[ZoneState, List[int]]:
        """
        Batch evaluate all objects in current frame against a designated zone.
        Returns:
            (ZoneState, List[intruding_object_ids])
        """
        intruding_ids = []
        for obj in objects:
            oid = obj.get("id")
            bbox = [obj.get("x", 0), obj.get("y", 0), obj.get("x", 0) + obj.get("w", 0), obj.get("y", 0) + obj.get("h", 0)]
            if self.check_intrusion_bbox(bbox, polygon, spatial_method="center_bottom"):
                intruding_ids.append(oid)

        state = ZoneState.INTRUDED if len(intruding_ids) > 0 else ZoneState.SAFE
        return state, intruding_ids
