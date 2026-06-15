"""Export label builders, dataset split, and a full YOLO export round-trip."""
import os
import json
import asyncio
from types import SimpleNamespace

import pytest
from PIL import Image

from backend.services.export_service import export_service as es


def _ann(**kw):
    base = dict(frame_id=1, cx=0.5, cy=0.5, width=0.2, height=0.1, angle=0.0,
                heading=0.0, points_json=None, class_id=1)
    base.update(kw)
    return SimpleNamespace(**base)


FRAME = SimpleNamespace(id=1, width=640, height=480)


def test_detect_line_drops_rotation_to_aabb():
    # A rotated annotation must export as its upright bounding box for detect.
    line = es._detect_line(_ann(angle=45.0, width=0.3, height=0.1), FRAME, 0)
    parts = line.split()
    assert len(parts) == 5
    # width should grow / height change vs the rotated local dims.
    assert float(parts[3]) != pytest.approx(0.3) or float(parts[4]) != pytest.approx(0.1)


def test_detect_line_axis_aligned_unchanged():
    line = es._detect_line(_ann(angle=0.0, width=0.3, height=0.1), FRAME, 0)
    assert line == "0 0.500000 0.500000 0.300000 0.100000"


def test_obb_line_eight_points():
    line = es._obb_line(_ann(angle=20.0), FRAME, 0)
    assert len(line.split()) == 9


def test_segment_line_uses_polygon():
    poly = [[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]
    line = es._segment_line(_ann(points_json=json.dumps(poly)), FRAME, 0)
    parts = line.split()
    assert parts[0] == "0"
    assert len(parts) == 1 + 6


def test_segment_line_falls_back_to_box_rectangle():
    # No polygon -> a 4-point rectangle derived from the bbox.
    line = es._segment_line(_ann(points_json=None), FRAME, 0)
    assert len(line.split()) == 1 + 8


def test_split_data_is_stable_and_partitions():
    frames = [SimpleNamespace(id=i, is_labeled=True) for i in range(10)]
    annos = []
    s1 = es.split_data(frames, annos, 0.7, 0.2, 0.1, seed=42)
    s2 = es.split_data(frames, annos, 0.7, 0.2, 0.1, seed=42)
    ids = lambda fs: sorted(f.id for f in fs)
    # Deterministic with a fixed seed.
    assert ids(s1["train"][0]) == ids(s2["train"][0])
    # Every labeled frame lands in exactly one split, no overlaps.
    all_ids = ids(s1["train"][0]) + ids(s1["val"][0]) + ids(s1["test"][0])
    assert sorted(all_ids) == list(range(10))


@pytest.mark.parametrize("task,expected_tokens", [("detect", 5), ("obb", 9)])
def test_export_yolo_roundtrip_box_tasks(tmp_path, task, expected_tokens):
    img_dir = tmp_path / "src"
    img_dir.mkdir()
    img = img_dir / "f0.jpg"
    Image.new("RGB", (640, 480), (20, 20, 20)).save(img)
    frame = SimpleNamespace(id=1, image_path=str(img), width=640, height=480, is_labeled=True)
    ann = _ann(angle=15.0 if task == "obb" else 0.0)
    cls = SimpleNamespace(id=1, index=0, name="obj")
    splits = {"train": ([frame], [ann]), "val": ([frame], [ann]), "test": ([], [])}
    out = tmp_path / "ds"

    asyncio.run(es.export_yolo(0, str(out), [cls], splits, task))

    # data.yaml + image copied + label has the right token count.
    yaml_text = (out / "data.yaml").read_text()
    assert "nc: 1" in yaml_text and "obj" in yaml_text
    assert (out / "images" / "train" / "f0.jpg").exists()
    label = (out / "labels" / "train" / "f0.txt").read_text().strip()
    assert len(label.split()) == expected_tokens


def test_export_yolo_segment_writes_polygon(tmp_path):
    img_dir = tmp_path / "src"
    img_dir.mkdir()
    img = img_dir / "f0.jpg"
    Image.new("RGB", (320, 320), (20, 20, 20)).save(img)
    frame = SimpleNamespace(id=1, image_path=str(img), width=320, height=320, is_labeled=True)
    poly = [[0.4, 0.4], [0.6, 0.4], [0.55, 0.6], [0.4, 0.62]]
    ann = _ann(points_json=json.dumps(poly))
    cls = SimpleNamespace(id=1, index=0, name="obj")
    splits = {"train": ([frame], [ann]), "val": ([frame], [ann]), "test": ([], [])}
    out = tmp_path / "ds"

    asyncio.run(es.export_yolo(0, str(out), [cls], splits, "segment"))

    label = (out / "labels" / "train" / "f0.txt").read_text().strip()
    # class + 4 polygon points = 9 tokens.
    assert len(label.split()) == 1 + 8
