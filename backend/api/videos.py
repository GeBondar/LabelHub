import os
import uuid
import shutil
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

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


@router.get("/{project_id}/list", response_model=list[VideoOut])
async def list_project_videos(project_id: int, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.execute(
        select(VideoFile).where(VideoFile.project_id == project_id).order_by(VideoFile.created_at.desc())
    )
    videos = result.scalars().all()
    return [
        VideoOut(
            id=v.id,
            project_id=v.project_id,
            original_filename=v.original_filename,
            fps=v.fps,
            total_frames=v.total_frames,
            duration_seconds=v.duration_seconds,
            created_at=str(v.created_at) if v.created_at else None,
        )
        for v in videos
    ]


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

    total = (await db.execute(
        select(func.count(Frame.id)).where(Frame.video_id == video_id)
    )).scalar() or 0

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
    video_id: Optional[int] = Query(default=None, description="Only frames of this video"),
    imported: bool = Query(default=False, description="Only imported frames (no video)"),
    class_id: Optional[int] = Query(default=None, description="Only frames containing this class"),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Optional source/content filter. class_id (whole-project, for analysing a
    # class) takes precedence over the per-folder video_id / imported filters.
    conds = []
    if class_id is not None:
        from backend.models.annotation import OrientedBBox
        conds.append(Frame.id.in_(
            select(OrientedBBox.frame_id).where(OrientedBBox.class_id == class_id)
        ))
    elif video_id is not None:
        conds.append(Frame.video_id == video_id)
    elif imported:
        conds.append(Frame.video_id.is_(None))

    total = (await db.execute(
        select(func.count(Frame.id)).where(Frame.project_id == project_id, *conds)
    )).scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Frame)
        .where(Frame.project_id == project_id, *conds)
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


class SourceOut(BaseModel):
    kind: str                       # "video" | "imported"
    video_id: Optional[int]
    name: str
    frame_count: int
    labeled_count: int
    thumb: Optional[str]            # image_path of the first frame, for the folder thumbnail


@router.get("/{project_id}/sources", response_model=list[SourceOut])
async def list_sources(project_id: int, db: AsyncSession = Depends(get_db)):
    """Folder list for the gallery: one entry per video (in upload order) plus an
    'Импорт' folder for frames that came from a dataset import (no video).
    Empty groups are omitted."""
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    async def group(video_id, name, kind):
        cond = (Frame.video_id == video_id) if video_id is not None else Frame.video_id.is_(None)
        count = (await db.execute(
            select(func.count(Frame.id)).where(Frame.project_id == project_id, cond)
        )).scalar() or 0
        if count == 0:
            return None
        labeled = (await db.execute(
            select(func.count(Frame.id)).where(Frame.project_id == project_id, cond, Frame.is_labeled == True)
        )).scalar() or 0
        thumb = (await db.execute(
            select(Frame.image_path).where(Frame.project_id == project_id, cond)
            .order_by(Frame.frame_index).limit(1)
        )).scalar()
        return SourceOut(kind=kind, video_id=video_id, name=name,
                         frame_count=count, labeled_count=labeled, thumb=thumb)

    videos = (await db.execute(
        select(VideoFile).where(VideoFile.project_id == project_id).order_by(VideoFile.created_at)
    )).scalars().all()

    sources = []
    for v in videos:
        g = await group(v.id, v.original_filename, "video")
        if g:
            sources.append(g)
    imported = await group(None, "Импорт", "imported")
    if imported:
        sources.append(imported)
    return sources
