/**
 * TypeScript Type Definitions for Multi-Camera DeepStream Tracking & Web Dashboard
 */

export interface CameraStreamConfig {
  cam_id: string;
  name: string;
  rtsp_url: string;
  webrtc_url?: string;
  enabled: boolean;
  fps?: number;
  resolution?: {
    width: number;
    height: number;
  };
}

export interface DetectionObject {
  id: number;
  global_id?: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  w: number; // normalized 0..1
  h: number; // normalized 0..1
  floor_x?: number; // 2D floor projection X
  floor_y?: number; // 2D floor projection Y
  vx?: number;
  vy?: number;
  speed?: number;
  class: string;
  confidence: number;
}

export interface StreamFrameMetadata {
  timestamp: number;
  streams: {
    cam_id: string;
    objects: DetectionObject[];
    tripwire_stats?: Record<string, { in: number; out: number }>;
    roi_states?: Array<{
      roi_id: string;
      name: string;
      status: "CARFULL" | "EMPTY";
      occupant_ids: number[];
      polygon: number[][];
    }>;
  }[];
}

export interface IntrusionZoneRule {
  id: string;
  cam_id: string;
  name: string;
  type: "intrusion" | "dwell_time" | "density";
  points: [number, number][]; // normalized coordinates
  target_objects: string[];
  threshold?: number;
  dwell_limit?: number;
  max_objects?: number;
}

export interface TripwireRule {
  id: string;
  cam_id: string;
  name: string;
  points: [[number, number], [number, number]];
  direction: "in" | "out" | "both";
}

export interface AlertEvent {
  id?: string;
  cam_id: string;
  global_id: number;
  rule_id: string;
  rule_type: "intrusion" | "tripwire" | "dwell_time" | "density";
  severity: "info" | "warning" | "critical";
  description: string;
  timestamp: number;
  counts?: { in: number; out: number };
  bbox?: number[];
}

export interface SystemDiagnostics {
  status: "healthy" | "degraded" | "error";
  uptime_seconds: number;
  timestamp: number;
  cpu: {
    usage_pct: number;
    cores: number;
  };
  memory: {
    total_gb: number;
    used_gb: number;
    percent: number;
  };
  gpu: {
    available: boolean;
    device_name: string;
    memory_used_mb: number;
    memory_total_mb: number;
    utilization_pct: number;
  };
  pipeline: {
    avg_ms: number;
    min_ms: number;
    max_ms: number;
    samples: number;
  };
  active_cameras_count: number;
}
