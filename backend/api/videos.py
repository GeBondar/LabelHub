import os
import uuid
import shutil
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.config import config
from backend.models.project import Project, VideoFile
from backend.models.annotation import Frame
from backend.services.video_processor import VideoProcessor, VideoProcessor as VP
from backend.services.websocket_manager import ws_manager

router = APIRouter(prefix="/api/videos", tags=["videos"])


class VideoOut(BaseModel):
    id: int
    project_id: int
    original_filename: str
    fps: float
    total_frames: int
    duration_seconds: float
    created_at: Optional[str]

    model_config = {"from_attributes": True}


class FrameOut(BaseModel):
    id: int
    video_id: Optional[int]
    frame_index: int
    image_path: str
    width: int
    height: int
    is_labeled: bool
    created_at: Optional[str]

    model_config = {"from_attributes": True}


class PaginatedFrames(BaseModel):
    items: list[FrameOut]
    total: int
    page: int
    page_size: int


@router.post("/upload/{project_id}", response_model=VideoOut)
async def upload_video(
    project_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    ext = os.path.splitext(file.filename or "unknown.mp4")[1].lower()
    if ext not in config.SUPPORTED_VIDEO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format: {ext}. Supported: {config.SUPPORTED_VIDEO_FORMATS}",
        )

    project_video_dir = os.path.join(config.DATA_DIR, "projects", str(project_id), "videos")
    os.makedirs(project_video_dir, exist_ok=True)

    stored_filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(project_video_dir, stored_filename)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    processor = VideoProcessor(ws_manager=ws_manager)
    try:
        info = await processor.get_video_info(filepath)
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        raise HTTPException(status_code=400, detail=f"Could not read video: {str(e)}")

    video = VideoFile(
        project_id=project_id,
        original_filename=file.filename or "unknown",
        stored_filename=stored_filename,
        fps=info["fps"],
        total_frames=info["total_frames"],
        duration_seconds=info["duration"],
    )
    db.add(video)
    await db.flush()
    await db.refresh(video)

    return VideoOut(
        id=video.id,
        project_id=video.project_id,
        original_filename=video.original_filename,
        fps=video.fps,
        total_frames=video.total_frames,
        duration_seconds=video.duration_seconds,
        created_at=str(video.created_at) if video.created_at else None,
    )


@router.post("/extract/{video_id}", response_model=list[FrameOut])
async def extract_frames(
    video_id: int,
    fps: float = Query(default=1.0, ge=0.1, le=60.0),
    db: AsyncSession = Depends(get_db),
):
    video = await db.get(VideoFile, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    video_path = os.path.join(
        config.DATA_DIR, "projects", str(video.project_id), "videos", video.stored_filename
    )

    frames_dir = os.path.join(
        config.DATA_DIR, "projects", str(video.project_id), "frames", str(video_id)
    )
    os.makedirs(frames_dir, exist_ok=True)

    processor = VideoProcessor(ws_manager=ws_manager)
    try:
        created = await processor.extract_frames(
            video_path=video_path,
            output_dir=frames_dir,
            target_fps=fps,
            video_id=video_id,
            db_session=db,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Frame extraction failed: {str(e)}")

    await db.flush()

    result = await db.execute(
        select(Frame).where(Frame.video_id == video_id).order_by(Frame.frame_index)
    )
    frames = result.scalars().all()

    return [
        FrameOut(
            id=f.id,
            video_id=f.video_id,
            frame_index=f.frame_index,
            image_path=f.image_path,
            width=f.width,
            height=f.height,
            is_labeled=f.is_labeled,
            created_at=str(f.created_at) if f.created_at else None,
        )
        for f in frames
    ]


@router.get("/by-video/{video_id}/frames", response_model=PaginatedFrames)
async def list_video_frames(
    video_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    video = await db.get(VideoFile, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    count_result = await db.execute(
        select(Frame).where(Frame.video_id == video_id)
    )
    total = len(count_result.scalars().all())

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Frame)
        .where(Frame.video_id == video_id)
        .order_by(Frame.frame_index)
        .offset(offset)
        .limit(page_size)
    )
    frames = result.scalars().all()

    return PaginatedFrames(
        items=[
            FrameOut(
                id=f.id,
                video_id=f.video_id,
                frame_index=f.frame_index,
                image_path=f.image_path,
                width=f.width,
                height=f.height,
                is_labeled=f.is_labeled,
                created_at=str(f.created_at) if f.created_at else None,
            )
            for f in frames
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{project_id}/frames", response_model=PaginatedFrames)
async def list_project_frames(
    project_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    count_result = await db.execute(
        select(Frame).where(Frame.project_id == project_id)
    )
    total = len(count_result.scalars().all())

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Frame)
        .where(Frame.project_id == project_id)
        .order_by(Frame.frame_index)
        .offset(offset)
        .limit(page_size)
    )
    frames = result.scalars().all()

    return PaginatedFrames(
        items=[
            FrameOut(
                id=f.id,
                video_id=f.video_id,
                frame_index=f.frame_index,
                image_path=f.image_path,
                width=f.width,
                height=f.height,
                is_labeled=f.is_labeled,
                created_at=str(f.created_at) if f.created_at else None,
            )
            for f in frames
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
