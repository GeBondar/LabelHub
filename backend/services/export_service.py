import os
import json
import math
import random
import shutil
import zipfile
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload

from backend.config import config
from backend.models.annotation import Frame, OrientedBBox
from backend.models.project import Project, ClassLabel, VideoFile
from backend.services.websocket_manager import ws_manager
from backend.services.geometry import yolo_obb_line, obb_corners_px


class ExportService:
    async def export_yolov8_obb(
        self,
        project_id: int,
        output_dir: str,
        classes: list,
        splits: dict,
    ):
        """Write an Ultralytics YOLOv8-OBB dataset.

        Label format is the standard 8-point polygon:
            class_idx x1 y1 x2 y2 x3 y3 x4 y4   (normalized, clockwise)
        `splits` is the result of split_data() so train/val/test are stable.
        """
        class_map = {c.id: c.index for c in classes}
        class_names = [c.name for c in sorted(classes, key=lambda x: x.index)]

        for split_name, (split_frames, split_annos) in splits.items():
            img_dir = os.path.join(output_dir, "images", split_name)
            lbl_dir = os.path.join(output_dir, "labels", split_name)
            os.makedirs(img_dir, exist_ok=True)
            os.makedirs(lbl_dir, exist_ok=True)

            for frame in split_frames:
                frame_annos = [a for a in split_annos if a.frame_id == frame.id]

                img_name = os.path.basename(frame.image_path)
                base_name = os.path.splitext(img_name)[0]

                try:
                    shutil.copy2(frame.image_path, os.path.join(img_dir, img_name))
                except FileNotFoundError:
                    continue

                label_lines = []
                for a in frame_annos:
                    cls_idx = class_map.get(a.class_id, 0)
                    label_lines.append(
                        yolo_obb_line(
                            cls_idx, a.cx, a.cy, a.width, a.height, a.angle,
                            frame.width, frame.height,
                            heading=a.heading if a.heading is not None else a.angle,
                        )
                    )

                lbl_path = os.path.join(lbl_dir, f"{base_name}.txt")
                with open(lbl_path, "w") as f:
                    f.write("\n".join(label_lines))

        # Ultralytics resolves train/val/test relative to `path`.
        names_block = "\n".join(f"  {i}: {n}" for i, n in enumerate(class_names))
        yaml_path = os.path.join(output_dir, "data.yaml")
        yaml_content = (
            f"path: {os.path.abspath(output_dir)}\n"
            f"train: images/train\n"
            f"val: images/val\n"
            f"test: images/test\n\n"
            f"nc: {len(class_names)}\n"
            f"names:\n{names_block}\n"
        )
        with open(yaml_path, "w") as f:
            f.write(yaml_content)

    async def export_coco(
        self,
        project_id: int,
        output_dir: str,
        classes: list,
        splits: dict,
    ):
        class_map = {c.id: c.index for c in classes}

        categories = []
        for c in classes:
            categories.append({
                "id": c.index + 1,
                "name": c.name,
                "supercategory": "none",
            })

        ann_dir = os.path.join(output_dir, "annotations")
        os.makedirs(ann_dir, exist_ok=True)

        for split_name, (split_frames, split_annos) in splits.items():
            coco = {
                "images": [],
                "annotations": [],
                "categories": categories,
            }

            frame_id_map = {}

            for frame in split_frames:
                img_name = os.path.basename(frame.image_path)
                coco_image = {
                    "id": frame.id,
                    "file_name": img_name,
                    "width": frame.width,
                    "height": frame.height,
                }
                coco["images"].append(coco_image)
                frame_id_map[frame.id] = frame

                img_dir = os.path.join(output_dir, split_name, "images")
                os.makedirs(img_dir, exist_ok=True)
                try:
                    shutil.copy2(frame.image_path, os.path.join(img_dir, img_name))
                except FileNotFoundError:
                    pass

            ann_id = 1
            for a in split_annos:
                if a.frame_id not in frame_id_map:
                    continue
                frame = frame_id_map[a.frame_id]

                corners = obb_corners_px(
                    a.cx, a.cy, a.width, a.height, a.angle, frame.width, frame.height
                )
                seg = [coord for pt in corners for coord in pt]
                xs = [p[0] for p in corners]
                ys = [p[1] for p in corners]
                bx, by = min(xs), min(ys)
                bw, bh = max(xs) - bx, max(ys) - by

                coco_ann = {
                    "id": ann_id,
                    "image_id": a.frame_id,
                    "category_id": class_map.get(a.class_id, 0) + 1,
                    "bbox": [bx, by, bw, bh],
                    "segmentation": [seg],
                    "area": a.width * a.height * frame.width * frame.height,
                    "iscrowd": 0,
                    "angle": a.angle,
                }
                coco["annotations"].append(coco_ann)
                ann_id += 1

            json_path = os.path.join(ann_dir, f"instances_{split_name}.json")
            with open(json_path, "w") as f:
                json.dump(coco, f, indent=2)

    async def export_pascal_voc(
        self,
        project_id: int,
        output_dir: str,
        classes: list,
        splits: dict,
    ):
        class_map = {c.id: c.name for c in classes}

        ann_dir = os.path.join(output_dir, "Annotations")
        os.makedirs(ann_dir, exist_ok=True)

        for split_name, (split_frames, split_annos) in splits.items():
            img_dir = os.path.join(output_dir, split_name, "JPEGImages")
            os.makedirs(img_dir, exist_ok=True)

            for frame in split_frames:
                frame_annos = [a for a in split_annos if a.frame_id == frame.id]
                if not frame_annos:
                    continue

                img_name = os.path.basename(frame.image_path)
                base_name = os.path.splitext(img_name)[0]

                try:
                    shutil.copy2(frame.image_path, os.path.join(img_dir, img_name))
                except FileNotFoundError:
                    continue

                xml_path = os.path.join(ann_dir, f"{base_name}.xml")
                self._write_voc_xml(xml_path, frame, frame_annos, class_map)

    def _write_voc_xml(self, xml_path: str, frame: Frame, annotations: list, class_map: dict):
        ann_items = []
        for a in annotations:
            cx_px = a.cx * frame.width
            cy_px = a.cy * frame.height
            class_name = class_map.get(a.class_id, "unknown")

            ann_items.append(f"""    <object>
        <name>{class_name}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <robndbox>
            <cx>{cx_px:.2f}</cx>
            <cy>{cy_px:.2f}</cy>
            <w>{a.width * frame.width:.2f}</w>
            <h>{a.height * frame.height:.2f}</h>
            <angle>{a.angle:.4f}</angle>
        </robndbox>
    </object>""")

        xml_content = f"""<?xml version="1.0" encoding="utf-8"?>
<annotation>
    <folder>{os.path.basename(os.path.dirname(xml_path))}</folder>
    <filename>{os.path.basename(frame.image_path)}</filename>
    <path>{frame.image_path}</path>
    <source>
        <database>LabelHub</database>
    </source>
    <size>
        <width>{frame.width}</width>
        <height>{frame.height}</height>
        <depth>3</depth>
    </size>
    <segmented>0</segmented>
{chr(10).join(ann_items)}
</annotation>"""

        with open(xml_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

    def split_data(
        self,
        frames: list,
        annotations: list,
        train_pct: float,
        val_pct: float,
        test_pct: float,
        seed: Optional[int] = None,
    ) -> dict:
        assert abs(train_pct + val_pct + test_pct - 1.0) < 1e-6

        labeled_frames = [f for f in frames if f.is_labeled]
        if not labeled_frames:
            labeled_frames = [f for f in frames if any(a.frame_id == f.id for a in annotations)]

        if not labeled_frames:
            return {"train": ([], []), "val": ([], []), "test": ([], [])}

        rng = random.Random(seed) if seed is not None else random
        labeled_frames = list(labeled_frames)
        rng.shuffle(labeled_frames)
        n = len(labeled_frames)
        train_end = max(1, int(n * train_pct))
        val_end = train_end + max(0, int(n * val_pct))

        train_frames = labeled_frames[:train_end]
        val_frames = labeled_frames[train_end:val_end]
        test_frames = labeled_frames[val_end:]

        def annos_for(fs):
            f_ids = {f.id for f in fs}
            return [a for a in annotations if a.frame_id in f_ids]

        return {
            "train": (train_frames, annos_for(train_frames)),
            "val": (val_frames, annos_for(val_frames)),
            "test": (test_frames, annos_for(test_frames)),
        }

    @staticmethod
    def zip_export(output_dir: str) -> str:
        zip_path = output_dir.rstrip("/").rstrip("\\") + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(output_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, os.path.dirname(output_dir))
                    zf.write(file_path, arcname)
        return zip_path


export_service = ExportService()
