import os
import random
import numpy as np
import cv2
from PIL import Image
# NOTE: albumentations is imported lazily (see _get_pipeline) because it pulls
# in torch, which would otherwise block backend startup on import.

from backend.config import config
from backend.services.geometry import obb_corners_px, polygon_to_obb, normalize_angle


class AugmentationService:
    """Augments images together with their oriented bounding boxes.

    OBBs are transformed by passing their 4 corners through the pipeline as
    keypoints (remove_invisible=False keeps the grouping intact), then the
    augmented corners are converted back to (cx, cy, w, h, angle). This keeps
    the heading correct under flips and rotations, which the old axis-aligned
    bbox approach could not do.
    """

    def __init__(self):
        # Built lazily on first use to keep albumentations (and torch) out of
        # the startup import path.
        self.transform_pipeline = None

    def _get_pipeline(self):
        if self.transform_pipeline is None:
            import albumentations as A
            self.transform_pipeline = A.Compose(
                [
                    A.HorizontalFlip(p=0.5),
                    A.VerticalFlip(p=0.3),
                    A.Rotate(limit=30, p=0.5, border_mode=cv2.BORDER_CONSTANT),
                    A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.5),
                    A.GaussNoise(p=0.3),
                ],
                keypoint_params=A.KeypointParams(format="xy", remove_invisible=False),
            )
        return self.transform_pipeline

    def apply_augmentations(
        self,
        image_path: str,
        annotations: list[dict],
        count_per_image: int,
        output_dir: str,
        image_index: int,
    ) -> list[dict]:
        """
        annotations: list of dicts with {class_idx, cx, cy, width, height, angle}
                     (all normalized to the source image).
        Returns list of dicts with {image_path, annotations}.
        """
        image = cv2.imread(image_path)
        if image is None:
            return []
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        h, w = image.shape[:2]

        results = []

        for aug_idx in range(count_per_image):
            keypoints = []
            kp_meta = []  # (ann_index, corner_index)
            for ai, ann in enumerate(annotations):
                corners = obb_corners_px(
                    ann["cx"], ann["cy"], ann["width"], ann["height"],
                    ann.get("angle", 0.0), w, h,
                )
                for ci, (x, y) in enumerate(corners):
                    keypoints.append((float(np.clip(x, 0, w - 1)), float(np.clip(y, 0, h - 1))))
                    kp_meta.append((ai, ci))

            if not keypoints:
                return results

            try:
                transformed = self._get_pipeline()(image=image, keypoints=keypoints)
            except Exception:
                continue

            aug_image = transformed["image"]
            aug_kps = transformed["keypoints"]
            aug_h, aug_w = aug_image.shape[:2]

            grouped: dict[int, list] = {}
            for (ai, ci), pt in zip(kp_meta, aug_kps):
                grouped.setdefault(ai, [None, None, None, None])[ci] = (pt[0], pt[1])

            out_filename = f"aug_{image_index}_{aug_idx}.jpg"
            out_path = os.path.join(output_dir, out_filename)
            aug_image_bgr = cv2.cvtColor(aug_image, cv2.COLOR_RGB2BGR)
            cv2.imwrite(out_path, aug_image_bgr)

            new_annotations = []
            for ai, ann in enumerate(annotations):
                pts = grouped.get(ai)
                if not pts or any(p is None for p in pts):
                    continue
                cx_px, cy_px, bw_px, bh_px, angle = polygon_to_obb(pts)
                if bw_px < 1 or bh_px < 1:
                    continue
                # Skip boxes whose center landed outside the augmented frame.
                if not (0 <= cx_px <= aug_w and 0 <= cy_px <= aug_h):
                    continue
                new_annotations.append({
                    "class_idx": ann["class_idx"],
                    "cx": float(np.clip(cx_px / aug_w, 0, 1)),
                    "cy": float(np.clip(cy_px / aug_h, 0, 1)),
                    "width": float(np.clip(bw_px / aug_w, 0, 1)),
                    "height": float(np.clip(bh_px / aug_h, 0, 1)),
                    "angle": normalize_angle(angle),
                })

            if not new_annotations:
                # nothing survived; drop the produced image to avoid empty labels
                try:
                    os.remove(out_path)
                except OSError:
                    pass
                continue

            results.append({
                "image_path": out_path,
                "annotations": new_annotations,
            })

        return results


augmentation_service = AugmentationService()
