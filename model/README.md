# Real-Time Unusual Activity Detection System

> **Production-level** Python project for detecting fire, weapons, and suspicious human activity in real time from webcam or CCTV streams using deep learning.

---

## 🎯 What It Detects

| Threat | Model | Classes |
|--------|-------|---------|
| Fire / Smoke | YOLOv8m (fine-tuned) | `fire`, `smoke` |
| Weapons | YOLOv8m (fine-tuned) | `pistol`, `knife` |
| Suspicious Activity | CNN + LSTM | `running_panic`, `violence`, `suspicious` |

The system also checks **fire/weapon proximity to humans** and triggers location-aware alerts.

---

## 📁 Project Structure

```
model/
├── configs/
│   └── detection_config.yaml     ← All thresholds and model paths
├── utils/
│   ├── __init__.py
│   ├── logger.py                 ← Rotating file + colored console logging
│   ├── alert.py                  ← Debounced alert engine + screenshot saving
│   ├── tracker.py                ← ByteTrack wrapper with per-track buffers
│   ├── visualizer.py             ← Bounding box drawing + OSD overlays
│   └── iou.py                    ← Bounding box geometry helpers
├── models/                       ← Pre-trained weights (ready to use)
│   ├── fire_detector.pt
│   ├── weapon_detector.pt
│   └── activity_classifier.pt
├── alerts/                       ← Saved screenshots of threat frames
├── logs/                         ← detections.log + alerts.jsonl
├── app.py                        ← Flask API server (video feed + alerts)
├── realtime_detection.py         ← Core detection pipeline
└── requirements.txt
```

---

## ⚙️ Setup

### 1. Prerequisites

- **Python 3.10+**
- **CUDA-capable GPU** (strongly recommended; RTX 3060+ for real-time performance)
- **CUDA 11.8 or 12.x** installed ([cuda downloads](https://developer.nvidia.com/cuda-downloads))

### 2. Create Virtual Environment

```bash
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

For GPU PyTorch (if not installed correctly):
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

---

## 🎬 Real-Time Detection

> **Pre-trained models are included in `models/`.** No training or dataset download required.

```bash
# Webcam (default)
python realtime_detection.py

# Explicit webcam index
python realtime_detection.py --source 0

# RTSP stream (CCTV camera)
python realtime_detection.py --source "rtsp://admin:password@192.168.1.100:554/stream"

# Video file
python realtime_detection.py --source path/to/video.mp4

# Test camera only (no models loaded)
python realtime_detection.py --dry-run
```

**Controls:**
- Press `Q` or `ESC` to quit

---

## 🌐 Flask API Server

Start the API server to stream video and receive alert data over HTTP:

```bash
python app.py
# With custom source:
python app.py --source 0 --port 5001
```

| Endpoint | Description |
|----------|-------------|
| `GET /video_feed` | MJPEG annotated live stream |
| `GET /api/alerts` | JSON list of active threats |

---

## 🚨 Alert System

When a threat is detected:

1. **Terminal**: Red colored `⚠ ALERT!` message with threat type, confidence, and track ID
2. **Bounding box**: Color-coded box with label + confidence on the live feed  
3. **Red banner**: Full-width alert banner across the top of the frame
4. **Screenshot**: Annotated frame saved to `alerts/YYYYMMDD_HHMMSS_THREATTYPE_idN.jpg`
5. **JSON log**: Structured event appended to `logs/alerts.jsonl`

**False positive reduction:**
- Threats must be detected in **2 consecutive frames** before alert fires
- Repeat alerts for the same track suppressed for **3 seconds** (debounce)

---

## ⚡ Performance Tuning

| Setting | File | Key |
|---------|------|-----|
| Confidence thresholds | `configs/detection_config.yaml` | `models.<name>.conf_threshold` |
| NMS IoU threshold | `configs/detection_config.yaml` | `models.<name>.iou_threshold` |
| Consecutive frames required | `configs/detection_config.yaml` | `alerts.consecutive_frames_required` |
| Alert debounce time | `configs/detection_config.yaml` | `alerts.debounce_seconds` |
| Person box expansion | `configs/detection_config.yaml` | `overlap.person_box_expand_factor` |
| Target FPS | `configs/detection_config.yaml` | `camera.fps_target` |

---

## 📊 Model Architecture Summary

### Fire & Weapon Detectors
- **Base**: YOLOv8m (pretrained on COCO 80 classes)
- **Fine-tuned head**: 2 custom classes each
- **Augmentation**: Mosaic, MixUp, Copy-Paste, HSV jitter, flips, scale, shear
- **Training**: AdamW + cosine LR + early stopping

### Activity Classifier
- **CNN backbone**: MobileNetV3-Small (ImageNet pretrained, 576-dim features)
- **Sequence model**: Bidirectional LSTM (2 layers, 256 hidden)
- **Input**: 16-frame sequence of 112×112 person crops
- **Classes**: `normal` | `running_panic` | `violence` | `suspicious`
- **Training**: Two-phase (frozen backbone warmup → full fine-tune), AMP, gradient clipping

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| `CUDA out of memory` | Reduce `--skip-frames` or switch to YOLOv8n |
| `Cannot open video source: 0` | Check webcam drivers; try `--source 1` |
| `Fire weights not found` | Ensure `models/fire_detector.pt` exists |
| `Weapon weights not found` | Ensure `models/weapon_detector.pt` exists |
| `Activity model weights not found` | Ensure `models/activity_classifier.pt` exists |
| Low FPS (< 15) | Lower `camera.fps_target` in config, or increase `--skip-frames` |

---

## 📋 Requirements Summary

```
torch >= 2.1.0          (with CUDA for GPU)
ultralytics >= 8.1.0    (YOLOv8 + ByteTrack)
opencv-python >= 4.9.0
torchvision >= 0.16.0
flask >= 3.0.0          (API server)
```

---

## 📜 License

This project is for educational and research purposes. Ensure compliance with local laws when deploying surveillance systems.
