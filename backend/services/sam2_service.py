import os
import numpy as np
import cv2
from PIL import Image
from typing import Optional
from shapely.geometry import Polygon
from shapely import affinity

from backend.config import config


class SAM2Service:
    _instance: Optional["SAM2Service"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.predictor = None
        self.device = "cuda" if __import__("torch").cuda.is_available() else "cpu"

    def _ensure_model(self):
        if self.predictor is not None:
            return True
        try:
            import sam2 as _sam2_pkg
            from hydra.core.global_hydra import GlobalHydra
            from hydra import initialize_config_dir
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            import torch

            checkpoint = config.SAM2_CHECKPOINT
            if not os.path.exists(checkpoint):
                raise FileNotFoundError(
                    f"SAM2 checkpoint not found at {checkpoint}. "
                    "Please download it from https://github.com/facebookresearch/sam2"
                )

            GlobalHydra.instance().clear()
            sam2_config_dir = os.path.join(os.path.dirname(_sam2_pkg.__file__), "configs", "sam2")
            with initialize_config_dir(version_base=None, config_dir=sam2_config_dir):
                sam2_model = build_sam2(config.SAM2_MODEL_CFG, device=self.device)

            sd = torch.load(checkpoint, map_location="cpu", weights_only=False)
            if isinstance(sd, dict) and "model" in sd:
                sd = sd["model"]
            sam2_model.load_state_dict(sd, strict=False)
            sam2_model.to(self.device)
            sam2_model.eval()

            self.predictor = SAM2ImagePredictor(sam2_model)
            return True
        except ImportError as e:
            raise RuntimeError(f"SAM2 not available: {e}")
        except FileNotFoundError as e:
            raise RuntimeError(str(e))

    async def predict_from_click(self, image_path: str, x: float, y: float) -> dict:
        self._ensure_model()

        image_path = config.relocate(image_path)
        if not os.path.exists(image_path):
            raise RuntimeError(f"Файл кадра не найден: {image_path}")
        image = Image.open(image_path).convert("RGB")
        image_np = np.array(image)
        orig_h, orig_w = image_np.shape[:2]

        max_size = 1024
        scale = 1.0
        if max(orig_w, orig_h) > max_size:
            scale = max_size / max(orig_w, orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            image_np = cv2.resize(image_np, (new_w, new_h), interpolation=cv2.INTER_AREA)
            x = x * scale
            y = y * scale

        self.predictor.set_image(image_np)

        input_point = np.array([[x, y]])
        input_label = np.array([1])

        masks, scores, _ = self.predictor.predict(
            point_coords=input_point,
            point_labels=input_label,
            multimask_output=True,
        )

        best_idx = np.argmax(scores)
        mask = masks[best_idx]
        score = float(scores[best_idx])

        if scale != 1.0:
            mask = cv2.resize(mask.astype(np.float32), (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
            mask = mask > 0.5

        obb = self._mask_to_obb(mask, orig_w, orig_h)

        return {
            "cx": obb["cx"],
            "cy": obb["cy"],
            "width": obb["width"],
            "height": obb["height"],
            "angle": obb["angle"],
            "score": score,
        }

    async def predict_from_box(self, image_path: str, x1: float, y1: float, x2: float, y2: float) -> dict:
        self._ensure_model()

        image_path = config.relocate(image_path)
        if not os.path.exists(image_path):
            raise RuntimeError(f"Файл кадра не найден: {image_path}")
        image = Image.open(image_path).convert("RGB")
        image_np = np.array(image)
        orig_h, orig_w = image_np.shape[:2]

        max_size = 1024
        scale = 1.0
        if max(orig_w, orig_h) > max_size:
            scale = max_size / max(orig_w, orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            image_np = cv2.resize(image_np, (new_w, new_h), interpolation=cv2.INTER_AREA)
            x1, y1, x2, y2 = x1 * scale, y1 * scale, x2 * scale, y2 * scale

        self.predictor.set_image(image_np)

        input_box = np.array([[x1, y1, x2, y2]])

        masks, scores, _ = self.predictor.predict(
            point_coords=None,
            point_labels=None,
            box=input_box,
            multimask_output=False,
        )

        mask = masks[0]
        score = float(scores[0])

        if scale != 1.0:
            mask = cv2.resize(mask.astype(np.float32), (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
            mask = mask > 0.5

        obb = self._mask_to_obb(mask, orig_w, orig_h)

        return {
            "cx": obb["cx"],
            "cy": obb["cy"],
            "width": obb["width"],
            "height": obb["height"],
            "angle": obb["angle"],
            "score": score,
        }

    def _mask_to_obb(self, mask: np.ndarray, img_width: int, img_height: int) -> dict:
        mask_uint8 = (mask * 255).astype(np.uint8)
        contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return {"cx": 0.5, "cy": 0.5, "width": 0.1, "height": 0.1, "angle": 0.0}

        all_points = np.vstack(contours)
        rect = cv2.minAreaRect(all_points)

        # rect = ((cx_px, cy_px), (w_px, h_px), angle)
        center_px, size_px, angle = rect
        cx_px, cy_px = center_px
        w_px, h_px = size_px

        if w_px < h_px:
            w_px, h_px = h_px, w_px
            angle += 90

        angle = angle % 180
        if angle > 90:
            angle -= 180

        return {
            "cx": cx_px / img_width if img_width > 0 else 0.0,
            "cy": cy_px / img_height if img_height > 0 else 0.0,
            "width": w_px / img_width if img_width > 0 else 0.0,
            "height": h_px / img_height if img_height > 0 else 0.0,
            "angle": angle,
        }

    def unload(self):
        if self.predictor is not None:
            del self.predictor
            self.predictor = None
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


sam2_service = SAM2Service()
