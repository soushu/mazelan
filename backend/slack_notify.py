"""Slack notification for operational events."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.environ.get("SLACK_OPS_WEBHOOK_URL", "")


def is_enabled() -> bool:
    return bool(SLACK_WEBHOOK_URL)


def notify(text: str) -> None:
    """Send a notification to Slack. Fire-and-forget, never raises."""
    if not SLACK_WEBHOOK_URL:
        return
    try:
        with httpx.Client(timeout=5.0) as client:
            client.post(SLACK_WEBHOOK_URL, json={"text": text})
    except Exception as e:
        logger.warning("Slack notification failed: %s", e)


def notify_new_user(email: str, auth_provider: str) -> None:
    """Notify when a new user registers."""
    provider_label = "Google" if auth_provider == "google" else "Email"
    notify(f"👤 新規ユーザー登録: {email} ({provider_label})")


def notify_error(endpoint: str, error: str) -> None:
    """Notify when a server error occurs."""
    notify(f"🚨 エラー: {endpoint} — {error[:200]}")
