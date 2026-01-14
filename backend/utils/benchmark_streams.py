#!/usr/bin/env python3
"""
Stream Benchmarking and Diagnostics Utility.

Measures throughput, FPS, latency, and connection stability for RTSP/Video camera sources.
"""

import time
import argparse
import logging
from typing import Dict, Any, List
import cv2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("BenchmarkStreams")


def benchmark_stream(
    rtsp_url: str,
    duration_seconds: int = 10,
    camera_name: str = "Camera"
) -> Dict[str, Any]:
    """
    Connect to an RTSP stream and measure frames received, FPS, and jitter.
    """
    logger.info(f"Starting benchmark for '{camera_name}' at: {rtsp_url}")
    
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    
    # Set network buffer flags if available
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
    
    if not cap.isOpened():
        logger.error(f"Failed to open stream: {rtsp_url}")
        return {
            "camera_name": camera_name,
            "url": rtsp_url,
            "status": "ERROR",
            "message": "Cannot open video stream"
        }
    
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    nominal_fps = cap.get(cv2.CAP_PROP_FPS)
    
    start_time = time.time()
    frames_read = 0
    read_latencies: List[float] = []
    
    try:
        while time.time() - start_time < duration_seconds:
            t0 = time.time()
            ret, frame = cap.read()
            t1 = time.time()
            
            if not ret or frame is None:
                time.sleep(0.01)
                continue
                
            frames_read += 1
            read_latencies.append((t1 - t0) * 1000.0)  # ms
            
    finally:
        cap.release()
        
    total_elapsed = time.time() - start_time
    actual_fps = frames_read / total_elapsed if total_elapsed > 0 else 0.0
    avg_latency = sum(read_latencies) / len(read_latencies) if read_latencies else 0.0
    
    result = {
        "camera_name": camera_name,
        "url": rtsp_url,
        "status": "HEALTHY" if actual_fps > 5.0 else "DEGRADED",
        "resolution": f"{width}x{height}",
        "nominal_fps": round(nominal_fps, 2),
        "actual_fps": round(actual_fps, 2),
        "frames_received": frames_read,
        "avg_frame_read_ms": round(avg_latency, 2),
        "duration_sec": round(total_elapsed, 2)
    }
    
    logger.info(
        f"Benchmark result for {camera_name}: "
        f"FPS={result['actual_fps']} | Res={result['resolution']} | "
        f"AvgReadLatency={result['avg_frame_read_ms']}ms"
    )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DeepStream Camera Stream Benchmark Tool")
    parser.add_argument("--url", type=str, default="rtsp://localhost:8554/cam1", help="RTSP stream URL")
    parser.add_argument("--duration", type=int, default=10, help="Benchmark duration in seconds")
    parser.add_argument("--name", type=str, default="TestCam", help="Camera identifier")
    args = parser.parse_args()
    
    res = benchmark_stream(args.url, args.duration, args.name)
    print("\n--- Summary Report ---")
    for k, v in res.items():
        print(f"{k:>20}: {v}")
