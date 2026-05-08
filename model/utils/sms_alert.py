"""
SMS/WhatsApp Alert Module — sends threat notifications via Twilio.

Sending strategy (tried in order):
  1. WhatsApp (via Twilio WhatsApp Sandbox) — works internationally for free
  2. SMS fallback — only works if your Twilio number supports international SMS

WhatsApp Sandbox Setup (one-time, 2 minutes):
  1. Each recipient must send the join message to the sandbox ONCE:
       Open WhatsApp → message  +1 415 523 8886
       Text exactly:  join <your-sandbox-keyword>
     (Find your keyword at console.twilio.com → Messaging → Try it out → Send a WhatsApp message)
  2. Add to model/.env:
       TWILIO_WHATSAPP_SANDBOX=whatsapp:+14155238886
       WHATSAPP_RECIPIENT_NUMBERS=+919301411981,+919876543210

SMS Setup (needs international-capable Twilio number):
  - Standard trial numbers are domestic (US) only
  - To send internationally, upgrade or buy an international number
  - Add to model/.env:
       TWILIO_PHONE_NUMBER=+12296586887
       SMS_RECIPIENT_NUMBERS=+919301411981
"""

import os
import time
import threading
from typing import Optional

from utils.logger import get_logger

logger = get_logger("sms_alert")

COOLDOWN_SECONDS = 60   # Min seconds between messages globally


class SMSSender:
    def __init__(self):
        self.account_sid  = os.getenv("TWILIO_ACCOUNT_SID", "")
        self.auth_token   = os.getenv("TWILIO_AUTH_TOKEN",  "")

        # ── WhatsApp (preferred — works internationally on trial) ─────────────
        self.whatsapp_from = os.getenv("TWILIO_WHATSAPP_SANDBOX", "whatsapp:+14155238886")
        raw_wa = os.getenv("WHATSAPP_RECIPIENT_NUMBERS", "")
        self.whatsapp_recipients = [n.strip() for n in raw_wa.split(",") if n.strip()]

        # ── SMS (fallback — needs international-capable Twilio number) ────────
        self.sms_from = os.getenv("TWILIO_PHONE_NUMBER", "")
        raw_sms = os.getenv("SMS_RECIPIENT_NUMBERS", "")
        self.sms_recipients = [n.strip() for n in raw_sms.split(",") if n.strip()]

        self.configured = False
        self.client     = None

        has_whatsapp = bool(self.account_sid and self.auth_token and self.whatsapp_recipients)
        has_sms      = bool(self.account_sid and self.auth_token and self.sms_from and self.sms_recipients)

        if has_whatsapp or has_sms:
            try:
                from twilio.rest import Client
                self.client     = Client(self.account_sid, self.auth_token)
                self.configured = True
                if has_whatsapp:
                    logger.info(
                        "WhatsApp alerts configured — %d recipient(s). "
                        "Recipients must join the sandbox first (see sms_alert.py docstring).",
                        len(self.whatsapp_recipients),
                    )
                if has_sms:
                    logger.info(
                        "SMS alerts configured — %d recipient(s).",
                        len(self.sms_recipients),
                    )
            except ImportError:
                logger.warning("twilio not installed — run: pip3 install twilio")
            except Exception as e:
                logger.warning("Twilio init failed: %s", e)
        else:
            logger.info(
                "Twilio not configured. Add TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN and either "
                "WHATSAPP_RECIPIENT_NUMBERS (recommended) or SMS_RECIPIENT_NUMBERS to model/.env"
            )

        self._last_send_time: float = 0.0
        self._lock = threading.Lock()

    def send_alert_async(
        self,
        threat_type: str,
        confidence: float,
        police_contact: Optional[dict] = None,
        fire_department: Optional[dict] = None,
    ):
        """Queue alert in a background thread (non-blocking)."""
        if not self.configured:
            return

        with self._lock:
            now     = time.time()
            elapsed = now - self._last_send_time
            if elapsed < COOLDOWN_SECONDS:
                logger.info(
                    "Message cooldown active — skipping %s (%.0fs remaining).",
                    threat_type, COOLDOWN_SECONDS - elapsed,
                )
                return
            self._last_send_time = now

        threading.Thread(
            target=self._send_all,
            args=(threat_type, confidence, police_contact, fire_department),
            daemon=True,
        ).start()

    def _build_body(
        self,
        threat_type: str,
        confidence: float,
        police_contact: Optional[dict],
        fire_department: Optional[dict],
    ) -> str:
        body = (
            f"🚨 SECURITY ALERT 🚨\n"
            f"Threat    : {threat_type}\n"
            f"Confidence: {confidence:.1%}\n"
        )
        if threat_type in ("FIRE", "SMOKE") and fire_department:
            body += (
                f"\n🔥 FIRE DEPT:\n"
                f"  {fire_department.get('station_name', 'N/A')}\n"
                f"  Phone    : {fire_department.get('phone', 'N/A')}\n"
                f"  Emergency: {fire_department.get('emergency', '101')}\n"
            )
        elif threat_type in ("PISTOL", "GUN") and police_contact:
            body += (
                f"\n🚔 POLICE:\n"
                f"  {police_contact.get('station_name', 'N/A')}\n"
                f"  Phone    : {police_contact.get('phone', 'N/A')}\n"
                f"  Emergency: {police_contact.get('emergency', '112')}\n"
            )
        body += "\nTake immediate action!"
        return body

    def _send_all(
        self,
        threat_type: str,
        confidence: float,
        police_contact: Optional[dict],
        fire_department: Optional[dict],
    ):
        body = self._build_body(threat_type, confidence, police_contact, fire_department)

        # 1. WhatsApp (international, works on trial)
        if self.whatsapp_recipients:
            for number in self.whatsapp_recipients:
                to = f"whatsapp:{number}" if not number.startswith("whatsapp:") else number
                try:
                    msg = self.client.messages.create(
                        body=body,
                        from_=self.whatsapp_from,
                        to=to,
                    )
                    logger.info("WhatsApp sent to %s for %s (SID: %s)", number, threat_type, msg.sid)
                except Exception as e:
                    err = str(e)
                    if "not joined" in err.lower() or "sandbox" in err.lower() or "63016" in err:
                        logger.error(
                            "WhatsApp to %s failed — recipient hasn't joined the sandbox. "
                            "Ask them to WhatsApp '+1 415 523 8886' with your sandbox join keyword.",
                            number,
                        )
                    else:
                        logger.error("WhatsApp to %s failed: %s", number, e)

        # 2. SMS fallback (domestic or international if number supports it)
        if self.sms_recipients and self.sms_from:
            for number in self.sms_recipients:
                try:
                    msg = self.client.messages.create(
                        body=body,
                        from_=self.sms_from,
                        to=number,
                    )
                    logger.info("SMS sent to %s for %s (SID: %s)", number, threat_type, msg.sid)
                except Exception as e:
                    err = str(e)
                    if "unverified" in err.lower():
                        logger.error(
                            "SMS to %s failed — trial accounts need verified numbers. "
                            "Verify at: twilio.com/console/phone-numbers/verified",
                            number,
                        )
                    elif "domestic" in err.lower() or "geo" in err.lower() or "21408" in err:
                        logger.error(
                            "SMS to %s failed — your Twilio number (+%s) is domestic-only "
                            "and cannot send to international numbers. "
                            "Use WhatsApp instead (WHATSAPP_RECIPIENT_NUMBERS in model/.env).",
                            number, self.sms_from,
                        )
                    else:
                        logger.error("SMS to %s failed: %s", number, e)
