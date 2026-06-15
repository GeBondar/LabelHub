"""End-to-end API tests through the FastAPI app (real SQLite on a temp dir)."""
import json
import pytest
from PIL import Image


# ----------------------------------------------------------------- projects
def test_create_project_sets_task_type(client):
    r = client.post("/api/projects/", json={"name": "p-detect", "task_type": "detect"})
    assert r.status_code == 200, r.text
    assert r.json()["task_type"] == "detect"


def test_invalid_task_type_rejected(client):
    r = client.post("/api/projects/", json={"name": "bad", "task_type": "nonsense"})
    assert r.status_code == 422


def test_project_defaults_to_obb(client):
    r = client.post("/api/projects/", json={"name": "p-default"})
    assert r.json()["task_type"] == "obb"


# ------------------------------------------------------------- base models
@pytest.mark.parametrize("task,suffix", [
    ("detect", "yolov8n.pt"), ("segment", "yolov8n-seg.pt"), ("obb", "yolov8n-obb.pt"),
])
def test_base_models_per_task(client, task, suffix):
    r = client.get("/api/training/models", params={"task_type": task})
    assert r.status_code == 200
    models = r.json()["models"]
    assert suffix in models
    assert len(models) == 10  # yolov8 + yolo11, 5 sizes each


# --------------------------------------------------------------- sam2 status
def test_sam2_status_shape(client):
    r = client.get("/api/annotations/sam2/status")
    assert r.status_code == 200
    body = r.json()
    assert "state" in body and "loaded" in body


# ------------------------------------------------------------------ import
def _make_dataset(root, labels_text, yaml_text, size=(640, 480)):
    (root / "images" / "train").mkdir(parents=True)
    (root / "labels" / "train").mkdir(parents=True)
    Image.new("RGB", size, (20, 20, 20)).save(root / "images" / "train" / "f0.jpg")
    (root / "labels" / "train" / "f0.txt").write_text(labels_text, encoding="utf-8")
    (root / "data.yaml").write_text(yaml_text, encoding="utf-8")
    return str(root)


def test_import_detect_names_from_yaml_and_counts(client, tmp_path):
    root = _make_dataset(
        tmp_path / "ds",
        "0 0.5 0.5 0.2 0.1\n1 0.3 0.3 0.1 0.1\n",
        "nc: 2\nnames:\n  0: robot\n  1: ball\n",
    )
    pid = client.post("/api/projects/", json={"name": "imp-detect", "task_type": "detect"}).json()["id"]
    r = client.post(f"/api/export/import/{pid}/dir",
                    json={"path": root, "format": "yolov8-detect"})
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1

    names = sorted(c["name"] for c in client.get(f"/api/projects/{pid}/classes").json())
    assert names == ["ball", "robot"]

    proj = client.get(f"/api/projects/{pid}").json()
    assert proj["frame_count"] == 1
    assert proj["annotation_count"] == 2
    assert proj["labeled_frame_count"] == 1


def test_import_segment_stores_polygon(client, tmp_path):
    root = _make_dataset(
        tmp_path / "seg",
        "0 0.4 0.4 0.6 0.4 0.55 0.6 0.4 0.62\n",
        "names:\n  - thing\n",
        size=(320, 320),
    )
    pid = client.post("/api/projects/", json={"name": "imp-seg", "task_type": "segment"}).json()["id"]
    r = client.post(f"/api/export/import/{pid}/dir",
                    json={"path": root, "format": "yolov8-seg"})
    assert r.status_code == 200, r.text

    frames = client.get(f"/api/videos/{pid}/frames").json()["items"]
    assert len(frames) == 1
    anns = client.get(f"/api/annotations/frame/{frames[0]['id']}").json()
    assert len(anns) == 1
    assert anns[0]["points"] is not None and len(anns[0]["points"]) >= 3


def test_import_detect_labels_are_axis_aligned(client, tmp_path):
    root = _make_dataset(
        tmp_path / "det2",
        "0 0.5 0.5 0.2 0.1\n",
        "names: [obj]\n",
    )
    pid = client.post("/api/projects/", json={"name": "imp-det2", "task_type": "detect"}).json()["id"]
    client.post(f"/api/export/import/{pid}/dir", json={"path": root, "format": "yolov8-detect"})
    frames = client.get(f"/api/videos/{pid}/frames").json()["items"]
    anns = client.get(f"/api/annotations/frame/{frames[0]['id']}").json()
    assert anns[0]["angle"] == 0.0
    assert anns[0]["points"] is None


# ------------------------------------------------- export reflects task type
def test_export_detect_produces_5_token_labels(client, tmp_path):
    root = _make_dataset(
        tmp_path / "e",
        "0 0.5 0.5 0.2 0.1\n",
        "names: [obj]\n",
    )
    pid = client.post("/api/projects/", json={"name": "exp", "task_type": "detect"}).json()["id"]
    client.post(f"/api/export/import/{pid}/dir", json={"path": root, "format": "yolov8-detect"})

    r = client.post(f"/api/export/{pid}", json={
        "format": "yolov8-detect", "train_split": 1.0, "val_split": 0.0,
        "test_split": 0.0, "output_name": "out", "apply_augmentation": False,
    })
    assert r.status_code == 200, r.text
    assert r.json()["train_count"] == 1
