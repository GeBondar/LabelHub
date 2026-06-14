"""Shared OBB geometry helpers.

An oriented bounding box (OBB) is stored normalized to the image as:
    cx, cy : box center, in [0, 1]
    width, height : box size, in [0, 1] (fractions of image width/height)
    angle : heading in DEGREES, clockwise, range [0, 360)

`angle` encodes the *direction* the box points ("front" of the object).
The box local frame: width runs along the local x-axis, height along local y.
The "front" of the box is the +x (right) edge of the local frame, so the
heading arrow points along local +x rotated by `angle`.

Rotation is performed in PIXEL space (never in normalized space, which would
distort the box because images are usually not square).
"""

import math
from typing import List, Tuple


def normalize_angle(angle: float) -> float:
    """Wrap an angle in degrees into [0, 360)."""
    a = float(angle) % 360.0
    if a < 0:
        a += 360.0
    return a


def obb_corners_px(
    cx: float,
    cy: float,
    width: float,
    height: float,
    angle: float,
    img_w: int,
    img_h: int,
) -> List[Tuple[float, float]]:
    """Return the 4 OBB corners in pixel coordinates.

    Corner order (clockwise, image coords with y pointing down):
        p1 = front-top, p2 = front-bottom, p3 = back-bottom, p4 = back-top
    Edge p1->p2 is the "front" edge, so the order encodes the heading.
    """
    cx_px = cx * img_w
    cy_px = cy * img_h
    half_w = (width * img_w) / 2.0
    half_h = (height * img_h) / 2.0
    a = math.radians(normalize_angle(angle))
    cos_a = math.cos(a)
    sin_a = math.sin(a)

    local = [
        (half_w, -half_h),   # front-top
        (half_w, half_h),    # front-bottom
        (-half_w, half_h),   # back-bottom
        (-half_w, -half_h),  # back-top
    ]
    corners = []
    for dx, dy in local:
        rx = dx * cos_a - dy * sin_a
        ry = dx * sin_a + dy * cos_a
        corners.append((cx_px + rx, cy_px + ry))
    return corners


def _reorder_for_heading(corners: list, angle: float, heading) -> list:
    """Rotate the corner list so the first edge is the box edge whose outward
    direction is closest to `heading`. The set of points is unchanged (outline
    identical) — only the ordering shifts, which is what encodes the front edge.
    """
    if heading is None:
        return corners
    k = int(round(((normalize_angle(heading) - normalize_angle(angle)) % 360) / 90.0)) % 4
    return corners[k:] + corners[:k]


def obb_corners_norm(
    cx: float,
    cy: float,
    width: float,
    height: float,
    angle: float,
    img_w: int,
    img_h: int,
    heading=None,
) -> List[Tuple[float, float]]:
    """Return the 4 OBB corners normalized to [0, 1] (clipped)."""
    corners_px = obb_corners_px(cx, cy, width, height, angle, img_w, img_h)
    corners_px = _reorder_for_heading(corners_px, angle, heading)
    out = []
    for x, y in corners_px:
        nx = min(1.0, max(0.0, x / img_w)) if img_w > 0 else 0.0
        ny = min(1.0, max(0.0, y / img_h)) if img_h > 0 else 0.0
        out.append((nx, ny))
    return out


def yolo_obb_line(
    class_idx: int,
    cx: float,
    cy: float,
    width: float,
    height: float,
    angle: float,
    img_w: int,
    img_h: int,
    heading=None,
) -> str:
    """Format one Ultralytics YOLOv8-OBB label line.

    Format: ``class_idx x1 y1 x2 y2 x3 y3 x4 y4`` (all coords normalized).
    The first edge (x1,y1)-(x2,y2) is the "front" edge implied by `heading`.
    """
    corners = obb_corners_norm(cx, cy, width, height, angle, img_w, img_h, heading)
    coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in corners)
    return f"{class_idx} {coords}"


def yolo_detect_line(
    class_idx: int,
    cx: float,
    cy: float,
    width: float,
    height: float,
) -> str:
    """Format one Ultralytics YOLO detect label line: ``class cx cy w h``.

    All coordinates are already normalized to [0, 1]. Values are clamped so a
    box edge that slightly overshoots the image never breaks the dataset.
    """
    cx = min(1.0, max(0.0, cx))
    cy = min(1.0, max(0.0, cy))
    width = min(1.0, max(0.0, width))
    height = min(1.0, max(0.0, height))
    return f"{class_idx} {cx:.6f} {cy:.6f} {width:.6f} {height:.6f}"


def yolo_segment_line(
    class_idx: int,
    points: List[Tuple[float, float]],
) -> str:
    """Format one Ultralytics YOLO-seg label line: ``class x1 y1 ... xn yn``.

    `points` are already normalized to [0, 1] (polygon vertices). Coordinates
    are clamped into range.
    """
    coords = " ".join(
        f"{min(1.0, max(0.0, x)):.6f} {min(1.0, max(0.0, y)):.6f}"
        for x, y in points
    )
    return f"{class_idx} {coords}"


def polygon_bbox(
    points: List[Tuple[float, float]],
) -> Tuple[float, float, float, float]:
    """Return the axis-aligned bounding rect (cx, cy, w, h) of a polygon.

    Works in whatever coordinate space the points are given (normalized or
    pixel); the result is in the same space. Used to keep an annotation's
    cx/cy/width/height in sync with its segmentation polygon.
    """
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    if not xs or not ys:
        return 0.0, 0.0, 0.0, 0.0
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return (
        (x_min + x_max) / 2.0,
        (y_min + y_max) / 2.0,
        x_max - x_min,
        y_max - y_min,
    )


def polygon_to_obb(
    points: List[Tuple[float, float]],
) -> Tuple[float, float, float, float, float]:
    """Convert a 4+ point polygon (pixel coords) to (cx, cy, w, h, angle_deg).

    Used when importing YOLOv8-OBB polygons. Heading is taken from the first
    edge (points[0] -> points[1]) so the import round-trips with the exporter.
    Returns center/size in pixels and angle in degrees [0, 360).
    """
    import numpy as np

    pts = np.array(points, dtype=np.float32)
    cx = float(pts[:, 0].mean())
    cy = float(pts[:, 1].mean())

    if len(pts) >= 2:
        front = pts[1] - pts[0]
        angle = math.degrees(math.atan2(front[1], front[0]))
        # The front edge runs perpendicular to the heading; heading is +90deg
        # from the p1->p2 edge in our corner convention (front-top -> front-bottom).
        heading = normalize_angle(angle - 90.0)
    else:
        heading = 0.0

    # width = front-edge depth direction, height = front-edge length.
    if len(pts) >= 4:
        height = float(np.linalg.norm(pts[1] - pts[0]))
        width = float(np.linalg.norm(pts[2] - pts[1]))
    else:
        xs, ys = pts[:, 0], pts[:, 1]
        width = float(xs.max() - xs.min())
        height = float(ys.max() - ys.min())

    return cx, cy, width, height, heading
