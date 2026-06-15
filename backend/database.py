from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from backend.config import config


class Base(DeclarativeBase):
    pass


engine = create_async_engine(config.DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _migrate(conn):
    """Lightweight additive migrations for columns added after a DB already
    exists (create_all never ALTERs existing tables)."""
    from sqlalchemy import text

    result = await conn.execute(text("PRAGMA table_info(oriented_bboxes)"))
    columns = {row[1] for row in result.fetchall()}
    if "heading" not in columns:
        await conn.execute(text("ALTER TABLE oriented_bboxes ADD COLUMN heading FLOAT"))
    if "points_json" not in columns:
        await conn.execute(text("ALTER TABLE oriented_bboxes ADD COLUMN points_json TEXT"))

    result = await conn.execute(text("PRAGMA table_info(projects)"))
    project_columns = {row[1] for row in result.fetchall()}
    if "task_type" not in project_columns:
        await conn.execute(
            text("ALTER TABLE projects ADD COLUMN task_type VARCHAR(16) DEFAULT 'obb'")
        )

    result = await conn.execute(text("PRAGMA table_info(training_runs)"))
    run_columns = {row[1] for row in result.fetchall()}
    if "train_count" not in run_columns:
        await conn.execute(text("ALTER TABLE training_runs ADD COLUMN train_count INTEGER DEFAULT 0"))
    if "val_count" not in run_columns:
        await conn.execute(text("ALTER TABLE training_runs ADD COLUMN val_count INTEGER DEFAULT 0"))

    await _renumber_frames_once(conn)


async def _renumber_frames_once(conn):
    """One-time data migration (guarded by PRAGMA user_version): renumber each
    project's frames so they run sequentially across videos — video 1 gets
    0..N, video 2 gets N+1.., and imported frames come last. The old code
    numbered every video from 0, which collided and interleaved them in the
    gallery. Annotations reference frame_id (not frame_index), so this is safe.
    """
    from sqlalchemy import text

    version = (await conn.execute(text("PRAGMA user_version"))).scalar() or 0
    if version >= 1:
        return

    await conn.execute(text(
        """
        CREATE TEMP TABLE _renum AS
        SELECT f.id AS fid,
               ROW_NUMBER() OVER (
                   PARTITION BY f.project_id
                   ORDER BY (v.created_at IS NULL), v.created_at, f.video_id,
                            f.frame_index, f.id
               ) - 1 AS nidx
        FROM frames f
        LEFT JOIN video_files v ON f.video_id = v.id
        """
    ))
    await conn.execute(text(
        """
        UPDATE frames
        SET frame_index = (SELECT nidx FROM _renum WHERE _renum.fid = frames.id)
        WHERE id IN (SELECT fid FROM _renum)
        """
    ))
    await conn.execute(text("DROP TABLE _renum"))
    await conn.execute(text("PRAGMA user_version = 1"))


async def init_db():
    from backend.models.project import Project, VideoFile, ClassLabel
    from backend.models.annotation import Frame, OrientedBBox
    from backend.models.training import TrainingRun
    from backend.models.ml_model import MLModel

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate(conn)


async def get_db():
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
