import os
import json
import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.config import config
from backend.models.project import Project
from backend.models.training import TrainingRun
from backend.services.training_service import training_service

router = APIRouter(prefix="/api/training", tags=["training"])


BASE_MODELS = [
    "yolov8n-obb.pt",
    "yolov8s-obb.pt",
    "yolov8m-obb.pt",
    "yolov8l-obb.pt",
    "yolov8x-obb.pt",
]


class TrainStartRequest(BaseModel):
    name: Optional[str] = None
    base_model: str = Field(default="yolov8n-obb.pt")
    epochs: int = Field(default=100, ge=1, le=2000)
    imgsz: int = Field(default=640, ge=64, le=2048)
    batch: int = Field(default=16, ge=1, le=128)
    device: str = Field(default="")
    val_ratio: float = Field(default=0.2, ge=0.05, le=0.5)


class TrainRunOut(BaseModel):
    id: int
    project_id: int
    name: str
    base_model: str
    epochs: int
    imgsz: int
    batch: int
    device: str
    status: str
    current_epoch: int
    best_map50: float
    best_map5095: float
    run_dir: str
    error: str
    created_at: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]

    model_config = {"from_attributes": True}


def _to_out(run: TrainingRun) -> TrainRunOut:
    return TrainRunOut(
        id=run.id,
        project_id=run.project_id,
        name=run.name,
        base_model=run.base_model,
        epochs=run.epochs,
        imgsz=run.imgsz,
        batch=run.batch,
        device=run.device or "",
        status=run.status,
        current_epoch=run.current_epoch or 0,
        best_map50=run.best_map50 or 0.0,
        best_map5095=run.best_map5095 or 0.0,
        run_dir=run.run_dir or "",
        error=run.error or "",
        created_at=str(run.created_at) if run.created_at else None,
        started_at=str(run.started_at) if run.started_at else None,
        finished_at=str(run.finished_at) if run.finished_at else None,
    )


@router.get("/models")
async def list_base_models():
    return {"models": BASE_MODELS}


@router.get("/device-info")
async def device_info():
    """Report whether CUDA/GPU training is available, for the UI badge."""
    info = {"cuda": False, "device_count": 0, "gpus": [], "torch": None}
    try:
        import torch
        info["torch"] = torch.__version__
        if torch.cuda.is_available():
            info["cuda"] = True
            info["device_count"] = torch.cuda.device_count()
            info["gpus"] = [
                {"index": i, "name": torch.cuda.get_device_name(i)}
                for i in range(torch.cuda.device_count())
            ]
    except Exception as e:
        info["error"] = str(e)
    return info


@router.post("/{project_id}/start", response_model=TrainRunOut)
async def start_training(
    project_id: int,
    data: TrainStartRequest,
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if data.base_model not in BASE_MODELS and not os.path.exists(data.base_model):
        raise HTTPException(status_code=400, detail=f"Unknown base model: {data.base_model}")

    # Build the dataset on disk first so config errors surface immediately.
    try:
        dataset_dir = await training_service.prepare_dataset(project_id, db, data.val_ratio)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось подготовить датасет: {e}")

    runs_root = os.path.join(config.DATA_DIR, "projects", str(project_id), "training", "runs")
    run_name = data.name or f"run_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir = os.path.join(runs_root, run_name)

    run = TrainingRun(
        project_id=project_id,
        name=run_name,
        base_model=data.base_model,
        epochs=data.epochs,
        imgsz=data.imgsz,
        batch=data.batch,
        device=data.device or "",
        params_json=json.dumps(data.model_dump()),
        dataset_dir=dataset_dir,
        run_dir=run_dir,
        status="pending",
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    run_id = run.id
    out = _to_out(run)
    # Commit before spawning so the row is visible to the monitor's sessions.
    await db.commit()

    import asyncio
    asyncio.create_task(training_service.start_run(run_id))

    return out


@router.get("/{project_id}/runs", response_model=list[TrainRunOut])
async def list_runs(project_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingRun)
        .where(TrainingRun.project_id == project_id)
        .order_by(TrainingRun.created_at.desc())
    )
    return [_to_out(r) for r in result.scalars().all()]


@router.get("/run/{run_id}", response_model=TrainRunOut)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _to_out(run)


@router.get("/run/{run_id}/metrics")
async def get_run_metrics(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return training_service.read_metrics_history(run.run_dir or "")


@router.post("/run/{run_id}/stop")
async def stop_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    ok = await training_service.stop_run(run_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Run is not active")
    return {"detail": "Stopping"}


@router.delete("/run/{run_id}")
async def delete_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=400, detail="Остановите обучение перед удалением")
    await db.delete(run)
    await db.flush()
    return {"detail": "Run deleted"}


@router.post("/{project_id}/tensorboard")
async def start_tensorboard(project_id: int):
    logdir = os.path.join(config.DATA_DIR, "projects", str(project_id), "training", "runs")
    try:
        res = await training_service.start_tensorboard(logdir)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return res


@router.get("/tensorboard/status")
async def tensorboard_status():
    return training_service.tensorboard_status()
