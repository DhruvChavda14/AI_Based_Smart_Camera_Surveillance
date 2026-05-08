# utils/alert.py
"""
Alert system: debounce, terminal print, in-memory screenshot capture,
direct MongoDB ingest via Node.js, and email + SMS notifications.

Screenshots are encoded to JPEG bytes in memory and:
  1. POSTed to Node.js  → stored in MongoDB GridFS (no local disk)
  2. Attached to alert email (if email is configured)

Email/SMS credentials are read from model/.env:
  SENDER_EMAIL, EMAIL_PASSWORD, RECIPIENT_EMAIL
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, SMS_RECIPIENT_NUMBERS
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

# Load model/.env so email/SMS/API-key credentials are available
# without needing to export them in the shell manually.
try:
    from dotenv import load_dotenv as _load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    _load_dotenv(_env_path, override=False)  # override=False keeps shell exports winning
except ImportError:
    pass  # python-dotenv not installed — credentials must come from shell env

from utils.logger import get_logger, log_alert

logger = get_logger("alert")

_ALERT_HEADER = f"{Fore.RED}{Style.BRIGHT}"
_RESET = Style.RESET_ALL

# ── Node.js ingest config ─────────────────────────────────────────────────────
_NODE_SERVER_URL = os.environ.get("NODE_SERVER_URL", "http://localhost:5050")
_MODEL_API_KEY   = os.environ.get("MODEL_API_KEY", "")


def _send_to_server(alert_dict: dict, img_bytes: bytes) -> Optional[str]:
    """
    POST alert metadata + JPEG bytes (base64) to Node.js /api/alerts/ingest.
    Returns imageId string on success, else None.
    Non-blocking — always called from a background thread.
    """
    if not _MODEL_API_KEY:
        logger.warning(
            "[Alert] MODEL_API_KEY not set — skipping server ingest. "
            "Set MODEL_API_KEY env var to enable direct MongoDB storage."
        )
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
            logger.info(
                "[Alert] Ingested to MongoDB — alertId=%s imageId=%s",
                result.get("alertId"), image_id,
            )
            return image_id
    except urllib.error.HTTPError as e:
        logger.error("[Alert] Ingest HTTP %s: %s", e.code, e.read().decode("utf-8", errors="ignore"))
    except urllib.error.URLError as e:
        logger.error("[Alert] Ingest connection failed (Node.js offline?): %s", e.reason)
    except Exception as e:
        logger.error("[Alert] Ingest unexpected error: %s", e)
    return None


class ThreatAlert:
    """
    Manages threat alerts with:
    - Per-track debouncing
    - In-memory JPEG encoding (no local disk save)
    - Direct MongoDB storage via Node.js ingest API
    - Email notifications with screenshot attachment
    - SMS notifications via Twilio
    - Emergency contact display (police / fire department)
    - Consecutive-frame confirmation (false positive reduction)
    - Admin toggle to disable/enable auto alerts
    """

    def __init__(
        self,
        screenshot_dir: str = "alerts",   # legacy compat — not used for saving
        log_dir: str = "logs",
        debounce_seconds: float = 3.0,
        consecutive_required: int = 3,
        email_cfg: Optional[dict] = None,
        police_contact: Optional[dict] = None,
        fire_department: Optional[dict] = None,
        auto_alerts_enabled: bool = True,
    ):
        self.log_dir               = log_dir
        self.debounce_seconds      = debounce_seconds
        self.consecutive_required  = consecutive_required
        self.email_cfg             = email_cfg or {}
        self.police_contact        = police_contact or {}
        self.fire_department       = fire_department or {}
        self.auto_alerts_enabled   = auto_alerts_enabled

        os.makedirs(log_dir, exist_ok=True)

        # ── Email sender ──────────────────────────────────────────────────────
        self.email_sender = None
        if self.email_cfg.get("enabled", False):
            try:
                from utils.email_alert import EmailSender
                self.email_sender = EmailSender()
                if not self.email_sender.configured:
                    self.email_sender = None  # silently disable
            except Exception as e:
                logger.info("Email alerts not available: %s", e)

        # ── SMS sender ────────────────────────────────────────────────────────
        self.sms_sender = None
        try:
            from utils.sms_alert import SMSSender
            sms = SMSSender()
            if sms.configured:
                self.sms_sender = sms
        except Exception as e:
            logger.info("SMS alerts not available: %s", e)

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
        Call every frame when a threat is detected.
        Returns True if an alert was fired.
        """
        key   = f"{threat_type}_{track_id if track_id is not None else 'global'}"
        now   = time.time()
        state = self._state.setdefault(key, {"last_alert_time": 0, "consecutive": 0})

        state["consecutive"] += 1

        if state["consecutive"] >= self.consecutive_required:
            if (now - state["last_alert_time"]) >= self.debounce_seconds:
                state["last_alert_time"] = now
                state["consecutive"]     = 0
                self._fire_alert(threat_type, confidence, frame, track_id, bbox, extra)
                return True

        return False

    def reset(self, threat_type: str, track_id: Optional[int] = None) -> None:
        """Reset consecutive counter when threat disappears."""
        key = f"{threat_type}_{track_id if track_id is not None else 'global'}"
        if key in self._state:
            self._state[key]["consecutive"] = 0

    def reset_all(self) -> None:
        """Clear all state."""
        self._state.clear()

    def toggle_auto_alerts(self) -> bool:
        """Toggle automatic alerts (email/SMS) ON/OFF. Returns new state."""
        self.auto_alerts_enabled = not self.auto_alerts_enabled
        logger.info(
            "Auto alerts toggled: %s",
            "ENABLED" if self.auto_alerts_enabled else "DISABLED",
        )
        return self.auto_alerts_enabled

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
        ts_str    = timestamp.strftime("%Y%m%d_%H%M%S_%f")

        # 1. Terminal print
        print(
            f"\n{_ALERT_HEADER}"
            f"⚠  ALERT! {threat_type} DETECTED  "
            f"| Conf: {confidence:.2%}"
            f"| TrackID: {track_id}"
            f"| Time: {timestamp.strftime('%H:%M:%S')}"
            f"{_RESET}\n"
        )

        # 1b. Print nearest police station for gun/pistol
        if threat_type in ("PISTOL", "GUN") and self.police_contact:
            pc = self.police_contact
            print(
                f"{Fore.YELLOW}{Style.BRIGHT}"
                f"🚨 NEAREST POLICE STATION:\n"
                f"   Station : {pc.get('station_name', 'N/A')}\n"
                f"   Phone   : {pc.get('phone', 'N/A')}\n"
                f"   Emergency: {pc.get('emergency', '112')}\n"
                f"   Address : {pc.get('address', 'N/A')}"
                f"{_RESET}\n"
            )

        # 1c. Print nearest fire department for fire/smoke
        if threat_type in ("FIRE", "SMOKE") and self.fire_department:
            fd = self.fire_department
            print(
                f"{Fore.RED}{Style.BRIGHT}"
                f"🔥 NEAREST FIRE DEPARTMENT:\n"
                f"   Station : {fd.get('station_name', 'N/A')}\n"
                f"   Phone   : {fd.get('phone', 'N/A')}\n"
                f"   Emergency: {fd.get('emergency', '101')}\n"
                f"   Address : {fd.get('address', 'N/A')}"
                f"{_RESET}\n"
            )

        # 2. Annotate frame in memory (no disk write)
        annotated = frame.copy()
        if bbox is not None:
            x1, y1, x2, y2 = [int(v) for v in bbox]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 3)
        cv2.putText(
            annotated,
            f"ALERT: {threat_type} ({confidence:.0%})",
            (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2, cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA,
        )

        # 3. Encode JPEG in memory
        encode_ok, img_buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
        img_bytes = img_buf.tobytes() if encode_ok else None

        # 4. Build alert metadata
        filename = f"{ts_str}_{threat_type}_id{track_id}.jpg"
        event = {
            "timestamp":   timestamp.isoformat(),
            "threat_type": threat_type,
            "confidence":  round(float(confidence), 4),
            "track_id":    track_id,
            "bbox":        list(bbox) if bbox else None,
            "filename":    filename,
            **(extra or {}),
        }
        # Include emergency contacts in log for relevant threat types
        if threat_type in ("PISTOL", "GUN") and self.police_contact:
            event["police_contact"] = self.police_contact
        if threat_type in ("FIRE", "SMOKE") and self.fire_department:
            event["fire_department"] = self.fire_department

        # 5. JSONL audit log
        log_alert(event, log_dir=self.log_dir)

        logger.warning(
            "ALERT fired: %s | conf=%.2f | track=%s | sending to MongoDB",
            threat_type, confidence, track_id,
        )

        # 6. Async: send to MongoDB + send email + send SMS (all in parallel threads)
        target_threats = self.email_cfg.get("target_threats", [])
        send_notifications = (
            self.auto_alerts_enabled and threat_type in target_threats
        )

        pc = self.police_contact if threat_type in ("PISTOL", "GUN") else None
        fd = self.fire_department if threat_type in ("FIRE", "SMOKE") else None

        def _background():
            # 6a. MongoDB ingest
            _send_to_server(event, img_bytes)

            # 6b. Email alert (with screenshot bytes attached)
            if send_notifications and self.email_sender:
                self.email_sender.send_alert_async(
                    threat_type, float(confidence),
                    screenshot_bytes=img_bytes,
                    police_contact=pc,
                    fire_department=fd,
                )
            elif not self.auto_alerts_enabled:
                logger.info("Auto alerts DISABLED — skipping email for %s", threat_type)

            # 6c. SMS alert
            if send_notifications and self.sms_sender:
                self.sms_sender.send_alert_async(
                    threat_type, float(confidence),
                    police_contact=pc,
                    fire_department=fd,
                )
            elif not self.auto_alerts_enabled:
                logger.info("Auto alerts DISABLED — skipping SMS for %s", threat_type)

        threading.Thread(target=_background, daemon=True).start()
