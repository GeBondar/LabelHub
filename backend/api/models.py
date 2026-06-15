import os
import json
import uuid
import shutil
import asyncio
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.config import config
from backend.models.ml_model import MLModel
from backend.models.training import TrainingRun
from backend.models.project import Project, ClassLabel

router = APIRouter(prefix="/api/models", tags=["models"])


class ModelOut(BaseModel):
    id: int
    name: str
    kind: str
    run_id: Optional[int]
    project_id: Optional[int]
    project_name: Optional[str]
    base_model: str
    imgsz: int
    classes: list[str]
    map50: Optional[float]
    map5095: Optional[float]
    missing: bool
    created_at: Optional[str]

    model_config = {"from_attributes": True}


class ImportRequest(BaseModel):
    path: str
    name: Optional[str] = None


class RenameRequest(BaseModel):
    name: str


def _resolve_run_dir(run_dir: str) -> Optional[str]:
    """Run dirs are stored as absolute paths; re-root them under the current
    DATA_DIR if the repo moved (mirrors how client.js re-roots frame paths at
    the 'projects/' segment)."""
    if not run_dir:
        return None
    if os.path.isdir(run_dir):
        return run_dir
    norm = run_dir.replace("\\", "/")
    idx = norm.rfind("projects/")
    if idx >= 0:
        candidate = os.path.normpath(os.path.join(config.DATA_DIR, norm[idx:]))
        if os.path.isdir(candidate):
            return candidate
    return run_dir


def _weights_for_run(run: TrainingRun) -> Optional[str]:
    base = _resolve_run_dir(run.run_dir)
    if not base:
        return None
    p = os.path.join(base, "weights", "best.pt")
    return p if os.path.exists(p) else None


async def _to_out(model: MLModel, db: AsyncSession) -> ModelOut:
    project_name = None
    if model.project_id is not None:
        proj = await db.get(Project, model.project_id)
        project_name = proj.name if proj else None
    try:
        classes = json.loads(model.classes_json or "[]")
    except Exception:
        classes = []
    return ModelOut(
        id=model.id,
        name=model.name,
        kind=model.kind,
        run_id=model.run_id,
        project_id=model.project_id,
        project_name=project_name,
        base_model=model.base_model or "",
        imgsz=model.imgsz or 640,
        classes=classes,
        map50=model.map50,
        map5095=model.map5095,
        missing=not (model.weights_path and os.path.exists(model.weights_path)),
        created_at=str(model.created_at) if model.created_at else None,
    )


async def _sync_trained(db: AsyncSession):
    """Ensure every run that produced a best.pt on disk has a registry row.

    Keyed off the weights file rather than status: a run interrupted by an app
    crash stays stuck in 'running' yet still has usable weights, and the user
    expects to see (and test) it here."""
    runs_res = await db.execute(select(TrainingRun))
    runs = list(runs_res.scalars().all())
    existing_res = await db.execute(select(MLModel.run_id).where(MLModel.run_id.isnot(None)))
    registered = {r for (r,) in existing_res.all()}

    created = False
    for run in runs:
        if run.id in registered:
            continue
        weights = _weights_for_run(run)
        if not weights:
            continue
        # Class names from the project, ordered by index.
        cls_res = await db.execute(
            select(ClassLabel).where(ClassLabel.project_id == run.project_id).order_by(ClassLabel.index)
        )
        classes = [c.name for c in cls_res.scalars().all()]
        db.add(MLModel(
            name=run.name,
            kind="trained",
            run_id=run.id,
            project_id=run.project_id,
            weights_path=weights,
            base_model=run.base_model or "",
            imgsz=run.imgsz or 640,
            classes_json=json.dumps(classes, ensure_ascii=False),
            map50=run.best_map50,
            map5095=run.best_map5095,
        ))
        created = True
    if created:
        await db.flush()


@router.get("", response_model=list[ModelOut])
@router.get("/", response_model=list[ModelOut])
async def list_models(db: AsyncSession = Depends(get_db)):
    await _sync_trained(db)
    res = await db.execute(select(MLModel).order_by(MLModel.created_at.desc()))
    models = list(res.scalars().all())
    return [await _to_out(m, db) for m in models]


@router.post("/import", response_model=ModelOut)
async def import_model(data: ImportRequest, db: AsyncSession = Depends(get_db)):
    src = data.path
    if not src or not os.path.exists(src):
        raise HTTPException(status_code=400, detail="Файл не найден")
    if os.path.splitext(src)[1].lower() != ".pt":
        raise HTTPException(status_code=400, detail="Ожидается файл весов .pt")

    # Load on a worker thread to read class names + task without blocking.
    def _probe(path):
        from ultralytics import YOLO
        m = YOLO(path)
        names = m.names
        if isinstance(names, dict):
            names = [names[k] for k in sorted(names.keys())]
        return list(names), getattr(m, "task", None)

    try:
        names, task = await asyncio.to_thread(_probe, src)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось прочитать модель: {e}")

    # The tester renders detect (boxes), segment (masks) and obb (oriented
    # boxes). Other YOLO tasks (pose/classify) aren't supported here.
    supported = {"detect", "segment", "obb"}
    if task and task not in supported:
        raise HTTPException(
            status_code=400,
            detail=f"Модель имеет тип '{task}'. Поддерживаются: detect, segment, obb.",
        )

    dst_dir = os.path.join(config.DATA_DIR, "models", "imported")
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, f"{uuid.uuid4().hex}.pt")
    shutil.copy2(src, dst)

    name = (data.name or os.path.splitext(os.path.basename(src))[0]).strip() or "imported"
    model = MLModel(
        name=name,
        kind="imported",
        run_id=None,
        project_id=None,
        weights_path=dst,
        base_model="",
        imgsz=640,
        classes_json=json.dumps(names, ensure_ascii=False),
        map50=None,
        map5095=None,
    )
    db.add(model)
    await db.flush()
    await db.refresh(model)
    return await _to_out(model, db)


@router.patch("/{model_id}", response_model=ModelOut)
async def rename_model(model_id: int, data: RenameRequest, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Имя не может быть пустым")
    model.name = name
    await db.flush()
    return await _to_out(model, db)


@router.delete("/{model_id}")
async def delete_model(model_id: int, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    # Only remove weights we own (imported copies); never touch a training run's files.
    if model.kind == "imported" and model.weights_path and os.path.exists(model.weights_path):
        try:
            os.remove(model.weights_path)
        except OSError:
            pass
    await db.delete(model)
    await db.flush()
    return {"detail": "Model deleted"}


@router.get("/{model_id}/export")
async def export_model(model_id: int, db: AsyncSession = Depends(get_db)):
    model = await db.get(MLModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.weights_path or not os.path.exists(model.weights_path):
        raise HTTPException(status_code=404, detail="Файл весов недоступен")
    safe = "".join(c for c in model.name if c.isalnum() or c in (" ", "-", "_")).strip() or "model"
    return FileResponse(model.weights_path, media_type="application/octet-stream", filename=f"{safe}.pt")
