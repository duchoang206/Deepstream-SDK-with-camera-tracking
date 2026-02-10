"""
Data Transfer Objects and Typed Models for Camera Telemetry and Analytics Events.
"""

from typing import List, Optional, Tuple, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field


class StreamStatusEnum(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    DEGRADED = "degraded"
    RECONNECTING = "reconnecting"


class AlertSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class Point2D(BaseModel):
    x: float
    y: float


class BoundingBox2D(BaseModel):
    xmin: float
    ymin: float
    xmax: float
    ymax: float
    confidence: float = 1.0
    class_name: str = "person"


class CameraTelemetry(BaseModel):
    camera_id: int
    camera_name: str
    ip_address: str
    stream_status: StreamStatusEnum = StreamStatusEnum.ONLINE
    current_fps: float = 30.0
    frame_drop_count: int = 0
    active_tracking_count: int = 0
    last_heartbeat_timestamp: float = Field(default_factory=lambda: 0.0)


class IntrusionEventPayload(BaseModel):
    event_id: str
    camera_id: int
    zone_id: str
    zone_name: str
    track_id: int
    severity: AlertSeverity = AlertSeverity.CRITICAL
    bbox: BoundingBox2D
    foot_location: Point2D
    timestamp_iso: str
    dwell_duration_sec: float = 0.0
    snapshot_path: Optional[str] = None


class ReIDCrossCameraMatch(BaseModel):
    global_person_id: int
    primary_track_id: int
    matched_camera_id: int
    matched_track_id: int
    similarity_score: float
    timestamp_iso: str


class AnalyticsSummaryReport(BaseModel):
    total_persons_detected: int = 0
    current_active_targets: int = 0
    total_intrusions_today: int = 0
    average_dwell_time_seconds: float = 0.0
    cameras_summary: List[CameraTelemetry] = Field(default_factory=list)
    recent_alerts: List[IntrusionEventPayload] = Field(default_factory=list)
