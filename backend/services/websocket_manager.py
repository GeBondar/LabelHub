import asyncio
import json
from typing import List, Optional
from fastapi import WebSocket

from backend.config import config


class WebSocketManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_progress(self, task_id: str, progress_pct: float, message: str):
        payload = {
            "type": "progress",
            "task_id": task_id,
            "progress": round(progress_pct, 2),
            "message": message,
        }
        await self._broadcast(payload)

    async def send_error(self, task_id: str, message: str):
        payload = {
            "type": "error",
            "task_id": task_id,
            "message": message,
        }
        await self._broadcast(payload)

    async def broadcast(self, message: dict):
        await self._broadcast(message)

    async def _broadcast(self, message: dict):
        stale = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)
        for conn in stale:
            self.disconnect(conn)

    async def send_personal(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)


ws_manager = WebSocketManager()
