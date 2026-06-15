import os
import re
import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.config import config
from backend.models.project import Project, ClassLabel
from backend.models.annotation import Frame, OrientedBBox
from backend.services.export_service import export_service
from backend.services.augmentation import augmentation_service
from backend.services.websocket_manager import ws_manager

router = APIRouter(prefix="/api/export", tags=["export"])


class ExportRequest(BaseModel):
    format: str = Field(..., description="Export format: yolov8-obb, coco, pascal-voc")
    train_split: float = Field(default=0.7, ge=0.0, le=1.0)
    val_split: float = Field(default=0.2, ge=0.0, le=1.0)
    test_split: float = Field(default=0.1, ge=0.0, le=1.0)
    apply_augmentation: bool = False
    augmentation_count: int = Field(default=3, ge=0, le=20)
    output_name: str = Field(default="export", min_length=1, max_length=255)


class ExportResponse(BaseModel):
    format: str
    output_path: str
    zip_path: Optional[str] = None
    train_count: int
    val_count: int
    test_count: int


@router.post("/{project_id}", response_model=ExportResponse)
async def export_dataset(
    project_id: int,
    data: ExportRequest,
    db: AsyncSession = Depends(get_db),
):
    if data.format not in config.EXPORT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {data.format}. Supported: {config.EXPORT_FORMATS}",
        )

    if abs(data.train_split + data.val_split + data.test_split - 1.0) > 1e-6:
        raise HTTPException(status_code=400, detail="Split ratios must sum to 1.0")

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Gather data
    classes_result = await db.execute(
        select(ClassLabel).where(ClassLabel.project_id == project_id).order_by(ClassLabel.index)
    )
    classes = list(classes_result.scalars().all())

    frames_result = await db.execute(
        select(Frame)
        .where(Frame.project_id == project_id)
        .where(Frame.is_labeled == True)
        .options(selectinload(Frame.annotations))
    )
    frames = list(frames_result.scalars().all())

    all_annotations = []
    for f in frames:
        for a in f.annotations:
            all_annotations.append(a)

    export_dir = os.path.join(
        config.DATA_DIR, "projects", str(project_id), "exports", data.output_name
    )
    os.makedirs(export_dir, exist_ok=True)

    task_id = f"export_{project_id}"
    await ws_manager.send_progress(task_id, 0, f"Starting {data.format} export...")

    # Compute the split ONCE with a fixed seed so the dataset written, the
    # augmentation source set, and the reported counts all agree.
    splits = export_service.split_data(
        frames, all_annotations,
        data.train_split, data.val_split, data.test_split,
        seed=42,
    )

    # The project's task type is the source of truth for the YOLO label format.
    task_type = project.task_type or "obb"
    yolo_formats = {"yolov8-obb": "obb", "yolov8-detect": "detect", "yolov8-seg": "segment"}

    if data.format in yolo_formats:
        await export_service.export_yolo(
            project_id=project_id,
            output_dir=export_dir,
            classes=classes,
            splits=splits,
            task_type=task_type,
        )
    elif data.format == "coco":
        await export_service.export_coco(
            project_id=project_id,
            output_dir=export_dir,
            classes=classes,
            splits=splits,
        )
    elif data.format == "pascal-voc":
        await export_service.export_pascal_voc(
            project_id=project_id,
            output_dir=export_dir,
            classes=classes,
            splits=splits,
        )

    await ws_manager.send_progress(task_id, 60, "Export structure created...")

    # Apply augmentations on the training set if requested. Supported for the
    # box-based tasks (obb/detect); segment polygons aren't augmented here.
    aug_supported = data.format in ("yolov8-obb", "yolov8-detect") and task_type in ("obb", "detect")
    if data.apply_augmentation and data.format == "yolov8-seg":
        await ws_manager.send_progress(
            task_id, 65, "Аугментация пропущена: не поддерживается для сегментации."
        )
    if data.apply_augmentation and aug_supported and data.augmentation_count > 0:
        from PIL import Image as _PILImage
        from backend.services.geometry import yolo_obb_line, yolo_detect_line

        await ws_manager.send_progress(task_id, 65, "Applying augmentations to training set...")

        train_frames, train_annos = splits["train"]

        train_img_dir = os.path.join(export_dir, "images", "train")
        train_lbl_dir = os.path.join(export_dir, "labels", "train")
        os.makedirs(train_img_dir, exist_ok=True)
        os.makedirs(train_lbl_dir, exist_ok=True)

        for i, frame in enumerate(train_frames):
            frame_annos = [a for a in train_annos if a.frame_id == frame.id]
            if not frame_annos:
                continue

            ann_dicts = []
            for a in frame_annos:
                cls_label = next((c for c in classes if c.id == a.class_id), None)
                cls_idx = cls_label.index if cls_label else 0
                ann_dicts.append({
                    "class_idx": cls_idx,
                    "cx": a.cx,
                    "cy": a.cy,
                    "width": a.width,
                    "height": a.height,
                    "angle": a.angle,
                })

            try:
                aug_results = augmentation_service.apply_augmentations(
                    image_path=frame.image_path,
                    annotations=ann_dicts,
                    count_per_image=data.augmentation_count,
                    output_dir=train_img_dir,
                    image_index=i,
                )
            except Exception as e:
                await ws_manager.send_error(task_id, f"Augmentation error on frame {frame.id}: {str(e)}")
                continue

            for aug_result in aug_results:
                aug_img_name = os.path.basename(aug_result["image_path"])
                base = os.path.splitext(aug_img_name)[0]
                lbl_path = os.path.join(train_lbl_dir, f"{base}.txt")

                try:
                    with _PILImage.open(aug_result["image_path"]) as im:
                        aw, ah = im.size
                except Exception:
                    aw, ah = frame.width, frame.height

                lbl_lines = []
                for a in aug_result["annotations"]:
                    if task_type == "detect":
                        lbl_lines.append(
                            yolo_detect_line(
                                a["class_idx"], a["cx"], a["cy"], a["width"], a["height"],
                            )
                        )
                    else:
                        lbl_lines.append(
                            yolo_obb_line(
                                a["class_idx"], a["cx"], a["cy"], a["width"], a["height"],
                                a["angle"], aw, ah,
                            )
                        )

                if lbl_lines:
                    with open(lbl_path, "w") as f:
                        f.write("\n".join(lbl_lines))

            pct = 65 + int((i + 1) / max(len(train_frames), 1) * 30)
            await ws_manager.send_progress(task_id, pct, f"Augmenting... {i+1}/{len(train_frames)}")

    await ws_manager.send_progress(task_id, 95, "Creating zip archive...")

    zip_path = export_service.zip_export(export_dir)

    await ws_manager.send_progress(task_id, 100, "Export complete!")

    return ExportResponse(
        format=data.format,
        output_path=export_dir,
        zip_path=zip_path,
        train_count=len(splits["train"][0]),
        val_count=len(splits["val"][0]),
        test_count=len(splits["test"][0]),
    )


