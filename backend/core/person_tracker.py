"""
PersonTrackerEngine - Fallback person detection & tracking using Ultralytics YOLOv8
Runs independently per camera stream, broadcasts bbox metadata via WebSocket callback.
Activated automatically when DeepStream pipeline is not producing detections.
"""
import os
import cv2
import time
import threading
import numpy as np
from typing import Dict, List, Callable, Optional

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

# NOTE: ultralytics/YOLO is imported lazily inside _get_model() to avoid
# matplotlib SIGSEGV crash caused by C-extension conflict in DeepStream container.
_YOLO_AVAILABLE = False
YOLO = None


class SimpleTracker:
    """
    Simple IOU-based tracker (SORT-lite) with EMA bounding-box smoothing
    and velocity estimation to assign consistent person IDs per camera.
    """
    def __init__(self, max_age: int = 15, min_iou: float = 0.25, smoothing_weight: float = 0.70):
        self.next_id = 1
        # id -> {bbox, age, missed, last_time, last_centroid, vx, vy}
        self.tracks: Dict[int, dict] = {}
        self.max_age = max_age
        self.min_iou = min_iou
        self.smoothing_weight = smoothing_weight

    def _iou(self, b1, b2):
        x1 = max(b1[0], b2[0]); y1 = max(b1[1], b2[1])
        x2 = min(b1[2], b2[2]); y2 = min(b1[3], b2[3])
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        a1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
        a2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
        union = a1 + a2 - inter
        return inter / union if union > 0 else 0.0

    def update(self, detections: List[List[float]]) -> List[dict]:
        """
        detections: list of [x1, y1, x2, y2] normalized 0..1
        Returns list of {id, x, y, w, h, floor_x, floor_y, vx, vy, speed} matched tracks
        """
        now = time.time()
        # Age all existing tracks
        for tid in list(self.tracks.keys()):
            self.tracks[tid]["missed"] += 1
            if self.tracks[tid]["missed"] > self.max_age:
                del self.tracks[tid]

        matched_ids = set()
        results = []

        for det in detections:
            best_tid = None
            best_iou = self.min_iou

            for tid, track in self.tracks.items():
                if tid in matched_ids:
                    continue
                iou = self._iou(det, track["bbox"])
                if iou > best_iou:
                    best_iou = iou
                    best_tid = tid

            cx = (det[0] + det[2]) / 2.0
            cy = det[3]

            if best_tid is not None:
                prev = self.tracks[best_tid]
                dt = max(1e-3, now - prev.get("last_time", now))
                prev_c = prev.get("last_centroid", (cx, cy))
                vx = (cx - prev_c[0]) / dt
                vy = (cy - prev_c[1]) / dt

                # Exponential smoothing on bounding box
                w = self.smoothing_weight
                smoothed_bbox = [
                    w * prev["bbox"][0] + (1.0 - w) * det[0],
                    w * prev["bbox"][1] + (1.0 - w) * det[1],
                    w * prev["bbox"][2] + (1.0 - w) * det[2],
                    w * prev["bbox"][3] + (1.0 - w) * det[3],
                ]

                self.tracks[best_tid]["bbox"] = smoothed_bbox
                self.tracks[best_tid]["missed"] = 0
                self.tracks[best_tid]["last_time"] = now
                self.tracks[best_tid]["last_centroid"] = (cx, cy)
                self.tracks[best_tid]["vx"] = vx
                self.tracks[best_tid]["vy"] = vy
                matched_ids.add(best_tid)
                tid = best_tid
                det_to_use = smoothed_bbox
            else:
                tid = self.next_id
                self.next_id += 1
                self.tracks[tid] = {
                    "bbox": det,
                    "missed": 0,
                    "last_time": now,
                    "last_centroid": (cx, cy),
                    "vx": 0.0,
                    "vy": 0.0
                }
                det_to_use = det
                vx, vy = 0.0, 0.0

            x1, y1, x2, y2 = det_to_use
            speed = float(np.hypot(vx, vy))

            results.append({
                "id": tid,
                "x": round(x1, 4),
                "y": round(y1, 4),
                "w": round(x2 - x1, 4),
                "h": round(y2 - y1, 4),
                "floor_x": round((x1 + x2) / 2, 4),
                "floor_y": round(y2, 4),
                "vx": round(float(vx), 3),
                "vy": round(float(vy), 3),
                "speed": round(speed, 3),
                "class": "person",
                "confidence": 0.85
            })

        return results


