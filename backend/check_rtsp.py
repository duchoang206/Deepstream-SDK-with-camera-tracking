import asyncio
import os
import cv2
import threading

async def is_rtsp_valid_async(url: str, timeout: float = 2.5) -> bool:
    """
    Robust RTSP probe using OpenCV.
    Enforces a strict timeout and checks if a valid frame can be read.
    """
    try:
        if url.startswith("file://"):
            return True
            
        loop = asyncio.get_running_loop()
        
        def check_opencv():
            # Apply OpenCV strict timeouts for RTSP/FFmpeg backend
            # 2.5 seconds timeout (in microseconds) and TCP transport
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;2500000"
            
            # Start OpenCV capture in a background thread with manual timeout enforcement
            cap = None
            is_valid = [False]
            
            def open_cap():
                nonlocal cap
                try:
                    c = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
                    if c.isOpened():
                        ret, _ = c.read()
                        if ret:
                            is_valid[0] = True
                    cap = c
                except Exception as e:
                    pass
            
            t = threading.Thread(target=open_cap, daemon=True)
            t.start()
            t.join(timeout=timeout + 0.5) # slightly larger than OpenCV stimeout
            
            if cap:
                cap.release()
                
            return is_valid[0]
            
        return await loop.run_in_executor(None, check_opencv)
    except Exception as e:
        print(f"[check_rtsp] Error checking {url}: {e}", flush=True)
        return False
