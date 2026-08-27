import faulthandler
faulthandler.enable()

import os
import sys
import uuid
import json
import asyncio
import requests
import cv2
from typing import Dict, List, Set, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core.database import db_manager
from utils.circular_logger import app_logger
from core.deepstream_engine import deepstream_manager, sanitize_rtsp_url
from core.camera_calibrator import camera_calibrator
from core.behavior_analytics import behavior_engine
from core.reid_matcher import global_reid


app = FastAPI(title="RTC VMS (R-SkyView) - Real-time Decoupled Multi-Camera Analytics", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import Request
from fastapi.responses import JSONResponse
import logging

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logging.error(f"Global Exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"}
    )

MEDIAMTX_API = os.getenv("MEDIAMTX_API", "http://127.0.0.1:9997/v3/config/paths")

# In-memory registry of active cameras
cameras: Dict[str, dict] = {}

from fastapi.responses import StreamingResponse
import httpx

class ChatMessage(BaseModel):
    text: str
    chat_history: Optional[str] = ""

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")

SYSTEM_PROMPT_TEMPLATE = """Bạn là Trợ lý Ảo AI chuyên trách hỗ trợ vận hành và hướng dẫn sử dụng hệ thống RTC VMS.
Nhiệm vụ của bạn là giải đáp thắc mắc, hướng dẫn người dùng thao tác giao diện hoặc cung cấp thông tin trạng thái hoạt động của hệ thống dựa CHÍNH XÁC vào các khối thông tin được cung cấp bên dưới.

### NGUYÊN TẮC BẮT BUỘC:
1. Độ ưu tiên thông tin:
   - Nếu câu hỏi liên quan đến số lượng camera, số cảnh báo, trạng thái runtime hoặc sự kiện vừa xảy ra: Hãy đọc và sử dụng thông tin trong mục [TRẠNG THÁI HỆ THỐNG THỜI GIAN THỰC].
   - Nếu câu hỏi là hướng dẫn thao tác, cách cấu hình, ý nghĩa các tab/nút bấm, thuật toán: Hãy đọc và sử dụng thông tin trong mục [TÀI LIỆU HƯỚNG DẪN KỸ THUẬT].
2. Tính trung thực & Giới hạn dữ liệu:
   - CHỈ trả lời dựa trên 2 nguồn dữ liệu được cấp. Tuyệt đối không tự suy diễn hoặc bịa đặt số liệu/tính năng không có trong tài liệu.
   - Nếu cả 2 nguồn đều không có thông tin để trả lời câu hỏi, hãy phản hồi: "Xin lỗi, hiện tôi không tìm thấy thông tin/dữ liệu tương ứng trong hệ thống. Vui lòng liên hệ quản trị viên."
3. Phong cách phản hồi:
   - Ngắn gọn, súc tích, đi thẳng vào câu trả lời (tối đa 2 - 4 câu hoặc dùng gạch đầu dòng rõ ràng).
   - Sử dụng tiếng Việt tự nhiên và giữ nguyên các thuật ngữ kỹ thuật trên giao diện (ví dụ: *Monitor*, *Building*, *Analytics*, *WHEP WebRTC*, *Homography 2D*, *MTMC Fusion*).

---
[TRẠNG THÁI HỆ THỐNG THỜI GIAN THỰC]:
{system_state_context}
---

[TÀI LIỆU HƯỚNG DẪN KỸ THUẬT]:
{retrieved_pdf_context}
---

[LỊCH SỬ HỘI THOẠI]:
{chat_history}

[CÂU HỎI CỦA NGƯỜI DÙNG]:
{user_query}

[TRẢ LỜI]:
"""

