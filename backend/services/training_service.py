"""Manages local YOLOv8-OBB training runs spawned from the app.

For each run we:
  1. export the project's labeled frames to a YOLOv8-OBB dataset on disk,
  2. spawn `train_runner.py` as a child process (same interpreter / venv),
  3. tail `results.csv` and stream per-epoch metrics over the websocket,
  4. update the TrainingRun DB row through its lifecycle.

A separate TensorBoard process can be launched on the project's runs/ tree.
"""

import os
import csv
import sys
import json
import signal
import asyncio
import shutil
import datetime
from typing import Optional

from backend.config import config
from backend.database import async_session_factory
from backend.services.websocket_manager import ws_manager
from backend.services.export_service import export_service


# Curated metric columns (matched by substring against the results.csv header).
_METRIC_KEYS = {
    "train_box_loss": "train/box_loss",
    "train_cls_loss": "train/cls_loss",
    "train_dfl_loss": "train/dfl_loss",
    # Segmentation runs add a mask-loss column; harmless for detect/obb (absent).
    "train_seg_loss": "train/seg_loss",
    "val_box_loss": "val/box_loss",
    "val_cls_loss": "val/cls_loss",
    "val_dfl_loss": "val/dfl_loss",
    "val_seg_loss": "val/seg_loss",
    "precision": "metrics/precision",
    "recall": "metrics/recall",
    "map50": "metrics/mAP50(",
    "map5095": "metrics/mAP50-95",
    "lr": "lr/pg0",
}


def _match_columns(header: list[str]) -> dict:
    """Map our metric keys to the actual column names in this results.csv."""
    mapping = {}
    stripped = [h.strip() for h in header]
    for key, needle in _METRIC_KEYS.items():
        for col in stripped:
            if needle in col:
                mapping[key] = col
                break
    return mapping