@router.get("/{project_id}/list")
async def list_exports(project_id: int, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    yolo_format = {
        "detect": "yolov8-detect", "segment": "yolov8-seg", "obb": "yolov8-obb",
    }.get((project.task_type if project else "obb") or "obb", "yolov8-obb")

    export_base = os.path.join(config.DATA_DIR, "projects", str(project_id), "exports")
    if not os.path.exists(export_base):
        return []

    exports = []
    for name in os.listdir(export_base):
        export_path = os.path.join(export_base, name)
        if os.path.isdir(export_path):
            zip_path = export_path.rstrip("/").rstrip("\\") + ".zip"
            stats = {}
            for split_dir in ["train", "val", "test"]:
                # Support both YOLO layouts: images/<split> (current) and
                # <split>/images (legacy).
                img_dir = os.path.join(export_path, "images", split_dir)
                if not os.path.exists(img_dir):
                    img_dir = os.path.join(export_path, split_dir, "images")
                if os.path.exists(img_dir):
                    stats[split_dir] = len([
                        f for f in os.listdir(img_dir)
                        if os.path.isfile(os.path.join(img_dir, f))
                    ])
            exports.append({
                "id": name,
                "filename": name,
                "format": yolo_format,
                "has_zip": os.path.exists(zip_path),
                "stats": stats,
            })
    return exports


@router.post("/import/{project_id}")
async def import_dataset(project_id: int, db: AsyncSession = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Import not yet implemented")


@router.post("/import/{project_id}/preview")
async def preview_import(project_id: int):
    raise HTTPException(status_code=501, detail="Import preview not yet implemented")


class ImportDirRequest(BaseModel):
    path: str
    format: str = "yolov8-obb"
    class_mapping: dict = {}
    merge_strategy: str = "append"


@router.post("/import/{project_id}/dir")
async def import_from_dir(project_id: int, data: ImportDirRequest, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    import_path = data.path.replace('\\', '/')
    if not os.path.exists(import_path):
        raise HTTPException(status_code=400, detail=f"Path not found: {import_path}")

    fmt_to_task = {
        "yolov8-obb": "obb",
        "yolov8-detect": "detect",
        "yolov8-seg": "segment",
    }
    if data.format in fmt_to_task:
        return await _import_yolo(project_id, import_path, data, db, fmt_to_task[data.format])
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported import format: {data.format}")


def _parse_data_yaml_names(base_path: str) -> dict:
    """Extract class name mapping from a YOLO dataset's data.yaml.

    Returns ``{class_index: class_name}``, e.g. ``{0: 'person', 1: 'car'}``.
    Returns an empty dict if data.yaml is missing or unparseable.
    """
    yaml_path = os.path.join(base_path, "data.yaml")
    if not os.path.exists(yaml_path):
        return {}

    try:
        with open(yaml_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return {}

    names = {}
    in_names = False
    auto_idx = 0
    for line in content.splitlines():
        stripped = line.strip()

        if in_names:
            if not stripped:
                break
            # Block-list form: ``- name`` (index implied by order).
            lm = re.match(r"^-\s*(.+?)\s*$", stripped)
            if lm:
                names[auto_idx] = lm.group(1).strip().strip("'\"")
                auto_idx += 1
                continue
            # Dict form: ``0: name``.
            m = re.match(r"^(\d+):\s*(.+?)\s*$", stripped)
            if m:
                names[int(m.group(1))] = m.group(2).strip().strip("'\"")
            else:
                break
        elif stripped == "names:" or stripped.startswith("names:"):
            inline = stripped[len("names:"):].strip()
            if not inline:
                in_names = True
            elif inline.startswith("[") and inline.endswith("]"):
                items = re.findall(r"'([^']*)'|\"([^\"]*)\"", inline[1:-1])
                for i, m in enumerate(items):
                    names[i] = m[0] or m[1]
                break
            else:
                m = re.match(r"^(\d+):\s*(.+?)\s*$", inline)
                if m:
                    names[int(m.group(1))] = m.group(2)
                in_names = True

    return names


async def _resolve_import_classes(project_id: int, db: AsyncSession) -> dict:
    """Return a mapping {source_class_index: ClassLabel.id} for imports.

    Existing project classes are reused by their `index`; missing indices are
    auto-created so a foreign dataset can be imported without manual setup.
    """
    result = await db.execute(
        select(ClassLabel).where(ClassLabel.project_id == project_id)
    )
    by_index = {c.index: c for c in result.scalars().all()}
    return by_index


# Distinct, stable colors for auto-created classes on import.
_IMPORT_PALETTE = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
    "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e",
]


def _color_for(idx: int) -> str:
    return _IMPORT_PALETTE[idx % len(_IMPORT_PALETTE)]


async def _import_yolo(project_id: int, base_path: str, data: ImportDirRequest, db: AsyncSession, task_type: str):
    import json
    import shutil
    from PIL import Image
    from backend.services.geometry import polygon_to_obb, normalize_angle, polygon_bbox

    imported = 0
    task_id = f"import_{project_id}"

    yaml_names = _parse_data_yaml_names(base_path)

    by_index = await _resolve_import_classes(project_id, db)
    next_index = (max(by_index.keys()) + 1) if by_index else 0

    # Pre-create every class declared in data.yaml so they carry their names
    # (and distinct colors) even if some have no annotations in this dataset.
    for idx in sorted(yaml_names.keys()):
        if idx not in by_index:
            label = ClassLabel(
                project_id=project_id,
                name=yaml_names[idx] or f"class_{idx}",
                color=_color_for(idx),
                index=idx,
            )
            db.add(label)
            await db.flush()
            by_index[idx] = label
            next_index = max(next_index, idx + 1)

    async def class_id_for(src_idx: int) -> int:
        nonlocal next_index
        # Explicit override from the request wins.
        if str(src_idx) in data.class_mapping:
            return int(data.class_mapping[str(src_idx)])
        if src_idx in by_index:
            return by_index[src_idx].id
        # Auto-create a class, preferring the name from data.yaml.
        class_name = yaml_names.get(src_idx, f"class_{src_idx}")
        label = ClassLabel(
            project_id=project_id,
            name=class_name,
            color=_color_for(src_idx),
            index=src_idx,
        )
        db.add(label)
        await db.flush()
        by_index[src_idx] = label
        next_index = max(next_index, src_idx + 1)
        return label.id

    for split in ["train", "val", "test"]:
        # Support both YOLO layouts.
        img_dir = os.path.join(base_path, "images", split)
        lbl_dir = os.path.join(base_path, "labels", split)
        if not (os.path.exists(img_dir) and os.path.exists(lbl_dir)):
            img_dir = os.path.join(base_path, split, "images")
            lbl_dir = os.path.join(base_path, split, "labels")
        if not (os.path.exists(img_dir) and os.path.exists(lbl_dir)):
            continue

        dest_img_dir = os.path.join(config.DATA_DIR, "projects", str(project_id), "frames", "imported")
        os.makedirs(dest_img_dir, exist_ok=True)

        for lbl_file in os.listdir(lbl_dir):
            if not lbl_file.endswith(".txt"):
                continue
            base_name = os.path.splitext(lbl_file)[0]
            img_exts = [".jpg", ".jpeg", ".png", ".bmp"]
            img_path = None
            src_ext = ".jpg"
            for ext in img_exts:
                candidate = os.path.join(img_dir, base_name + ext)
                if os.path.exists(candidate):
                    img_path = candidate
                    src_ext = ext
                    break
            if not img_path:
                continue

            stored_name = f"imp_{split}_{base_name}{src_ext}"
            dest_path = os.path.join(dest_img_dir, stored_name)
            shutil.copy2(img_path, dest_path)

            try:
                im = Image.open(dest_path)
                w, h = im.size
            except Exception:
                w, h = 1920, 1080

            frame = Frame(
                project_id=project_id,
                frame_index=imported,
                image_path=dest_path,
                width=w,
                height=h,
                is_labeled=True,
            )
            db.add(frame)
            await db.flush()

            lbl_path = os.path.join(lbl_dir, lbl_file)
            with open(lbl_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split()
                    if len(parts) < 5:
                        continue
                    src_idx = int(float(parts[0]))

                    angle = 0.0
                    points_json = None
                    if task_type == "segment":
                        # YOLO-seg polygon: class x1 y1 ... xn yn (normalized).
                        coords = list(map(float, parts[1:]))
                        if len(coords) < 6:  # need at least 3 points
                            continue
                        pts = [[coords[i], coords[i + 1]] for i in range(0, len(coords) - 1, 2)]
                        cx, cy, bw, bh = polygon_bbox(pts)
                        points_json = json.dumps(pts)
                    elif task_type == "obb" and len(parts) >= 9:
                        # YOLOv8-OBB: class x1 y1 x2 y2 x3 y3 x4 y4 (normalized).
                        coords = list(map(float, parts[1:9]))
                        pts_px = [
                            (coords[i] * w, coords[i + 1] * h)
                            for i in range(0, 8, 2)
                        ]
                        cx_px, cy_px, bw_px, bh_px, angle = polygon_to_obb(pts_px)
                        cx, cy = cx_px / w, cy_px / h
                        bw, bh = bw_px / w, bh_px / h
                    else:
                        # Detect (class cx cy w h) or legacy OBB (class cx cy w h angle).
                        cx, cy, bw, bh = map(float, parts[1:5])
                        if task_type == "obb" and len(parts) > 5:
                            angle = normalize_angle(float(parts[5]))

                    class_id = await class_id_for(src_idx)
                    bbox = OrientedBBox(
                        frame_id=frame.id,
                        class_id=class_id,
                        cx=min(1.0, max(0.0, cx)),
                        cy=min(1.0, max(0.0, cy)),
                        width=min(1.0, max(0.0, bw)),
                        height=min(1.0, max(0.0, bh)),
                        angle=angle,
                        points_json=points_json,
                        is_verified=True,
                    )
                    db.add(bbox)

            imported += 1
            if imported % 10 == 0:
                await ws_manager.send_progress(task_id, min(imported * 2, 99), f"Импортировано {imported} изображений...")

    await db.flush()
    await ws_manager.send_progress(task_id, 100, f"Импорт завершён: {imported} изображений")
    return {"imported": imported, "project_id": project_id}
