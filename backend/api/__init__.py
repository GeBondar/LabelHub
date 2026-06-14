from .projects import router as projects_router
from .videos import router as videos_router
from .annotations import router as annotations_router
from .exports import router as exports_router
from .files import router as files_router
from .training import router as training_router

__all__ = [
    "projects_router",
    "videos_router",
    "annotations_router",
    "exports_router",
    "files_router",
    "training_router",
]