class TrainingService:
    def __init__(self):
        self.runs: dict[int, dict] = {}  # run_id -> {process, task, stop}
        self.tensorboard_proc = None
        self.tensorboard_port = 6006

    # ------------------------------------------------------------------ dataset
    async def prepare_dataset(self, project_id: int, db, val_ratio: float = 0.2) -> str:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        from backend.models.project import Project, ClassLabel
        from backend.models.annotation import Frame

        project = await db.get(Project, project_id)
        task_type = (project.task_type if project else "obb") or "obb"

        classes_result = await db.execute(
            select(ClassLabel).where(ClassLabel.project_id == project_id).order_by(ClassLabel.index)
        )
        classes = list(classes_result.scalars().all())
        if not classes:
            raise ValueError("В проекте нет классов — добавьте хотя бы один класс.")

        frames_result = await db.execute(
            select(Frame)
            .where(Frame.project_id == project_id)
            .where(Frame.is_labeled == True)
            .options(selectinload(Frame.annotations))
        )
        frames = list(frames_result.scalars().all())
        labeled = [f for f in frames if f.annotations]
        if len(labeled) < 2:
            raise ValueError("Нужно минимум 2 размеченных кадра для обучения.")

        all_annotations = [a for f in labeled for a in f.annotations]

        # Build a stable train/val split with a guaranteed non-empty val set.
        import random
        rng = random.Random(42)
        shuffled = list(labeled)
        rng.shuffle(shuffled)
        n = len(shuffled)
        val_count = max(1, int(round(n * val_ratio)))
        val_count = min(val_count, n - 1)
        val_frames = shuffled[:val_count]
        train_frames = shuffled[val_count:]

        def annos_for(fs):
            ids = {f.id for f in fs}
            return [a for a in all_annotations if a.frame_id in ids]

        splits = {
            "train": (train_frames, annos_for(train_frames)),
            "val": (val_frames, annos_for(val_frames)),
            "test": ([], []),
        }

        dataset_dir = os.path.join(
            config.DATA_DIR, "projects", str(project_id), "training", "dataset"
        )
        # Fresh export each run so stale labels never leak in.
        if os.path.exists(dataset_dir):
            shutil.rmtree(dataset_dir, ignore_errors=True)
        os.makedirs(dataset_dir, exist_ok=True)

        await export_service.export_yolo(
            project_id=project_id,
            output_dir=dataset_dir,
            classes=classes,
            splits=splits,
            task_type=task_type,
        )
        return {
            "dataset_dir": dataset_dir,
            "train_count": len(train_frames),
            "val_count": len(val_frames),
        }

    # ------------------------------------------------------------------- start
    async def start_run(self, run_id: int):
        """Spawn the trainer and begin monitoring. Updates the DB row."""
        from backend.models.training import TrainingRun

        async with async_session_factory() as db:
            run = await db.get(TrainingRun, run_id)
            if not run:
                return
            data_yaml = os.path.join(run.dataset_dir, "data.yaml")
            run_dir = run.run_dir
            runs_root = os.path.dirname(run.run_dir)
            run_name = os.path.basename(run.run_dir)
            base_model = run.base_model
            epochs = run.epochs
            imgsz = run.imgsz
            batch = run.batch
            device = run.device or ""

        os.makedirs(runs_root, exist_ok=True)

        runner = os.path.join(os.path.dirname(__file__), "train_runner.py")
        cmd = [
            sys.executable, runner,
            "--data", data_yaml,
            "--model", base_model,
            "--epochs", str(epochs),
            "--imgsz", str(imgsz),
            "--batch", str(batch),
            "--project", runs_root,
            "--name", run_name,
        ]
        if device:
            cmd += ["--device", device]

        log_path = os.path.join(runs_root, f"{run_name}.log")
        log_file = open(log_path, "w", encoding="utf-8")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            stdout=log_file,
            stderr=asyncio.subprocess.STDOUT,
        )

        self.runs[run_id] = {"process": proc, "stop": False, "log_file": log_file}

        async with async_session_factory() as db:
            run = await db.get(TrainingRun, run_id)
            if run:
                run.status = "running"
                run.pid = proc.pid
                run.started_at = datetime.datetime.utcnow()
                await db.commit()

        await ws_manager.broadcast({
            "type": "training", "run_id": run_id, "status": "running",
            "message": "Обучение запущено", "epoch": 0, "total_epochs": epochs,
        })

        task = asyncio.create_task(self._monitor(run_id, proc, run_dir, epochs, log_file))
        self.runs[run_id]["task"] = task

    # ----------------------------------------------------------------- monitor
    async def _monitor(self, run_id: int, proc, run_dir: str, total_epochs: int, log_file):
        results_csv = os.path.join(run_dir, "results.csv") if run_dir else None
        last_epoch = 0
        col_map = None

        try:
            while True:
                if proc.returncode is None:
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=3.0)
                    except asyncio.TimeoutError:
                        pass

                # Read any new epoch rows.
                if results_csv and os.path.exists(results_csv):
                    rows = self._read_csv(results_csv)
                    if rows:
                        if col_map is None:
                            col_map = _match_columns(list(rows[0].keys()))
                        for row in rows:
                            try:
                                epoch = int(float(row.get("epoch", 0) or 0))
                            except (ValueError, TypeError):
                                epoch = last_epoch + 1
                            if epoch <= last_epoch:
                                continue
                            last_epoch = epoch
                            metrics = self._extract_metrics(row, col_map)
                            await self._persist_epoch(run_id, epoch, metrics)
                            await ws_manager.broadcast({
                                "type": "training", "run_id": run_id, "status": "running",
                                "epoch": epoch, "total_epochs": total_epochs,
                                "metrics": metrics,
                            })

                if proc.returncode is not None:
                    break

            await self._finalize(run_id, proc.returncode)
        except Exception as e:  # pragma: no cover - defensive
            await self._fail(run_id, str(e))
        finally:
            try:
                log_file.close()
            except Exception:
                pass
            self.runs.pop(run_id, None)

    def _read_csv(self, path: str) -> list[dict]:
        try:
            with open(path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                return [
                    {(k.strip() if k else k): v for k, v in r.items()}
                    for r in reader
                ]
        except Exception:
            return []

    def _extract_metrics(self, row: dict, col_map: dict) -> dict:
        out = {}
        for key, col in col_map.items():
            val = row.get(col)
            if val is None:
                continue
            try:
                out[key] = float(val)
            except (ValueError, TypeError):
                continue
        return out

    async def _persist_epoch(self, run_id: int, epoch: int, metrics: dict):
        from backend.models.training import TrainingRun
        async with async_session_factory() as db:
            run = await db.get(TrainingRun, run_id)
            if not run:
                return
            run.current_epoch = epoch
            if "map50" in metrics:
                run.best_map50 = max(run.best_map50 or 0.0, metrics["map50"])
            if "map5095" in metrics:
                run.best_map5095 = max(run.best_map5095 or 0.0, metrics["map5095"])
            await db.commit()

    async def _finalize(self, run_id: int, returncode: int):
        from backend.models.training import TrainingRun
        stopped = self.runs.get(run_id, {}).get("stop", False)
        status = "stopped" if stopped else ("completed" if returncode == 0 else "failed")
        async with async_session_factory() as db:
            run = await db.get(TrainingRun, run_id)
            if run:
                run.status = status
                run.finished_at = datetime.datetime.utcnow()
                if status == "failed" and not run.error:
                    run.error = f"Процесс завершился с кодом {returncode}"
                await db.commit()
        await ws_manager.broadcast({
            "type": "training", "run_id": run_id, "status": status,
            "message": {
                "completed": "Обучение завершено",
                "stopped": "Обучение остановлено",
                "failed": "Ошибка обучения (см. лог)",
            }.get(status, status),
        })

    async def _fail(self, run_id: int, message: str):
        from backend.models.training import TrainingRun
        async with async_session_factory() as db:
            run = await db.get(TrainingRun, run_id)
            if run:
                run.status = "failed"
                run.error = message
                run.finished_at = datetime.datetime.utcnow()
                await db.commit()
        await ws_manager.broadcast({
            "type": "training", "run_id": run_id, "status": "failed", "message": message,
        })

    # -------------------------------------------------------------------- stop
    async def stop_run(self, run_id: int) -> bool:
        entry = self.runs.get(run_id)
        if not entry:
            return False
        entry["stop"] = True
        proc = entry["process"]
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        return True

    def read_metrics_history(self, run_dir: str) -> dict:
        """Return the full per-epoch metric history for charts on (re)open."""
        results_csv = os.path.join(run_dir, "results.csv")
        rows = self._read_csv(results_csv)
        if not rows:
            return {"epochs": [], "series": {}}
        col_map = _match_columns(list(rows[0].keys()))
        epochs = []
        series: dict[str, list] = {k: [] for k in col_map}
        for row in rows:
            try:
                ep = int(float(row.get("epoch", 0) or 0))
            except (ValueError, TypeError):
                ep = len(epochs) + 1
            epochs.append(ep)
            m = self._extract_metrics(row, col_map)
            for k in col_map:
                series[k].append(m.get(k))
        return {"epochs": epochs, "series": series}

    # ------------------------------------------------------------- tensorboard
    @staticmethod
    def _tensorboard_available() -> bool:
        if shutil.which("tensorboard"):
            return True
        try:
            import importlib.util
            return importlib.util.find_spec("tensorboard") is not None
        except Exception:
            return False

    def _port_open(self) -> bool:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex(("127.0.0.1", self.tensorboard_port)) == 0

    @staticmethod
    def _has_event_files(logdir: str) -> bool:
        for root, _dirs, files in os.walk(logdir):
            if any("tfevents" in f for f in files):
                return True
        return False

    async def start_tensorboard(self, logdir: str) -> dict:
        url = f"http://localhost:{self.tensorboard_port}"
        os.makedirs(logdir, exist_ok=True)

        # Already running (or something else on the port) -> reuse it.
        if (self.tensorboard_proc and self.tensorboard_proc.returncode is None) or self._port_open():
            return {"status": "running", "url": url, "has_data": self._has_event_files(logdir)}

        if not self._tensorboard_available():
            raise RuntimeError("TensorBoard не установлен. Выполните: pip install tensorboard")

        tb = shutil.which("tensorboard")
        if tb:
            cmd = [tb, "--logdir", logdir, "--port", str(self.tensorboard_port), "--host", "127.0.0.1"]
        else:
            cmd = [sys.executable, "-m", "tensorboard.main", "--logdir", logdir,
                   "--port", str(self.tensorboard_port), "--host", "127.0.0.1"]

        log_path = os.path.join(logdir, "tensorboard.log")
        log_file = open(log_path, "w", encoding="utf-8")
        self.tensorboard_proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=log_file, stderr=asyncio.subprocess.STDOUT,
        )

        # Wait until the server actually answers on the port (or fails).
        for _ in range(40):  # up to ~20s
            if self.tensorboard_proc.returncode is not None:
                try:
                    log_file.flush()
                    tail = open(log_path, "r", encoding="utf-8", errors="replace").read()[-400:]
                except Exception:
                    tail = ""
                raise RuntimeError(f"TensorBoard завершился с ошибкой. {tail.strip()}")
            if self._port_open():
                return {"status": "running", "url": url, "has_data": self._has_event_files(logdir)}
            await asyncio.sleep(0.5)

        return {"status": "starting", "url": url, "has_data": self._has_event_files(logdir)}

    def tensorboard_status(self) -> dict:
        running = bool(self.tensorboard_proc and self.tensorboard_proc.returncode is None) or self._port_open()
        return {"running": running, "url": f"http://localhost:{self.tensorboard_port}" if running else None}


training_service = TrainingService()
