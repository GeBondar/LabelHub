import os
import mimetypes
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from backend.config import config

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("/image/{project_id}/{image_name:path}")
async def serve_image(project_id: int, image_name: str):
    filepath = os.path.join(config.DATA_DIR, "projects", str(project_id), "frames")
    for root, dirs, files in os.walk(filepath):
        if image_name in files:
            full_path = os.path.join(root, image_name)
            media_type = mimetypes.guess_type(full_path)[0] or "image/jpeg"
            return FileResponse(full_path, media_type=media_type)

    raise HTTPException(status_code=404, detail="Image not found")


@router.get("/export/{project_id}/{export_name}/download")
async def download_export(project_id: int, export_name: str):
    export_dir = os.path.join(
        config.DATA_DIR, "projects", str(project_id), "exports", export_name
    )
    zip_path = export_dir.rstrip("/").rstrip("\\") + ".zip"

    if not os.path.exists(zip_path):
        import zipfile
        if not os.path.exists(export_dir):
            raise HTTPException(status_code=404, detail="Export not found")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(export_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, os.path.dirname(export_dir))
                    zf.write(file_path, arcname)

    def cleanup():
        pass

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{export_name}.zip",
    )