@app.post("/api/chat")
async def chat_with_bot(req: ChatMessage):
    user_query = req.text
    chat_history = req.chat_history if req.chat_history else "Không có"
    
    # 1. Routing nhẹ: Kiểm tra xem query có cần dữ liệu DB thời gian thực không
    realtime_keywords = ["mấy camera", "bao nhiêu cam", "cảnh báo", "trạng thái", "online", "sự kiện"]
    needs_realtime = any(kw in user_query.lower() for kw in realtime_keywords)
    
    # 2. Lấy dữ liệu động từ PostgreSQL / Memory
    if needs_realtime:
        stats = db_manager.get_dashboard_stats(len(cameras))
        system_state_context = f"- Số camera đang hoạt động: {len(cameras)}\n"
        system_state_context += f"- Tổng số cảnh báo hôm nay: {stats.get('total_alarms', 0)}\n"
        system_state_context += f"- Trạng thái AI Engine: Hoạt động (WHEP WebRTC Active)"
    else:
        system_state_context = "Không có yêu cầu kiểm tra trạng thái thời gian thực."

    # 3. Lấy dữ liệu tĩnh từ ChromaDB (PDF Chunks)
    from core.rag_manager import rag_engine
    retrieved_pdf_context = rag_engine.query_rag(user_query, top_k=2)

    # 4. Ghép hoàn chỉnh Prompt
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        system_state_context=system_state_context,
        retrieved_pdf_context=retrieved_pdf_context,
        chat_history=chat_history,
        user_query=user_query
    )
    
    async def generate_response():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream('POST', OLLAMA_URL, json={
                    "model": "qwen2.5:1.5b",
                    "prompt": prompt,
                    "stream": True
                }) as response:
                    # Nếu Ollama chưa chạy, sẽ báo lỗi ở đây
                    async for chunk in response.aiter_lines():
                        if chunk:
                            try:
                                data = json.loads(chunk)
                                if 'response' in data:
                                    yield data['response']
                            except:
                                pass
        except Exception as e:
            logging.error(f"Ollama Error: {str(e)}")
            yield "Xin lỗi, hiện tại tôi không thể kết nối tới mô hình AI (Ollama). Vui lòng kiểm tra lại cấu hình."
                        
    return StreamingResponse(generate_response(), media_type="text/plain")
# Active WebSocket connections
connected_metadata_ws: Set[WebSocket] = set()
connected_event_ws: Set[WebSocket] = set()
loop: Optional[asyncio.AbstractEventLoop] = None

# --- REQUEST MODELS ---
class CameraAddRequest(BaseModel):
    name: str
    rtsp_url: str

class CalibrationRequest(BaseModel):
    src_points: List[List[float]] # 4 points normalized [[x,y]...]
    dst_points: List[List[float]] # 4 points floor map [[X,Y]...]
    cam_x: Optional[float] = None
    cam_y: Optional[float] = None
    cam_z: Optional[float] = None
    yaw: Optional[float] = None

class RuleItem(BaseModel):
    id: str
    type: str # intrusion, tripwire, dwell_time, density
    name: str
    points: List[List[float]] # polygon or line coordinates
    target_objects: Optional[List[str]] = ["robot", "rack"]
    threshold: Optional[float] = 10.0
    direction: Optional[str] = "both"

class SaveRulesRequest(BaseModel):
    rules: List[RuleItem]

# --- ASYNC EVENT & METADATA BROADCASTERS ---
def broadcast_metadata_sync(payload: dict):
    if not connected_metadata_ws or not loop:
        return
    msg = json.dumps(payload)
    asyncio.run_coroutine_threadsafe(_broadcast_to_set(connected_metadata_ws, msg), loop)

def broadcast_event_sync(event_payload: dict):
    if not connected_event_ws or not loop:
        return
    msg = json.dumps(event_payload)
    asyncio.run_coroutine_threadsafe(_broadcast_to_set(connected_event_ws, msg), loop)

async def _broadcast_to_set(target_set: Set[WebSocket], msg: str):
    disconnected = set()
    for ws in list(target_set):
        try:
            await ws.send_text(msg)
        except Exception:
            disconnected.add(ws)
    for ws in disconnected:
        target_set.discard(ws)

