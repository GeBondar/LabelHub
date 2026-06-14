# LabelHub

**Local desktop annotation & training tool for YOLOv8-OBB (Oriented Bounding Boxes)**

LabelHub is a full-stack desktop application that lets you annotate images with rotated bounding boxes, train YOLOv8-OBB models directly from the UI, and export datasets in multiple formats — all running locally on your machine.

## Features

- **Project management** — create annotation projects, upload videos, extract frames at configurable FPS
- **OBB annotation** — draw rotated bounding boxes with heading arrows using a Fabric.js canvas
- **AI-assisted labeling** — one-click segmentation with Meta SAM2, automatically converted to oriented boxes
- **In-app training** — train YOLOv8-OBB models directly from labeled data with live metric streaming via WebSocket
- **Real-time charts** — monitor loss, mAP, precision/recall during training
- **TensorBoard** — launch TensorBoard from the UI to inspect training runs
- **Augmentations** — flip, rotate, brightness/contrast, Gaussian noise (OBB-aware)
- **Multi-format export** — YOLOv8-OBB (polygon), COCO JSON, Pascal VOC XML
- **Dataset import** — import existing YOLOv8-OBB datasets

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Electron 28, React 18, Fabric.js 5, Recharts, Tailwind CSS, Vite 5 |
| Backend | FastAPI (Python), Uvicorn, WebSockets |
| Database | SQLite (SQLAlchemy 2.0 async + aiosqlite) |
| Computer Vision | OpenCV, Ultralytics YOLOv8-OBB, SAM2 |
| ML / Augmentation | PyTorch, Albumentations, Shapely |
| Build | electron-builder, Vite, concurrently |

## Project Structure

```
LabelHub/
├── electron/              # Electron + React frontend
│   ├── main.cjs           # Electron main process (spawns Python backend)
│   ├── preload.cjs        # Context bridge for IPC
│   ├── src/               # React application
│   │   ├── App.jsx
│   │   ├── api/client.js  # Axios API client + WebSocket manager
│   │   └── components/    # UI components
│   ├── build/             # App icons
│   └── dist/              # Vite production build
├── backend/               # FastAPI backend
│   ├── main.py            # App entry point (port 8787)
│   ├── config.py          # Paths, settings, constants
│   ├── database.py        # SQLAlchemy async engine & migrations
│   ├── api/               # REST API routers (projects, videos, annotations, exports, training)
│   ├── models/            # SQLAlchemy ORM models (Project, Frame, OrientedBBox, TrainingRun)
│   └── services/          # Business logic
│       ├── sam2_service.py       # SAM2 segmentation wrapper
│       ├── training_service.py   # YOLOv8-OBB training orchestration
│       ├── export_service.py     # Multi-format dataset export
│       ├── augmentation.py       # OBB-aware augmentations
│       ├── geometry.py           # OBB corner math
│       ├── video_processor.py    # FFmpeg frame extraction
│       └── websocket_manager.py  # Real-time broadcast
├── models/                # Model checkpoints (SAM2, YOLO)
├── data/                  # Runtime data (SQLite DB, projects, frames)
├── elrs_controller.py     # Standalone: ExpressLRS CRSF protocol for RC robot control
├── inference_video.py     # Standalone: YOLOv8-OBB inference on video
├── label_pose.py          # Standalone: YOLOv8-pose keypoint labeling tool
├── vision_research.md     # Research notes on CV algorithms for robot tracking
└── requirements.txt       # Python deps for standalone scripts
```

## Getting Started

### Prerequisites

- Python 3.10+ with PyTorch (CUDA recommended)
- Node.js 18+ and npm
- FFmpeg (for video processing)
- [SAM2](https://github.com/facebookresearch/sam2) installed from source (optional, for AI-assisted labeling)

### Backend Setup

```bash
pip install -r backend/requirements.txt

# SAM2 (optional, for AI-assisted annotation)
git clone https://github.com/facebookresearch/sam2.git
cd sam2 && pip install -e .
```

Download the SAM2 checkpoint and place it in `models/`:

```
models/sam2_hiera_large.pt
```

### Frontend Setup

```bash
cd electron
npm install
```

### Running

```bash
# Development mode (from electron/ directory)
npm start

# Production build
npm run build
```

Electron will automatically spawn the Python backend on port `8787`. The Vite dev server proxies API calls, WebSocket connections, and static file requests to the backend.

## Standalone Scripts

The root directory contains three standalone scripts unrelated to the LabelHub GUI:

| Script | Purpose |
|--------|---------|
| `elrs_controller.py` | CRSF protocol implementation for ExpressLRS radio control (RC channels + telemetry) |
| `inference_video.py` | Run a trained YOLOv8-OBB model on a video file with visualization |
| `label_pose.py` | OpenCV-based keypoint annotation tool for YOLOv8-pose format |

Install standalone dependencies:

```bash
pip install -r requirements.txt
```

## Database

The application uses SQLite (`data/labelhub.db`) with async SQLAlchemy. Tables:

- `projects` — annotation projects
- `video_files` — uploaded videos
- `class_labels` — class definitions per project
- `frames` — extracted frames per video
- `oriented_bboxes` — annotated oriented bounding boxes (cx, cy, width, height, angle, heading)
- `training_runs` — training job history with metrics

## Export Formats

- **YOLOv8-OBB** — 8-point normalized polygon per box (class x1 y1 x2 y2 ... x8 y8)
- **COCO JSON** — standard COCO format with rotated bounding box (cx, cy, w, h, angle)
- **Pascal VOC XML** — per-image XML with rotated bounding box

## License

MIT
