"""Email sending via Resend API."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "noreply@mazelan.ai")


def is_enabled() -> bool:
    return bool(RESEND_API_KEY)


def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email via Resend API. Returns True on success."""
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set, skipping email to %s", to)
        return False
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={
                    "from": f"Mazelan <{FROM_EMAIL}>",
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
            if resp.status_code >= 400:
                logger.error("Resend API error %s: %s", resp.status_code, resp.text[:200])
                return False
            return True
    except Exception as e:
        logger.error("Email send failed: %s", e)
        return False


def send_password_reset(to: str, reset_url: str) -> bool:
    """Send password reset email."""
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #0369A1;">Mazelan</h2>
        <p>パスワードリセットのリクエストを受け付けました。</p>
        <p>以下のリンクをクリックして新しいパスワードを設定してください：</p>
        <a href="{reset_url}" style="display: inline-block; background: #0369A1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0;">パスワードをリセット</a>
        <p style="color: #666; font-size: 14px;">このリンクは1時間で有効期限が切れます。</p>
        <p style="color: #666; font-size: 14px;">このリクエストに心当たりがない場合は、このメールを無視してください。</p>
    </div>
    """
    return send_email(to, "パスワードリセット — Mazelan", html)