@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_running_loop()

    # Khởi tạo RAG (Load PDF into ChromaDB)
    from core.rag_manager import rag_engine
    rag_pdf_path = os.path.join(os.path.dirname(__file__), "rag_data", "main-10.pdf")
    rag_engine.initialize_with_pdf(rag_pdf_path)

    # Wire DeepStream to the metadata broadcast callback
    deepstream_manager.metadata_callback = broadcast_metadata_sync
    deepstream_manager.event_callback = broadcast_event_sync

    # Pre-populate cameras from DB
    db_cams = db_manager.get_all_cameras()
    for c in db_cams:
        cam_id = c["id"]
        clean_url = sanitize_rtsp_url(c["rtsp_url"])
        cameras[cam_id] = {
            "id": cam_id,
            "name": c["name"],
            "rtsp_url": clean_url,
            "calibration": c.get("calibration_points"),
            "cam_x": c.get("cam_x"),
            "cam_y": c.get("cam_y"),
            "cam_z": c.get("cam_z"),
            "yaw": c.get("yaw"),
            "fov_polygon": c.get("fov_polygon"),
            "status": "online"
        }
        
        # Ensure MediaMTX knows about this stream (useful on restarts)
        try:
            res = requests.post(f"{MEDIAMTX_API}/add/{cam_id}", json={
                "source": clean_url,
                "sourceOnDemand": False,
                "rtspTransport": "tcp"
            }, timeout=2)
            if res.status_code not in (200, 201):
                requests.post(f"{MEDIAMTX_API}/patch/{cam_id}", json={"source": clean_url}, timeout=2)
        except Exception as e:
            print(f"[MediaMTX] Startup proxy path registration failed for {cam_id}: {e}")

    # Collect all cameras for static pre-loading into the pipeline (safe DeepStream pattern)
    # Only cameras reachable via TCP are added initially.
    # nvinfer SIGABRT/Segfault when ALL nvurisrcbin sources are unreachable simultaneously.
    initial_sources = []
    offline_cameras = []

    for cam_id, c in cameras.items():
        rtsp_url = c["rtsp_url"]

        # Load calibration if available
        calib_pts = c.get("calibration")
        if calib_pts and isinstance(calib_pts, dict):
            camera_calibrator.set_calibration(
                cam_id,
                calib_pts.get("src_points", []),
                calib_pts.get("dst_points", []),
                c.get("cam_x"),
                c.get("cam_y"),
                c.get("cam_z"),
                c.get("yaw")
            )
        # Load behavior rules
        rules = db_manager.get_rules_by_camera(cam_id)
        if rules:
            behavior_engine.set_rules(cam_id, rules)

        # Check reachability (8s timeout, 2 retries) before adding to pipeline.
        # DeepStream nvinfer crashes if ALL sources are unreachable simultaneously.
        # nvurisrcbin handles reconnect internally once in PLAYING state.
        is_reachable = False
        for attempt in range(2):
            try:
                from check_rtsp import is_rtsp_valid_async
                is_reachable = await is_rtsp_valid_async(rtsp_url, timeout=8)
                if is_reachable:
                    break
            except Exception:
                is_reachable = False

        if is_reachable:
            initial_sources.append((cam_id, rtsp_url))
            print(f"[Main] Camera {cam_id} reachable - will add to pipeline.", flush=True)
        else:
            offline_cameras.append((cam_id, rtsp_url))
            print(f"[Main] Camera {cam_id} unreachable at startup - will retry in background.", flush=True)


    # Start DeepStream Pipeline with reachable cameras pre-loaded (NULL → PLAYING in one step).
    # This avoids the SIGABRT caused by dynamic source add on a running nvinfer pipeline.
    deepstream_manager.start(initial_sources=initial_sources if initial_sources else None)

    # Schedule background retry for offline cameras
    if offline_cameras:
        asyncio.ensure_future(_retry_offline_cameras(offline_cameras))

    print(f"[Main] Startup complete. {len(initial_sources)} cameras online, {len(offline_cameras)} retrying.", flush=True)


async def _retry_offline_cameras(offline_list: list, interval: int = 30):
    """Background task: retry adding offline cameras to the pipeline every `interval` seconds."""
    remaining = list(offline_list)
    while remaining:
        await asyncio.sleep(interval)
        still_offline = []
        for cam_id, rtsp_url in remaining:
            try:
                from check_rtsp import is_rtsp_valid_async
                is_reachable = await is_rtsp_valid_async(rtsp_url, timeout=5)
            except Exception:
                is_reachable = False

            if is_reachable:
                print(f"[Main] Camera {cam_id} is now reachable - adding to pipeline.", flush=True)
                deepstream_manager.add_source(cam_id, rtsp_url)
            else:
                still_offline.append((cam_id, rtsp_url))

        remaining = still_offline
        if remaining:
            print(f"[Main] Still waiting for {len(remaining)} offline camera(s) to come online.", flush=True)
        else:
            print("[Main] All cameras are now online.", flush=True)



# --- WEBSOCKET ENDPOINTS ---
@app.websocket("/ws/metadata")
async def websocket_metadata_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_metadata_ws.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_metadata_ws.discard(websocket)
    except Exception:
        connected_metadata_ws.discard(websocket)

@app.websocket("/ws/events")
async def websocket_events_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_event_ws.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_event_ws.discard(websocket)
    except Exception:
        connected_event_ws.discard(websocket)

