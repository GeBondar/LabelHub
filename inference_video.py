import cv2
import numpy as np
import math
from ultralytics import YOLO

MODEL_PATH = r"C:\Users\George\Documents\GitHub\battlebots_ai\data\projects\3\training\runs\run_20260614_040103\weights\best.pt"
VIDEO_PATH = r"C:\Users\George\Downloads\Telegram Desktop\2025-05-31 14-34-17-converted.mp4"

COLORS = {
    "blue_robot": (200, 80, 50),
    "red_robot": (50, 80, 220),
}

def draw_obb(frame, cx, cy, w, h, angle_deg, label, conf):
    color = COLORS.get(label, (0, 255, 0))
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    hw, hh = w / 2, h / 2
    corners = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]])
    rot = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
    corners = corners @ rot.T + np.array([cx, cy])
    corners = corners.astype(np.int32)
    cv2.polylines(frame, [corners], isClosed=True, color=color, thickness=2)

    front_x = int(cx + (w / 2 + 15) * cos_a)
    front_y = int(cy + (w / 2 + 15) * sin_a)
    cv2.arrowedLine(frame, (int(cx), int(cy)), (front_x, front_y), color, 3, tipLength=0.3)

    text = f"{label} {conf:.2f} {angle_deg:.0f}'"
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
    cv2.rectangle(frame, (int(cx) - tw // 2 - 4, int(cy - hh) - th - 12),
                  (int(cx) + tw // 2 + 4, int(cy - hh) - 2), color, -1)
    cv2.putText(frame, text, (int(cx) - tw // 2, int(cy - hh) - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

def main():
    model = YOLO(MODEL_PATH)
    cap = cv2.VideoCapture(VIDEO_PATH)
    if not cap.isOpened():
        print("Error: Cannot open video")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Video: {width}x{height} @ {fps:.1f} FPS, {total} frames")

    cv2.namedWindow("Battlebots - OBB Detection", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Battlebots - OBB Detection", 1280, 720)

    paused = False
    frame_idx = 0

    while True:
        if not paused:
            ret, frame = cap.read()
            if not ret:
                print("End of video")
                break
            frame_idx += 1

            results = model(frame, verbose=False)[0]

            if results.obb is not None:
                obb = results.obb
                for i in range(len(obb.cls)):
                    cls_id = int(obb.cls[i])
                    conf = float(obb.conf[i])
                    label = model.names.get(cls_id, f"cls_{cls_id}")
                    xywhr = obb.xywhr[i].cpu().numpy()
                    cx, cy, w, h, angle_rad = xywhr
                    angle_deg = math.degrees(angle_rad)
                    draw_obb(frame, cx, cy, w, h, angle_deg, label, conf)

            cv2.putText(frame, f"Frame: {frame_idx}/{total} | FPS: {fps:.0f}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

        cv2.imshow("Battlebots - OBB Detection", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break
        elif key == 32:
            paused = not paused
            print(f"{'Paused' if paused else 'Resumed'} at frame {frame_idx}")

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
