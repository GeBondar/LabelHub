import React, { useEffect, useRef, useState, useCallback } from 'react';
import fabricModule from 'fabric';
const fabric = fabricModule?.fabric || fabricModule;
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MousePointer2,
  Square,
  Trash2,
  Undo2,
  Redo2,
  Crosshair,
  Loader2,
  CheckCircle2,
  Navigation,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../App';
import apiClient from '../api/client';
import SAM2Tools from './SAM2Tools';
import { addTranslations } from '../i18n';

addTranslations({
  'SAM2 loading…': 'SAM2 загружается…',
  'SAM2 ready': 'SAM2 готов',
  'SAM2 unavailable': 'SAM2 недоступен',
  'SAM2…': 'SAM2…',
  'Polygon draft cancelled': 'Черновик полигона отменён',
  'Class {id}': 'Класс {id}',
  'A polygon needs at least 3 points': 'Нужно минимум 3 точки для полигона',
  'Select a class before annotating': 'Выберите класс перед разметкой',
  'Polygon created': 'Полигон создан',
  'Failed to create the polygon': 'Ошибка создания полигона',
  'Unknown': 'Неизвестно',
  'Select a class before drawing': 'Выберите класс перед рисованием',
  'Annotation created': 'Аннотация создана',
  'Failed to create the annotation': 'Ошибка создания аннотации',
  'Could not find the annotation': 'Не удалось найти аннотацию',
  'Annotation deleted': 'Аннотация удалена',
  'Failed to delete the annotation': 'Ошибка удаления аннотации',
  'Objects deleted: {n}': 'Удалено объектов: {n}',
  'Select a class before using SAM2': 'Выберите класс перед использованием SAM2',
  'SAM2 segmentation done': 'SAM2 сегментация выполнена',
  'Unknown error': 'Неизвестная ошибка',
  'SAM2 unavailable: {msg}': 'SAM2 недоступен: {msg}',
  'Nothing to undo': 'Нечего отменять',
  'Undone': 'Отменено',
  'Nothing to redo': 'Нечего повторить',
  'Redone': 'Повторено',
  'Annotation confirmed': 'Аннотация подтверждена',
  'Confirmation error': 'Ошибка подтверждения',
  'Class changed to: {name}': 'Класс изменён на: {name}',
  'Class change error': 'Ошибка изменения класса',
  'Select a box (Edit mode)': 'Выделите бокс (режим «Редактировать»)',
  'No active frame': 'Нет активного кадра',
  'Cancel SAM': 'Отмена SAM',
  'Object direction: click as many times as needed, the outline does not move (F)':
    'Направление объекта: жмите сколько нужно, обводка не двигается (F)',
  'Direction': 'Направление',
  'Polygon: click — point, double-click / Enter — close': 'Полигон: клик — точка, двойной клик / Enter — замкнуть',
  'Cancel the unfinished polygon (Esc / Delete)': 'Отменить незавершённый полигон (Esc / Delete)',
  'Cancel polygon ({n})': 'Отменить полигон ({n})',
  'Zoom out': 'Уменьшить',
  'Zoom in': 'Увеличить',
  'Fit': 'По размеру',
  'SAM2 is processing...': 'SAM2 обрабатывает...',
  'SAM2 Click: click an object to segment it': 'SAM2 Click: нажмите на объект для сегментации',
  'SAM2 Box: draw a box around the object': 'SAM2 Box: обведите объект рамкой',
  'Delete mode: hold LMB and drag over an area (or click objects), then Delete':
    'Удаление: зажмите ЛКМ и обведите область (или кликайте объекты), затем Delete',
  ' — {n} selected': ' — выбрано {n}',
  ' · Esc — reset': ' · Esc — сброс',
  'Image load error': 'Ошибка загрузки изображения',
  'Annotation: {name}': 'Аннотация: {name}',
  'Change class': 'Сменить класс',
  'Confirm': 'Подтвердить',
});

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

// Axis-aligned bounding box (normalized cx,cy,w,h) that encloses an oriented
// box. Used so detect projects always show/train upright boxes even if an
// annotation carries an angle (e.g. SAM2 returns a rotated minAreaRect).
// Rotation is computed in pixel space because images aren't square.
function obbToAabbNorm(cx, cy, w, h, angleDeg, imgW, imgH) {
  if (!imgW || !imgH) return { cx, cy, width: w, height: h };
  const a = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const hw = (w * imgW) / 2, hh = (h * imgH) / 2;
  const cxPx = cx * imgW, cyPx = cy * imgH;
  const xs = [], ys = [];
  for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    xs.push(cxPx + dx * cosA - dy * sinA);
    ys.push(cyPx + dx * sinA + dy * cosA);
  }
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  return {
    cx: ((x0 + x1) / 2) / imgW,
    cy: ((y0 + y1) / 2) / imgH,
    width: (x1 - x0) / imgW,
    height: (y1 - y0) / imgH,
  };
}

