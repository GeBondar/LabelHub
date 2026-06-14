import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from backend.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    # Network task this project's annotations target: "detect" (axis-aligned
    # boxes), "segment" (instance polygons), or "obb" (oriented boxes). Fixed at
    # creation; drives annotation tools, storage, export and training. Existing
    # projects default to "obb" (the only type before this feature).
    task_type = Column(String(16), nullable=False, default="obb")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    videos = relationship("VideoFile", back_populates="project", cascade="all, delete-orphan")
    classes = relationship("ClassLabel", back_populates="project", cascade="all, delete-orphan")
    frames = relationship("Frame", back_populates="project", cascade="all, delete-orphan")


class VideoFile(Base):
    __tablename__ = "video_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    original_filename = Column(String(512), nullable=False)
    stored_filename = Column(String(512), nullable=False)
    fps = Column(Float, nullable=False)
    total_frames = Column(Integer, nullable=False)
    duration_seconds = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="videos")
    frames = relationship("Frame", back_populates="video", cascade="all, delete-orphan")


class ClassLabel(Base):
    __tablename__ = "class_labels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    color = Column(String(7), nullable=False, default="#FF0000")
    index = Column(Integer, nullable=False, default=0)

    project = relationship("Project", back_populates="classes")
    annotations = relationship("OrientedBBox", back_populates="class_label", cascade="all, delete-orphan")
