import os


def is_safe_name(name: str) -> bool:
    """True if ``name`` is a single, safe path segment.

    Rejects empty names, ``.``/``..``, anything containing a path separator
    (``/`` or ``\\``) or a NUL byte, and any ``..`` traversal sequence. Used to
    guard user-supplied names (image files, export folders) before joining them
    onto a base directory, so a request can never escape the project tree.
    """
    if not name or name in (".", ".."):
        return False
    if "/" in name or "\\" in name or "\x00" in name:
        return False
    if ".." in name:
        return False
    return True


class Config:
    # Data root holds the SQLite DB, project frames, exports and training runs.
    # Override with LABELHUB_DATA_DIR (used by tests and for multiple workspaces).
    DATA_DIR: str = os.environ.get("LABELHUB_DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
    )
    DATABASE_URL: str = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'labelhub.db')}"
    SAM2_CHECKPOINT: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "sam2_hiera_large.pt")
    SAM2_MODEL_CFG: str = "sam2_hiera_l.yaml"
    SUPPORTED_VIDEO_FORMATS: list[str] = [".mp4", ".avi", ".mov", ".mkv", ".webm"]
    SUPPORTED_IMAGE_FORMATS: list[str] = [".jpg", ".jpeg", ".png", ".bmp"]
    FFMPEG_PATH: str = "ffmpeg"
    FFPROBE_PATH: str = "ffprobe"
    MAX_FRAME_DIMENSION: int = 1920
    EXPORT_FORMATS: list[str] = [
        "yolov8-obb", "yolov8-detect", "yolov8-seg", "coco", "pascal-voc"
    ]
    # Bind to localhost only — this is a single-user desktop tool whose API can
    # read/write files and launch training. Never expose it to the network.
    SERVER_HOST: str = "127.0.0.1"
    SERVER_PORT: int = 8787

    @classmethod
    def relocate(cls, stored_path: str) -> str:
        """Re-root an absolute path stored from a previous repo location under the
        current DATA_DIR. Paths in the DB were saved with absolute paths from when
        the repo lived elsewhere (e.g. battlebots_ai); re-root them at the
        'projects/' segment, mirroring how the frontend resolves frame images."""
        if not stored_path or os.path.exists(stored_path):
            return stored_path
        norm = stored_path.replace("\\", "/")
        idx = norm.rfind("projects/")
        if idx >= 0:
            candidate = os.path.normpath(os.path.join(cls.DATA_DIR, norm[idx:]))
            if os.path.exists(candidate):
                return candidate
        return stored_path

    @classmethod
    def ensure_dirs(cls):
        os.makedirs(cls.DATA_DIR, exist_ok=True)
        models_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
        os.makedirs(models_dir, exist_ok=True)


config = Config()