// SAM2 load-state badge for the canvas toolbar. `status` is the /sam2/status
// payload: { state: idle|loading|loaded|error, error }.
function renderSamBadge(status, t) {
  const state = status?.state || 'unknown';
  const cfg = {
    loading: { Icon: Loader2, cls: 'text-amber-300 bg-amber-900/20 border-amber-700/40', text: t('SAM2 loading…'), spin: true },
    loaded: { Icon: CheckCircle2, cls: 'text-green-300 bg-green-900/20 border-green-700/40', text: t('SAM2 ready') },
    error: { Icon: AlertCircle, cls: 'text-red-300 bg-red-900/20 border-red-700/40', text: t('SAM2 unavailable') },
  }[state] || { Icon: Loader2, cls: 'text-slate-400 bg-slate-700/40 border-slate-600/40', text: t('SAM2…'), spin: true };
  const { Icon, cls, text, spin } = cfg;
  const title = state === 'error' && status?.error ? status.error : text;
  return (
    <span
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${cls}`}
      title={title}
    >
      <Icon size={12} className={spin ? 'loading-spinner' : ''} />
      <span className="hidden lg:inline">{text}</span>
    </span>
  );
}

export default function AnnotationCanvas({
  projectId,
  taskType = 'obb',
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
  deleteActiveRef,
  undoRef,
  redoRef,
}) {
  const isSegment = taskType === 'segment';
  const isObb = taskType === 'obb';
  const isDetect = taskType === 'detect';
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
  const [samStatus, setSamStatus] = useState({ state: 'unknown', error: null });
  const [selectedObj, setSelectedObj] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [loadingImg, setLoadingImg] = useState(false);
  const [imgError, setImgError] = useState(false);
  const isDrawingRef = useRef(false);
  const drawStartRef = useRef(null);
  const drawRectRef = useRef(null);
  // Segment polygon-in-progress: scene-space vertices + preview objects.
  const polyPointsRef = useRef([]);
  const polyPreviewRef = useRef(null);
  const polyMarkersRef = useRef([]);
  const skipRedrawRef = useRef(false);
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(false);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  // Live mirror of selectedClassId. Fabric mouse handlers are bound once per
  // frame and would otherwise capture a stale selectedClassId — so a class
  // picked after the frame loaded wouldn't apply to newly drawn objects. Read
  // this ref in the create paths so the current class is always used.
  const selectedClassIdRef = useRef(selectedClassId);
  // Region-delete (marquee) in DELETE mode: drag a rectangle to mark objects,
  // then press Delete to remove all of them at once.
  const isMarqueeRef = useRef(false);
  const marqueeStartRef = useRef(null);
  const marqueeRectRef = useRef(null);
  const pendingDeleteRef = useRef(new Set());
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0);
  const [polyPointCount, setPolyPointCount] = useState(0);  // in-progress segment draft
  const { addToast, annotations: allAnnotations, updateAnnotationLocal, removeAnnotationLocal, setAnnotationsForFrame, t } = useApp();

  const currentAnnotations = frame ? (allAnnotations[frame.id] || annotations) : [];

  // Bind undo/redo every render so they always see the current frame state
  // (the workspace calls these on Ctrl+Z / Ctrl+Shift+Z regardless of focus).
  useEffect(() => {
    if (undoRef) undoRef.current = handleUndo;
    if (redoRef) redoRef.current = handleRedo;
  });

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

  // Delete the currently selected annotation (used by the Аннотации panel's
  // Delete key). Re-bound when the frame changes so it never deletes against a
  // stale frame. Returns true if something was deleted.
  useEffect(() => {
    if (!deleteActiveRef) return;
    deleteActiveRef.current = () => {
      const canvas = fabricRef.current;
      if (!canvas) return false;
      // 0) An unfinished polygon draft (the dashed lines): Delete abandons it.
      if (polyPointsRef.current.length > 0) {
        clearPolygonDraft();
        addToast(t('Polygon draft cancelled'), 'info', 1500);
        return true;
      }
      // 1) Region-delete: a marquee in DELETE mode marked several objects.
      if (pendingDeleteRef.current.size > 0) {
        deleteManyByIds([...pendingDeleteRef.current]);
        return true;
      }
      const active = canvas.getActiveObject();
      if (!active) return false;
      // 2) A multi-object selection (drag-select in EDIT mode).
      if (active.type === 'activeSelection') {
        const ids = active.getObjects()
          .filter((o) => o.annotationData)
          .map((o) => o.annotationData.id);
        canvas.discardActiveObject();
        if (ids.length) { deleteManyByIds(ids); return true; }
        return false;
      }
      // 3) A single selected object (clicked on canvas or in the panel list).
      if (active.annotationData) {
        deleteAnnotation(active);
        return true;
      }
      return false;
    };
  }, [deleteActiveRef, frame?.id]);

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
    selectedClassIdRef.current = selectedClassId;
  }, [selectedClassId]);

  // Poll the SAM2 load state for the status badge. The backend warms it up in
  // the background at startup; we poll fast while it's still loading and slow
  // once it settles (loaded/error).
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function poll() {
      try {
        const res = await apiClient.samStatus();
        if (cancelled) return;
        const data = res.data || { state: 'unknown' };
        setSamStatus(data);
        const settled = data.state === 'loaded' || data.state === 'error';
        timer = setTimeout(poll, settled ? 8000 : 1500);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4000);
      }
    }
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !frame) return;

    undoStackRef.current = [];
    redoStackRef.current = [];
    // Stale polygon-in-progress markers belong to the old canvas; drop them.
    polyPointsRef.current = [];
    polyPreviewRef.current = null;
    polyMarkersRef.current = [];
    // Region-delete selection doesn't carry across frames.
    isMarqueeRef.current = false;
    marqueeStartRef.current = null;
    marqueeRectRef.current = null;
    pendingDeleteRef.current = new Set();
    setPendingDeleteCount(0);
    setPolyPointCount(0);

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
    // Double-click closes the segment polygon in progress.
    canvas.on('mouse:dblclick', () => {
      if (modeRef.current === MODES.DRAW && polyPointsRef.current.length >= 3) {
        finishPolygon();
      }
    });

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
      // Auto-save: flush any pending (debounced) edit before leaving this frame,
      // so a move/resize is never lost when switching photos quickly.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingSaveRef.current) {
        const { id, data } = pendingSaveRef.current;
        pendingSaveRef.current = null;
        apiClient.updateAnnotation(id, data).catch((e) =>
          console.error('Auto-save on navigate failed:', e));
      }
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
    // Keep objects non-movable while in DELETE mode after a re-render.
    if (modeRef.current === MODES.DELETE) {
      canvas.getObjects().forEach((o) => { if (o.annotationData) o.selectable = false; });
    }
    canvas.renderAll();
  }, [currentAnnotations, classes]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (canvas) {
      canvas.selection = canvasMode === MODES.EDIT;
      if (canvasMode !== MODES.EDIT) canvas.discardActiveObject();
      // In DELETE mode objects can be marked (findTarget still works via
      // `evented`) but not moved/resized — so a marquee/click never drags them.
      const selectable = canvasMode !== MODES.DELETE;
      canvas.getObjects().forEach((o) => { if (o.annotationData) o.selectable = selectable; });
      canvas.renderAll();
    }
    // Leaving DELETE mode drops any region-delete selection.
    if (canvasMode !== MODES.DELETE) clearPendingDelete();
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
    // Segment annotations (with a polygon) render as a fabric.Polygon.
    if (ann.points && ann.points.length >= 3) {
      drawPolygonAnnotation(canvas, ann);
      return;
    }

    const cls = classes.find((c) => c.id === ann.class_id);
    const color = cls?.color || '#3b82f6';
    const label = cls?.name || t('Class {id}', { id: ann.class_id });

    const rawAngle = ann.angle || 0;
    // Detect boxes are axis-aligned: if a stored annotation carries an angle
    // (e.g. created via SAM2, which returns a rotated minAreaRect), render its
    // upright bounding box instead — that's exactly what detect trains on.
    let gCx = ann.cx, gCy = ann.cy, gW = ann.width, gH = ann.height;
    let annAngle = rawAngle;
    if (isDetect && rawAngle && frame) {
      const bb = obbToAabbNorm(ann.cx, ann.cy, ann.width, ann.height, rawAngle, frame.width, frame.height);
      gCx = bb.cx; gCy = bb.cy; gW = bb.width; gH = bb.height; annAngle = 0;
    }

    const { x, y } = canvasFromNormalized(gCx, gCy);
    const { w, h } = canvasSizeFromNormalized(gW, gH);

    const annHeading = (ann.heading === undefined || ann.heading === null) ? annAngle : ann.heading;

    // Detect = axis-aligned box (no rotation/heading); OBB = rotatable arrow box.
    const RectClass = isDetect ? fabric.Rect : (ensureOBBRect() || fabric.Rect);
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
      // Detect boxes never rotate — hide the rotation handle and lock the angle.
      lockRotation: isDetect,
      hasRotatingPoint: !isDetect,
      padding: 0,
      objectCaching: false,
      annotationData: {
        id: ann.id,
        class_id: ann.class_id,
        cx: gCx,
        cy: gCy,
        width: gW,
        height: gH,
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

  // Convert a fabric.Polygon's vertices to normalized image coords using its
  // transform matrix, so moves/scales of the polygon are reflected on save.
  function polygonToNormalized(polyObj) {
    if (!imageRef.current || !polyObj?.points) return [];
    const m = polyObj.calcTransformMatrix();
    const offX = polyObj.pathOffset?.x || 0;
    const offY = polyObj.pathOffset?.y || 0;
    return polyObj.points.map((p) => {
      const scene = fabric.util.transformPoint({ x: p.x - offX, y: p.y - offY }, m);
      return normalizeCoords(scene.x, scene.y);
    }).map((n) => [n.cx, n.cy]);
  }

  function drawPolygonAnnotation(canvas, ann) {
    const cls = classes.find((c) => c.id === ann.class_id);
    const color = cls?.color || '#3b82f6';
    const label = cls?.name || t('Class {id}', { id: ann.class_id });

    const scenePoints = ann.points.map(([nx, ny]) => {
      const { x, y } = canvasFromNormalized(nx, ny);
      return { x, y };
    });

    const poly = new fabric.Polygon(scenePoints, {
      fill: `${color}33`,
      stroke: color,
      strokeWidth: 2,
      strokeUniform: true,
      objectCaching: false,
      perPixelTargetFind: true,
      hasRotatingPoint: false,
      annotationData: {
        id: ann.id,
        class_id: ann.class_id,
        cx: ann.cx,
        cy: ann.cy,
        width: ann.width,
        height: ann.height,
        points: ann.points,
        is_verified: ann.is_verified,
      },
    });

    const { x, y } = canvasFromNormalized(ann.cx, ann.cy);
    const { h } = canvasSizeFromNormalized(ann.width, ann.height);
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

    canvas.add(poly);
    canvas.add(text);
    labelMapRef.current[ann.id] = text;
  }

  function clearPolygonDraft() {
    const canvas = fabricRef.current;
    if (canvas) {
      if (polyPreviewRef.current) canvas.remove(polyPreviewRef.current);
      polyMarkersRef.current.forEach((m) => canvas.remove(m));
      canvas.renderAll();
    }
    polyPreviewRef.current = null;
    polyMarkersRef.current = [];
    polyPointsRef.current = [];
    setPolyPointCount(0);
  }

  function renderPolygonDraft() {
    const selectedClassId = selectedClassIdRef.current;
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (polyPreviewRef.current) canvas.remove(polyPreviewRef.current);
    polyMarkersRef.current.forEach((m) => canvas.remove(m));
    polyMarkersRef.current = [];

    const pts = polyPointsRef.current;
    if (pts.length === 0) { canvas.renderAll(); return; }

    const cls = classes.find((c) => c.id === selectedClassId);
    const color = cls?.color || '#3b82f6';

    if (pts.length >= 2) {
      const line = new fabric.Polyline(pts.map((p) => ({ x: p.x, y: p.y })), {
        fill: 'transparent',
        stroke: color,
        strokeWidth: 2,
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      polyPreviewRef.current = line;
      canvas.add(line);
    }
    pts.forEach((p, i) => {
      const dot = new fabric.Circle({
        left: p.x, top: p.y, radius: 4,
        fill: i === 0 ? '#ffffff' : color,
        stroke: color, strokeWidth: 1,
        originX: 'center', originY: 'center',
        selectable: false, evented: false, objectCaching: false,
      });
      polyMarkersRef.current.push(dot);
      canvas.add(dot);
    });
    canvas.renderAll();
  }

  function addPolygonPoint(scenePt) {
    const pts = polyPointsRef.current;
    // Click near the first vertex closes the polygon.
    if (pts.length >= 3) {
      const first = pts[0];
      const d = Math.hypot(scenePt.x - first.x, scenePt.y - first.y);
      const closeThresh = 10 / (fabricRef.current?.getZoom() || 1);
      if (d <= closeThresh) {
        finishPolygon();
        return;
      }
    }
    pts.push({ x: scenePt.x, y: scenePt.y });
    setPolyPointCount(pts.length);
    renderPolygonDraft();
  }

  async function finishPolygon() {
    const selectedClassId = selectedClassIdRef.current;
    const pts = polyPointsRef.current;
    if (pts.length < 3) {
      addToast(t('A polygon needs at least 3 points'), 'warning', 2000);
      return;
    }
    if (!selectedClassId) {
      addToast(t('Select a class before annotating'), 'warning');
      return;
    }
    const normPoints = pts.map((p) => {
      const n = normalizeCoords(p.x, p.y);
      return [n.cx, n.cy];
    });
    clearPolygonDraft();
    await createSegmentAnnotation(normPoints);
  }

  async function createSegmentAnnotation(normPoints) {
    const selectedClassId = selectedClassIdRef.current;
    const canvas = fabricRef.current;
    if (!canvas || !frame) return;
    try {
      pushUndo();
      const res = await apiClient.createAnnotation(frame.id, {
        class_id: selectedClassId,
        cx: 0, cy: 0, width: 0.0001, height: 0.0001, angle: 0,
        points: normPoints,
      });
      const newAnn = res.data;
      updateAnnotationLocal(frame.id, newAnn);
      drawAnnotation(canvas, newAnn);
      canvas.renderAll();
      addToast(t('Polygon created'), 'success', 2000);
    } catch (e) {
      addToast(t('Failed to create the polygon'), 'error');
    }
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

    // Polygon (segment) annotations: recompute vertices from the transform.
    if (data.points && obj.type === 'polygon') {
      const newPoints = polygonToNormalized(obj);
      if (!newPoints.length) return;
      const xs = newPoints.map((p) => p[0]);
      const ys = newPoints.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      const newData = { ...data, points: newPoints, cx, cy, width, height };
      obj.annotationData = newData;
      skipRedrawRef.current = true;
      updateAnnotationLocal(frame.id, newData);
      const labelObj = labelMapRef.current[data.id];
      if (labelObj && imageRef.current) {
        const { x, y } = canvasFromNormalized(cx, cy);
        const { h } = canvasSizeFromNormalized(width, height);
        labelObj.set({ left: x, top: y - h / 2 - 4 });
      }
      debouncedSave(data.id, { points: newPoints });
      return;
    }

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
    const pending = pendingSaveRef.current;
    if (pending && pending.id !== annotationId) {
      // A different annotation is still queued — flush it now so its fields are
      // never dropped by the incoming save.
      apiClient.updateAnnotation(pending.id, pending.data).catch((e) => {
        console.error('Auto-save failed:', e);
      });
      pendingSaveRef.current = { id: annotationId, data };
    } else {
      // Same annotation: merge field-by-field so an earlier geometry edit isn't
      // overwritten by a later heading-only edit (or vice versa).
      pendingSaveRef.current = {
        id: annotationId,
        data: { ...(pending?.data || {}), ...data },
      };
    }
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
          className: cls?.name || t('Unknown'),
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
      // Segment projects build a polygon click-by-click instead of a box.
      if (isSegment) {
        // When not mid-draft, clicking an existing object selects it (so it can
        // be moved or deleted) instead of starting a new point.
        const target = canvas.findTarget(evt, false);
        if (polyPointsRef.current.length === 0 && target && target.annotationData) {
          canvas.setActiveObject(target);
          canvas.renderAll();
          return;
        }
        const pointer = canvas.getPointer(evt);
        addPolygonPoint(pointer);
        return;
      }
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        canvas.setActiveObject(target);
        canvas.renderAll();
        return;
      }
      startDraw(opt, canvas);
    } else if (currentMode === MODES.DELETE) {
      // Click an object to mark/unmark it; drag on empty space to marquee-select
      // a region. Then Delete removes everything marked.
      const target = canvas.findTarget(evt, false);
      if (target && target.annotationData) {
        togglePendingDelete(target);
      } else {
        startMarquee(opt, canvas);
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

    if (isMarqueeRef.current && marqueeRectRef.current && canvas) {
      const pointer = canvas.getPointer(opt.e);
      const start = marqueeStartRef.current;
      marqueeRectRef.current.set({
        left: Math.min(start.x, pointer.x),
        top: Math.min(start.y, pointer.y),
        width: Math.abs(pointer.x - start.x),
        height: Math.abs(pointer.y - start.y),
      });
      marqueeRectRef.current.setCoords();
      canvas.renderAll();
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

    if (isMarqueeRef.current) {
      finalizeMarquee(canvas);
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
    const selectedClassId = selectedClassIdRef.current;
    if (!frame || !selectedClassId) {
      addToast(t('Select a class before drawing'), 'warning');
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
      addToast(t('Annotation created'), 'success', 2000);
    } catch (e) {
      addToast(t('Failed to create the annotation'), 'error');
    }
  }

  async function deleteAnnotation(obj) {
    const data = getAnnotationFromObject(obj);
    if (!data || !data.id) {
      addToast(t('Could not find the annotation'), 'error');
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
      canvas.discardActiveObject();
      canvas.renderAll();
      addToast(t('Annotation deleted'), 'success', 2000);
    } catch (e) {
      addToast(t('Failed to delete the annotation'), 'error');
    }
  }

  // ---------------------------------------------- region (marquee) deletion
  function setPendingHighlight(obj, on) {
    if (!obj) return;
    if (on) {
      obj.set({ stroke: '#ef4444', strokeWidth: 4, fill: 'rgba(239,68,68,0.20)' });
    } else {
      const cls = classes.find((c) => c.id === obj.annotationData?.class_id);
      const color = cls?.color || '#3b82f6';
      obj.set({ stroke: color, strokeWidth: 2, fill: obj.type === 'polygon' ? `${color}33` : `${color}22` });
    }
  }

  function togglePendingDelete(obj) {
    const id = obj.annotationData?.id;
    if (id == null) return;
    const set = pendingDeleteRef.current;
    if (set.has(id)) { set.delete(id); setPendingHighlight(obj, false); }
    else { set.add(id); setPendingHighlight(obj, true); }
    setPendingDeleteCount(set.size);
    fabricRef.current?.renderAll();
  }

  function startMarquee(opt, canvas) {
    const pointer = canvas.getPointer(opt.e);
    isMarqueeRef.current = true;
    marqueeStartRef.current = { x: pointer.x, y: pointer.y };
    marqueeRectRef.current = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 0, height: 0,
      fill: 'rgba(239,68,68,0.12)', stroke: '#ef4444', strokeWidth: 1.5,
      strokeDashArray: [5, 4], strokeUniform: true, selectable: false, evented: false,
    });
    canvas.add(marqueeRectRef.current);
    canvas.renderAll();
  }

  function finalizeMarquee(canvas) {
    const rect = marqueeRectRef.current;
    isMarqueeRef.current = false;
    marqueeStartRef.current = null;
    if (!rect) return;
    const m = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
    canvas.remove(rect);
    marqueeRectRef.current = null;
    if (rect.width < 4 && rect.height < 4) { canvas.renderAll(); return; }  // a click, not a drag
    const set = pendingDeleteRef.current;
    for (const o of canvas.getObjects()) {
      if (!o.annotationData) continue;
      const b = o.getBoundingRect(true);
      const overlaps = !(b.left + b.width < m.left || b.left > m.right
        || b.top + b.height < m.top || b.top > m.bottom);
      if (overlaps && !set.has(o.annotationData.id)) {
        set.add(o.annotationData.id);
        setPendingHighlight(o, true);
      }
    }
    setPendingDeleteCount(set.size);
    canvas.renderAll();
  }

  function clearPendingDelete() {
    const canvas = fabricRef.current;
    const set = pendingDeleteRef.current;
    if (canvas && set.size) {
      for (const o of canvas.getObjects()) {
        if (o.annotationData && set.has(o.annotationData.id)) setPendingHighlight(o, false);
      }
    }
    set.clear();
    setPendingDeleteCount(0);
    canvas?.renderAll();
  }

  async function deleteManyByIds(ids) {
    const canvas = fabricRef.current;
    if (!canvas || !frame || ids.length === 0) return;
    pushUndo();
    for (const id of ids) {
      try { await apiClient.deleteAnnotation(id); } catch (e) { /* keep going */ }
      const obj = canvas.getObjects().find((o) => o.annotationData?.id === id);
      if (obj) canvas.remove(obj);
      const labelObj = labelMapRef.current[id];
      if (labelObj) { canvas.remove(labelObj); delete labelMapRef.current[id]; }
      removeAnnotationLocal(frame.id, id);
      pendingDeleteRef.current.delete(id);
    }
    setPendingDeleteCount(pendingDeleteRef.current.size);
    canvas.discardActiveObject();
    canvas.renderAll();
    addToast(t('Objects deleted: {n}', { n: ids.length }), 'success', 2000);
  }

  // Build the create payload from a SAM2 response per task type. Segment stores
  // the polygon; detect stores an axis-aligned bbox (SAM returns a rotated
  // minAreaRect, which is wrong for detect); OBB keeps the oriented box.
  function samPayload(obb) {
    const selectedClassId = selectedClassIdRef.current;
    if (isSegment && obb.points && obb.points.length >= 3) {
      return { class_id: selectedClassId, cx: 0, cy: 0, width: 0.0001, height: 0.0001, angle: 0, points: obb.points };
    }
    if (isDetect) {
      let bb;
      if (obb.points && obb.points.length >= 3) {
        const xs = obb.points.map((p) => p[0]);
        const ys = obb.points.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);
        bb = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, width: x1 - x0, height: y1 - y0 };
      } else {
        bb = obbToAabbNorm(obb.cx, obb.cy, obb.width, obb.height, obb.angle || 0, frame.width, frame.height);
      }
      return { class_id: selectedClassId, cx: bb.cx, cy: bb.cy, width: bb.width, height: bb.height, angle: 0 };
    }
    return { class_id: selectedClassId, cx: obb.cx, cy: obb.cy, width: obb.width, height: obb.height, angle: obb.angle };
  }

  async function handleSAMClick(opt, canvas) {
    const selectedClassId = selectedClassIdRef.current;
    if (!frame) return;
    if (!selectedClassId) {
      addToast(t('Select a class before using SAM2'), 'warning');
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

      const payload = samPayload(obb);
      const createRes = await apiClient.createAnnotation(frame.id, payload);

      const newAnn = createRes.data;
      updateAnnotationLocal(frame.id, newAnn);
      clearAnnotations();
      const updatedAnns = (allAnnotations[frame.id] || annotations).concat(newAnn);
      updatedAnns.forEach((ann) => drawAnnotation(canvas, ann));
      canvas.renderAll();
      addToast(t('SAM2 segmentation done'), 'success');
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || t('Unknown error');
      addToast(t('SAM2 unavailable: {msg}', { msg }), 'error', 6000);
    } finally {
      setSamLoading(false);
    }
  }

  async function handleSAMBox(drawRect) {
    const selectedClassId = selectedClassIdRef.current;
    if (!frame) return;
    if (!selectedClassId) {
      addToast(t('Select a class before using SAM2'), 'warning');
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

      const payload = samPayload(obb);
      const createRes = await apiClient.createAnnotation(frame.id, payload);

      const newAnn = createRes.data;
      updateAnnotationLocal(frame.id, newAnn);
      clearAnnotations();
      const updatedAnns = (allAnnotations[frame.id] || annotations).concat(newAnn);
      updatedAnns.forEach((ann) => drawAnnotation(canvas, ann));
      canvas.renderAll();
      addToast(t('SAM2 segmentation done'), 'success');
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || t('Unknown error');
      addToast(t('SAM2 unavailable: {msg}', { msg }), 'error', 6000);
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

  function annDiffers(a, b) {
    if (a.class_id !== b.class_id) return true;
    for (const k of ['cx', 'cy', 'width', 'height', 'angle', 'heading']) {
      if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-9) return true;
    }
    return JSON.stringify(a.points || null) !== JSON.stringify(b.points || null);
  }

  // Make the backend + local state match a saved snapshot: delete annotations
  // that were added since, re-create ones that were deleted (they get fresh
  // ids), and restore geometry/class on those that still exist. This is what
  // makes Ctrl+Z work for deletions, not just visually.
  async function applySnapshot(target) {
    const canvas = fabricRef.current;
    if (!frame) return target;
    const fid = frame.id;
    const current = allAnnotations[fid] || [];
    const curById = new Map(current.map((a) => [a.id, a]));
    const tgtIds = new Set(target.map((a) => a.id));

    for (const a of current) {
      if (!tgtIds.has(a.id)) {
        try { await apiClient.deleteAnnotation(a.id); } catch (e) { /* gone already */ }
      }
    }

    const rebuilt = [];
    for (const a of target) {
      const payload = {
        class_id: a.class_id,
        cx: a.cx, cy: a.cy, width: a.width, height: a.height,
        angle: a.angle ?? 0, heading: a.heading,
        points: a.points || undefined,
      };
      if (curById.has(a.id)) {
        // Only touch the backend if this object actually changed (e.g. a move
        // being undone) — not for every object on every undo.
        if (annDiffers(curById.get(a.id), a)) {
          try { await apiClient.updateAnnotation(a.id, payload); } catch (e) { /* ignore */ }
        }
        rebuilt.push(a);
      } else {
        try {
          const res = await apiClient.createAnnotation(fid, payload);
          rebuilt.push(res.data);
        } catch (e) {
          rebuilt.push(a);
        }
      }
    }

    // The [currentAnnotations] redraw effect repaints the canvas from `rebuilt`.
    setAnnotationsForFrame(fid, rebuilt);
    return rebuilt;
  }

  async function handleUndo() {
    if (!frame || undoStackRef.current.length === 0) {
      addToast(t('Nothing to undo'), 'info', 1500);
      return;
    }
    const prev = undoStackRef.current.pop();
    const current = allAnnotations[frame.id] || [];
    redoStackRef.current.push(JSON.parse(JSON.stringify(current)));
    await applySnapshot(prev);
    addToast(t('Undone'), 'success', 1500);
  }

  async function handleRedo() {
    if (!frame || redoStackRef.current.length === 0) {
      addToast(t('Nothing to redo'), 'info', 1500);
      return;
    }
    const next = redoStackRef.current.pop();
    const current = allAnnotations[frame.id] || [];
    undoStackRef.current.push(JSON.parse(JSON.stringify(current)));
    await applySnapshot(next);
    addToast(t('Redone'), 'success', 1500);
  }

  function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const canvas = fabricRef.current;

    // Segment polygon controls: Enter closes, Escape cancels the draft.
    if (isSegment && polyPointsRef.current.length > 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishPolygon();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        clearPolygonDraft();
        return;
      }
    }

    // Escape clears a region-delete selection.
    if (e.key === 'Escape' && pendingDeleteRef.current.size > 0) {
      e.preventDefault();
      clearPendingDelete();
      return;
    }

    // Delete and Undo/Redo are handled once at the workspace level (via refs) so
    // they work whether focus is on the canvas or the annotations panel, without
    // double-firing.

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onFrameNavigate(e.key === 'ArrowLeft' ? -1 : 1);
    }

    // Heading arrow (does NOT move the box): F steps the direction by 90°.
    // Only meaningful for OBB projects.
    if (isObb && e.key.toLowerCase() === 'f' && !e.ctrlKey) {
      e.preventDefault();
      rotateHeading(90);
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
          addToast(t('Annotation confirmed'), 'success');
        }).catch(() => {
          addToast(t('Confirmation error'), 'error');
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
      addToast(t('Class changed to: {name}', { name: cls?.name || newClassId }), 'success');
    }).catch(() => {
      addToast(t('Class change error'), 'error');
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
      addToast(t('Select a box (Edit mode)'), 'info', 2000);
      return null;
    }
    return active;
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
        <p>{t('No active frame')}</p>
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
            {t('Cancel SAM')}
          </button>
        )}

        {/* SAM2 load-state badge — shows whether the model is still warming up
            in the background, ready, or unavailable. */}
        {renderSamBadge(samStatus, t)}

        {isObb && <div className="h-5 w-px bg-slate-700 mx-1" />}

        {/* Heading arrow — sets the object's direction; never moves the box.
            Each press steps the direction by 90°, which maps 1:1 to the front
            edge encoded in the exported YOLOv8-OBB label. OBB-only. */}
        {isObb && (
          <button
            className="tool-btn"
            onClick={() => rotateHeading(90)}
            title={t('Object direction: click as many times as needed, the outline does not move (F)')}
          >
            <Navigation size={16} className="text-emerald-400" />
            <span className="hidden lg:inline text-xs ml-1">{t('Direction')}</span>
          </button>
        )}

        {isSegment && polyPointCount === 0 && (
          <span className="text-xs text-slate-400 ml-2 hidden lg:inline">
            {t('Polygon: click — point, double-click / Enter — close')}
          </span>
        )}
        {isSegment && polyPointCount > 0 && (
          <button
            className="tool-btn text-red-300 hover:text-red-200 ml-1"
            onClick={() => clearPolygonDraft()}
            title={t('Cancel the unfinished polygon (Esc / Delete)')}
          >
            <Trash2 size={14} />
            <span className="text-xs ml-1">{t('Cancel polygon ({n})', { n: polyPointCount })}</span>
          </button>
        )}

        <div className="flex-1" />

        <span className="text-xs text-slate-500 mr-2 tabular-nums">
          {Math.round(zoom * 100)}%
        </span>

        <button className="tool-btn" onClick={handleZoomOut} title={t('Zoom out')}>
          <ZoomOut size={16} />
        </button>
        <button className="tool-btn" onClick={handleZoomIn} title={t('Zoom in')}>
          <ZoomIn size={16} />
        </button>
        <button className="tool-btn" onClick={handleZoomFit} title={t('Fit')}>
          <RotateCcw size={16} />
        </button>
      </div>

      {/* SAM2 Status */}
      {samLoading && (
        <div className="h-7 bg-blue-900/30 border-b border-blue-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Loader2 size={14} className="loading-spinner text-blue-400" />
          <span className="text-xs text-blue-300">{t('SAM2 is processing...')}</span>
        </div>
      )}

      {canvasMode === MODES.SAM_CLICK && !samLoading && (
        <div className="h-7 bg-purple-900/30 border-b border-purple-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Crosshair size={14} className="text-purple-400" />
          <span className="text-xs text-purple-300">{t('SAM2 Click: click an object to segment it')}</span>
        </div>
      )}

      {canvasMode === MODES.SAM_BOX && !samLoading && (
        <div className="h-7 bg-purple-900/30 border-b border-purple-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Square size={14} className="text-purple-400" />
          <span className="text-xs text-purple-300">{t('SAM2 Box: draw a box around the object')}</span>
        </div>
      )}

      {canvasMode === MODES.DELETE && (
        <div className="h-7 bg-red-900/30 border-b border-red-700/30 flex items-center px-3 gap-2 flex-shrink-0">
          <Trash2 size={14} className="text-red-400" />
          <span className="text-xs text-red-300">
            {t('Delete mode: hold LMB and drag over an area (or click objects), then Delete')}
            {pendingDeleteCount > 0 ? t(' — {n} selected', { n: pendingDeleteCount }) : ''}
            {pendingDeleteCount > 0 ? t(' · Esc — reset') : ''}
          </span>
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
            <p>{t('Image load error')}</p>
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
              {t('Annotation: {name}', { name: contextMenu.className })}
            </div>
            <div className="px-1 py-1 border-b border-slate-700">
              <p className="px-2 py-0.5 text-[10px] text-slate-500 uppercase">{t('Change class')}</p>
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
              <CheckCircle2 size={14} /> {t('Confirm')}
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 transition"
              onClick={() => handleContextAction('delete')}
            >
              <Trash2 size={14} /> {t('Delete')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
