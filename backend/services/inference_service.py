"""Real-time model-testing inference sessions.

Each session runs a YOLO model over a video source (file, project video, or
webcam) in a background thread, draws oriented bounding boxes on every frame,
and exposes the latest annotated frame as JPEG bytes. The API layer serves those
bytes as an MJPEG (`multipart/x-mixed-replace`) stream the UI renders in an
`<img>`.

Kept import-light at module load: heavy deps (torch, ultralytics) are imported
inside the worker thread so importing this module never blocks the event loop.
"""

import os
import time
import math
import uuid
import queue
import threading
import colorsys

import cv2
import numpy as np

from backend.config import config


def _class_color(idx: int):
    """Stable, well-spread BGR color for a class index."""
    hue = (idx * 0.61803398875) % 1.0
    r, g, b = colorsys.hsv_to_rgb(hue, 0.65, 1.0)
    return (int(b * 255), int(g * 255), int(r * 255))


def _draw_obb(frame, cx, cy, w, h, angle_deg, label, conf, color):
    angle_rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    hw, hh = w / 2, h / 2
    corners = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]])
    rot = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
    corners = (corners @ rot.T + np.array([cx, cy])).astype(np.int32)
    cv2.polylines(frame, [corners], isClosed=True, color=color, thickness=2)

    # Heading arrow along the box's local +x axis.
    front_x = int(cx + (w / 2 + 15) * cos_a)
    front_y = int(cy + (w / 2 + 15) * sin_a)
    cv2.arrowedLine(frame, (int(cx), int(cy)), (front_x, front_y), color, 3, tipLength=0.3)

    text = f"{label} {conf:.2f} {angle_deg:.0f}'"
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
    top = int(cy - hh)
    cv2.rectangle(frame, (int(cx) - tw // 2 - 4, top - th - 12),
                  (int(cx) + tw // 2 + 4, top - 2), color, -1)
    cv2.putText(frame, text, (int(cx) - tw // 2, top - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)


def _draw_mask(frame, polygon_xy, color):
    """Overlay a translucent filled instance mask + outline from a polygon."""
    if polygon_xy is None or len(polygon_xy) < 3:
        return
    pts = np.asarray(polygon_xy, dtype=np.int32).reshape(-1, 1, 2)
    overlay = frame.copy()
    cv2.fillPoly(overlay, [pts], color)
    cv2.addWeighted(overlay, 0.4, frame, 0.6, 0, frame)
    cv2.polylines(frame, [pts], isClosed=True, color=color, thickness=2)


def _draw_box(frame, x1, y1, x2, y2, label, conf, color):
    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
    text = f"{label} {conf:.2f}"
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
    cv2.rectangle(frame, (int(x1), int(y1) - th - 10), (int(x1) + tw + 6, int(y1)), color, -1)
    cv2.putText(frame, text, (int(x1) + 3, int(y1) - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)


class InferenceSession:
    def __init__(self, sid, model_path, source, model_name, device, device_label):
        self.sid = sid
        self.model_path = model_path
        self.source = source              # {"type": "file"|"webcam", "path"/"index"}
        self.model_name = model_name
        self.device = device              # passed to ultralytics: "0" / "cpu"
        self.device_label = device_label  # human label for the UI

        # Live-controllable state (guarded by _lock where mutated cross-thread).
        self._lock = threading.Lock()
        self.conf = 0.25
        self.paused = False
        self.stop_flag = False
        self._seek_to = None
        self.record = False

        # Observed state.
        self.cur_frame = 0
        self.total = 0
        self.src_fps = 0.0
        self.fps = 0.0
        self.detections = 0
        self.finished = False
        self.error = None

        # Latest annotated JPEG for the MJPEG stream.
        self._latest = None
        self._version = 0

        # Recording.
        self._writer = None
        self.output_path = None

        self._thread = threading.Thread(target=self._run, daemon=True)

    # ----------------------------------------------------------------- controls
    def start(self):
        self._thread.start()

    def set_conf(self, value: float):
        with self._lock:
            self.conf = max(0.01, min(0.99, float(value)))

    def set_paused(self, paused: bool):
        with self._lock:
            self.paused = bool(paused)

    def seek(self, frame_index: int):
        with self._lock:
            self._seek_to = max(0, int(frame_index))

    def set_record(self, on: bool):
        with self._lock:
            self.record = bool(on)

    def stop(self):
        self.stop_flag = True

    def get_frame(self):
        with self._lock:
            return self._latest, self._version

    def status(self) -> dict:
        with self._lock:
            return {
                "session_id": self.sid,
                "model_name": self.model_name,
                "device": self.device_label,
                "frame": self.cur_frame,
                "total": self.total,
                "fps": round(self.fps, 1),
                "detections": self.detections,
                "conf": round(self.conf, 2),
                "paused": self.paused,
                "finished": self.finished,
                "error": self.error,
                "is_stream": self.source.get("type") == "webcam",
                "recording": self.record and self._writer is not None,
                "has_output": bool(self.output_path and os.path.exists(self.output_path)),
            }

    # -------------------------------------------------------------------- worker
    def _open_capture(self):
        if self.source["type"] == "webcam":
            index = int(self.source.get("index", 0))
            # CAP_DSHOW avoids slow MSMF startup on Windows.
            cap = cv2.VideoCapture(index, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(index)
        else:
            cap = cv2.VideoCapture(self.source["path"])
        return cap

    def _ensure_writer(self, frame):
        if self._writer is not None:
            return
        out_dir = os.path.join(config.DATA_DIR, "inference")
        os.makedirs(out_dir, exist_ok=True)
        self.output_path = os.path.join(out_dir, f"{self.sid}.mp4")
        h, w = frame.shape[:2]
        fps = self.src_fps if self.src_fps and self.src_fps > 1 else 25.0
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        self._writer = cv2.VideoWriter(self.output_path, fourcc, fps, (w, h))

    def _close_writer(self):
        if self._writer is not None:
            try:
                self._writer.release()
            except Exception:
                pass
            self._writer = None

    def _run(self):
        try:
            from ultralytics import YOLO
            try:
                import torch  # noqa: F401
            except Exception:
                pass

            model = YOLO(self.model_path)
            cap = self._open_capture()
            if not cap or not cap.isOpened():
                self.error = "Не удалось открыть источник видео"
                self.finished = True
                return

            self.src_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
            if self.source["type"] != "webcam":
                self.total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

            t_prev = time.time()
            while not self.stop_flag:
                with self._lock:
                    paused = self.paused
                    seek_to = self._seek_to
                    self._seek_to = None
                    conf = self.conf
                    want_record = self.record

                if seek_to is not None and self.source["type"] != "webcam":
                    cap.set(cv2.CAP_PROP_POS_FRAMES, seek_to)
                    self.cur_frame = seek_to

                if paused:
                    time.sleep(0.03)
                    continue

                ret, frame = cap.read()
                if not ret:
                    if self.source["type"] == "webcam":
                        time.sleep(0.01)
                        continue
                    self.finished = True
                    break

                self.cur_frame = int(cap.get(cv2.CAP_PROP_POS_FRAMES) or (self.cur_frame + 1))

                results = model(frame, conf=conf, device=self.device, verbose=False)[0]
                det = 0
                if getattr(results, "obb", None) is not None and len(results.obb) > 0:
                    obb = results.obb
                    for i in range(len(obb.cls)):
                        cls_id = int(obb.cls[i])
                        c = float(obb.conf[i])
                        label = model.names.get(cls_id, f"cls_{cls_id}") if isinstance(model.names, dict) else str(cls_id)
                        cx, cy, w, h, ang = obb.xywhr[i].cpu().numpy()
                        _draw_obb(frame, cx, cy, w, h, math.degrees(ang), label, c, _class_color(cls_id))
                        det += 1
                elif getattr(results, "boxes", None) is not None and len(results.boxes) > 0:
                    # Segment models expose per-instance polygons in results.masks
                    # alongside boxes; draw the mask then the box+label on top.
                    masks_xy = None
                    masks = getattr(results, "masks", None)
                    if masks is not None and getattr(masks, "xy", None) is not None:
                        masks_xy = masks.xy
                    for i in range(len(results.boxes.cls)):
                        cls_id = int(results.boxes.cls[i])
                        c = float(results.boxes.conf[i])
                        label = model.names.get(cls_id, f"cls_{cls_id}") if isinstance(model.names, dict) else str(cls_id)
                        if masks_xy is not None and i < len(masks_xy):
                            _draw_mask(frame, masks_xy[i], _class_color(cls_id))
                        x1, y1, x2, y2 = results.boxes.xyxy[i].cpu().numpy()
                        _draw_box(frame, x1, y1, x2, y2, label, c, _class_color(cls_id))
                        det += 1

                now = time.time()
                inst_fps = 1.0 / max(1e-6, now - t_prev)
                t_prev = now
                self.fps = 0.8 * self.fps + 0.2 * inst_fps if self.fps else inst_fps
                self.detections = det

                hud = f"{self.cur_frame}" + (f"/{self.total}" if self.total else "") + f"  |  {self.fps:.0f} FPS  |  {self.device_label}"
                cv2.putText(frame, hud, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
                cv2.putText(frame, hud, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1)

                if want_record:
                    self._ensure_writer(frame)
                    if self._writer is not None:
                        self._writer.write(frame)
                elif self._writer is not None:
                    self._close_writer()

                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    with self._lock:
                        self._latest = buf.tobytes()
                        self._version += 1

            cap.release()
        except Exception as e:  # pragma: no cover - defensive
            self.error = str(e)
            self.finished = True
        finally:
            self._close_writer()


class InferenceService:
    def __init__(self):
        self.sessions: dict[str, InferenceSession] = {}
        self._cuda = None

    def cuda_available(self) -> bool:
        if self._cuda is None:
            try:
                import torch
                self._cuda = bool(torch.cuda.is_available())
            except Exception:
                self._cuda = False
        return self._cuda

    def _device(self):
        if self.cuda_available():
            try:
                import torch
                name = torch.cuda.get_device_name(0)
            except Exception:
                name = "CUDA"
            return "0", f"GPU · {name}"
        return "cpu", "CPU"

    def start(self, model_path: str, source: dict, model_name: str) -> InferenceSession:
        # Single active session: tear down anything still running.
        self.stop_all()
        device, device_label = self._device()
        sid = uuid.uuid4().hex
        sess = InferenceSession(sid, model_path, source, model_name, device, device_label)
        self.sessions[sid] = sess
        sess.start()
        return sess

    def get(self, sid: str) -> InferenceSession | None:
        return self.sessions.get(sid)

    def stop(self, sid: str) -> bool:
        sess = self.sessions.pop(sid, None)
        if not sess:
            return False
        sess.stop()
        return True

    def stop_all(self):
        for sid in list(self.sessions.keys()):
            self.stop(sid)


inference_service = InferenceService()
