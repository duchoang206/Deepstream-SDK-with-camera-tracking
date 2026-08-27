import cv2
import numpy as np
import os

videos_info = [
    {
        "filename": "20260826_143512_cam0_intrusion_CARFULL.mp4",
        "cam": "CAM 01 - CỬA KHO A",
        "event": "INTRUSION DETECTED",
        "status": "STATUS: CARFULL / OCCUPIED",
        "time": "2026-08-26 14:35:12",
        "color": (50, 50, 240), # Red / Rose
        "obj_name": "CARGO_ROBOT #102"
    },
    {
        "filename": "20260826_141205_cam1_intrusion_OCCUPIED.mp4",
        "cam": "CAM 02 - CỬA THOÁT HIỂM",
        "event": "RESTRICTED AREA INTRUSION",
        "status": "STATUS: OCCUPIED",
        "time": "2026-08-26 14:12:05",
        "color": (50, 50, 240),
        "obj_name": "PERSON #105"
    },
    {
        "filename": "20260826_135840_cam0_tripwire_IN.mp4",
        "cam": "CAM 01 - CỔNG RA VÀO",
        "event": "TRIPWIRE CROSSED",
        "status": "DIRECTION: ENTRY (IN)",
        "time": "2026-08-26 13:58:40",
        "color": (220, 180, 20), # Cyan
        "obj_name": "FORKLIFT #98"
    },
    {
        "filename": "20260826_132015_cam2_dwell_time_TIMEOUT.mp4",
        "cam": "CAM 03 - KHU BỐC DỠ",
        "event": "DWELL TIME EXCEEDED (>20s)",
        "status": "STATUS: DWELLING_TIMEOUT",
        "time": "2026-08-26 13:20:15",
        "color": (20, 160, 245), # Amber
        "obj_name": "AGV_ROBOT #87"
    },
    {
        "filename": "20260826_124500_cam1_density_CROWD_ALERT.mp4",
        "cam": "CAM 02 - SẢNH CHÍNH",
        "event": "HIGH CROWD DENSITY",
        "status": "COUNT: 8 PERSONS",
        "time": "2026-08-26 12:45:00",
        "color": (200, 100, 220), # Violet
        "obj_name": "CROWD_GROUP"
    }
]

out_dirs = [
    os.path.abspath("web-dashboard/public/recordings"),
    os.path.abspath("backend/recordings")
]

for d in out_dirs:
    os.makedirs(d, exist_ok=True)

width, height = 640, 360
fps = 20
num_frames = 60 # 3-second clip

for info in videos_info:
    for out_dir in out_dirs:
        filepath = os.path.join(out_dir, info["filename"])
        # Use mp4v or avc1
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(filepath, fourcc, fps, (width, height))
        
        for frame_idx in range(num_frames):
            # Create dark surveillance scene
            frame = np.zeros((height, width, 3), dtype=np.uint8)
            frame[:] = (18, 22, 28)
            
            # Draw perspective floor grid lines
            for i in range(0, width, 50):
                cv2.line(frame, (i, int(height*0.3)), (int((i - width/2)*2.5 + width/2), height), (35, 42, 54), 1)
            for j in range(int(height*0.3), height, 25):
                cv2.line(frame, (0, j), (width, j), (35, 42, 54), 1)
                
            # Draw surveillance HUD Header
            cv2.rectangle(frame, (0, 0), (width, 36), (10, 12, 16), -1)
            cv2.line(frame, (0, 36), (width, 36), (60, 75, 95), 1)
            cv2.putText(frame, f"[VMS-EVIDENCE] {info['cam']}", (14, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 245), 2)
            cv2.putText(frame, f"{info['time']} - 25 FPS", (width - 240, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160, 175, 195), 1)

            # Draw flashing REC indicator
            if (frame_idx // 10) % 2 == 0:
                cv2.circle(frame, (width - 260, 20), 5, (50, 50, 240), -1)
                cv2.putText(frame, "REC", (width - 295, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (50, 50, 240), 2)

            # Animated moving object with bounding box
            progress = frame_idx / float(num_frames)
            box_x = int(120 + progress * 200)
            box_y = int(110 + np.sin(progress * np.pi) * 30)
            box_w, box_h = 130, 150
            
            # ROI polygon (zone)
            roi_pts = np.array([[100, 120], [380, 120], [450, 310], [80, 310]], np.int32)
            cv2.polylines(frame, [roi_pts], True, (60, 80, 120), 2)
            cv2.putText(frame, "RESTRICTED ROI ZONE", (110, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 130, 180), 1)

            # Draw tracked bounding box
            cv2.rectangle(frame, (box_x, box_y), (box_x + box_w, box_y + box_h), info["color"], 2)
            cv2.rectangle(frame, (box_x, box_y - 24), (box_x + box_w, box_y), info["color"], -1)
            cv2.putText(frame, info["obj_name"], (box_x + 6, box_y - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)
            
            # Event banner on bottom
            cv2.rectangle(frame, (0, height - 42), (width, height), (10, 12, 16), -1)
            cv2.line(frame, (0, height - 42), (width, height - 42), info["color"], 2)
            cv2.putText(frame, f"{info['event']} | {info['status']}", (14, height - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, info["color"], 2)

            out.write(frame)
            
        out.release()
        print(f"Generated sample video: {filepath}")
