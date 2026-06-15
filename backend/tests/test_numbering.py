"""Global sequential frame numbering: the one-time renumber migration and the
import base offset."""
import asyncio
import tempfile

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from PIL import Image

from backend.database import _renumber_frames_once


def test_renumber_migration_is_global_and_idempotent():
    async def run():
        db = tempfile.mktemp(suffix=".db")
        engine = create_async_engine(f"sqlite+aiosqlite:///{db}")
        async with engine.begin() as conn:
            await conn.execute(text("CREATE TABLE video_files (id INTEGER PRIMARY KEY, project_id INT, created_at TEXT)"))
            await conn.execute(text("CREATE TABLE frames (id INTEGER PRIMARY KEY, project_id INT, video_id INT, frame_index INT)"))
            await conn.execute(text("INSERT INTO video_files VALUES (1,1,'2026-01-01'),(2,1,'2026-01-02')"))
            # video A frames 0,1,2 ; video B frames 0,1 (collides) ; imported NULL 0
            await conn.execute(text(
                "INSERT INTO frames (id,project_id,video_id,frame_index) VALUES "
                "(1,1,1,0),(2,1,1,1),(3,1,1,2),(4,1,2,0),(5,1,2,1),(6,1,NULL,0)"))
            await conn.execute(text("PRAGMA user_version = 0"))
            await _renumber_frames_once(conn)
        async with engine.begin() as conn:
            rows = (await conn.execute(text("SELECT id, frame_index FROM frames ORDER BY id"))).fetchall()
            ver = (await conn.execute(text("PRAGMA user_version"))).scalar()
            await _renumber_frames_once(conn)  # guard: no-op
            rows2 = (await conn.execute(text("SELECT id, frame_index FROM frames ORDER BY id"))).fetchall()
        await engine.dispose()
        return {r[0]: r[1] for r in rows}, ver, rows == rows2

    by_id, ver, idempotent = asyncio.run(run())
    # Sequential 0..5 across the whole project, videos in upload order, imported last.
    assert by_id == {1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}
    assert ver == 1
    assert idempotent


def _dataset(root, n_labels=1):
    (root / "images" / "train").mkdir(parents=True)
    (root / "labels" / "train").mkdir(parents=True)
    Image.new("RGB", (320, 240), (10, 10, 10)).save(root / "images" / "train" / "f0.jpg")
    (root / "labels" / "train" / "f0.txt").write_text("0 0.5 0.5 0.2 0.1\n")
    (root / "data.yaml").write_text("names:\n  0: obj\n")
    return str(root)


def test_import_continues_numbering(client, tmp_path):
    pid = client.post("/api/projects/", json={"name": "num", "task_type": "detect"}).json()["id"]
    client.post(f"/api/export/import/{pid}/dir",
                json={"path": _dataset(tmp_path / "a"), "format": "yolov8-detect"})
    client.post(f"/api/export/import/{pid}/dir",
                json={"path": _dataset(tmp_path / "b"), "format": "yolov8-detect"})

    frames = client.get(f"/api/videos/{pid}/frames").json()["items"]
    idxs = sorted(f["frame_index"] for f in frames)
    # Two single-frame imports -> global indices 0 and 1, not 0 and 0.
    assert idxs == [0, 1]
