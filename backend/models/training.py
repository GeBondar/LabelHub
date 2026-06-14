import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from backend.database import Base


class TrainingRun(Base):
    __tablename__ = "training_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)

    # Configuration
    base_model = Column(String(128), nullable=False, default="yolov8n-obb.pt")
    epochs = Column(Integer, nullable=False, default=100)
    imgsz = Column(Integer, nullable=False, default=640)
    batch = Column(Integer, nullable=False, default=16)
    device = Column(String(32), nullable=False, default="")  # "" = auto, "cpu", "0"
    params_json = Column(Text, default="{}")

    # Filesystem locations
    dataset_dir = Column(String(1024), default="")
    run_dir = Column(String(1024), default="")

    # Lifecycle
    status = Column(String(32), nullable=False, default="pending")  # pending|running|completed|failed|stopped
    pid = Column(Integer, nullable=True)
    error = Column(Text, default="")
    current_epoch = Column(Integer, default=0)
    best_map50 = Column(Float, default=0.0)
    best_map5095 = Column(Float, default=0.0)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    project = relationship("Project")
