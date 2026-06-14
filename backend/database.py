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
