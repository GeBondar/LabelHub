"""
YOLOv8-pose labelling tool — pure OpenCV, zero dependencies except cv2 + numpy.

Usage:
    python label_pose.py <images_dir> --points 4

Controls:
    Left click            — place next keypoint (in order)
    Right click on point  — remove it
    Left drag on point    — move it
    Space / Right arrow   — save and next image
    Left arrow            — previous image
    Backspace             — go back one image
    R                     — reset all points on current image
    S                     — save without moving
    [ / ]                 — jump 10 images back/forward
    Q / Esc               — quit

Format: YOLOv8-pose TXT (one file per image)
    class_id x1 y1 v1 x2 y2 v2 ... xn yn vn
    v=2 (visible), coordinates normalized [0..1]
"""

import cv2
import numpy as np
from pathlib import Path
import argparse
import json
import sys

COLORS = [
    (0, 255, 0), (255, 0, 0), (0, 0, 255), (255, 255, 0),
    (255, 0, 255), (0, 255, 255), (128, 255, 0), (255, 128, 0),
]
RADIUS = 5
FONT = cv2.FONT_HERSHEY_SIMPLEX


class PoseLabeler:
    def __init__(self, image_dir, num_points=4, class_id=0, class_name="robot",
                 extensions=(".jpg", ".jpeg", ".png", ".bmp", ".tiff")):
        self.image_dir = Path(image_dir)
        self.num_points = num_points
        self.class_id = class_id
        self.class_name = class_name

        self.images = sorted([
            p for p in self.image_dir.iterdir()
            if p.suffix.lower() in extensions
        ])
        if not self.images:
            print(f"No images found in {image_dir}")
            sys.exit(1)

        self.idx = 0
        self.points = []  # list of (x, y) in pixels
        self.dragging = None
        self.drag_threshold = 3

        self.window = f"YOLOv8 Pose Labeler [{class_name}] — {num_points} pts"
        cv2.namedWindow(self.window, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(self.window, 1280, 960)
        cv2.setMouseCallback(self.window, self._mouse_cb)

        self._load_image()
        self._load_annotation()

    # ------------------------------------------------------------------
    def _load_image(self):
        self.path = self.images[self.idx]
        self.img = cv2.imread(str(self.path))
        if self.img is None:
            print(f"Failed to load {self.path}, skipping")
            self.idx += 1
            return self._load_image()
        self.h, self.w = self.img.shape[:2]
        self.display = self.img.copy()

    # ------------------------------------------------------------------
    def _annotation_path(self):
        return self.path.with_suffix(".txt")

    def _save_annotation(self):
        txt = self._annotation_path()
        if not self.points:
            if txt.exists():
                txt.unlink()
            return

        with open(txt, "w") as f:
            line = [str(self.class_id)]
            for x, y in self.points:
                line.append(f"{x / self.w:.6f}")
                line.append(f"{y / self.h:.6f}")
                line.append("2")  # visible
            f.write(" ".join(line) + "\n")

    def _load_annotation(self):
        txt = self._annotation_path()
        self.points = []
        if not txt.exists():
            return
        with open(txt) as f:
            for line in f:
                parts = line.strip().split()
                kps = parts[1:]  # skip class_id, take triplets
                for i in range(0, len(kps), 3):
                    xn = float(kps[i])
                    yn = float(kps[i + 1])
                    self.points.append((int(xn * self.w), int(yn * self.h)))

    # ------------------------------------------------------------------
    def _mouse_cb(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            # Check if clicking near an existing point for drag
            for i, (px, py) in enumerate(self.points):
                if abs(x - px) < RADIUS + 3 and abs(y - py) < RADIUS + 3:
                    self.dragging = i
                    return
            # Otherwise, add a new point (if not full)
            if len(self.points) < self.num_points:
                self.points.append((x, y))

        elif event == cv2.EVENT_LBUTTONUP:
            self.dragging = None

        elif event == cv2.EVENT_MOUSEMOVE and self.dragging is not None:
            self.points[self.dragging] = (x, y)

        elif event == cv2.EVENT_RBUTTONDOWN:
            # Remove nearest point
            if not self.points:
                return
            dists = [(abs(x - px) + abs(y - py), i)
                     for i, (px, py) in enumerate(self.points)]
            dists.sort()
            if dists[0][0] < RADIUS + 5:
                self.points.pop(dists[0][1])

    # ------------------------------------------------------------------
    def _draw(self):
        self.display = self.img.copy()

        # Progress bar at top
        pct = (self.idx + 1) / len(self.images)
        bar_w = int(self.w * pct)
        cv2.rectangle(self.display, (0, 0), (bar_w, 4), (0, 255, 100), -1)

        # Header bar
        header = f"  {self.idx + 1}/{len(self.images)}  |  {self.path.name}  |  {len(self.points)}/{self.num_points} points"
        cv2.rectangle(self.display, (0, self.h - 36), (self.w, self.h), (30, 30, 30), -1)
        cv2.putText(self.display, header, (8, self.h - 10), FONT, 0.5,
                    (200, 200, 200), 1, cv2.LINE_AA)

        # Points and connections
        for i, (px, py) in enumerate(self.points):
            color = COLORS[i % len(COLORS)]
            cv2.circle(self.display, (px, py), RADIUS, color, -1)
            cv2.circle(self.display, (px, py), RADIUS + 1, (255, 255, 255), 1)
            # Label
            cv2.putText(self.display, str(i), (px + 8, py - 8),
                        FONT, 0.45, color, 1, cv2.LINE_AA)

        # Lines connecting points in order
        for i in range(len(self.points) - 1):
            cv2.line(self.display, self.points[i], self.points[i + 1],
                     (255, 255, 255), 1, cv2.LINE_AA)

        cv2.imshow(self.window, self.display)

    # ------------------------------------------------------------------
    def run(self):
        print(f"\nLoaded {len(self.images)} images from {self.image_dir}")
        print(f"Keypoints: {self.num_points} | Class: [{self.class_id}] {self.class_name}")
        print(f"Image {self.idx + 1}: {self.path.name}")
        print("\nControls:")
        print("  LeftClick = add point  |  RightClick = remove  |  LeftDrag = move")
        print("  Space/Right = next  |  Left = prev  |  R = reset  |  Q = quit\n")

        while True:
            self._draw()
            key = cv2.waitKeyEx(10) & 0xFF

            if key == 0xFF:
                continue
            elif key in (27, ord('q')):  # Esc / Q
                self._save_annotation()
                break
            elif key in (32, 83):        # Space / Right arrow
                self._save_annotation()
                self.idx = min(self.idx + 1, len(self.images) - 1)
                self._load_image()
                self._load_annotation()
            elif key == 81:              # Left arrow
                self._save_annotation()
                self.idx = max(self.idx - 1, 0)
                self._load_image()
                self._load_annotation()
            elif key == 8:               # Backspace (sometimes)
                if self.points:
                    self.points.pop()
            elif key == ord('r'):
                self.points = []
            elif key == ord('s'):
                self._save_annotation()
                print(f"Saved {self._annotation_path().name}")
            elif key == ord('['):
                self._save_annotation()
                self.idx = max(self.idx - 10, 0)
                self._load_image()
                self._load_annotation()
            elif key == ord(']'):
                self._save_annotation()
                self.idx = min(self.idx + 10, len(self.images) - 1)
                self._load_image()
                self._load_annotation()

        cv2.destroyAllWindows()
        if self.idx >= len(self.images) - 1:
            # Check if we need to create a YAML config for ultralytics
            self._write_dataset_config()

    # ------------------------------------------------------------------
    def _write_dataset_config(self):
        """Write a minimal ultralytics dataset YAML for training."""
        yaml_path = self.image_dir.parent / "dataset.yaml"
        if yaml_path.exists():
            return

        # Guess split from directory name
        dir_name = self.image_dir.name
        config = {
            "path": str(self.image_dir.parent.resolve()),
            "train": dir_name,
            "val": dir_name,
            "kpt_shape": [self.num_points, 3],
            "names": {self.class_id: self.class_name},
        }
        with open(yaml_path, "w") as f:
            f.write(f"# Auto-generated by label_pose.py\n")
            for k, v in config.items():
                if isinstance(v, dict):
                    f.write(f"{k}:\n")
                    for dk, dv in v.items():
                        f.write(f"  {dk}: {dv}\n")
                elif isinstance(v, list):
                    f.write(f"{k}: {v}\n")
                else:
                    f.write(f"{k}: {v}\n")

        print(f"\nWritten dataset config: {yaml_path}")


# ======================================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YOLOv8-pose keypoint labeler")
    parser.add_argument("images", help="Directory with images to label")
    parser.add_argument("--points", "-p", type=int, default=4,
                        help="Number of keypoints (default: 4)")
    parser.add_argument("--class-id", type=int, default=0,
                        help="Class ID (default: 0)")
    parser.add_argument("--class-name", default="robot",
                        help="Class name (default: robot)")
    args = parser.parse_args()

    app = PoseLabeler(
        image_dir=args.images,
        num_points=args.points,
        class_id=args.class_id,
        class_name=args.class_name,
    )
    app.run()
