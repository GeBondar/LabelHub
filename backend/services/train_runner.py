"""Standalone Ultralytics YOLOv8-OBB training runner.

Spawned as a separate process by training_service using the same Python
interpreter, so it shares the backend's virtual environment (and thus
ultralytics / torch / CUDA). Kept dependency-light and import-isolated from the
FastAPI app on purpose — it must run even if the app package is not importable.

Metrics are read back by the parent from `<project>/<name>/results.csv`, which
Ultralytics updates every epoch. TensorBoard event files are written to the same
run directory automatically when the `tensorboard` package is installed.
"""

import argparse
import sys


def _patch_numpy_compat():
    """NumPy 2.x removed several aliases (np.trapz, np.float_, ...) that older
    Ultralytics/2nd-party code still calls. Restore the ones we need so training
    works regardless of the installed NumPy/Ultralytics combination."""
    try:
        import numpy as np
        if not hasattr(np, "trapz") and hasattr(np, "trapezoid"):
            np.trapz = np.trapezoid
        if not hasattr(np, "float_"):
            np.float_ = np.float64
        if not hasattr(np, "int_"):
            np.int_ = np.int64
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="YOLOv8-OBB trainer")
    parser.add_argument("--data", required=True, help="path to data.yaml")
    parser.add_argument("--model", default="yolov8n-obb.pt", help="base model/checkpoint")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="", help="'', 'cpu', '0', '0,1'")
    parser.add_argument("--project", required=True, help="runs root dir")
    parser.add_argument("--name", required=True, help="run name")
    args = parser.parse_args()

    _patch_numpy_compat()

    try:
        from ultralytics import YOLO
        from ultralytics import settings as ul_settings
        # Make sure TensorBoard logging is on for the live charts / TB view.
        try:
            ul_settings.update({"tensorboard": True})
        except Exception:
            pass
    except Exception as e:  # pragma: no cover - import guard
        print(f"ULTRALYTICS_IMPORT_ERROR: {e}", flush=True)
        return 3

    model = YOLO(args.model)

    train_kwargs = dict(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        exist_ok=True,
        plots=True,
    )
    if args.device != "":
        train_kwargs["device"] = args.device

    model.train(**train_kwargs)
    print("TRAINING_DONE", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