# --- CAMERA MANAGEMENT API ---
@app.post("/api/v1/streams/add")
@app.post("/api/camera/add")
async def add_camera(request: CameraAddRequest):
    cam_id = str(uuid.uuid4())[:8]
    clean_url = sanitize_rtsp_url(request.rtsp_url)
    
    # 1. Check RTSP asynchronously with 2.5s timeout (non-blocking)
    from check_rtsp import is_rtsp_valid_async
    is_valid = await is_rtsp_valid_async(clean_url, timeout=2.5)
    
    status = "online" if is_valid else "offline"

    # 2. Save to DB decoupled from pipeline
    try:
        db_manager.save_camera(cam_id, request.name, clean_url)
    except Exception as e:
        print(f"[Main] Database save camera warning: {e}")
        
    cameras[cam_id] = {
        "id": cam_id,
        "name": request.name,
        "rtsp_url": clean_url,
        "status": status
    }
    
    # 3. Register Camera Stream in MediaMTX for direct WebRTC/WHEP streaming (background / fast)
    try:
        res = requests.post(f"{MEDIAMTX_API}/add/{cam_id}", json={
            "source": clean_url,
            "sourceOnDemand": False,
            "rtspTransport": "tcp"
        }, timeout=1.5)
        if res.status_code not in (200, 201):
            requests.post(f"{MEDIAMTX_API}/patch/{cam_id}", json={"source": clean_url}, timeout=1.0)
    except Exception as e:
        print(f"[MediaMTX] Note: proxy path registration: {e}")

    # 4. If stream is not reachable, return HTTP 400 gracefully
    if not is_valid:
        raise HTTPException(status_code=400, detail="Không thể kết nối tới RTSP IP, vui lòng kiểm tra mạng.")

    # 5. If valid, safely add to DeepStream engine (via GLib.idle_add internally)
    deepstream_manager.add_source(cam_id, clean_url)
    
    return {"status": "success", "camera": cameras[cam_id]}

class CameraUpdateRequest(BaseModel):
    name: Optional[str] = None
    rtsp_url: Optional[str] = None

@app.patch("/api/camera/{cam_id}")
async def update_camera(cam_id: str, request: CameraUpdateRequest):
    if cam_id not in cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    cam = cameras[cam_id]
    if request.name:
        cam["name"] = request.name
    if request.rtsp_url:
        clean_url = sanitize_rtsp_url(request.rtsp_url)
        cam["rtsp_url"] = clean_url
        try:
            requests.post(f"{MEDIAMTX_API}/patch/{cam_id}", json={"source": clean_url}, timeout=2)
        except Exception:
            pass
        deepstream_manager.delete_source(cam_id)
        deepstream_manager.add_source(cam_id, clean_url)

    db_manager.save_camera(cam_id, cam["name"], cam["rtsp_url"])
    return {"status": "success", "camera": cam}

@app.delete("/api/v1/streams/{cam_id}")
@app.delete("/api/camera/{cam_id}")
async def delete_camera(cam_id: str):
    if cam_id not in cameras:
        raise HTTPException(status_code=404, detail="Camera not found")

    deepstream_manager.delete_source(cam_id)
    try:
        requests.post(f"{MEDIAMTX_API}/delete/{cam_id}", timeout=2)
    except Exception:
        pass

    db_manager.delete_camera(cam_id)
    del cameras[cam_id]
    return {"status": "success", "deleted_id": cam_id}

@app.get("/api/v1/streams/list")
@app.get("/api/camera/list")
async def list_cameras():
    return {
        "status": "success",
        "cameras": list(cameras.values())
    }

@app.get("/api/camera/{cam_id}/snapshot")
async def get_camera_snapshot(cam_id: str):
    if cam_id not in cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    def _grab():
        rtsp_url = f"rtsp://localhost:8554/{cam_id}"
        cap = cv2.VideoCapture(rtsp_url)
        ret, frame = cap.read()
        cap.release()
        
        if not ret or frame is None:
            direct_url = cameras[cam_id].get("rtsp_url")
            if direct_url:
                cap = cv2.VideoCapture(direct_url)
                ret, frame = cap.read()
                cap.release()
                
        if not ret or frame is None:
            return None
            
        ret_encode, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ret_encode:
            return None
        return buffer.tobytes()

    loop = asyncio.get_event_loop()
    img_bytes = await loop.run_in_executor(None, _grab)
    if img_bytes is None:
        raise HTTPException(status_code=500, detail="Không thể chụp snapshot từ camera")
        
    return Response(content=img_bytes, media_type="image/jpeg")

