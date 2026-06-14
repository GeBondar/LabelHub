import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text

from backend.database import Base


class MLModel(Base):
    """Registry entry for a trained-or-imported YOLO model usable for inference.

    Trained models are auto-registered (lazily, see api/models.py) from completed
    TrainingRun rows that have a `weights/best.pt` on disk. Imported models point
    at a `.pt` copied into data/models/imported/.
    """

    __tablename__ = "models"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    kind = Column(String(32), nullable=False, default="trained")  # trained | imported

    # Provenance
    run_id = Column(Integer, ForeignKey("training_runs.id", ondelete="SET NULL"), nullable=True)
    project_id = Column(Integer, nullable=True)  # origin project for trained models

    # Filesystem / config
    weights_path = Column(String(1024), nullable=False, default="")
    base_model = Column(String(128), default="")
    imgsz = Column(Integer, default=640)
    classes_json = Column(Text, default="[]")

    # Metrics (copied from the run for trained models; null for imported)
    map50 = Column(Float, nullable=True)
    map5095 = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