class CameraPersonTracker:
    """Runs YOLO person detection + SimpleTracker for a single RTSP camera stream."""

    def __init__(self, cam_id: str, rtsp_url: str, model: "YOLO",
                 metadata_callback: Callable, target_fps: int = 8):
        self.cam_id = cam_id
        self.rtsp_url = rtsp_url
        self.model = model
        self.metadata_callback = metadata_callback
        self.target_fps = target_fps
        self.tracker = SimpleTracker()
        self.running = False
        self.thread: Optional[threading.Thread] = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True, name=f"tracker-{self.cam_id}")
        self.thread.start()
        print(f"[PersonTracker] Started tracker for {self.cam_id}", flush=True)

    def stop(self):
        self.running = False

    def _loop(self):
        cap = None
        reconnect_wait = 3.0
        frame_interval = 1.0 / self.target_fps

        while self.running:
            # Open capture
            if cap is None or not cap.isOpened():
                print(f"[PersonTracker] Connecting to {self.cam_id}: {self.rtsp_url}", flush=True)
                cap = cv2.VideoCapture(self.rtsp_url)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if not cap.isOpened():
                    time.sleep(reconnect_wait)
                    continue

            t0 = time.time()
            ret, frame = cap.read()
            if not ret or frame is None:
                cap.release()
                cap = None
                time.sleep(reconnect_wait)
                continue

            try:
                img_h, img_w = frame.shape[:2]
                # Run YOLO inference - class 0 = person only
                # Use CUDA if available, else CPU
                try:
                    import torch
                    _device = 0 if torch.cuda.is_available() else "cpu"
                except Exception:
                    _device = "cpu"

                results = self.model(
                    frame,
                    verbose=False,
                    classes=[0],  # person only
                    conf=0.25,
                    iou=0.45,
                    imgsz=640,
                    device=_device
                )

                detections = []
                if results and len(results) > 0:
                    r = results[0]
                    if r.boxes is not None and len(r.boxes) > 0:
                        boxes_xyxy = r.boxes.xyxy.cpu().numpy()
                        for box in boxes_xyxy:
                            x1 = max(0.0, float(box[0]) / img_w)
                            y1 = max(0.0, float(box[1]) / img_h)
                            x2 = min(1.0, float(box[2]) / img_w)
                            y2 = min(1.0, float(box[3]) / img_h)
                            detections.append([x1, y1, x2, y2])

                tracked = self.tracker.update(detections)

                if self.metadata_callback:
                    self.metadata_callback({
                        "timestamp": int(time.time() * 1000),
                        "streams": [{
                            "cam_id": self.cam_id,
                            "objects": tracked,
                            "tripwire_stats": {}
                        }]
                    })

            except Exception as e:
                print(f"[PersonTracker] Inference error on {self.cam_id}: {e}", flush=True)

            elapsed = time.time() - t0
            sleep_t = max(0.0, frame_interval - elapsed)
            time.sleep(sleep_t)

        if cap:
            cap.release()
        print(f"[PersonTracker] Stopped tracker for {self.cam_id}", flush=True)


class PersonTrackerManager:
    """
    Manages one CameraPersonTracker per camera.
    Acts as fallback when DeepStream is not producing metadata.
    """
    def __init__(self):
        self._trackers: Dict[str, CameraPersonTracker] = {}
        self._model: Optional["YOLO"] = None
        self._lock = threading.Lock()
        self.metadata_callback: Optional[Callable] = None

    def _get_model(self) -> Optional["YOLO"]:
        if not _YOLO_AVAILABLE:
            return None
        if self._model is None:
            # NOTE: .engine files are TensorRT engines for DeepStream, NOT for ultralytics
            # ultralytics can only use .pt or .onnx
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            candidates = [
                os.path.join(base, "models_config", "weights", "yolov8n.onnx"),
                os.path.join(base, "yolov8n.pt"),
                "yolov8n.pt",  # downloads if missing
            ]
            for path in candidates:
                if os.path.exists(path) or path == "yolov8n.pt":
                    try:
                        print(f"[PersonTracker] Loading model from: {path}", flush=True)
                        self._model = YOLO(path)
                        print(f"[PersonTracker] Model loaded OK: {path}", flush=True)
                        break
                    except Exception as e:
                        print(f"[PersonTracker] Failed to load {path}: {e}", flush=True)
        return self._model

    def add_camera(self, cam_id: str, rtsp_url: str):
        with self._lock:
            if cam_id in self._trackers:
                return
            model = self._get_model()
            if model is None:
                print(f"[PersonTracker] No YOLO model available, cannot track {cam_id}", flush=True)
                return
            tracker = CameraPersonTracker(
                cam_id=cam_id,
                rtsp_url=rtsp_url,
                model=model,
                metadata_callback=self.metadata_callback,
                target_fps=8  # 8 FPS inference is smooth enough for tracking display
            )
            tracker.start()
            self._trackers[cam_id] = tracker

    def remove_camera(self, cam_id: str):
        with self._lock:
            tracker = self._trackers.pop(cam_id, None)
            if tracker:
                tracker.stop()

    def active_cameras(self):
        with self._lock:
            return list(self._trackers.keys())


# Global singleton
person_tracker_manager = PersonTrackerManager()
