import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from backend.database import Base


class Frame(Base):
    __tablename__ = "frames"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    video_id = Column(Integer, ForeignKey("video_files.id", ondelete="CASCADE"), nullable=True)
    frame_index = Column(Integer, nullable=False)
    image_path = Column(String(1024), nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    is_labeled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="frames")
    video = relationship("VideoFile", back_populates="frames")
    annotations = relationship("OrientedBBox", back_populates="frame", cascade="all, delete-orphan")


class OrientedBBox(Base):
    __tablename__ = "oriented_bboxes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    frame_id = Column(Integer, ForeignKey("frames.id", ondelete="CASCADE"), nullable=False)
    class_id = Column(Integer, ForeignKey("class_labels.id", ondelete="CASCADE"), nullable=False)
    cx = Column(Float, nullable=False)
    cy = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)
    angle = Column(Float, nullable=False)
    # Heading = direction the object "faces", in degrees [0,360), independent of
    # the box outline. NULL falls back to `angle`. Changing heading must never
    # move/rotate/resize the box itself — it only re-points the arrow and decides
    # which box edge is "front" in the YOLO-OBB corner order.
    heading = Column(Float, nullable=True)
    # Normalized instance-segmentation polygon as a JSON list [[x, y], ...] in
    # [0,1] image coords. Populated only for "segment" projects; NULL for
    # detect/obb. cx/cy/width/height still hold the polygon's bounding rect (used
    # for the label position, list display and SAM seeding).
    points_json = Column(Text, nullable=True)
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    frame = relationship("Frame", back_populates="annotations")
    class_label = relationship("ClassLabel", back_populates="annotations")
