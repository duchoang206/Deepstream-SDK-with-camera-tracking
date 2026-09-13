import os
import cv2
import threading
import time
import queue
from typing import Tuple, Optional, Dict, Any

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

class RTSPLatestFrameReader:
    """
    RTSP stream reader using background thread buffering that automatically drops old frames.
    Keeps only the latest frame in memory using a Queue with maxsize=1.
    Implements exponential backoff reconnects and frame ingestion metrics.
    """
    def __init__(self, rtsp_url: Any, cam_id: str = "Cam_1", max_reconnect_attempts: int = -1):
        self.rtsp_url = rtsp_url
        self.cam_id = cam_id
        self.max_reconnect_attempts = max_reconnect_attempts
        
        # Telemetry metrics
        self.frames_received = 0
        self.frames_dropped = 0
        self.reconnect_count = 0
        self.is_connected = False
        self._last_fps_time = time.time()
        self._fps_counter = 0
        self.current_fps = 0.0

        # Initialize video capture
        self.cap = cv2.VideoCapture(self.rtsp_url)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if self.cap.isOpened():
            self.is_connected = True
        
        # Queue that holds maximum 1 frame
        self.frame_queue = queue.Queue(maxsize=1) 
        self.running = True
        
        # Start the background thread to continuously read frames
        self.thread = threading.Thread(target=self._capture_frames, daemon=True, name=f"rtsp-{self.cam_id}")
        self.thread.start()

    def _capture_frames(self):
        attempts = 0
        backoff_delay = 1.0

        while self.running:
            if not self.cap or not self.cap.isOpened():
                self.is_connected = False
                attempts += 1
                self.reconnect_count += 1
                print(f"[{self.cam_id}] Reconnecting to RTSP (Attempt {attempts}, wait {backoff_delay:.1f}s)...")
                time.sleep(backoff_delay)
                backoff_delay = min(16.0, backoff_delay * 1.5)
                
                self.cap = cv2.VideoCapture(self.rtsp_url)
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                
                if self.max_reconnect_attempts > 0 and attempts > self.max_reconnect_attempts:
                    print(f"[{self.cam_id}] Max reconnect attempts reached. Stopping thread.")
                    self.running = False
                    break
                continue
            
            # Reset backoff on successful connection
            attempts = 0
            backoff_delay = 1.0
            self.is_connected = True

            ret, frame = self.cap.read()
            if not ret or frame is None:
                print(f"[{self.cam_id}] Failed to read frame. Attempting to reconnect...")
                self.is_connected = False
                self.cap.release()
                time.sleep(1.0)
                continue
            
            self.frames_received += 1
            self._fps_counter += 1
            now = time.time()
            if now - self._last_fps_time >= 1.0:
                self.current_fps = round(self._fps_counter / (now - self._last_fps_time), 1)
                self._fps_counter = 0
                self._last_fps_time = now

            # If the queue is full, remove the old frame before adding the new one
            if self.frame_queue.full():
                try:
                    self.frame_queue.get_nowait()
                    self.frames_dropped += 1
                except queue.Empty:
                    pass
            
            # Put the latest frame into the queue
            self.frame_queue.put(frame)

    def get_latest_frame(self) -> Tuple[bool, Optional[Any]]:
        """
        Returns the most recent frame captured by the background thread.
        Should be called by the AI processing loop.
        
        Returns:
            (bool, np.ndarray): True and the frame if successful, False and None otherwise.
        """
        try:
            return True, self.frame_queue.get_nowait()
        except queue.Empty:
            return False, None

    def get_metrics(self) -> Dict[str, Any]:
        """Return runtime stream statistics."""
        return {
            "cam_id": self.cam_id,
            "connected": self.is_connected,
            "fps": self.current_fps,
            "frames_received": self.frames_received,
            "frames_dropped": self.frames_dropped,
            "reconnect_count": self.reconnect_count
        }

    def stop(self):
        """Gracefully stops the background thread and releases resources."""
        self.running = False
        if self.thread.is_alive():
            self.thread.join(timeout=2)
        if self.cap:
            self.cap.release()
        self.is_connected = False
        print(f"[{self.cam_id}] RTSP Reader stopped successfully.")

if __name__ == "__main__":
    print("Testing RTSPLatestFrameReader...")
    reader = RTSPLatestFrameReader(0, cam_id="Test_Cam")
    time.sleep(1)
    try:
        for _ in range(20):
            ret, frame = reader.get_latest_frame()
            time.sleep(0.05)
        print("Reader metrics:", reader.get_metrics())
    finally:
        reader.stop()
