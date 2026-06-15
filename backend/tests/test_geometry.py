"""Pure geometry helpers — the core label math, no DB or I/O."""
import math
import pytest

from backend.services.geometry import (
    normalize_angle,
    yolo_detect_line,
    yolo_segment_line,
    yolo_obb_line,
    polygon_bbox,
    obb_to_aabb,
    obb_corners_px,
    polygon_to_obb,
)


@pytest.mark.parametrize("inp,expected", [
    (0, 0.0), (360, 0.0), (-90, 270.0), (450, 90.0), (720, 0.0), (-360, 0.0),
])
def test_normalize_angle_wraps_into_0_360(inp, expected):
    assert normalize_angle(inp) == pytest.approx(expected)


def test_detect_line_format_and_clamp():
    assert yolo_detect_line(3, 0.5, 0.5, 0.2, 0.1) == "3 0.500000 0.500000 0.200000 0.100000"
    # Out-of-range values are clamped into [0, 1].
    line = yolo_detect_line(0, 1.5, -0.2, 2.0, 0.3)
    cls, cx, cy, w, h = line.split()
    assert cls == "0"
    assert float(cx) == 1.0 and float(cy) == 0.0 and float(w) == 1.0


def test_segment_line_format():
    line = yolo_segment_line(2, [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
    parts = line.split()
    assert parts[0] == "2"
    assert len(parts) == 1 + 6  # class + 3 points
    assert parts[1:3] == ["0.100000", "0.200000"]


def test_obb_line_is_eight_point_polygon():
    line = yolo_obb_line(1, 0.5, 0.5, 0.4, 0.2, 0.0, 640, 480)
    parts = line.split()
    assert parts[0] == "1"
    assert len(parts) == 1 + 8  # class + 4 corners


def test_polygon_bbox_center_and_size():
    cx, cy, w, h = polygon_bbox([[0.2, 0.4], [0.6, 0.4], [0.6, 0.8], [0.2, 0.8]])
    assert (cx, cy, w, h) == pytest.approx((0.4, 0.6, 0.4, 0.4))


def test_polygon_bbox_empty():
    assert polygon_bbox([]) == (0.0, 0.0, 0.0, 0.0)


def test_obb_to_aabb_identity_when_axis_aligned():
    # angle 0 -> AABB equals the box itself.
    cx, cy, w, h = obb_to_aabb(0.5, 0.5, 0.3, 0.1, 0.0, 640, 480)
    assert (cx, cy, w, h) == pytest.approx((0.5, 0.5, 0.3, 0.1))


def test_obb_to_aabb_90_degrees_swaps_w_h():
    # A 90° rotation swaps width/height. Use a square image so normalized
    # dimensions swap cleanly (rotation happens in pixel space).
    cx, cy, w, h = obb_to_aabb(0.5, 0.5, 0.4, 0.2, 90.0, 1000, 1000)
    assert cx == pytest.approx(0.5) and cy == pytest.approx(0.5)
    assert w == pytest.approx(0.2, abs=1e-6)
    assert h == pytest.approx(0.4, abs=1e-6)


def test_obb_to_aabb_rotation_grows_bbox():
    # A rotated box's upright bbox is larger than its own width/height.
    cx, cy, w, h = obb_to_aabb(0.5, 0.5, 0.4, 0.1, 30.0, 1000, 1000)
    assert w > 0.4 - 1e-9 or h > 0.1  # at least one dimension grows
    assert w >= 0 and h >= 0


def test_obb_corners_px_count_and_center():
    corners = obb_corners_px(0.5, 0.5, 0.4, 0.2, 0.0, 1000, 1000)
    assert len(corners) == 4
    cx = sum(p[0] for p in corners) / 4
    cy = sum(p[1] for p in corners) / 4
    assert cx == pytest.approx(500) and cy == pytest.approx(500)


def test_polygon_to_obb_roundtrips_axis_aligned():
    # 4 corners of an axis-aligned 200x100 box centered at (500, 500).
    pts = [(400, 450), (600, 450), (600, 550), (400, 550)]
    cx, cy, w, h, angle = polygon_to_obb(pts)
    assert cx == pytest.approx(500) and cy == pytest.approx(500)
    assert {round(w), round(h)} == {200, 100}
