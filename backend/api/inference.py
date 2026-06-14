import os
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.config import config
from backend.models.ml_model import MLModel
from backend.models.project import VideoFile
from backend.services.inference_service import inference_service

router = APIRouter(prefix="/api/inference", tags=["inference"])


class SourceSpec(BaseModel):
    type: str                       # "file" | "project_video" | "webcam"
    path: Optional[str] = None      # for file
    video_id: Optional[int] = None  # for project_video
    index: Optional[int] = 0        # for webcam


class StartRequest(BaseModel):
    model_id: int
    source: SourceSpec


class ControlRequest(BaseModel):
    action: str          # play | pause | seek | conf | record
    value: Optional[float] = None


@router.post("/start")
async def start_inference(data: StartRequest, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, data.model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.weights_path or not os.path.exists(model.weights_path):
        raise HTTPException(status_code=400, detail="Файл весов модели недоступен")

    src = data.source
    if src.type == "file":
        if not src.path or not os.path.exists(src.path):
            raise HTTPException(status_code=400, detail="Видео файл не найден")
        source = {"type": "file", "path": src.path}
    elif src.type == "project_video":
        video = await db.get(VideoFile, src.video_id) if src.video_id else None
        if not video:
            raise HTTPException(status_code=404, detail="Видео проекта не найдено")
        path = os.path.join(
            config.DATA_DIR, "projects", str(video.project_id), "videos", video.stored_filename
        )
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Файл видео отсутствует на диске")
        source = {"type": "file", "path": path}
    elif src.type == "webcam":
        source = {"type": "webcam", "index": int(src.index or 0)}
    else:
        raise HTTPException(status_code=400, detail=f"Неизвестный источник: {src.type}")

    sess = inference_service.start(model.weights_path, source, model.name)
    return {"session_id": sess.sid, **sess.status()}


@router.get("/{sid}/stream")
async def stream(sid: str):
    if inference_service.get(sid) is None:
        raise HTTPException(status_code=404, detail="Session not found")

    async def gen():
        last_ver = -1
        grace = 0  # frames to keep the connection after the source finishes
        while True:
            sess = inference_service.get(sid)
            if sess is None:
                break
            data, ver = sess.get_frame()
            if data is not None and ver != last_ver:
                last_ver = ver
                yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                       + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
            if sess.finished:
                grace += 1
                if grace > 100:  # ~2s after the final frame
                    break
            await asyncio.sleep(0.02)

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.post("/{sid}/control")
async def control(sid: str, data: ControlRequest):
    sess = inference_service.get(sid)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    action = data.action
    if action == "play":
        sess.set_paused(False)
    elif action == "pause":
        sess.set_paused(True)
    elif action == "seek":
        sess.seek(int(data.value or 0))
    elif action == "conf":
        sess.set_conf(float(data.value if data.value is not None else 0.25))
    elif action == "record":
        sess.set_record(bool(data.value))
    else:
        raise HTTPException(status_code=400, detail=f"Неизвестное действие: {action}")
    return sess.status()


@router.get("/{sid}/status")
async def status(sid: str):
    sess = inference_service.get(sid)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess.status()


@router.post("/{sid}/stop")
async def stop(sid: str):
    ok = inference_service.stop(sid)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"detail": "stopped"}


@router.get("/{sid}/download")
async def download(sid: str):
    sess = inference_service.get(sid)
    if not sess or not sess.output_path or not os.path.exists(sess.output_path):
        raise HTTPException(status_code=404, detail="Записанное видео недоступно")
    return FileResponse(sess.output_path, media_type="video/mp4", filename=f"inference_{sid}.mp4")
