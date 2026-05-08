from flask import Flask, Response, jsonify, send_from_directory, abort, request
from flask_cors import CORS
import threading
import time
import argparse
import yaml
import torch
import cv2
import numpy as np
import os
import json

# Import detection dependencies
from realtime_detection import DetectionPipeline, ThreadedCapture
from utils.logger import get_logger

logger = get_logger("flask_app")

app = Flask(__name__)
CORS(app)

latest_threats = []
threat_lock = threading.Lock()

class VideoGenerator:
    def __init__(self, cfg, device, args):
        self.pipeline = DetectionPipeline(cfg, device, dry_run=args.dry_run, skip_frames=args.skip_frames)
        cam_cfg = cfg["camera"]
        try:
            self.cap = ThreadedCapture(
                source=cam_cfg["source"],
                width=cam_cfg["width"],
                height=cam_cfg["height"],
                buffer_size=cam_cfg.get("buffer_size", 2),
            )
        except Exception as e:
            logger.error(f"Failed to start ThreadedCapture: {e}")
            self.cap = None
        self.fps_target = cam_cfg.get("fps_target", 30)
        self.frame_count = 0

    def generate(self):
        global latest_threats
        
        if self.cap is None:
            # Yield dummy frames if camera failed
            while True:
                blank_img = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(blank_img, "Camera Offline", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                ret, buffer = cv2.imencode('.jpg', blank_img)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                time.sleep(1)
        
        while True:
            t_start = time.perf_counter()
            ret, frame = self.cap.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue
            
            self.frame_count += 1
            annotated, threats = self.pipeline.process(frame)
            
            with threat_lock:
                latest_threats = threats
                
            ret, buffer = cv2.imencode('.jpg', annotated)
            frame_bytes = buffer.tobytes()
            
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                   
            ms_processing = (time.perf_counter() - t_start) * 1000
            target_ms = 1000.0 / self.fps_target
            sleep_ms = target_ms - ms_processing
            if sleep_ms > 1:
                time.sleep(sleep_ms / 1000.0)

video_generator = None

@app.route('/video_feed')
def video_feed():
    if video_generator is None:
        return "Generator not initialized", 500
    return Response(video_generator.generate(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/alerts/<path:filename>')
def serve_alert_screenshot(filename):
    # Serve screenshots saved under the configured alerts directory (default: "alerts")
    if video_generator is None:
        # fallback to default directory when generator not initialized
        screenshot_dir = "alerts"
    else:
        screenshot_dir = video_generator.pipeline.cfg.get("alerts", {}).get("screenshot_dir", "alerts")

    screenshot_dir = os.path.abspath(screenshot_dir)
    file_path = os.path.abspath(os.path.join(screenshot_dir, filename))
    if not file_path.startswith(screenshot_dir + os.sep):
        return abort(400)

    return send_from_directory(screenshot_dir, filename, as_attachment=False)

@app.route('/api/alerts')
def alerts():
    with threat_lock:
        # Return in-memory threats + recent history from JSONL (last 100)
        history = _read_jsonl_alerts(limit=100)
        # Merge: put in-memory threats first (they are the freshest)
        existing_ts = {t.get('timestamp') for t in latest_threats}
        merged = list(latest_threats) + [h for h in history if h.get('timestamp') not in existing_ts]
        return jsonify({"alerts": merged[:100]})

@app.route('/api/alerts/history')
def alerts_history():
    """Return all alerts from JSONL log (newest first). Optional ?limit=N query param."""
    limit = min(int(request.args.get('limit', 500)), 2000)
    alerts_list = _read_jsonl_alerts(limit=limit)
    return jsonify({"alerts": alerts_list, "total": len(alerts_list)})

@app.route('/api/captures/latest')
def captures_latest():
    """Return latest N alert screenshots metadata for dashboard display."""
    limit = min(int(request.args.get('limit', 12)), 50)
    alerts_list = _read_jsonl_alerts(limit=limit)
    return jsonify({"captures": alerts_list})

def _read_jsonl_alerts(limit=100):
    """Read alerts from JSONL log file, newest first."""
    if video_generator is not None:
        log_dir = video_generator.pipeline.cfg.get('alerts', {}).get('log_dir', 'logs')
    else:
        log_dir = 'logs'
    jsonl_path = os.path.join(os.path.abspath(log_dir), 'alerts.jsonl')
    if not os.path.exists(jsonl_path):
        return []
    lines = []
    try:
        with open(jsonl_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        lines.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    except Exception:
        return []
    # Newest first
    lines.reverse()
    return lines[:limit]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=None)
    parser.add_argument("--config", default="configs/detection_config.yaml")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-frames", type=int, default=3)
    parser.add_argument("--port", type=int, default=5001)
    args = parser.parse_args()
    
    with open(args.config, "r") as f:
        cfg = yaml.safe_load(f)
        
    if args.source is not None:
        src = args.source
        if src.isdigit(): src = int(src)
        cfg["camera"]["source"] = src
        
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Initializing VideoGenerator on device {device}...")
    video_generator = VideoGenerator(cfg, device, args)
    
    logger.info(f"Starting Flask server on port {args.port}...")
    app.run(host='0.0.0.0', port=args.port, threaded=True)
