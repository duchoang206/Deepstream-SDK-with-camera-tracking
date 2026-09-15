"""
WebSocket Connection Manager and Broadcast Handler for Real-Time Analytics.
"""

from typing import List, Dict, Any
import json
import logging
from fastapi import WebSocket

logger = logging.getLogger("WebSocketManager")


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Remaining: {len(self.active_connections)}")

    async def broadcast_json(self, message: Dict[str, Any]):
        if not self.active_connections:
            return
            
        disconnected: List[WebSocket] = []
        payload_str = json.dumps(message)
        
        for connection in self.active_connections:
            try:
                await connection.send_text(payload_str)
            except Exception as e:
                logger.warning(f"Failed to send to client: {e}")
                disconnected.append(connection)

        for conn in disconnected:
            self.disconnect(conn)

    def get_client_count(self) -> int:
        return len(self.active_connections)


ws_manager = ConnectionManager()
