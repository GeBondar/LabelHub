# Changelog

All notable changes to LabelHub are documented here.

## v1.0.0

First public release — a complete annotate → train → test workflow for YOLO.

### Highlights
- **Multi-task projects** — Detect (axis-aligned boxes), OBB (oriented boxes with a heading arrow) and
  Segmentation (instance polygons). The task type is chosen per project and drives the annotation tools,
  storage, import, export and training.
- **SAM2 click-to-segment** — click or drag to turn an object into a mask → polygon (segmentation) or box
  (detect/obb). SAM2 warms up on a background thread; a toolbar badge shows its state.
- **Fast startup** — PyTorch and Albumentations are loaded lazily and SAM2 in the background, so the
  window opens in ~1.5 s instead of waiting out a 20–40 s cold start.
- **In-app training** — YOLOv8 and YOLO11 (n/s/m/l/x) with live loss/mAP charts, GPU auto-detection,
  per-run train/val split counts, and TensorBoard.
- **Live model tester** — real-time inference over a video file or webcam with confidence control and
  recording; renders boxes, oriented boxes and masks.
- **Import & export** — round-trip YOLO datasets for all three task types, with class **names** read from
  `data.yaml`; COCO and Pascal-VOC export.
- **Auto-save** — frames are marked labeled automatically and pending edits are flushed on navigation.

### Quality
- 42 backend tests (`python -m pytest`) covering geometry, label formats, export round-trips, dataset
  split, `data.yaml` parsing and the import/export API.
- Backend bound to `127.0.0.1`; counts use SQL `COUNT` instead of loading rows.

### Notes
- SAM2 is optional (see the README); the app is fully usable without it.
- For NVIDIA GPUs, install a CUDA PyTorch build inside the venv — the app auto-detects it.
