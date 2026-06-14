import os


class Config:
    DATA_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    DATABASE_URL: str = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'labelhub.db')}"
    SAM2_CHECKPOINT: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "sam2_hiera_large.pt")
    SAM2_MODEL_CFG: str = "sam2_hiera_l.yaml"
    SUPPORTED_VIDEO_FORMATS: list[str] = [".mp4", ".avi", ".mov", ".mkv", ".webm"]
    SUPPORTED_IMAGE_FORMATS: list[str] = [".jpg", ".jpeg", ".png", ".bmp"]
    FFMPEG_PATH: str = "ffmpeg"
    FFPROBE_PATH: str = "ffprobe"
    MAX_FRAME_DIMENSION: int = 1920
    EXPORT_FORMATS: list[str] = ["yolov8-obb", "coco", "pascal-voc"]
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8787

    @classmethod
    def ensure_dirs(cls):
        os.makedirs(cls.DATA_DIR, exist_ok=True)
        models_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
        os.makedirs(models_dir, exist_ok=True)


config = Config()
