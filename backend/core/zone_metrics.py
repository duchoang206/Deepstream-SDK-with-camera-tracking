"""
Zone Violations and Occupancy Rate Metrics Calculator.
"""

from typing import Dict, List, Any
from collections import defaultdict
import time


class ZoneMetricsTracker:
    def __init__(self, window_seconds: int = 300):
        self.window_seconds = window_seconds
        self.intrusion_events: List[Dict[str, Any]] = []
        self.zone_occupancy: Dict[str, int] = defaultdict(int)

    def record_intrusion(self, zone_id: str, track_id: int, camera_id: int):
        now = time.time()
        self.intrusion_events.append({
            "timestamp": now,
            "zone_id": zone_id,
            "track_id": track_id,
            "camera_id": camera_id
        })
        self._purge_stale_events(now)

    def update_occupancy(self, zone_id: str, count: int):
        self.zone_occupancy[zone_id] = count

    def _purge_stale_events(self, current_time: float):
        cutoff = current_time - self.window_seconds
        self.intrusion_events = [e for e in self.intrusion_events if e["timestamp"] >= cutoff]

    def get_zone_statistics(self) -> Dict[str, Any]:
        now = time.time()
        self._purge_stale_events(now)
        
        freq_by_zone: Dict[str, int] = defaultdict(int)
        for ev in self.intrusion_events:
            freq_by_zone[ev["zone_id"]] += 1

        return {
            "window_seconds": self.window_seconds,
            "total_intrusions_in_window": len(self.intrusion_events),
            "intrusion_frequency_by_zone": dict(freq_by_zone),
            "current_occupancy_by_zone": dict(self.zone_occupancy),
            "calculated_at": now
        }
