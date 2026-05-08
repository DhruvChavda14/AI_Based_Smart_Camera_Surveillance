# utils/alert.py
"""
Alert system: debounce, terminal print, screenshot capture and direct
upload to MongoDB via the Node.js ingest API.

Screenshots are NO LONGER saved to local disk — they are encoded as
base64 and POSTed directly to the Node.js server, which stores them in
MongoDB GridFS.  The JSONL log is kept as a lightweight operational
audit trail (no file paths stored in it).
"""

import base64
import json as _json
import os
import time
import threading
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from colorama import Fore, Style

from utils.logger import get_logger, log_alert

logger = get_logger("alert")

# ANSI alert banner
_ALERT_HEADER = f"{Fore.RED}{Style.BRIGHT}"
_RESET = Style.RESET_ALL

# ── Node.js ingest endpoint config ───────────────────────────────────────────
_NODE_SERVER_URL = os.environ.get("NODE_SERVER_URL", "http://localhost:5050")
_MODEL_API_KEY   = os.environ.get("MODEL_API_KEY", "")


def _send_to_server(alert_dict: dict, img_bytes: bytes) -> Optional[str]:
    """
    POST alert metadata + JPEG bytes (base64-encoded) to the Node.js
    /api/alerts/ingest endpoint.

    Runs in a background thread so it never blocks the detection pipeline.

    Returns the imageId string if upload succeeded, else None.
    """
    if not _MODEL_API_KEY:
        logger.warning("[Alert] MODEL_API_KEY not set — skipping server ingest. "
                       "Set MODEL_API_KEY env var to enable direct MongoDB storage.")
        return None

    payload = {
        "alert": alert_dict,
        "image_b64": base64.b64encode(img_bytes).decode("utf-8") if img_bytes else None,
    }

    data = _json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{_NODE_SERVER_URL}/api/alerts/ingest",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-model-api-key": _MODEL_API_KEY,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            result = _json.loads(resp.read().decode("utf-8"))
            image_id = result.get("imageId")
            logger.info("[Alert] Ingested to MongoDB — alertId=%s imageId=%s",
                        result.get("alertId"), image_id)
            return image_id
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        logger.error("[Alert] Ingest HTTP %s: %s", e.code, body)
    except urllib.error.URLError as e:
        logger.error("[Alert] Ingest connection failed (Node.js offline?): %s", e.reason)
    except Exception as e:
        logger.error("[Alert] Ingest unexpected error: %s", e)
    return None


class ThreatAlert:
    """
    Manages threat alerts with:
    - Per-track debouncing (avoid spamming same alert)
    - Frame annotation with bbox + label overlay
    - Direct upload to MongoDB via Node.js ingest API (no local disk save)
    - Structured JSONL audit log
    - Consecutive-frame confirmation (false positive reduction)
    """

    def __init__(
        self,
        screenshot_dir: str = "alerts",   # kept for backward compat, no longer used for saving
        log_dir: str = "logs",
        debounce_seconds: float = 3.0,
        consecutive_required: int = 3,
    ):
        self.log_dir = log_dir
        self.debounce_seconds = debounce_seconds
        self.consecutive_required = consecutive_required

        # Only create the log dir (no screenshot dir needed)
        os.makedirs(log_dir, exist_ok=True)

        # track_id → {"last_alert_time": float, "consecutive": int}
        self._state: dict[str, dict] = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def update(
        self,
        threat_type: str,
        confidence: float,
        frame: np.ndarray,
        track_id: Optional[int] = None,
        bbox: Optional[tuple] = None,
        extra: Optional[dict] = None,
    ) -> bool:
        """
        Call every frame when a threat is detected.  Returns True if an alert
        was fired (after confirming consecutive frames and debounce).
        """
        key = f"{threat_type}_{track_id if track_id is not None else 'global'}"
        now = time.time()
        state = self._state.setdefault(key, {"last_alert_time": 0, "consecutive": 0})

        state["consecutive"] += 1

        if state["consecutive"] >= self.consecutive_required:
            if (now - state["last_alert_time"]) >= self.debounce_seconds:
                state["last_alert_time"] = now
                state["consecutive"] = 0
                self._fire_alert(threat_type, confidence, frame, track_id, bbox, extra)
                return True

        return False

    def reset(self, threat_type: str, track_id: Optional[int] = None) -> None:
        """Reset consecutive counter when threat disappears."""
        key = f"{threat_type}_{track_id if track_id is not None else 'global'}"
        if key in self._state:
            self._state[key]["consecutive"] = 0

    def reset_all(self) -> None:
        """Clear all state (call at start of new session)."""
        self._state.clear()

    # ── Private ───────────────────────────────────────────────────────────────

    def _fire_alert(
        self,
        threat_type: str,
        confidence: float,
        frame: np.ndarray,
        track_id: Optional[int],
        bbox: Optional[tuple],
        extra: Optional[dict],
    ) -> None:
        timestamp = datetime.now()
        ts_str = timestamp.strftime("%Y%m%d_%H%M%S_%f")

        # 1. Terminal print
        print(
            f"\n{_ALERT_HEADER}"
            f"⚠  ALERT! {threat_type} DETECTED  "
            f"| Conf: {confidence:.2%}"
            f"| TrackID: {track_id}"
            f"| Time: {timestamp.strftime('%H:%M:%S')}"
            f"{_RESET}\n"
        )

        # 2. Annotate frame (in memory — never written to disk)
        annotated = frame.copy()
        if bbox is not None:
            x1, y1, x2, y2 = [int(v) for v in bbox]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 3)
        cv2.putText(
            annotated,
            f"ALERT: {threat_type} ({confidence:.0%})",
            (10, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 0, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            (10, 70),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        # 3. Encode JPEG to bytes (in memory)
        encode_ok, img_buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
        img_bytes = img_buf.tobytes() if encode_ok else None

        # 4. Build alert metadata
        filename = f"{ts_str}_{threat_type}_id{track_id}.jpg"
        event = {
            "timestamp": timestamp.isoformat(),
            "threat_type": threat_type,
            "confidence": round(float(confidence), 4),
            "track_id": track_id,
            "bbox": list(bbox) if bbox else None,
            "filename": filename,          # for reference only — no local path
            **(extra or {}),
        }

        # 5. JSONL audit log (lightweight — no screenshot path, no image data)
        log_alert(event, log_dir=self.log_dir)

        # 6. Send alert + image to Node.js → MongoDB GridFS (non-blocking)
        def _ingest():
            _send_to_server(event, img_bytes)

        threading.Thread(target=_ingest, daemon=True).start()

        logger.warning(
            "ALERT fired: %s | conf=%.2f | track=%s | sending to MongoDB",
            threat_type,
            confidence,
            track_id,
        )
