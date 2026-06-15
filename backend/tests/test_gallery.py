"""Folder/sources endpoint and frame filters (video / imported / class)."""
from PIL import Image


def _two_class_dataset(root):
    (root / "images" / "train").mkdir(parents=True)
    (root / "labels" / "train").mkdir(parents=True)
    for name in ("f0", "f1"):
        Image.new("RGB", (320, 240), (10, 10, 10)).save(root / "images" / "train" / f"{name}.jpg")
    # f0 has class 0 only, f1 has class 1 only.
    (root / "labels" / "train" / "f0.txt").write_text("0 0.5 0.5 0.2 0.1\n")
    (root / "labels" / "train" / "f1.txt").write_text("1 0.3 0.3 0.1 0.1\n")
    (root / "data.yaml").write_text("names:\n  0: robot\n  1: ball\n")
    return str(root)


def test_sources_has_imported_folder(client, tmp_path):
    pid = client.post("/api/projects/", json={"name": "src", "task_type": "detect"}).json()["id"]
    client.post(f"/api/export/import/{pid}/dir",
                json={"path": _two_class_dataset(tmp_path / "ds"), "format": "yolov8-detect"})

    sources = client.get(f"/api/videos/{pid}/sources").json()
    assert len(sources) == 1
    s = sources[0]
    assert s["kind"] == "imported"
    assert s["name"] == "Импорт"
    assert s["frame_count"] == 2
    assert s["thumb"]  # first frame's image path


def test_frames_filter_by_class(client, tmp_path):
    pid = client.post("/api/projects/", json={"name": "cls", "task_type": "detect"}).json()["id"]
    client.post(f"/api/export/import/{pid}/dir",
                json={"path": _two_class_dataset(tmp_path / "ds"), "format": "yolov8-detect"})

    classes = {c["name"]: c["id"] for c in client.get(f"/api/projects/{pid}/classes").json()}

    # All frames.
    allf = client.get(f"/api/videos/{pid}/frames").json()
    assert allf["total"] == 2

    # Only frames containing 'robot' (class 0) -> exactly one.
    robot = client.get(f"/api/videos/{pid}/frames", params={"class_id": classes["robot"]}).json()
    assert robot["total"] == 1
    ball = client.get(f"/api/videos/{pid}/frames", params={"class_id": classes["ball"]}).json()
    assert ball["total"] == 1
    assert robot["items"][0]["id"] != ball["items"][0]["id"]


def test_frames_filter_imported(client, tmp_path):
    pid = client.post("/api/projects/", json={"name": "imp", "task_type": "detect"}).json()["id"]
    client.post(f"/api/export/import/{pid}/dir",
                json={"path": _two_class_dataset(tmp_path / "ds"), "format": "yolov8-detect"})
    res = client.get(f"/api/videos/{pid}/frames", params={"imported": "true"}).json()
    assert res["total"] == 2  # both frames are imported (no video)


def test_frames_pagination_caps_at_500(client):
    # page_size over 500 is rejected (422) so the UI must chunk.
    pid = client.post("/api/projects/", json={"name": "pg", "task_type": "detect"}).json()["id"]
    r = client.get(f"/api/videos/{pid}/frames", params={"page_size": 1000})
    assert r.status_code == 422
