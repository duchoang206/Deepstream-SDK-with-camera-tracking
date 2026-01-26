#!/usr/bin/env python3
"""
Synthetic Multi-Camera Test Stream Generator.

Generates test video files or live streaming patterns with bounding boxes,
timestamps, and camera IDs for offline testing and DeepStream pipeline simulation.
"""

import time
import os
import argparse
import logging
import cv2
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("MockStreamGenerator")


def create_synthetic_camera_frame(
    camera_id: int,
    frame_index: int,
    width: int = 1280,
    height: int = 720
) -> np.ndarray:
    """
    Generate a single synthetic frame with animated simulated moving targets and HUD.
    """
    # Create dark futuristic background
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    
    # Grid background lines
    grid_size = 80
    for x in range(0, width, grid_size):
        cv2.line(frame, (x, 0), (x, height), (30, 35, 45), 1)
    for y in range(0, height, grid_size):
        cv2.line(frame, (y, 0), (y, width), (30, 35, 45), 1)
        
    # Simulated moving object (Person)
    speed_x = 4
    obj_x = int((frame_index * speed_x + camera_id * 200) % (width - 100))
    obj_y = int(250 + 50 * np.sin(frame_index * 0.05 + camera_id))
    box_w, box_h = 70, 160
    
    # Draw simulated bounding box
    cv2.rectangle(
        frame,
        (obj_x, obj_y),
        (obj_x + box_w, obj_y + box_h),
        (0, 255, 128),
        2
    )
    cv2.putText(
        frame,
        f"Person #{(camera_id * 10) + 1} (96%)",
        (obj_x, obj_y - 8),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (0, 255, 128),
        1,
        cv2.LINE_AA
    )
    
    # Simulated restricted zone
    zone_pts = np.array([
        [int(width * 0.5), int(height * 0.4)],
        [int(width * 0.85), int(height * 0.4)],
        [int(width * 0.80), int(height * 0.8)],
        [int(width * 0.45), int(height * 0.8)]
    ], np.int32)
    cv2.polylines(frame, [zone_pts], isClosed=True, color=(0, 0, 255), thickness=2)
    cv2.putText(
        frame,
        "ZONE: RESTRICTED",
        (int(width * 0.5) + 10, int(height * 0.4) + 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (0, 0, 255),
        2
    )

    # Top overlay header
    cv2.rectangle(frame, (0, 0), (width, 50), (20, 20, 25), -1)
    timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S")
    cv2.putText(
        frame,
        f"CAM #{camera_id:02d} | LIVE FEED | {timestamp_str} | FRAME #{frame_index:05d}",
        (20, 32),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 220, 255),
        2,
        cv2.LINE_AA
    )
    
    return frame


def generate_mock_video_file(
    output_path: str,
    camera_id: int = 1,
    duration_sec: int = 10,
    fps: int = 30,
    width: int = 1280,
    height: int = 720
):
    """
    Generate an MP4 video file simulating a camera stream.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    total_frames = duration_sec * fps
    logger.info(f"Generating {total_frames} frames for Cam #{camera_id} -> {output_path}")
    
    for i in range(total_frames):
        frame = create_synthetic_camera_frame(camera_id, i, width, height)
        out.write(frame)
        
    out.release()
    logger.info(f"Successfully created mock stream video: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mock Camera Video Stream Generator")
    parser.add_argument("--out", type=str, default="sample_cam.mp4", help="Output video file path")
    parser.add_argument("--cam_id", type=int, default=1, help="Camera ID")
    parser.add_argument("--duration", type=int, default=10, help="Duration in seconds")
    args = parser.parse_args()
    
    generate_mock_video_file(args.out, camera_id=args.cam_id, duration_sec=args.duration)
