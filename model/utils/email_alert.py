"""
Email Alert Module — sends threat notification emails via Gmail SMTP.
Reads credentials from environment variables (loaded in alert.py via dotenv).

Setup:
    1. Enable 2-Step Verification on your Gmail account
    2. Generate a 16-char App Password at myaccount.google.com → Security → App passwords
    3. Add to model/.env:
          SENDER_EMAIL=you@gmail.com
          EMAIL_PASSWORD=xxxx xxxx xxxx xxxx   (16-char App Password, spaces OK)
          RECIPIENT_EMAIL=security@yourorg.com,admin@yourorg.com
"""

import os
import smtplib
import threading
import time
from email.message import EmailMessage
from typing import Optional

from utils.logger import get_logger

logger = get_logger("email_alert")

EMAIL_COOLDOWN_SECONDS = 60  # Minimum seconds between emails for the same threat


class EmailSender:
    def __init__(self):
        self.sender     = os.getenv("SENDER_EMAIL", "")
        self.password   = os.getenv("EMAIL_PASSWORD", "")
        raw_recipients  = os.getenv("RECIPIENT_EMAIL", "")
        self.recipients = [e.strip() for e in raw_recipients.split(",") if e.strip()]

        self.configured = bool(self.sender and self.password and self.recipients)

        if self.configured:
            logger.info(
                "Email alerts configured — sender=%s, recipients=%d",
                self.sender, len(self.recipients),
            )
        else:
            logger.info(
                "Email alerts not configured "
                "(missing SENDER_EMAIL, EMAIL_PASSWORD, or RECIPIENT_EMAIL in .env)"
            )

        # Per-threat cooldown: threat_type → last_send_time
        self._last_send: dict[str, float] = {}
        self._lock = threading.Lock()

    def send_alert_async(
        self,
        threat_type: str,
        confidence: float,
        screenshot_bytes: Optional[bytes] = None,
        police_contact: Optional[dict] = None,
        fire_department: Optional[dict] = None,
    ):
        """Queue an email alert in a background thread (non-blocking)."""
        if not self.configured:
            return

        # Per-threat cooldown check (thread-safe)
        with self._lock:
            now = time.time()
            elapsed = now - self._last_send.get(threat_type, 0.0)
            if elapsed < EMAIL_COOLDOWN_SECONDS:
                logger.info(
                    "Email cooldown active — skipping %s alert (%.0fs remaining).",
                    threat_type, EMAIL_COOLDOWN_SECONDS - elapsed,
                )
                return
            self._last_send[threat_type] = now

        threading.Thread(
            target=self._send_email,
            args=(threat_type, confidence, screenshot_bytes, police_contact, fire_department),
            daemon=True,
        ).start()

    def _send_email(
        self,
        threat_type: str,
        confidence: float,
        screenshot_bytes: Optional[bytes],
        police_contact: Optional[dict],
        fire_department: Optional[dict],
    ):
        """Build and send the alert email."""
        try:
            msg = EmailMessage()

            # ── Subject ───────────────────────────────────────────────────────
            if threat_type in ("FIRE", "SMOKE"):
                subject = f"🔥 FIRE ALERT — {threat_type} detected ({confidence:.0%} confidence)"
            elif threat_type in ("PISTOL", "GUN", "KNIFE", "WEAPON"):
                subject = f"🚨 WEAPON ALERT — {threat_type} detected ({confidence:.0%} confidence)"
            else:
                subject = f"⚠️ SECURITY ALERT — {threat_type} detected ({confidence:.0%} confidence)"

            msg["Subject"] = subject
            msg["From"]    = self.sender
            msg["To"]      = ", ".join(self.recipients)

            # ── Plain-text body ───────────────────────────────────────────────
            body_lines = [
                "=" * 60,
                f"  SECURITY ALERT — {threat_type}",
                "=" * 60,
                "",
                f"  Threat Type : {threat_type}",
                f"  Confidence  : {confidence:.1%}",
                "",
            ]

            if threat_type in ("FIRE", "SMOKE") and fire_department:
                body_lines += [
                    "  🔥 NEAREST FIRE DEPARTMENT",
                    f"  Station  : {fire_department.get('station_name', 'N/A')}",
                    f"  Phone    : {fire_department.get('phone', 'N/A')}",
                    f"  Emergency: {fire_department.get('emergency', '101')}",
                    f"  Address  : {fire_department.get('address', 'N/A')}",
                    "",
                ]

            if threat_type in ("PISTOL", "GUN") and police_contact:
                body_lines += [
                    "  🚨 NEAREST POLICE STATION",
                    f"  Station  : {police_contact.get('station_name', 'N/A')}",
                    f"  Phone    : {police_contact.get('phone', 'N/A')}",
                    f"  Emergency: {police_contact.get('emergency', '112')}",
                    f"  Address  : {police_contact.get('address', 'N/A')}",
                    "",
                ]

            body_lines += [
                "  A screenshot is attached to this email.",
                "",
                "  — Security Monitoring System (Automated Alert)",
                "=" * 60,
            ]

            msg.set_content("\n".join(body_lines))

            # ── HTML body ─────────────────────────────────────────────────────
            emergency_html = ""
            if threat_type in ("FIRE", "SMOKE") and fire_department:
                emergency_html = f"""
                <div style="margin:16px 0;padding:12px;background:#fff3cd;border-left:4px solid #ff9800;border-radius:4px;">
                  <b>🔥 Nearest Fire Department</b><br>
                  {fire_department.get('station_name','')}<br>
                  Phone: {fire_department.get('phone','')}&nbsp;&nbsp;
                  Emergency: <b>{fire_department.get('emergency','101')}</b><br>
                  {fire_department.get('address','')}
                </div>"""
            elif threat_type in ("PISTOL", "GUN") and police_contact:
                emergency_html = f"""
                <div style="margin:16px 0;padding:12px;background:#fce4ec;border-left:4px solid #e53935;border-radius:4px;">
                  <b>🚨 Nearest Police Station</b><br>
                  {police_contact.get('station_name','')}<br>
                  Phone: {police_contact.get('phone','')}&nbsp;&nbsp;
                  Emergency: <b>{police_contact.get('emergency','112')}</b><br>
                  {police_contact.get('address','')}
                </div>"""

            header_color = "#c62828" if threat_type in ("FIRE","SMOKE","PISTOL","GUN","KNIFE") else "#e65100"
            msg.add_alternative(f"""
<html><body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:32px auto;">
  <tr><td style="background:{header_color};padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">⚠ SECURITY ALERT</h1>
    <p style="color:#ffcdd2;margin:8px 0 0;">Automated notification from your surveillance system</p>
  </td></tr>
  <tr><td style="background:#fff;padding:24px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.1);">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:8px 16px;background:#ffebee;border-radius:4px;">
          <b style="font-size:18px;color:#c62828;">{threat_type}</b>
        </td>
        <td style="padding:8px 16px;text-align:right;">
          Confidence: <b style="color:#e53935;">{confidence:.1%}</b>
        </td>
      </tr>
    </table>
    {emergency_html}
    <p style="color:#555;font-size:13px;margin-top:24px;">
      📸 A screenshot of the detected threat is attached.<br>
      Please review immediately and take appropriate action.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
    <p style="color:#9e9e9e;font-size:11px;text-align:center;">
      Security Monitoring System — Automated Alert
    </p>
  </td></tr>
</table>
</body></html>""", subtype="html")

            # ── Attach screenshot ─────────────────────────────────────────────
            if screenshot_bytes:
                msg.add_attachment(
                    screenshot_bytes,
                    maintype="image",
                    subtype="jpeg",
                    filename=f"alert_{threat_type.lower()}.jpg",
                )

            # ── Send via Gmail SMTP ───────────────────────────────────────────
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
                server.starttls()
                server.login(self.sender, self.password)
                server.send_message(msg)

            logger.info(
                "Email alert sent for %s to %d recipient(s).",
                threat_type, len(self.recipients),
            )

        except smtplib.SMTPAuthenticationError:
            logger.error(
                "Email auth failed — check SENDER_EMAIL and EMAIL_PASSWORD "
                "(must be a 16-char Gmail App Password)."
            )
        except Exception as e:
            logger.error("Email alert failed: %s", e)
