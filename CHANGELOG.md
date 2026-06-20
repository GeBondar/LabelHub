# Changelog

All notable changes to LabelHub are documented here.

LabelHub follows [Semantic Versioning](https://semver.org/). Pre-1.0-quality
public builds are tagged as Beta with a `-beta.N` suffix (e.g. `v1.0.0-beta.1`).

## [Unreleased]

_Nothing yet._

## v1.0.0-beta.1

First public **Beta** — a complete annotate → train → test workflow for YOLO,
shipped as a source install (`git clone` + `install` + `run`). Feature-complete
for the 1.0 scope and in active testing; see the caveats below.

### Highlights
- **Multi-task projects** — Detect (axis-aligned boxes), OBB (oriented boxes with a
  heading arrow) and Segmentation (instance polygons). The task type is chosen per project and drives the annotation tools,
  storage, import, export and training.
- **SAM2 click-to-segment** — click or drag to turn an object into a mask → polygon
  (segmentation) or box (detect/obb). SAM2 warms up on a background thread; a toolbar badge shows its state.
- **Fast startup** — PyTorch and Albumentations are loaded lazily and SAM2 in the
  background, so the window opens in ~1.5 s instead of waiting out a 20–40 s cold start.
- **In-app training** — YOLOv8 and YOLO11 (n/s/m/l/x) with live loss/mAP charts,
  GPU auto-detection (with automatic CPU fallback), per-run train/val split counts, and TensorBoard.
- **Live model tester** — real-time inference over a video file or webcam with confidence control and
  recording; renders boxes, oriented boxes and masks.
- **Import & export** — round-trip YOLO datasets for all three task types, with class **names** read from
  `data.yaml`; COCO and Pascal-VOC export.
- **Auto-save** — frames are marked labeled automatically and pending edits are flushed on navigation.
- **Internationalized UI** — English (default) and Russian, switchable in the header.

### Beta hardening
- Validate user-supplied file/export names to prevent path traversal in the file
  and export endpoints.
- Enforce that an annotation's class belongs to its own project.
- Project deletion now removes files **before** the DB row, uses the configured
  data directory, and fails loudly instead of silently orphaning data.
- Electron now takes a single-instance lock (no duplicate backend / `database is
  locked`) and shuts the Python backend down gracefully (SIGTERM → SIGKILL),
  releasing port 8787 for the next launch.
- Startup checks warn early when `ffmpeg`/`ffprobe` or the SAM2 checkpoint are missing.
- A banner appears in the UI when the backend connection drops.
- Training fails cleanly (no leaked log handles or unmonitored processes), and
  requesting a GPU with none present falls back to CPU.

### Quality
- 48 backend tests (`python -m pytest`) covering geometry, label formats, export round-trips, dataset
  split, `data.yaml` parsing and the import/export API.
- Continuous integration runs the backend tests and the web build on every push and pull request.
- Backend bound to `127.0.0.1`; counts use SQL `COUNT` instead of loading rows.

### Beta caveats / known issues
- **Windows is the tested platform.** Linux/macOS are community-supported — please report issues.
- **Source install only** for this Beta: requires Python 3.10+ and Node 18+ on your `PATH`.
  A packaged one-click installer is planned for v1.0.
- **Back up `data/labelhub.db` before upgrading** — schema migrations are applied in place.
- **Don't move the `data/` directory** after creating projects; some stored paths are absolute.
- SAM2 is optional and requires a manual ~1.2 GB checkpoint (see the README).
- For NVIDIA GPUs, install a CUDA PyTorch build inside the venv — the app auto-detects it.
