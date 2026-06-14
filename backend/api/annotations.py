import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from shapely.geometry import Polygon

from backend.database import get_db
from backend.models.annotation import Frame, OrientedBBox
from backend.models.project import ClassLabel
from backend.services.sam2_service import sam2_service
from backend.services.geometry import normalize_angle

router = APIRouter(prefix="/api/annotations", tags=["annotations"])


class BBoxCreate(BaseModel):
    class_id: int
    cx: float = Field(..., ge=0.0, le=1.0)
    cy: float = Field(..., ge=0.0, le=1.0)
    width: float = Field(..., gt=0.0, le=1.0)
    height: float = Field(..., gt=0.0, le=1.0)
    angle: float = Field(default=0.0)
    heading: Optional[float] = None


class BBoxUpdate(BaseModel):
    class_id: Optional[int] = None
    cx: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    cy: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    width: Optional[float] = Field(default=None, gt=0.0, le=1.0)
    height: Optional[float] = Field(default=None, gt=0.0, le=1.0)
    angle: Optional[float] = None
    heading: Optional[float] = None
    is_verified: Optional[bool] = None


class SAM2ClickRequest(BaseModel):
    x: float
    y: float


class SAM2BoxRequest(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class FrameStatusUpdate(BaseModel):
    is_labeled: bool


class BBoxOut(BaseModel):
    id: int
    frame_id: int
    class_id: int
    class_name: Optional[str] = None
    cx: float
    cy: float
    width: float
    height: float
    angle: float
    heading: float
    is_verified: bool
    created_at: Optional[str]
    updated_at: Optional[str]

    model_config = {"from_attributes": True}


def _obb_to_polygon(cx: float, cy: float, width: float, height: float, angle: float, img_w: int, img_h: int) -> Polygon:
    import math
    cx_px = cx * img_w
    cy_px = cy * img_h
    w_px = width * img_w
    h_px = height * img_h
    angle_rad = math.radians(angle)

    half_w = w_px / 2
    half_h = h_px / 2
    corners = []
    for dx, dy in [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]:
        rx = dx * math.cos(angle_rad) - dy * math.sin(angle_rad)
        ry = dx * math.sin(angle_rad) + dy * math.cos(angle_rad)
        corners.append((cx_px + rx, cy_px + ry))
    return Polygon(corners)


def _compute_iou(ann1: dict, ann2: dict, img_w: int, img_h: int) -> float:
    poly1 = _obb_to_polygon(
        ann1["cx"], ann1["cy"], ann1["width"], ann1["height"], ann1["angle"], img_w, img_h
    )
    poly2 = _obb_to_polygon(
        ann2["cx"], ann2["cy"], ann2["width"], ann2["height"], ann2["angle"], img_w, img_h
    )
    if not poly1.is_valid or not poly2.is_valid:
        return 0.0
    intersection = poly1.intersection(poly2).area
    union = poly1.union(poly2).area
    if union == 0:
        return 0.0
    return intersection / union


@router.post("/frame/{frame_id}", response_model=BBoxOut)
async def create_bbox(
    frame_id: int,
    data: BBoxCreate,
    db: AsyncSession = Depends(get_db),
):
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")

    cls = await db.get(ClassLabel, data.class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class label not found")

    angle = normalize_angle(data.angle)
    heading = normalize_angle(data.heading) if data.heading is not None else angle
    bbox = OrientedBBox(
        frame_id=frame_id,
        class_id=data.class_id,
        cx=data.cx,
        cy=data.cy,
        width=data.width,
        height=data.height,
        angle=angle,
        heading=heading,
    )
    db.add(bbox)
    await db.flush()
    await db.refresh(bbox)

    frame.is_labeled = True

    return BBoxOut(
        id=bbox.id,
        frame_id=bbox.frame_id,
        class_id=bbox.class_id,
        class_name=cls.name,
        cx=bbox.cx,
        cy=bbox.cy,
        width=bbox.width,
        height=bbox.height,
        angle=bbox.angle,
        heading=bbox.heading if bbox.heading is not None else bbox.angle,
        is_verified=bbox.is_verified,
        created_at=str(bbox.created_at) if bbox.created_at else None,
        updated_at=str(bbox.updated_at) if bbox.updated_at else None,
    )


@router.get("/frame/{frame_id}", response_model=list[BBoxOut])
async def get_frame_annotations(frame_id: int, db: AsyncSession = Depends(get_db)):
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")

    result = await db.execute(
        select(OrientedBBox).where(OrientedBBox.frame_id == frame_id)
    )
    bboxes = result.scalars().all()

    out = []
    for b in bboxes:
        cls = await db.get(ClassLabel, b.class_id)
        out.append(BBoxOut(
            id=b.id,
            frame_id=b.frame_id,
            class_id=b.class_id,
            class_name=cls.name if cls else None,
            cx=b.cx,
            cy=b.cy,
            width=b.width,
            height=b.height,
            angle=b.angle,
            heading=b.heading if b.heading is not None else b.angle,
            is_verified=b.is_verified,
            created_at=str(b.created_at) if b.created_at else None,
            updated_at=str(b.updated_at) if b.updated_at else None,
        ))
    return out


@router.put("/{bbox_id}", response_model=BBoxOut)
async def update_bbox(
    bbox_id: int,
    data: BBoxUpdate,
    db: AsyncSession = Depends(get_db),
):
    bbox = await db.get(OrientedBBox, bbox_id)
    if not bbox:
        raise HTTPException(status_code=404, detail="Annotation not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is None:
            continue
        if key in ("angle", "heading"):
            value = normalize_angle(value)
        setattr(bbox, key, value)

    bbox.updated_at = datetime.datetime.utcnow()
    await db.flush()
    await db.refresh(bbox)

    cls = await db.get(ClassLabel, bbox.class_id)

    return BBoxOut(
        id=bbox.id,
        frame_id=bbox.frame_id,
        class_id=bbox.class_id,
        class_name=cls.name if cls else None,
        cx=bbox.cx,
        cy=bbox.cy,
        width=bbox.width,
        height=bbox.height,
        angle=bbox.angle,
        heading=bbox.heading if bbox.heading is not None else bbox.angle,
        is_verified=bbox.is_verified,
        created_at=str(bbox.created_at) if bbox.created_at else None,
        updated_at=str(bbox.updated_at) if bbox.updated_at else None,
    )


@router.delete("/{bbox_id}")
async def delete_bbox(bbox_id: int, db: AsyncSession = Depends(get_db)):
    bbox = await db.get(OrientedBBox, bbox_id)
    if not bbox:
        raise HTTPException(status_code=404, detail="Annotation not found")

    await db.delete(bbox)
    await db.flush()
    return {"detail": "Annotation deleted"}


@router.post("/frame/{frame_id}/sam2-click")
async def sam2_click_annotation(
    frame_id: int,
    data: SAM2ClickRequest,
    db: AsyncSession = Depends(get_db),
):
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")

    try:
        result = await sam2_service.predict_from_click(
            image_path=frame.image_path,
            x=data.x,
            y=data.y,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result


@router.post("/frame/{frame_id}/sam2-box")
async def sam2_box_annotation(
    frame_id: int,
    data: SAM2BoxRequest,
    db: AsyncSession = Depends(get_db),
):
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")

    try:
        result = await sam2_service.predict_from_box(
            image_path=frame.image_path,
            x1=data.x1,
            y1=data.y1,
            x2=data.x2,
            y2=data.y2,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result


@router.put("/frame/{frame_id}/status")
async def update_frame_status(
    frame_id: int,
    data: FrameStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")

    frame.is_labeled = data.is_labeled
    await db.flush()
    return {"detail": f"Frame marked as {'labeled' if data.is_labeled else 'unlabeled'}"}


@router.get("/sam2/status")
async def sam2_status():
    try:
        loaded = sam2_service.predictor is not None
        return {"loaded": loaded, "device": sam2_service.device}
    except Exception:
        return {"loaded": False, "device": "unknown"}


@router.post("/sam2/load")
async def sam2_load():
    try:
        sam2_service._ensure_model()
        return {"status": "loaded", "device": sam2_service.device}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
