# Hướng Dẫn Triển Khai Hệ Thống (Deployment Guide)

Tài liệu hướng dẫn triển khai toàn diện cho hệ thống **DeepStream Multi-Camera Tracking & WebRTC Analytics Platform**.

---

## 1. Yêu Cầu Phần Cứng & Phần Mềm

### Phần Cứng (Hardware Requirements)
- **NVIDIA GPU**: Khuyến nghị RTX 3050 trở lên (VRAM >= 4GB) hoặc dòng GPU chuyên dụng (T4, A2, RTX 40xx) / NVIDIA Jetson (Orin Nano, Orin NX, AGX Orin).
- **CPU**: Tối thiểu 4 nhân (x86_64 hoặc aarch64 cho Jetson).
- **RAM**: Tối thiểu 8GB (khuyến nghị 16GB trở lên).
- **Storage**: Tối thiểu 20GB dung lượng trống.

### Phần Mềm & Driver (Software Prerequisites)
- **Hệ Điều Hành**: Ubuntu 22.04 LTS (khuyến nghị) hoặc Ubuntu 20.04 LTS.
- **NVIDIA Driver**: Bản 535.xx trở lên (`nvidia-smi` xác nhận hoạt động).
- **NVIDIA Container Toolkit**: Cần thiết để Docker truy cập GPU (`nvidia-docker2`).
- **Docker & Docker Compose**: Docker Engine v24.0+ và Docker Compose v2.20+.
- **Node.js**: v18.x trở lên (cho Web Dashboard nếu chạy không dùng Docker).
- **Python**: 3.10+ (nếu chạy local backend).

---

## 2. Cấu Trúc Dịch Vụ Hệ Thống

Hệ thống bao gồm 3 thành phần chính hoạt động đồng bộ:

```
                  +-----------------------------------+
                  |         Camera RTSP Feeds         |
                  +-----------------+-----------------+
                                    |
                                    v
                  +-----------------------------------+
                  |        NVIDIA DeepStream          |
                  |     (YOLOv8 + ReID + Analytics)   |
                  +--------+-----------------+--------+
                           |                 |
     RTSP / WebRTC Stream  |                 | Telemetry & Tracking Logs
                           v                 v
           +-----------------------+   +----------------------+
           |       MediaMTX        |   |   FastAPI Backend    |
           | (RTSP/WebRTC Gateway) |   | (Analytics, RAG, DB) |
           +-----------+-----------+   +----------+-----------+
                       |                          |
                       +------------+-------------+
                                    |
                                    v
                       +-------------------------+
                       |    Next.js Dashboard    |
                       |  (Live Video & Heatmap) |
                       +-------------------------+
```

---

## 3. Triển Khai Bằng Docker Compose (Khuyến Nghị)

### Bước 1: Cài đặt Driver NVIDIA & Docker
Sử dụng script tự động được chuẩn bị sẵn:
```bash
chmod +x install_docker_and_nvidia.sh
./install_docker_and_nvidia.sh
```

Khởi động lại máy hoặc reload docker daemon để áp dụng cấu hình NVIDIA runtime:
```bash
sudo systemctl restart docker
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

### Bước 2: Chuẩn bị Cấu hình Mô hình YOLOv8 & Engine
Chuyển đổi trọng số ONNX sang TensorRT Engine phù hợp với GPU hiện tại:
```bash
cd backend
python3 export_model.py
```

### Bước 3: Khởi chạy toàn bộ hệ thống
Tại thư mục gốc dự án:
```bash
docker compose up -d --build
```

Kiểm tra trạng thái các container:
```bash
docker compose ps
docker compose logs -f backend
```

---

## 4. Triển Khai Từng Thành Phần (Manual Setup)

### 4.1 Khởi chạy MediaMTX (WebRTC/RTSP Gateway)
```bash
cd services/mediamtx
./mediamtx mediamtx.yml
```
- MediaMTX WebRTC Port: `8889`
- MediaMTX RTSP Port: `8554`
- API Metrics Port: `9997`

### 4.2 Khởi chạy Backend FastAPI
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4.3 Khởi chạy Web Dashboard (Next.js)
```bash
cd web-dashboard
npm install
npm run dev
```
Dashboard sẵn sàng tại: `http://localhost:3000`

---

## 5. Danh Mục Cổng Mạng (Port Allocation)

| Service | Port | Giao Thức | Mục Đích |
|---|---|---|---|
| **Web Dashboard** | `3000` | HTTP | Giao diện điều khiển Next.js |
| **Backend API** | `8000` | HTTP / WS | REST API & WebSocket Events |
| **MediaMTX RTSP** | `8554` | TCP / UDP | Luồng RTSP Ingest & Egress |
| **MediaMTX WebRTC** | `8889` | HTTP / WHEP | WebRTC Live Stream phát trực tiếp |
| **MediaMTX API** | `9997` | HTTP | Điều khiển và truy vấn MediaMTX |

---

## 6. Khắc Phục Sự Cố (Troubleshooting)

1. **Lỗi GPU Không Nhận Diện Trong Container**:
   - Kiểm tra `nvidia-container-toolkit` đã cấu hình làm default runtime trong `/etc/docker/daemon.json`.
   - Chạy `sudo nvidia-ctk runtime configure --runtime=docker` và khởi động lại Docker.

2. **RTSP Stream Bị Lag hoặc Mất Kết Nối**:
   - Sử dụng script `backend/check_rtsp.py` để kiểm tra độ trễ mạng và tính khả dụng của luồng camera.
   - Điều chỉnh `rtsp-reconnect-interval` và buffer size trong cấu hình DeepStream.

3. **Lỗi Tràn Bộ Nhớ VRAM**:
   - Giảm `batch-size` trong `backend/models_config/config_infer_primary.txt`.
   - Chuyển `network-mode` sang FP16 hoặc INT8 nếu phần cứng hỗ trợ.
