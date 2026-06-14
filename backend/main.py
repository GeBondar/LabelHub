import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope
from starlette.responses import Response

from backend.config import config
from backend.database import init_db
from backend.api import (
    projects_router,
    videos_router,
    annotations_router,
    exports_router,
    files_router,
    training_router,
    models_router,
    inference_router,
)
from backend.services.websocket_manager import ws_manager


class CORSStaticFiles(StaticFiles):
    async def __call__(self, scope: Scope, receive, send):
        async def send_with_cors(message):
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers", []))
                headers[b"access-control-allow-origin"] = b"*"
                headers[b"access-control-allow-credentials"] = b"true"
                message["headers"] = list(headers.items())
            await send(message)
        await super().__call__(scope, receive, send_with_cors)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    await init_db()
    yield


app = FastAPI(
    title="LabelHub",
    description="Image annotation tool for Oriented Bounding Boxes",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)
app.include_router(videos_router)
app.include_router(annotations_router)
app.include_router(exports_router)
app.include_router(files_router)
app.include_router(training_router)
app.include_router(models_router)
app.include_router(inference_router)

# Static files mount for serving images
data_dir = config.DATA_DIR
os.makedirs(data_dir, exist_ok=True)
app.mount("/static/frames", CORSStaticFiles(directory=data_dir), name="static_frames")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            await ws_manager.broadcast(data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "LabelHub"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        reload=True,
    )
