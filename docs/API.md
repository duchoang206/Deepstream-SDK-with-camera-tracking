# Tài Liệu API & WebSocket (API Specification)

Tài liệu chi tiết về các điểm cuối REST API và giao thức WebSocket được cung cấp bởi **FastAPI Backend Service**.

---

## 1. Tổng Quan

- **Base URL**: `http://localhost:8000`
- **Tài liệu Swagger tương tác**: `http://localhost:8000/docs`
- **Tài liệu ReDoc**: `http://localhost:8000/redoc`
- **Định dạng dữ liệu**: `application/json`

---

## 2. Các Nhóm Endpoint Chính

### 2.1 Quản Lý Luồng Camera (`/api/cameras`)

#### `GET /api/cameras`
Lấy danh sách tất cả các luồng camera đang được cấu hình.

**Response (200 OK):**
```json
[
  {
    "id": 1,
    "name": "Camera Khu Vực Cổng Chính",
    "ip": "192.168.1.101",
    "stream_url": "rtsp://192.168.1.101:554/live",
    "webrtc_url": "http://localhost:8889/cam1/whep",
    "status": "online",
    "fps": 30.0,
    "resolution": "1920x1080"
  },
  {
    "id": 2,
    "name": "Camera Khu Vực Kho Hàng",
    "ip": "192.168.1.102",
    "stream_url": "rtsp://192.168.1.102:554/live",
    "webrtc_url": "http://localhost:8889/cam2/whep",
    "status": "online",
    "fps": 29.8,
    "resolution": "1920x1080"
  }
]
```

#### `POST /api/cameras/setup`
Thêm hoặc cập nhật địa chỉ IP và thông tin luồng camera.

**Request Body:**
```json
{
  "camera_id": 1,
  "name": "Camera Cổng 1",
  "ip": "192.168.1.150",
  "stream_url": "rtsp://192.168.1.150:554/stream1"
}
```

---

### 2.2 Quản Lý Vùng Giám Sát ROI & Xâm Nhập (`/api/zones`)

#### `GET /api/zones`
Lấy danh sách các vùng đa giác (Polygon ROI) được thiết lập để phát hiện xâm nhập trái phép.

**Response (200 OK):**
```json
[
  {
    "zone_id": "zone_restricted_warehouse",
    "camera_id": 2,
    "zone_name": "Khu Vực Hạn Chế Ra Vào",
    "polygon_points": [
      {"x": 120, "y": 240},
      {"x": 640, "y": 240},
      {"x": 600, "y": 720},
      {"x": 100, "y": 700}
    ],
    "alert_level": "CRITICAL"
  }
]
```

#### `POST /api/zones/update`
Cập nhật tọa độ vùng ROI cho camera.

---

### 2.3 Phân Tích Hành Vi & Cảnh Báo (`/api/analytics`)

#### `GET /api/analytics/summary`
Lấy thống kê tổng quan về số lượng đối tượng, lượt xâm nhập và thời gian lưu lại (dwell time).

**Response (200 OK):**
```json
{
  "total_tracked_persons": 142,
  "active_tracks": 8,
  "total_intrusion_events": 3,
  "average_dwell_time_seconds": 45.2,
  "high_density_alerts": 1,
  "timestamp": "2026-09-15T22:00:00Z"
}
```

#### `GET /api/analytics/events`
Truy vấn nhật ký cảnh báo gần nhất theo bộ lọc thời gian.

---

### 2.4 Truy Vấn Thông Minh RAG (`/api/rag`)

#### `POST /api/rag/query`
Gửi câu hỏi bằng ngôn ngữ tự nhiên để truy vấn cơ sở tri thức nhật ký video và sự kiện.

**Request Body:**
```json
{
  "query": "Hôm nay có sự kiện xâm nhập nào ở khu vực kho hàng không?",
  "top_k": 5
}
```

**Response (200 OK):**
```json
{
  "answer": "Vào lúc 14:22:15, hệ thống phát hiện đối tượng ID #42 đi vào vùng hạn chế kho hàng và lưu lại 3 phút 12 giây.",
  "relevant_events": [
    {
      "event_id": "evt_88921",
      "timestamp": "2026-09-15T14:22:15Z",
      "zone": "Khu Vực Hạn Chế Ra Vào",
      "confidence": 0.94
    }
  ]
}
```

---

## 3. WebSocket Realtime Stream (`/ws/events`)

Kênh truyền dữ liệu sự kiện thời gian thực (Push notification) tới Web Dashboard.

- **URL**: `ws://localhost:8000/ws/events`

### Cấu Trúc Message Phát Tán:
```json
{
  "type": "INTRUSION_ALERT",
  "payload": {
    "camera_id": 2,
    "track_id": 108,
    "zone_name": "Kho Hàng A",
    "timestamp": "2026-09-15T22:55:00Z",
    "bbox": [320, 180, 480, 560],
    "image_snapshot_url": "/api/snapshots/evt_9912.jpg"
  }
}
```
