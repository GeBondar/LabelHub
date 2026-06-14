# BattleBots AI — Обзор алгоритмов поиска и сегментации объектов

## Задача

Два робота на плоской арене, камера сверху (вид в плане):

| Объект | Что известно | Что нужно найти |
|--------|-------------|-----------------|
| **Свой робот** | Форма, размер, цвет, текстура, CAD-модель | Положение (x, y) + угол поворота θ |
| **Чужой робот** | Ничего (произвольная форма/цвет) | Положение (x, y), без поворота |

Ограничения: реальное время (≥30 FPS), ноутбучный CPU (возможно с GPU), контролируемое освещение арены.

---

## Содержание

1. [Классические CV-методы](#1-классические-cv-методы-без-обучения)
2. [Глубокое обучение: детекция](#2-глубокое-обучение-детекция)
3. [Глубокое обучение: сегментация](#3-глубокое-обучение-сегментация)
4. [Оценка поворота (θ)](#4-оценка-поворота-θ)
5. [Oriented Object Detection — детекция с поворотом](#5-oriented-object-detection)
6. [Foundation-модели (zero-shot)](#6-foundation-модели-zero-shot)
7. [Трекинг (временная фильтрация)](#7-трекинг-временная-фильтрация)
8. [Бенчмарки и сравнение](#8-бенчмарки-и-сравнение)
9. [Практические рекомендации](#9-практические-рекомендации)

---

## 1. Классические CV-методы (без обучения)

### 1.1 Цветовая сегментация (HSV)

```
Frame → HSV-пространство → inRange(lower, upper) → бинарная маска
       → moments() → центроид (cx, cy)
       → центральные моменты (mu11, mu20, mu02) → угол главной оси
```

**Оценка угла через моменты изображения:**

```
angle = 0.5 * arctan2(2*mu11, mu20 - mu02)
```

Даёт угол главной оси эллипса инерции (±90°). Не различает перед/зад (180° ambiguity).

**Решение 180° неоднозначности:** разместить 2-3 цветовые метки на роботе (например, зелёная спереди, розовая сзади). Вектор между центроидами меток даёт точный поворот без неоднозначности.

| Характеристика | Значение |
|---------------|----------|
| Скорость | ~1 мс/кадр на CPU |
| Точность позиции | ±1-2 пикселя |
| Точность угла | ±3-5° (моменты), ±1° (две метки) |
| Сложность | Минимальная (20 строк кода) |
| GPU | Не нужен |
| Обучение | Не требуется |

**Проблемы:** чувствительность к освещению, пересечение цветов с чужим роботом, тени и блики.

**Вариант — Backprojection (CamShift):** вместо жёсткого порога — гистограмма цвета робота, `cv2.calcBackProject()` + `cv2.CamShift()`. Устойчивее к градиентам освещения.

### 1.2 Вычитание фона (Background Subtraction)

```
MOG2/KNN модель фона → apply(frame) → foreground mask
→ connectedComponentsWithStats() → фильтр по площади → центроид чужого робота
```

Идеально для обнаружения **любого** движущегося объекта без знания его внешности.

| Алгоритм | Скорость | Адаптация к освещению |
|----------|----------|----------------------|
| MOG2 | 3-5 мс | Да (learningRate) |
| KNN | 2-4 мс | Да |
| Frame differencing | <1 мс | Нет |

**Проблема:** неподвижный робот через ~30 секунд «врастает» в фон. Решения:
- Периодический сброс модели когда роботов нет в кадре
- Длинный `history` (500+ кадров)
- Комбинация с motion detection

### 1.3 Feature Matching (SIFT/ORB/AKAZE)

Имея эталонное изображение своего робота, ищем соответствия ключевых точек:

```
reference → detectAndCompute → keypoints_ref, descriptors_ref
frame    → detectAndCompute → keypoints_frame, descriptors_frame
→ knnMatch + ratio test (Lowe) → RANSAC → гомография H
→ позиция = H * center_ref, угол = atan2(H[1,0], H[0,0])
```

| Детектор | Скорость | Качество | Инвариантность к повороту |
|----------|----------|----------|--------------------------|
| **ORB** | 8-15 мс | Среднее | Да |
| **AKAZE** | 15-25 мс | Хорошее | Да |
| **SIFT** | 30-80 мс | Отличное | Да |
| **SuperPoint** | 15-30 мс (GPU) | Отличное | Да |

**Требование:** робот должен иметь текстуру (наклейки, болты, рёбра). Гладкий корпус даёт 0 ключевых точек.

### 1.4 Контурный анализ + Hu Moments

```
бинаризация (цвет/фон) → findContours → matchShapes(contour, ref_contour, I1)
→ Hu моменты инвариантны к повороту/масштабу/трансляции
```

**Для своего робота:** `matchShapes` с эталонным контуром даёт идентификацию + `minAreaRect(contour)` даёт угол.

**Для чужого робота:** любой блоб подходящей площади/компактности/соотношения сторон — кандидат.

| Характеристика | Значение |
|---------------|----------|
| Скорость | 2-5 мс |
| Инвариантность к повороту | Да (Hu moments по определению) |
| Точность угла (minAreaRect) | ±5-10° |

### 1.5 Template Matching с поворотом

**Наивный подход:** вращать шаблон с шагом ~2° (180 вариантов), для каждого — `cv2.matchTemplate()`. Слишком медленно (500+ мс).

**Fourier-Mellin Transform (log-polar + phase correlation):**

```
FFT(шаблон) → magnitude → log-polar → FFT
FFT(поиск)  → magnitude → log-polar → FFT
→ phase correlation в log-polar → угол θ + масштаб s
→ повернуть шаблон на θ → phase correlation в Cartesian → сдвиг (dx, dy)
```

Поворот в log-polar становится сдвигом — решается фазовой корреляцией. Точность ±1°, но чувствителен к окклюзиям и текстуре.

### 1.6 Оптический поток

Дополнительный сигнал: движущиеся пиксели = роботы. Полезно в комбинации с вычитанием фона (фон — для неподвижных, поток — для движущихся).

```
Farneback dense flow (20 мс) или Lucas-Kanade sparse (5 мс)
→ magnitude threshold → moving object mask
```

---

## 2. Глубокое обучение: детекция

### 2.1 Обычные детекторы (axis-aligned bounding boxes)

Дают только положение (cx, cy, w, h) — **без угла поворота**.

| Модель | mAP (COCO) | Скорость GPU | Скорость CPU (ONNX) | Размер |
|--------|-----------|-------------|---------------------|--------|
| **YOLOv8n** | 37.3 | 1.5 мс | 10 мс | 6 MB |
| **YOLOv8s** | 44.9 | 2.5 мс | 25 мс | 22 MB |
| **YOLOv11n** | ~38 | ~1 мс | 8-12 мс | 5 MB |
| **YOLO-NAS S** | ~47 | ~2 мс | ~20 мс | 24 MB |
| **RT-DETR** | ~53 | ~10 мс | ~80 мс | 40 MB |
| **Faster R-CNN** | ~37 | 50+ мс | 200+ мс | 500 MB |

**Для своего робота:** детекция YOLO → crop bounding box → классический метод для угла (minAreaRect, моменты, или отдельная CNN для угла).

**Для чужого робота:** одного класса `"robot"` достаточно. Данные: 200-500 изображений с разными роботами.

### 2.2 Двухэтапный подход: детекция + регрессия угла

```
YOLOv8 → bounding box → crop → EfficientNet/ResNet → (cx, cy, sin θ, cos θ)
```

Регрессия sin/cos вместо прямого угла решает проблему разрыва на ±π:

```python
loss = MSE(pred[:, :2], target[:, :2]) + λ * (1 - cos_sim(pred[:, 2:], target[:, 2:]))
```

---

## 3. Глубокое обучение: сегментация

### 3.1 Instance Segmentation (Mask R-CNN, YOLOv8-seg)

Дают бинарную маску на каждый объект. Из маски:
- Центроид: `moments(mask)` → (cx, cy)
- Угол: `minAreaRect(contour)` или PCA точек маски

| Модель | Скорость GPU | Точность |
|--------|-------------|----------|
| YOLOv8n-seg | 3-5 мс | Средняя |
| YOLOv8s-seg | 5-8 мс | Хорошая |
| Mask R-CNN | 30-50 мс | Отличная |
| YOLACT | 5-10 мс | Средняя |

**Недостаток:** разметка масок трудоёмка (попиксельно).

### 3.2 Semantic Segmentation (U-Net, DeepLabv3+)

Попиксельная классификация: `фон / свой_робот / чужой_робот`.

**Минус:** два чужих робота сливаются в одну маску (нет разделения экземпляров). Для 1vs1 приемлемо.

---

## 4. Оценка поворота (θ)

### 4.1 Методы на основе маски/контура

| Метод | Основан на | Диапазон | Неоднозначность | Точность |
|-------|-----------|----------|-----------------|----------|
| **Моменты изображения** | `mu11, mu20, mu02` | [-90°, 90°] | 180° | ±3-5° |
| **fitEllipse** | Контур | [0°, 180°] | 180° | ±3-5° |
| **minAreaRect** | Контур | [-90°, 0°] | 180° (90° для квадрата) | ±5-10° |
| **PCA контура** | Точки маски | [-180°, 180°] | 180° | ±2-3° |
| **Две цветовые метки** | Центроиды блобов | [0°, 360°] | Нет | ±1° |

### 4.2 Keypoint-based (по ключевым точкам)

Определяем N ключевых точек на роботе (углы корпуса, центр, метки). Модель предсказывает их 2D-координаты:

```
keypoints: [(x1, y1), ..., (xN, yN)]
→ позиция = mean(keypoints)
→ поворот = arctan2(y_front - y_rear, x_front - x_rear)
→ Kabsch algorithm для точного 2D rigid transform
```

| Модель | Тип | Точность угла |
|--------|-----|--------------|
| YOLOv8-pose | Детекция + точки | ±2-3° |
| HRNet | Только точки | ±1-2° |
| Custom keypoint CNN | Только точки | ±2-5° |

**Преимущество:** угол из нескольких точек стабильнее, чем один регрессированный угол (нет проблемы разрыва на ±π).

### 4.3 ArUco / AprilTag (эталонный метод)

Фидуциарные маркеры на корпусе робота — дают субградусную точность (±0.5°) и субпиксельную позицию через `solvePnP`. Идеально как baseline для сравнения.

```python
import cv2.aruco as aruco
corners, ids, _ = aruco.detectMarkers(frame, dictionary)
rvec, tvec, _ = aruco.estimatePoseSingleMarkers(corners, marker_size, K, dist)
```

---

## 5. Oriented Object Detection

Детекторы, предсказывающие **повёрнутый bounding box** (cx, cy, w, h, θ) напрямую.

### 5.1 YOLOv8-OBB

Расширение YOLOv8 с дополнительной головой для угла. Самое простое и быстрое решение:

```
Выход: (cx, cy, width, height, angle_radians, confidence, class)
```

- Угол через sin/cos кодирование (без разрыва на ±π)
- NMS для повёрнутых боксов (ProbIoU)
- Экспорт в ONNX/TensorRT

| Вариант | Параметры | ONNX размер | GPU | CPU |
|---------|----------|-------------|-----|-----|
| nano | 3.2M | 6 MB | 1.5 мс | 10 мс |
| small | 11.2M | 22 MB | 2.5 мс | 25 мс |

### 5.2 KLD Loss (Kullback-Leibler Divergence)

Повёрнутый бокс → 2D гауссово распределение. Функция потерь между гауссианами вместо прямого сравнения углов. Устраняет проблему разрыва на ±π гладко и дифференцируемо.

```
cx, cy, w, h, θ → Σ (2×2 ковариационная матрица)
loss = KL(N_gt || N_pred)
```

### 5.3 CSL (Circular Smooth Label)

Угол классифицируется на N бинов (180 или 360) с гауссовым сглаживанием метки с учётом зацикленности:
- Бин 179 (179°) и бин 0 (0°) — соседи
- Предсказание: argmax → угол

Убирает проблему разрыва, стабильнее прямой регрессии.

### 5.4 S2ANet (Single-Shot Alignment Network)

Feature Alignment: поворачивает свёрточную сетку по предсказанному углу бокса, извлекает признаки точно по ориентации объекта. Двухэтапная: Anchor Refinement → Alignment → Detection.

Точнее YOLOv8-OBB, но медленнее (~15 мс GPU) и сложнее в настройке.

### 5.5 Сравнение OBB-методов

| Модель | mAP (DOTA) | Скорость GPU | Сложность внедрения |
|--------|-----------|-------------|---------------------|
| **YOLOv8-OBB** | 76-80 | 1-6 мс | Низкая (ultralytics) |
| **Rotated FCOS** | 79-82 | 8-12 мс | Средняя (mmrotate) |
| **S2ANet** | 80-84 | 12-20 мс | Высокая (mmrotate) |
| **R3Det** | 81-85 | 15-25 мс | Высокая (mmrotate) |

---

## 6. Foundation-модели (zero-shot)

### 6.1 SAM / SAM2 (Segment Anything Model, Meta)

Сегментирует **любой** объект без обучения. Два режима:
- **Promptable:** пользователь указывает точку/бокс → маска этого объекта
- **Automatic:** сетка точек → все объекты в кадре

```python
from sam2.build_sam import build_sam2
predictor = SAM2ImagePredictor(build_sam2("sam2.1_hiera_l.yaml", "sam2.1_hiera_l.pt"))
predictor.set_image(frame)
masks, scores, _ = predictor.predict(point_coords=[[cx, cy]], point_labels=[1])
# из маски: centroid + PCA/minAreaRect для угла
```

| Вариант | Размер | GPU | CPU |
|---------|--------|-----|-----|
| SAM (ViT-H) | 2.4 GB | 50 мс | 2 сек |
| SAM2 (hiera-t) | 150 MB | 20 мс | 500 мс |
| MobileSAM | 40 MB | 10 мс | 200 мс |

**Вердикт:** SAM — мощный инструмент для разметки данных, но для real-time на CPU непригоден. На GPU SAM2-tiny может работать на 10-20 FPS.

### 6.2 Grounding DINO

Детекция по текстовому запросу: `"robot"`, `"battle robot with square chassis"`.

```
prompt: "robot . chassis . wheel"
→ bounding boxes (axis-aligned) + confidence
```

Не даёт поворот. Комбинация: Grounding DINO → crop → SAM2 → маска → угол.

Скорость: ~50-100 мс GPU, 500+ мс CPU. Не real-time на CPU.

### 6.3 OWL-ViT / Detic

Альтернативы Grounding DINO — open-vocabulary detection через CLIP. Аналогичная скорость и ограничения.

---

## 7. Трекинг (временная фильтрация)

Сглаживает шум детекций, предсказывает позицию при кратковременной окклюзии.

### 7.1 Kalman Filter

```
Состояние своего робота:    [x, y, vx, vy, θ, ω]  (6D)
Состояние чужого робота:    [x, y, vx, vy]        (4D)
```

- **Predict:** каждые Δt между кадрами
- **Update:** по измерениям детектора/сегментации
- Скорость: <0.1 мс

**Продвинутые варианты:**
- **EKF:** нелинейная модель движения (повороты робота)
- **UKF:** без вычисления якобианов, точнее EKF

### 7.2 SORT / DeepSORT / ByteTrack

| Трекер | ReID (переидентификация) | Скорость | Устойчивость к окклюзиям |
|--------|-------------------------|----------|-------------------------|
| **SORT** | Нет (только IoU) | <1 мс | Низкая |
| **DeepSORT** | Да (CNN-эмбеддинг) | ~5 мс | Средняя |
| **ByteTrack** | Нет (использует low-confidence детекции) | <1 мс | Высокая |

**ByteTrack** рекомендуется: ассоциирует ВСЕ детекции (даже низкоуверенные) с треками, не теряет объекты при перекрытии.

### 7.3 Оптический поток как трекер

Lucas-Kanade на ключевых точках робота → медианный сдвиг → Δx, Δy. Аффинное преобразование по точкам → Δθ. Накапливает дрейф — нужен периодический сброс по абсолютной детекции.

---

## 8. Бенчмарки и сравнение

### 8.1 Для своего робота (позиция + угол)

| Метод | FPS CPU | FPS GPU | Точность позиции | Точность угла | Обучение |
|-------|---------|---------|-----------------|---------------|----------|
| 2 цветовые метки + моменты | 200+ | — | ±1 px | ±1° | Нет |
| Feature matching (ORB) | 30-60 | — | ±2 px | ±2° | Нет |
| YOLOv8 + minAreaRect | 30 | 200+ | ±3 px | ±5° | 1 день |
| YOLOv8-pose (keypoints) | 20-30 | 200+ | ±2 px | ±2° | 2 дня |
| YOLOv8-OBB | 15-25 | 200+ | ±3 px | ±3° | 2-3 дня |
| SAM2-tiny + PCA | 2-5 | 20-50 | ±3 px | ±5° | Нет |

### 8.2 Для чужого робота (только позиция)

| Метод | FPS CPU | Точность | Обучение |
|-------|---------|----------|----------|
| MOG2 + контуры | 60+ | ±5 px | Нет |
| Motion detection + connected components | 60+ | ±5 px | Нет |
| YOLOv8n (класс "robot") | 30 | ±3 px | 1 день |
| Grounding DINO | 1-2 | ±3 px | Нет |
| SAM2 automatic + фильтрация | 2-5 | ±2 px | Нет |

### 8.3 Итоговый рейтинг архитектур

| Ранг | Подход | Кому |
|------|--------|------|
| **1** | **Классика: цветовые метки + MOG2 + Kalman** | Быстрый старт, нет GPU, сегодня |
| **2** | **Гибрид: YOLOv8 + классический угол** | Нужна робастность, CPU viable |
| **3** | **YOLOv8-OBB единая модель** | Лучшая точность, есть GPU |
| **4** | **Keypoints: YOLOv8-pose** | Нужна максимальная точность угла |
| **5** | **SAM2 zero-shot** | Прототипирование / разметка данных |

---

## 9. Практические рекомендации

### 9.1 Быстрый старт (1-2 дня)

1. **Разместить 2-3 цветовые метки** на своём роботе (неоновая изолента/наклейки разного цвета: красная спереди, синяя сзади)
2. **HSV-пороги** подобрать интерактивно (скрипт с трекбарами)
3. **MOG2 background subtractor** для чужого робота, сброс модели каждые 10 сек
4. **Kalman filter** на оба трека
5. **100 строк кода** на Python/OpenCV

### 9.2 Production-система (1-2 недели)

1. **Синтетические данные:** Blender/Unity — рендер 5000-10000 кадров с domain randomization (случайный пол, освещение, текстуры, ракурс)
2. **Разметка:** CVAT с SAM2-ассистентом или roLabelImg для OBB
3. **Модель:** YOLOv8n-OBB или YOLOv8s-OBB, две категории: `own_robot`, `opponent`
4. **Экспорт:** ONNX → ONNXRuntime (CPU) или TensorRT (GPU)
5. **Трекинг:** ByteTrack
6. **Фьюжн с датчиками:** EKF объединяет визуальную позу с IMU/одометрией из ELRS-телеметрии

### 9.3 Борьба с освещением

- Фиксировать auto-exposure и auto-white-balance камеры
- Светоотражающая лента + кольцевая подсветка вокруг камеры (как в motion capture)
- IR-светодиоды + IR-pass фильтр на камере (убирает ambient light)
- Для цветовой сегментации: калибровать HSV-пороги в начале каждого матча

### 9.4 Калибровка камеры

```
cv2.calibrateCamera() с шахматной доской → матрица камеры K, дисторсия
→ cv2.undistort() на каждом кадре → pixels-to-meters: разместить объект
   известного размера в арене, вычислить масштабный коэффициент px/m
```

### 9.5 Развёртывание

| Платформа | Инференс | YOLOv8n-OBB (640x640) |
|-----------|----------|----------------------|
| Ноутбучный CPU (i7) | ONNX Runtime | 10-15 мс |
| Ноутбучный GPU (RTX 3060+) | TensorRT | 1-3 мс |
| Intel iGPU | OpenVINO | 8-12 мс |
| Jetson Orin Nano | TensorRT | 3-5 мс |
| Raspberry Pi 5 | NCNN / TFLite | 30-50 мс (320x320) |

### 9.6 Структура кода (рекомендуемая)

```
LabelHub/
├── vision/
│   ├── detector.py         # YOLOv8-OBB / YOLOv8 inference
│   ├── classical.py        # HSV segmentation, MOG2, contour analysis
│   ├── rotation.py         # moments, minAreaRect, keypoint angle
│   ├── tracker.py          # Kalman filter, ByteTrack wrapper
│   ├── calibrate.py        # camera calibration, px-to-meters
│   └── config.yaml         # HSV ranges, model path, arena scale
├── control/
│   └── elrs_controller.py  # existing serial control
├── data/
│   ├── models/             # .pt, .onnx, .engine files
│   └── labels/             # training annotations
├── scripts/
│   ├── label_data.py       # semi-automatic labeling tool
│   ├── train.py            # YOLOv8 training script
│   └── generate_synthetic.py  # Blender/Unity rendering
└── requirements.txt
```

### 9.7 Ключевые Python-библиотеки

```
opencv-python>=4.8       # всё классическое CV
ultralytics>=8.2         # YOLOv8, YOLOv8-OBB, YOLOv8-pose
onnxruntime>=1.17        # инференс ONNX на CPU
numpy>=1.24              # матричные операции
filterpy>=1.4            # Kalman filter
deep-sort-realtime>=1.3  # DeepSORT (опционально)
sam2>=1.0                # SAM2 (опционально, для разметки)
```

---

## A. Приложение: быстрый прототип (классический подход)

```python
import cv2
import numpy as np

class RobotTracker:
    def __init__(self):
        # Свой робот: HSV-диапазоны для двух цветовых меток
        self.front_lower = np.array([35, 100, 100])   # зелёный
        self.front_upper = np.array([85, 255, 255])
        self.rear_lower  = np.array([160, 100, 100])  # розовый/красный
        self.rear_upper  = np.array([180, 255, 255])

        # Чужой робот: вычитание фона
        self.bg_sub = cv2.createBackgroundSubtractorMOG2(history=500,
                           detectShadows=False)

        # Фильтрация
        self.own_kf = KalmanFilter6D()   # x, y, vx, vy, theta, omega
        self.opp_kf = KalmanFilter4D()   # x, y, vx, vy

    def detect_own_robot(self, frame):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        # Передняя метка
        front_mask = cv2.inRange(hsv, self.front_lower, self.front_upper)
        front_pts = self._blob_centroid(front_mask)
        # Задняя метка
        rear_mask = cv2.inRange(hsv, self.rear_lower, self.rear_upper)
        rear_pts = self._blob_centroid(rear_mask)

        if front_pts is None or rear_pts is None:
            return None

        cx = (front_pts[0] + rear_pts[0]) / 2
        cy = (front_pts[1] + rear_pts[1]) / 2
        theta = np.arctan2(front_pts[1] - rear_pts[1],
                           front_pts[0] - rear_pts[0])
        return (cx, cy, theta)

    def detect_opponent(self, frame, own_mask):
        fg = self.bg_sub.apply(frame)
        # Исключаем своего робота
        fg[own_mask > 0] = 0
        # Морфология
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3,3)))
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5,5)))
        # Крупнейший блоб
        contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL,
                                        cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        largest = max(contours, key=cv2.contourArea)
        if cv2.contourArea(largest) < 200:  # фильтр шума
            return None
        M = cv2.moments(largest)
        return (M['m10']/M['m00'], M['m01']/M['m00'])

    def _blob_centroid(self, mask):
        M = cv2.moments(mask)
        if M['m00'] < 10:
            return None
        return (M['m10']/M['m00'], M['m01']/M['m00'])

    def process_frame(self, frame):
        own = self.detect_own_robot(frame)
        opp = self.detect_opponent(frame, own_mask)
        # Kalman update
        if own: own = self.own_kf.update(own)
        if opp: opp = self.opp_kf.update(opp)
        return own, opp
```

---

## B. Ссылки

- [Ultralytics YOLOv8-OBB](https://docs.ultralytics.com/tasks/obb/)
- [MMRotate](https://github.com/open-mmlab/mmrotate) — S2ANet, R3Det, Rotated FCOS
- [SAM2](https://github.com/facebookresearch/sam2)
- [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO)
- [ByteTrack](https://github.com/ifzhang/ByteTrack)
- [Kornia Feature Matching](https://kornia.readthedocs.io/en/latest/feature.html) — SuperPoint, LoFTR
- [CVAT](https://github.com/cvat-ai/cvat) — разметка данных
- [roLabelImg](https://github.com/roLabelImg/roLabelImg) — разметка повёрнутых боксов
