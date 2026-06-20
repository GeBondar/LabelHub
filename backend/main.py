import os
import sys
import shutil
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope
from starlette.responses import Response

from backend import __version__
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


# A dedicated logger with its own stderr handler so startup notices and errors
# are visible regardless of how uvicorn configures the root logger (these lines
# also feed the Electron splash's detail subtext).
logger = logging.getLogger("labelhub")
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("[LabelHub] %(levelname)s: %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def _startup_checks():
    """Warn early about optional-but-commonly-missing external dependencies so a
    Beta user sees an actionable message at startup instead of a cryptic error
    the first time they upload a video or click SAM2."""
    if not shutil.which(config.FFMPEG_PATH) or not shutil.which(config.FFPROBE_PATH):
        logger.warning(
            "ffmpeg/ffprobe not found on PATH — video frame extraction is "
            "unavailable. Install ffmpeg (https://ffmpeg.org/download.html) and "
            "ensure it is on your PATH. Importing existing datasets still works."
        )
    if not os.path.exists(config.SAM2_CHECKPOINT):
        logger.info(
            "SAM2 checkpoint not found at %s — click-to-segment is disabled "
            "(optional; see the README to enable it).",
            config.SAM2_CHECKPOINT,
        )


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
    import asyncio
    config.ensure_dirs()
    _startup_checks()
    await init_db()
    # Warm up SAM2 (torch + model weights) on a background thread so it's ready
    # by the time the user reaches for it, without delaying server startup or
    # blocking the event loop. Failures are captured in the service's load_state
    # and surfaced to the UI badge — they never break startup.
    # Set LABELHUB_SKIP_WARMUP=1 to disable (used by tests to avoid loading torch).
    if not os.environ.get("LABELHUB_SKIP_WARMUP"):
        from backend.services.sam2_service import sam2_service
        asyncio.create_task(asyncio.to_thread(sam2_service.warmup))
    yield


app = FastAPI(
    title="LabelHub",
    description="Local-first desktop studio for YOLO datasets and models",
    version=__version__,
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
        logger.exception("WebSocket error")
        ws_manager.disconnect(websocket)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "LabelHub", "version": __version__}


@app.get("/api/version")
async def version():
    return {"version": __version__}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        reload=True,
    )
