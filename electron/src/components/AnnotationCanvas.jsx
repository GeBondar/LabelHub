import React, { useEffect, useRef, useState, useCallback } from 'react';
import fabricModule from 'fabric';
const fabric = fabricModule?.fabric || fabricModule;
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  MousePointer2,
  Square,
  Trash2,
  Undo2,
  Redo2,
  Crosshair,
  Loader2,
  CheckCircle2,
  Navigation,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';
import SAM2Tools from './SAM2Tools';

const MODES = {
  DRAW: 'draw',
  EDIT: 'edit',
  DELETE: 'delete',
  SAM_CLICK: 'sam_click',
  SAM_BOX: 'sam_box',
};

// Custom rect that draws a heading arrow pointing in the `headingOffset`
// direction (degrees, measured in the box's LOCAL frame relative to +x).
// The arrow is independent of the box outline: changing headingOffset only
// re-points the arrow and never moves/rotates/resizes the rectangle. The arrow
// is rendered in local space so it follows the box, and the arrowhead is
// counter-scaled so it keeps a constant on-screen size.
let OBBRect = null;
function ensureOBBRect() {
  if (OBBRect || !fabric) return OBBRect;
  OBBRect = fabric.util.createClass(fabric.Rect, {
    type: 'obbRect',
    _render(ctx) {
      this.callSuper('_render', ctx);
      const sx = this.scaleX || 1;
      const sy = this.scaleY || 1;
      const color = this.stroke || '#3b82f6';

      const off = ((this.headingOffset || 0) * Math.PI) / 180; // local radians
      const dx = Math.cos(off);
      const dy = Math.sin(off);
      const hw = this.width / 2;
      const hh = this.height / 2;
      // Point on the box border along the heading direction.
      const t = Math.min(
        hw / Math.max(Math.abs(dx), 1e-6),
        hh / Math.max(Math.abs(dy), 1e-6),
      );
      const ex = dx * t;
      const ey = dy * t;

      ctx.save();
      // Line from center to the front edge.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / Math.max(sx, sy, 1e-4);
      ctx.stroke();

      // Arrowhead at the edge, drawn in screen px (counter-scaled), oriented
      // along the on-screen direction of the local heading vector.
      const screenAngle = Math.atan2(dy * sy, dx * sx);
      ctx.translate(ex, ey);
      ctx.scale(1 / sx, 1 / sy);
      ctx.rotate(screenAngle);
      const s = 9;
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.4, -s * 0.85);
      ctx.lineTo(-s * 0.4, s * 0.85);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    },
  });
  return OBBRect;
}

