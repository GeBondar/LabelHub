import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models.project import Project, ClassLabel

router = APIRouter(prefix="/api/projects", tags=["projects"])


TASK_TYPES = {"detect", "segment", "obb"}


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    task_type: str = Field(default="obb", pattern=r"^(detect|segment|obb)$")


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ClassLabelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: str = Field(default="#FF0000", pattern=r"^#[0-9A-Fa-f]{6}$")


class ProjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    task_type: str = "obb"
    created_at: Optional[str]
    updated_at: Optional[str]
    class_count: int = 0
    video_count: int = 0
    frame_count: int = 0
    labeled_frame_count: int = 0
    annotation_count: int = 0

    model_config = {"from_attributes": True}


class ClassLabelOut(BaseModel):
    id: int
    name: str
    color: str
    index: int

    model_config = {"from_attributes": True}


async def _project_counts(db: AsyncSession, project_id: int) -> dict:
    """Aggregate counts for a project using SQL COUNT (never loads rows)."""
    from backend.models.annotation import Frame, OrientedBBox
    from backend.models.project import VideoFile

    async def count(stmt):
        return (await db.execute(stmt)).scalar() or 0

    return {
        "class_count": await count(
            select(func.count(ClassLabel.id)).where(ClassLabel.project_id == project_id)
        ),
        "video_count": await count(
            select(func.count(VideoFile.id)).where(VideoFile.project_id == project_id)
        ),
        "frame_count": await count(
            select(func.count(Frame.id)).where(Frame.project_id == project_id)
        ),
        "labeled_frame_count": await count(
            select(func.count(Frame.id)).where(
                Frame.project_id == project_id, Frame.is_labeled == True
            )
        ),
        "annotation_count": await count(
            select(func.count(OrientedBBox.id))
            .join(Frame, OrientedBBox.frame_id == Frame.id)
            .where(Frame.project_id == project_id)
        ),
    }


@router.post("/", response_model=ProjectOut)
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db)):
    project = Project(name=data.name, description=data.description, task_type=data.task_type)
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        task_type=project.task_type,
        created_at=str(project.created_at) if project.created_at else None,
        updated_at=str(project.updated_at) if project.updated_at else None,
        class_count=0,
        video_count=0,
        frame_count=0,
    )


@router.get("/", response_model=list[ProjectOut])
async def list_projects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    projects = result.scalars().all()

    out = []
    for p in projects:
        counts = await _project_counts(db, p.id)
        out.append(ProjectOut(
            id=p.id,
            name=p.name,
            description=p.description,
            task_type=p.task_type or "obb",
            created_at=str(p.created_at) if p.created_at else None,
            updated_at=str(p.updated_at) if p.updated_at else None,
            **counts,
        ))
    return out


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: int, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    counts = await _project_counts(db, project_id)
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        task_type=project.task_type or "obb",
        created_at=str(project.created_at) if project.created_at else None,
        updated_at=str(project.updated_at) if project.updated_at else None,
        **counts,
    )


@router.delete("/{project_id}")
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.flush()

    import shutil
    import os
    project_dir = os.path.join("data", "projects", str(project_id))
    if os.path.exists(project_dir):
        shutil.rmtree(project_dir, ignore_errors=True)

    return {"detail": "Project deleted"}


@router.put("/{project_id}/classes", response_model=ClassLabelOut)
async def add_class_label(
    project_id: int,
    data: ClassLabelCreate,
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ClassLabel).where(ClassLabel.project_id == project_id)
    )
    existing = result.scalars().all()
    next_index = max([c.index for c in existing], default=-1) + 1

    label = ClassLabel(
        project_id=project_id,
        name=data.name,
        color=data.color,
        index=next_index,
    )
    db.add(label)
    await db.flush()
    await db.refresh(label)
    return ClassLabelOut.model_validate(label)


@router.get("/{project_id}/classes", response_model=list[ClassLabelOut])
async def list_class_labels(project_id: int, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await db.execute(
        select(ClassLabel).where(ClassLabel.project_id == project_id).order_by(ClassLabel.index)
    )
    labels = result.scalars().all()
    return [ClassLabelOut.model_validate(l) for l in labels]


@router.delete("/{project_id}/classes/{class_id}")
async def delete_class_label(
    project_id: int,
    class_id: int,
    db: AsyncSession = Depends(get_db),
):
    label = await db.get(ClassLabel, class_id)
    if not label or label.project_id != project_id:
        raise HTTPException(status_code=404, detail="Class label not found")

    await db.delete(label)
    await db.flush()
    return {"detail": "Class label deleted"}


class ClassLabelUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


@router.put("/{project_id}/classes/{class_id}", response_model=ClassLabelOut)
async def update_class_label(
    project_id: int,
    class_id: int,
    data: ClassLabelUpdate,
    db: AsyncSession = Depends(get_db),
):
    label = await db.get(ClassLabel, class_id)
    if not label or label.project_id != project_id:
        raise HTTPException(status_code=404, detail="Class label not found")

    if data.name is not None:
        label.name = data.name
    if data.color is not None:
        label.color = data.color

    await db.flush()
    await db.refresh(label)
    return ClassLabelOut.model_validate(label)