# --- CAMERA CALIBRATION API (2D-to-Floor-Map) ---
@app.post("/api/camera/{cam_id}/calibration")
async def save_camera_calibration(cam_id: str, calib: CalibrationRequest):
    if cam_id not in cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    success = camera_calibrator.set_calibration(cam_id, calib.src_points, calib.dst_points, calib.cam_x, calib.cam_y, calib.cam_z, calib.yaw)
    if not success:
        raise HTTPException(status_code=400, detail="Không thể tính ma trận biến đổi từ các điểm đã chọn")
        
    cfg = camera_calibrator.get_config(cam_id)
    if cfg:
        db_manager.save_calibration(cam_id, calib.src_points, calib.dst_points, cfg["matrix"], calib.cam_x, calib.cam_y, calib.cam_z, calib.yaw, cfg.get("fov_polygon"))
        cameras[cam_id]["calibration"] = cfg
        cameras[cam_id]["cam_x"] = calib.cam_x
        cameras[cam_id]["cam_y"] = calib.cam_y
        cameras[cam_id]["cam_z"] = calib.cam_z
        cameras[cam_id]["yaw"] = calib.yaw
        cameras[cam_id]["fov_polygon"] = cfg.get("fov_polygon")
        
    return {"status": "success", "config": cfg}

@app.get("/api/camera/{cam_id}/calibration")
async def get_camera_calibration(cam_id: str):
    cfg = camera_calibrator.get_config(cam_id)
    return {"status": "success", "calibration": cfg}

@app.get("/api/calibration/map-overview")
async def get_map_overview():
    calibrations = []
    for cam_id, cam in cameras.items():
        if "calibration" in cam and cam["calibration"]:
            calibrations.append({
                "cam_id": cam_id,
                "name": cam["name"],
                "calibration": cam["calibration"]
            })
    return {"status": "success", "calibrations": calibrations}

# --- BEHAVIOR RULES (ROI & TRIPWIRES) API ---
@app.post("/api/camera/{cam_id}/rules")
@app.post("/api/camera/{cam_id}/roi")
async def save_camera_rules(cam_id: str, req: SaveRulesRequest):
    if cam_id not in cameras:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    rules_dict_list = []
    for r in req.rules:
        r_dict = {
            "id": r.id,
            "cam_id": cam_id,
            "type": r.type,
            "name": r.name,
            "points": r.points,
            "target_objects": r.target_objects,
            "threshold": r.threshold,
            "direction": r.direction
        }
        db_manager.save_rule(r_dict)
        rules_dict_list.append(r_dict)
        
    behavior_engine.set_rules(cam_id, rules_dict_list)
    return {"status": "success", "rules_count": len(rules_dict_list)}

@app.get("/api/camera/{cam_id}/rules")
async def get_camera_rules(cam_id: str):
    rules = db_manager.get_rules_by_camera(cam_id)
    return {"status": "success", "rules": rules}

# --- ON-DEMAND ANALYTICS & EVENTS API (PostgreSQL Storage) ---
@app.get("/api/analytics/dashboard")
async def get_dashboard_analytics():
    stats = db_manager.get_dashboard_stats(active_cameras_count=len(cameras))
    return stats

@app.get("/api/analytics/classes")
@app.get("/api/model/classes")
async def get_model_classes():
    labels_file = os.path.join(os.path.dirname(__file__), "models_config", "labels.txt")
    classes = []
    try:
        with open(labels_file, "r") as f:
            classes = [line.strip() for line in f.readlines() if line.strip()]
    except Exception as e:
        import logging
        logging.error(f"Error reading labels.txt: {e}")
        classes = ["robot", "rack"]
    return {"status": "success", "classes": classes}

@app.get("/api/events/list")
async def list_events(
    limit: int = Query(50, ge=1, le=500),
    rule_type: Optional[str] = None,
    cam_id: Optional[str] = None
):
    events = db_manager.get_events_list(limit=limit, rule_type=rule_type, cam_id=cam_id)
    return {"status": "success", "events": events}

@app.get("/api/tracks/{global_id}/history")
async def get_track_history(global_id: int):
    # Try in-memory track history first, fallback to DB
    mem_history = global_reid.get_track_history(global_id)
    if mem_history:
        return {"status": "success", "source": "realtime", "data": mem_history}
        
    db_history = db_manager.get_global_track_journey(global_id)
    return {
        "status": "success",
        "source": "database",
        "data": {
            "global_id": global_id,
            "trajectory": db_history
        }
    }

@app.get("/api/debug/pipeline")
async def debug_pipeline():
    """Debug endpoint: inspect DeepStream pipeline state and source mappings."""
    manager = deepstream_manager
    return {
        "is_running": manager.is_running,
        "pipeline_exists": manager.pipeline is not None,
        "sources_count": len(manager.sources),
        "cam_id_to_source_id": dict(manager.cam_id_to_source_id),
        "source_id_to_cam_id": dict(manager.source_id_to_cam_id),
        "debug_frame_count": getattr(manager, '_debug_frame_count', 0),
        "cameras_in_memory": list(cameras.keys()),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