export default function AnnotationCanvas({
  projectId,
  frame,
  annotations,
  classes,
  mode,
  selectedClassId,
  onFrameNavigate,
  onRefreshAnnotations,
  applyClassRef,
  saveRef,
  selectAnnotationRef,
}) {
  const fabricRef = useRef(null);
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const canvasElRef = useRef(null);
  const modeRef = useRef(MODES.DRAW);
  const [zoom, setZoom] = useState(1);
  const [canvasMode, setCanvasMode] = useState(MODES.DRAW);
  const [isPanning, setIsPanning] = useState(false);
  const [samMode, setSamMode] = useState(null);
  const [samLoading, setSamLoading] = useState(false);
  const [selectedObj, setSelectedObj] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [loadingImg, setLoadingImg] = useState(false);
  const [imgError, setImgError] = useState(false);
  const isDrawingRef = useRef(false);
  const drawStartRef = useRef(null);
  const drawRectRef = useRef(null);
  const skipRedrawRef = useRef(false);
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(false);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const { addToast, annotations: allAnnotations, updateAnnotationLocal, removeAnnotationLocal, setAnnotationsForFrame } = useApp();

  const currentAnnotations = frame ? (allAnnotations[frame.id] || annotations) : [];

  useEffect(() => {
    if (saveRef) {
      saveRef.current = async () => {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        if (pendingSaveRef.current) {
          const { id, data } = pendingSaveRef.current;
          pendingSaveRef.current = null;
          await apiClient.updateAnnotation(id, data);
        }
      };
    }
  }, [saveRef]);

  useEffect(() => {
    if (selectAnnotationRef) {
      selectAnnotationRef.current = (annotationId, hoverOnly) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        canvas.discardActiveObject();
        if (!annotationId) { canvas.renderAll(); return; }
        const objs = canvas.getObjects();
        for (const obj of objs) {
          if (obj.annotationData && obj.annotationData.id === annotationId) {
            if (!hoverOnly) canvas.setActiveObject(obj);
            obj.set('strokeWidth', 4);
          } else if (obj.annotationData) {
            obj.set('strokeWidth', 2);
          }
        }
        canvas.renderAll();
      };
    }
  }, [selectAnnotationRef]);

  useEffect(() => {
    if (applyClassRef) {
      applyClassRef.current = (classId) => {
        const canvas = fabricRef.current;
        if (!canvas) return false;
        const active = canvas.getActiveObject();
        if (!active || !active.annotationData) return false;
        pushUndo();
        const data = active.annotationData;
        apiClient.updateAnnotation(data.id, { class_id: classId }).then(() => {
          updateAnnotationLocal(frame.id, { ...data, class_id: classId });
          const cls = classes.find(c => c.id === classId);
          const color = cls?.color || '#3b82f6';
          active.set({ stroke: color, fill: `${color}22`, cornerColor: color, cornerStrokeColor: color });
          const labelObj = labelMapRef.current[data.id];
          if (labelObj) {
            labelObj.set({ text: cls?.name || '', backgroundColor: color });
          }
          canvas.renderAll();
        }).catch(() => {});
        return true;
      };
    }
  }, [frame?.id, classes, applyClassRef]);

  useEffect(() => {
    setCanvasMode(mode === 'draw' ? MODES.DRAW : mode === 'edit' ? MODES.EDIT : MODES.DELETE);
  }, [mode]);

  useEffect(() => {
    modeRef.current = canvasMode;
  }, [canvasMode]);

  useEffect(() => {
    if (!containerRef.current || !frame) return;

    undoStackRef.current = [];
    redoStackRef.current = [];

    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    const container = containerRef.current;
    const w = container.clientWidth || 1200;
    const h = container.clientHeight || 800;

    const canvasEl = document.createElement('canvas');
    canvasEl.style.width = w + 'px';
    canvasEl.style.height = h + 'px';
    container.appendChild(canvasEl);
    canvasElRef.current = canvasEl;

    const canvas = new fabric.Canvas(canvasEl, {
      width: w,
      height: h,
      backgroundColor: '#0a0f1a',
      selection: modeRef.current !== MODES.DRAW,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true,
    });

    fabricRef.current = canvas;

    loadImage(canvas, w, h);

    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let newZoom = canvas.getZoom() * (1 - delta / 500);
      newZoom = Math.max(0.1, Math.min(10, newZoom));
      canvas.zoomToPoint(
        { x: opt.e.offsetX, y: opt.e.offsetY },
        newZoom
      );
      setZoom(Math.round(newZoom * 100) / 100);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    canvas.on('mouse:down', (opt) => handleMouseDown(opt, canvas));
    canvas.on('mouse:move', (opt) => handleMouseMove(opt, canvas));
    canvas.on('mouse:up', (opt) => handleMouseUp(opt, canvas));

    canvas.on('selection:created', (e) => {
      if (e.selected && e.selected.length === 1) {
        setSelectedObj(e.selected[0]);
      }
    });

    canvas.on('selection:updated', (e) => {
      if (e.selected && e.selected.length === 1) {
        setSelectedObj(e.selected[0]);
      }
    });

    canvas.on('selection:cleared', () => {
      setSelectedObj(null);
    });

    canvas.on('object:modified', (e) => {
      if (e.target && e.target.annotationData) {
        handleAnnotationModified(e.target);
      }
    });

    canvas.on('mouse:down', (opt) => {
      if (canvasMode === MODES.EDIT && opt.target && opt.target.annotationData) {
        pushUndo();
      }
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && fabricRef.current) {
          fabricRef.current.setWidth(width);
          fabricRef.current.setHeight(height);
          fabricRef.current.renderAll();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
      if (canvasElRef.current && canvasElRef.current.parentNode) {
        canvasElRef.current.parentNode.removeChild(canvasElRef.current);
        canvasElRef.current = null;
      }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [frame?.id]);

  useEffect(() => {
    if (!fabricRef.current || !imageRef.current) return;
    // Edits made directly on the canvas (move/rotate/resize/heading) already
    // updated their objects in place; skip the wipe-and-redraw so the active
    // selection isn't lost (lets the user press a control repeatedly).
    if (skipRedrawRef.current) {
      skipRedrawRef.current = false;
      return;
    }
    const canvas = fabricRef.current;
    clearAnnotations();
    if (currentAnnotations && currentAnnotations.length > 0) {
      currentAnnotations.forEach((ann) => drawAnnotation(canvas, ann));
    }
    canvas.renderAll();
  }, [currentAnnotations, classes]);

  useEffect(() => {
    if (fabricRef.current) {
      const canvas = fabricRef.current;
      canvas.selection = modeRef.current === MODES.EDIT;
      if (modeRef.current !== MODES.EDIT) {
        canvas.discardActiveObject();
        canvas.renderAll();
      }
    }
  }, [canvasMode]);

  function loadImage(canvas, containerW, containerH) {
    if (!frame) return;
    setLoadingImg(true);
    setImgError(false);
    const imgUrl = apiClient.getFrameImageUrl(projectId, frame.image_path);

    fabric.Image.fromURL(imgUrl, (img) => {
      if (!fabricRef.current) return;
      imageRef.current = img;

      const scaleX = containerW / img.width;
      const scaleY = containerH / img.height;
      const scale = Math.min(scaleX, scaleY, 1) * 0.9;

      img.set({
        left: (containerW - img.width * scale) / 2,
        top: (containerH - img.height * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        hasControls: false,
      });

      canvas.add(img);
      canvas.setZoom(1);
      setZoom(1);
      canvas.sendToBack(img);
      canvas.renderAll();
      setLoadingImg(false);
    }, {
      crossOrigin: 'anonymous',
    });
  }

  function normalizeCoords(canvasX, canvasY) {
    if (!imageRef.current) return { cx: 0, cy: 0 };
    const img = imageRef.current;
    const imgX = (canvasX - img.left) / img.scaleX;
    const imgY = (canvasY - img.top) / img.scaleY;
    return {
      cx: imgX / img.width,
      cy: imgY / img.height,
    };
  }

  function normalizeSize(canvasW, canvasH) {
    if (!imageRef.current) return { w: 0, h: 0 };
    const img = imageRef.current;
    return {
      w: canvasW / (img.scaleX * img.width),
      h: canvasH / (img.scaleY * img.height),
    };
  }

  function canvasFromNormalized(nx, ny) {
    if (!imageRef.current) return { x: 0, y: 0 };
    const img = imageRef.current;
    return {
      x: nx * img.width * img.scaleX + img.left,
      y: ny * img.height * img.scaleY + img.top,
    };
  }

  function canvasSizeFromNormalized(nw, nh) {
    if (!imageRef.current) return { w: 0, h: 0 };
    const img = imageRef.current;
    return {
      w: nw * img.width * img.scaleX,
      h: nh * img.height * img.scaleY,
    };
  }

  const labelMapRef = useRef({});

  function wrapAngle(a) {
    let v = a % 360;
    if (v < 0) v += 360;
    return v;
  }

  function drawAnnotation(canvas, ann) {
    const cls = classes.find((c) => c.id === ann.class_id);
    const color = cls?.color || '#3b82f6';
    const label = cls?.name || `Класс ${ann.class_id}`;

    const { x, y } = canvasFromNormalized(ann.cx, ann.cy);
    const { w, h } = canvasSizeFromNormalized(ann.width, ann.height);

    const annAngle = ann.angle || 0;
    const annHeading = (ann.heading === undefined || ann.heading === null) ? annAngle : ann.heading;

    const RectClass = ensureOBBRect() || fabric.Rect;
    const rect = new RectClass({
      width: w,
      height: h,
      fill: `${color}22`,
      stroke: color,
      strokeWidth: 2,
      strokeUniform: true,
      originX: 'center',
      originY: 'center',
      left: x,
      top: y,
      angle: annAngle,
      headingOffset: wrapAngle(annHeading - annAngle),
      transparentCorners: false,
      cornerColor: color,
      cornerStrokeColor: color,
      cornerSize: 8,
      cornerStyle: 'circle',
      rotatingPointOffset: 30,
      padding: 0,
      objectCaching: false,
      annotationData: {
        id: ann.id,
        class_id: ann.class_id,
        cx: ann.cx,
        cy: ann.cy,
        width: ann.width,
        height: ann.height,
        angle: annAngle,
        heading: annHeading,
        is_verified: ann.is_verified,
      },
    });

    const text = new fabric.Text(label, {
      fontSize: 11,
      fill: '#fff',
      backgroundColor: color,
      padding: 3,
      originX: 'center',
      originY: 'bottom',
      left: x,
      top: y - h / 2 - 4,
      selectable: false,
      evented: false,
    });

    canvas.add(rect);
    canvas.add(text);
    labelMapRef.current[ann.id] = text;
  }

  function clearAnnotations() {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    const objs = canvas.getObjects();
    for (let i = objs.length - 1; i >= 0; i--) {
      if (objs[i].annotationData || (labelMapRef.current && Object.values(labelMapRef.current).includes(objs[i]))) {
        canvas.remove(objs[i]);
      }
    }
    labelMapRef.current = {};
  }

  function getAnnotationFromObject(obj) {
    return obj?.annotationData || null;
  }

  function updateAnnotationFromRect(rect) {
    if (!rect || !imageRef.current) return null;
    const img = imageRef.current;
    const cx = rect.left;
    const cy = rect.top;

    const imgX = (cx - img.left) / img.scaleX;
    const imgY = (cy - img.top) / img.scaleY;
    const w = (rect.width * (rect.scaleX || 1)) / (img.scaleX * img.width);
    const h = (rect.height * (rect.scaleY || 1)) / (img.scaleY * img.height);

    const angle = wrapAngle(rect.angle || 0);
    // Heading stays glued to the box: arrow keeps the same side while the box
    // is moved/rotated/resized (headingOffset is relative to the box's +x).
    const heading = wrapAngle(angle + (rect.headingOffset || 0));

    return {
      cx: imgX / img.width,
      cy: imgY / img.height,
      width: Math.abs(w),
      height: Math.abs(h),
      angle,
      heading,
    };
  }

  async function handleAnnotationModified(obj) {
    const data = getAnnotationFromObject(obj);
    if (!data || !data.id) return;

    const updated = updateAnnotationFromRect(obj);
    if (!updated) return;

    const newData = { ...data, ...updated };
    obj.annotationData = newData;
    skipRedrawRef.current = true;
    updateAnnotationLocal(frame.id, newData);

    const labelObj = labelMapRef.current[data.id];
    if (labelObj && imageRef.current) {
      const { x, y } = canvasFromNormalized(updated.cx, updated.cy);
      const { h } = canvasSizeFromNormalized(updated.width, updated.height);
      labelObj.set({ left: x, top: y - h / 2 - 4 });
    }

    debouncedSave(data.id, {
      cx: updated.cx,
      cy: updated.cy,
      width: updated.width,
      height: updated.height,
      angle: updated.angle,
      heading: updated.heading,
    });
  }

  function debouncedSave(annotationId, data) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingSaveRef.current = { id: annotationId, data };
    saveTimerRef.current = setTimeout(async () => {
      if (!pendingSaveRef.current) return;
      const { id, data: saveData } = pendingSaveRef.current;
      try {
        await apiClient.updateAnnotation(id, saveData);
      } catch (e) {
        console.error('Auto-save failed:', e);
      }
      pendingSaveRef.current = null;
    }, 2000);
  }

  function handleMouseDown(opt, canvas) {
    const evt = opt.e;
    const currentMode = modeRef.current;

    // Right-click for context menu
    if (evt.button === 2) {
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        const data = target.annotationData;
        const cls = classes.find((c) => c.id === data?.class_id);
        setContextMenu({
          x: evt.clientX,
          y: evt.clientY,
          annotationId: data?.id,
          classId: data?.class_id,
          className: cls?.name || 'Неизвестно',
          target: target,
        });
        evt.preventDefault();
        return;
      }
      setContextMenu(null);
      return;
    }

    // Space + drag for panning
    if (evt.altKey || evt.spaceKey) {
      setIsPanning(true);
      canvas.selection = false;
      canvas.defaultCursor = 'grabbing';
      canvas.getObjects().forEach((o) => {
        if (o.annotationData) o.selectable = false;
      });
      return;
    }

    if (currentMode === MODES.DRAW) {
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        canvas.setActiveObject(target);
        canvas.renderAll();
        return;
      }
      startDraw(opt, canvas);
    } else if (currentMode === MODES.DELETE) {
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        deleteAnnotation(target);
      }
    } else if (currentMode === MODES.SAM_CLICK) {
      // Clicking an existing box selects it (to move/rotate/delete) instead of
      // re-running SAM2 and spawning a duplicate over the same object.
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        canvas.setActiveObject(target);
        canvas.renderAll();
        return;
      }
      handleSAMClick(opt, canvas);
    } else if (currentMode === MODES.SAM_BOX) {
      // Same here: grab an existing box rather than starting a new SAM region.
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        canvas.setActiveObject(target);
        canvas.renderAll();
        return;
      }
      startDraw(opt, canvas);
    }
  }

  function handleMouseMove(opt, canvas) {
    if (isPanning && canvas) {
      const e = opt.e;
      const vpt = canvas.viewportTransform;
      if (vpt) {
        vpt[4] += e.movementX || 0;
        vpt[5] += e.movementY || 0;
        canvas.requestRenderAll();
      }
      return;
    }

    if (isDrawingRef.current && drawRectRef.current && canvas) {
      const pointer = canvas.getPointer(opt.e);
      const start = drawStartRef.current;
      const left = Math.min(start.x, pointer.x);
      const top = Math.min(start.y, pointer.y);
      const width = Math.abs(pointer.x - start.x);
      const height = Math.abs(pointer.y - start.y);

      drawRectRef.current.set({ left, top, width, height });
      drawRectRef.current.setCoords();
      canvas.renderAll();
    }
  }

  function handleMouseUp(opt, canvas) {
    if (isPanning) {
      setIsPanning(false);
      canvas.defaultCursor = 'crosshair';
      if (modeRef.current === MODES.EDIT) {
        canvas.selection = true;
      }
      canvas.getObjects().forEach((o) => {
        if (o.annotationData) o.selectable = true;
      });
      return;
    }

    if (isDrawingRef.current && drawRectRef.current) {
      const drawRect = drawRectRef.current;
      const w = drawRect.width * (drawRect.scaleX || 1);
      const h = drawRect.height * (drawRect.scaleY || 1);

      if (w < 5 || h < 5) {
        canvas.remove(drawRect);
        isDrawingRef.current = false;
        drawRectRef.current = null;
        drawStartRef.current = null;
        canvas.renderAll();
        return;
      }

      canvas.remove(drawRect);

      if (modeRef.current === MODES.SAM_BOX) {
        handleSAMBox(drawRect);
      } else {
        createAnnotation(drawRect);
      }

      isDrawingRef.current = false;
      drawRectRef.current = null;
      drawStartRef.current = null;
      canvas.renderAll();
    }
  }

  function startDraw(opt, canvas) {
    const pointer = canvas.getPointer(opt.e);
    isDrawingRef.current = true;
    drawStartRef.current = { x: pointer.x, y: pointer.y };

    drawRectRef.current = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
      fill: 'rgba(59, 130, 246, 0.15)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
    });

    canvas.add(drawRectRef.current);
    canvas.renderAll();
  }

  async function createAnnotation(drawRect) {
    if (!frame || !selectedClassId) {
      addToast('Выберите класс перед рисованием', 'warning');
      return;
    }

    const canvas = fabricRef.current;
    if (!canvas) return;

    const centerX = drawRect.left + drawRect.width * (drawRect.scaleX || 1) / 2;
    const centerY = drawRect.top + drawRect.height * (drawRect.scaleY || 1) / 2;
    const w = drawRect.width * (drawRect.scaleX || 1);
    const h = drawRect.height * (drawRect.scaleY || 1);

    const normCenter = normalizeCoords(centerX, centerY);
    const normSize = normalizeSize(w, h);

    const cls = classes.find((c) => c.id === selectedClassId);
    const color = cls?.color || '#3b82f6';

    try {
      pushUndo();
      const res = await apiClient.createAnnotation(frame.id, {
        class_id: selectedClassId,
        cx: normCenter.cx,
        cy: normCenter.cy,
        width: normSize.w,
        height: normSize.h,
        angle: 0,
      });

      const newAnn = res.data;
      updateAnnotationLocal(frame.id, newAnn);
      drawAnnotation(canvas, newAnn);
      canvas.renderAll();
      addToast('Аннотация создана', 'success', 2000);
    } catch (e) {
      addToast('Ошибка создания аннотации', 'error');
    }
  }

  async function deleteAnnotation(obj) {
    const data = getAnnotationFromObject(obj);
    if (!data || !data.id) {
      addToast('Не удалось найти аннотацию', 'error');
      return;
    }

    const canvas = fabricRef.current;
    try {
      pushUndo();
      await apiClient.deleteAnnotation(data.id);
      canvas.remove(obj);
      const labelObj = labelMapRef.current[data.id];
      if (labelObj) {
        canvas.remove(labelObj);
        delete labelMapRef.current[data.id];
      }
      removeAnnotationLocal(frame.id, data.id);
      canvas.renderAll();
      addToast('Аннотация удалена', 'success', 2000);
    } catch (e) {
      addToast('Ошибка удаления аннотации', 'error');
    }
  }

  async function handleSAMClick(opt, canvas) {
    if (!frame) return;
    if (!selectedClassId) {
      addToast('Выберите класс перед использованием SAM2', 'warning');
      return;
    }
    const pointer = canvas.getPointer(opt.e);
    const norm = normalizeCoords(pointer.x, pointer.y);

    const img = imageRef.current;
    const pxX = norm.cx * img.width;
    const pxY = norm.cy * img.height;
    setSamLoading(true);

    try {
      pushUndo();
      const res = await apiClient.samPoint(frame.id, pxX, pxY);
      const obb = res.data;

      const createRes = await apiClient.createAnnotation(frame.id, {
        class_id: selectedClassId,
        cx: obb.cx, cy: obb.cy, width: obb.width, height: obb.height, angle: obb.angle,
      });

      const newAnn = createRes.data;
      updateAnnotationLocal(frame.id, newAnn);
      clearAnnotations();
      const updatedAnns = (allAnnotations[frame.id] || annotations).concat(newAnn);
      updatedAnns.forEach((ann) => drawAnnotation(canvas, ann));
      canvas.renderAll();
      addToast('SAM2 сегментация выполнена', 'success');
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Неизвестная ошибка';
      addToast('SAM2 недоступен: ' + msg, 'error', 6000);
    } finally {
      setSamLoading(false);
    }
  }

  async function handleSAMBox(drawRect) {
    if (!frame) return;
    if (!selectedClassId) {
      addToast('Выберите класс перед использованием SAM2', 'warning');
      return;
    }
    setSamLoading(true);

    const x1 = (drawRect.left - imageRef.current.left) / imageRef.current.scaleX;
    const y1 = (drawRect.top - imageRef.current.top) / imageRef.current.scaleY;
    const w = drawRect.width * (drawRect.scaleX || 1) / imageRef.current.scaleX;
    const h = drawRect.height * (drawRect.scaleY || 1) / imageRef.current.scaleY;
    const x2 = x1 + w;
    const y2 = y1 + h;

    const canvas = fabricRef.current;

    try {
      pushUndo();
      const res = await apiClient.samBox(frame.id, x1, y1, x2, y2);
      const obb = res.data;

      const createRes = await apiClient.createAnnotation(frame.id, {
        class_id: selectedClassId,
        cx: obb.cx, cy: obb.cy, width: obb.width, height: obb.height, angle: obb.angle,
      });

      const newAnn = createRes.data;
      updateAnnotationLocal(frame.id, newAnn);
      clearAnnotations();
      const updatedAnns = (allAnnotations[frame.id] || annotations).concat(newAnn);
      updatedAnns.forEach((ann) => drawAnnotation(canvas, ann));
      canvas.renderAll();
      addToast('SAM2 сегментация выполнена', 'success');
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Неизвестная ошибка';
      addToast('SAM2 недоступен: ' + msg, 'error', 6000);
    } finally {
      setSamLoading(false);
    }
  }

  function handleZoomIn() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let newZoom = canvas.getZoom() * 1.2;
    newZoom = Math.min(10, newZoom);
    const center = canvas.getCenter();
    canvas.zoomToPoint({ x: center.left, y: center.top }, newZoom);
    setZoom(Math.round(newZoom * 100) / 100);
  }

  function handleZoomOut() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let newZoom = canvas.getZoom() / 1.2;
    newZoom = Math.max(0.1, newZoom);
    const center = canvas.getCenter();
    canvas.zoomToPoint({ x: center.left, y: center.top }, newZoom);
    setZoom(Math.round(newZoom * 100) / 100);
  }

  function handleZoomReset() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    setZoom(1);
    canvas.renderAll();
  }

  function handleZoomFit() {
    const canvas = fabricRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const containerW = canvas.getWidth();
    const containerH = canvas.getHeight();
    const scaleX = containerW / (img.width * img.scaleX);
    const scaleY = containerH / (img.height * img.scaleY);
    const scale = Math.min(scaleX, scaleY, 1) * 0.9;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.setZoom(scale);
    setZoom(Math.round(scale * 100) / 100);
    canvas.renderAll();
  }

  function pushUndo() {
    if (!frame) return;
    const current = allAnnotations[frame.id] || [];
    undoStackRef.current.push(JSON.parse(JSON.stringify(current)));
    redoStackRef.current = [];
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
  }

  function handleUndo() {
    if (!frame || undoStackRef.current.length === 0) {
      addToast('Нечего отменять', 'info', 1500);
      return;
    }
    const canvas = fabricRef.current;
    const prev = undoStackRef.current.pop();
    const current = allAnnotations[frame.id] || [];
    redoStackRef.current.push(JSON.parse(JSON.stringify(current)));
    setAnnotationsForFrame(frame.id, prev);
    if (canvas) {
      const objs = canvas.getObjects().filter(o => o.annotationData);
      objs.forEach(o => canvas.remove(o));
      prev.forEach(ann => drawAnnotation(canvas, ann));
      canvas.renderAll();
    }
    addToast('Отменено', 'success', 1500);
  }

  function handleRedo() {
    if (!frame || redoStackRef.current.length === 0) {
      addToast('Нечего повторить', 'info', 1500);
      return;
    }
    const canvas = fabricRef.current;
    const next = redoStackRef.current.pop();
    const current = allAnnotations[frame.id] || [];
    undoStackRef.current.push(JSON.parse(JSON.stringify(current)));
    setAnnotationsForFrame(frame.id, next);
    if (canvas) {
      const objs = canvas.getObjects().filter(o => o.annotationData);
      objs.forEach(o => canvas.remove(o));
      next.forEach(ann => drawAnnotation(canvas, ann));
      canvas.renderAll();
    }
    addToast('Повторено', 'success', 1500);
  }

  function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const canvas = fabricRef.current;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const active = canvas?.getActiveObject();
      if (active && active.annotationData) {
        deleteAnnotation(active);
      }
    }

    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      handleUndo();
    }
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
      e.preventDefault();
      handleRedo();
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onFrameNavigate(e.key === 'ArrowLeft' ? -1 : 1);
    }

    // Heading arrow (does NOT move the box): F / Shift+F = +/-90°.
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey) {
      e.preventDefault();
      rotateHeading(e.shiftKey ? -90 : 90);
    }
    // Box outline rotation: R / Shift+R = +/-90°, Q / E = -/+5°.
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey) {
      e.preventDefault();
      rotateBox(e.shiftKey ? -90 : 90);
    }
    if (e.key === 'q') {
      e.preventDefault();
      rotateBox(-5);
    }
    if (e.key === 'e') {
      e.preventDefault();
      rotateBox(5);
    }
  }

  function handleContextAction(action) {
    if (!contextMenu) return;
    setContextMenu(null);

    switch (action) {
      case 'delete':
        if (contextMenu.target) {
          deleteAnnotation(contextMenu.target);
        }
        break;
      case 'verify':
        apiClient.updateAnnotation(contextMenu.annotationId, { is_verified: true }).then(() => {
          addToast('Аннотация подтверждена', 'success');
        }).catch(() => {
          addToast('Ошибка подтверждения', 'error');
        });
        break;
      default:
        break;
    }
  }

  function handleChangeClass(newClassId) {
    if (!contextMenu || !contextMenu.annotationId) return;
    pushUndo();
    const cls = classes.find((c) => c.id === newClassId);
    apiClient.updateAnnotation(contextMenu.annotationId, { class_id: newClassId }).then(() => {
      const data = contextMenu.target?.annotationData;
      if (data) {
        updateAnnotationLocal(frame.id, { ...data, class_id: newClassId });
      }
      if (fabricRef.current) {
        clearAnnotations();
        const updatedAnns = currentAnnotations.map((a) =>
          a.id === contextMenu.annotationId ? { ...a, class_id: newClassId } : a
        );
        updatedAnns.forEach((ann) => drawAnnotation(fabricRef.current, ann));
        fabricRef.current.renderAll();
      }
      addToast(`Класс изменён на: ${cls?.name || newClassId}`, 'success');
    }).catch(() => {
      addToast('Ошибка изменения класса', 'error');
    });
    setContextMenu(null);
  }

  const handleSamClickMode = () => setCanvasMode(MODES.SAM_CLICK);
  const handleSamBoxMode = () => setCanvasMode(MODES.SAM_BOX);
  const handleSamCancel = () => setCanvasMode(MODES.DRAW);

  function getActiveAnnotated() {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const active = canvas.getActiveObject();
    if (!active || !active.annotationData) {
      addToast('Выделите бокс (режим «Редактировать»)', 'info', 2000);
      return null;
    }
    return active;
  }

  // Rotate the box OUTLINE by `delta` degrees (changes geometry). The heading
  // arrow stays on the same side of the box (headingOffset is preserved).
  function rotateBox(delta) {
    const active = getActiveAnnotated();
    if (!active) return;
    const canvas = fabricRef.current;
    pushUndo();
    const data = active.annotationData;
    const newAngle = wrapAngle((data.angle || 0) + delta);
    const newHeading = wrapAngle(newAngle + (active.headingOffset || 0));

    active.set('angle', newAngle);
    active.annotationData = { ...data, angle: newAngle, heading: newHeading };
    active.setCoords();
    canvas.renderAll();

    skipRedrawRef.current = true;
    updateAnnotationLocal(frame.id, { ...data, angle: newAngle, heading: newHeading });
    debouncedSave(data.id, { angle: newAngle, heading: newHeading });
  }

  // Rotate ONLY the heading arrow by `delta` degrees. The box outline
  // (cx, cy, width, height, angle) is never touched, so it cannot shift.
  function rotateHeading(delta) {
    const active = getActiveAnnotated();
    if (!active) return;
    const canvas = fabricRef.current;
    pushUndo();
    const data = active.annotationData;
    const baseHeading = (data.heading === undefined || data.heading === null) ? (data.angle || 0) : data.heading;
    const newHeading = wrapAngle(baseHeading + delta);

    active.headingOffset = wrapAngle(newHeading - (data.angle || 0));
    active.dirty = true;
    active.annotationData = { ...data, heading: newHeading };
    canvas.renderAll();

    skipRedrawRef.current = true;
    updateAnnotationLocal(frame.id, { ...data, heading: newHeading });
    debouncedSave(data.id, { heading: newHeading });
  }


  if (!frame) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <p>Нет активного кадра</p>
      </div>
    );
  }

  const containerClass = `canvas-container ${isPanning ? 'panning' : ''} ${
    canvasMode === MODES.EDIT ? 'selecting' : ''
  }`;

  return (
    <div className="h-full flex flex-col" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="h-10 bg-slate-800/80 border-b border-slate-700 flex items-center px-2 gap-1 flex-shrink-0 z-10">
        <button
          className={`tool-btn ${canvasMode === MODES.SAM_CLICK ? 'active' : ''}`}
          onClick={handleSamClickMode}
          title="SAM2 Click"
        >
          <Crosshair size={16} />
          <span className="hidden lg:inline text-xs ml-1">SAM Click</span>
        </button>
        <button
          className={`tool-btn ${canvasMode === MODES.SAM_BOX ? 'active' : ''}`}
          onClick={handleSamBoxMode}
          title="SAM2 Box"
        >
          <Square size={16} />
          <span className="hidden lg:inline text-xs ml-1">SAM Box</span>
        </button>

        {(canvasMode === MODES.SAM_CLICK || canvasMode === MODES.SAM_BOX) && (
          <button className="tool-btn text-yellow-400" onClick={handleSamCancel}>
            Отмена SAM
          </button>
        )}

        <div className="h-5 w-px bg-slate-700 mx-1" />

        {/* Heading arrow — re-points the arrow only, never moves the box */}
        <button className="tool-btn" onClick={() => rotateHeading(-90)} title="Повернуть стрелку −90° (Shift+F)">
          <RotateCcw size={16} className="text-emerald-400" />
        </button>
        <button
          className="tool-btn"
          onClick={() => rotateHeading(90)}
          title="Направление стрелки: жмите сколько нужно, обводка не двигается (F)"
        >
          <Navigation size={16} className="text-emerald-400" />
          <span className="hidden lg:inline text-xs ml-1">Направление</span>
        </button>

        <div className="h-5 w-px bg-slate-700 mx-1" />

        {/* Box outline rotation — changes the box geometry */}
        <button className="tool-btn" onClick={() => rotateBox(-90)} title="Повернуть БОКС −90° (Shift+R)">
          <RotateCcw size={16} />
        </button>
        <button className="tool-btn" onClick={() => rotateBox(90)} title="Повернуть БОКС +90° (R)">
          <RotateCw size={16} />
          <span className="hidden lg:inline text-xs ml-1">Бокс</span>
        </button>

        <div className="flex-1" />

        <span className="text-xs text-slate-500 mr-2 tabular-nums">
          {Math.round(zoom * 100)}%
        </span>

        <button className="tool-btn" onClick={handleZoomOut} title="Уменьшить">
          <ZoomOut size={16} />
        </button>
        <button className="tool-btn" onClick={handleZoomIn} title="Увеличить">
          <ZoomIn size={16} />
        </button>
        <button className="tool-btn" onClick={handleZoomFit} title="По размеру">
          <RotateCcw size={16} />
        </button>
      </div>

      {/* SAM2 Status */}
      {samLoading && (
        <div className="h-7 bg-blue-900/30 border-b border-blue-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Loader2 size={14} className="loading-spinner text-blue-400" />
          <span className="text-xs text-blue-300">SAM2 обрабатывает...</span>
        </div>
      )}

      {canvasMode === MODES.SAM_CLICK && !samLoading && (
        <div className="h-7 bg-purple-900/30 border-b border-purple-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Crosshair size={14} className="text-purple-400" />
          <span className="text-xs text-purple-300">SAM2 Click: нажмите на объект для сегментации</span>
        </div>
      )}

      {canvasMode === MODES.SAM_BOX && !samLoading && (
        <div className="h-7 bg-purple-900/30 border-b border-purple-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Square size={14} className="text-purple-400" />
          <span className="text-xs text-purple-300">SAM2 Box: обведите объект рамкой</span>
        </div>
      )}

      {/* Canvas Area */}
      <div ref={containerRef} className={containerClass} style={{ flex: 1 }}>
        {loadingImg && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 z-20">
            <Loader2 size={32} className="loading-spinner text-blue-400" />
          </div>
        )}
        {imgError && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 z-20">
            <p>Ошибка загрузки изображения</p>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl py-1 min-w-[200px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-700">
              Аннотация: {contextMenu.className}
            </div>
            <div className="px-1 py-1 border-b border-slate-700">
              <p className="px-2 py-0.5 text-[10px] text-slate-500 uppercase">Сменить класс</p>
              <div className="max-h-32 overflow-y-auto">
                {classes.map((cls) => (
                  <button
                    key={cls.id}
                    className={`w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-slate-700 rounded transition ${
                      cls.id === contextMenu.classId ? 'text-blue-400' : 'text-slate-300'
                    }`}
                    onClick={() => handleChangeClass(cls.id)}
                  >
                    <span className="w-3 h-3 rounded-sm border border-slate-600" style={{ backgroundColor: cls.color }} />
                    {cls.name}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition"
              onClick={() => handleContextAction('verify')}
            >
              <CheckCircle2 size={14} /> Подтвердить
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 transition"
              onClick={() => handleContextAction('delete')}
            >
              <Trash2 size={14} /> Удалить
            </button>
          </div>
        </>
      )}
    </div>
  );
}
