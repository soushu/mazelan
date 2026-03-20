"""SerpAPI usage monitoring with daily summary and threshold alerts."""

import logging
import os
import threading
import time
from datetime import datetime, timezone

import httpx

from backend.slack_notify import notify

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json"

# In-memory daily counters (reset at midnight UTC)
_lock = threading.Lock()
_daily_counts: dict[str, int] = {"flight": 0, "amazon": 0, "maps": 0}
_daily_date: str = ""
_alerted_thresholds: set[int] = set()

ALERT_THRESHOLDS = [50, 20, 10]


def record_usage(tool_name: str) -> None:
    """Record a tool usage. Called from _execute_tool in providers.py."""
    global _daily_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        if _daily_date != today:
            _daily_counts.update({"flight": 0, "amazon": 0, "maps": 0})
            _daily_date = today
            _alerted_thresholds.clear()
        key = "flight" if "flight" in tool_name else "amazon" if "amazon" in tool_name else "maps"
        _daily_counts[key] = _daily_counts.get(key, 0) + 1


def get_daily_counts() -> dict[str, int]:
    """Get current daily usage counts."""
    with _lock:
        return dict(_daily_counts)


def check_account() -> dict | None:
    """Fetch SerpAPI account info."""
    if not SERPAPI_KEY:
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(SERPAPI_ACCOUNT_URL, params={"api_key": SERPAPI_KEY})
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning("SerpAPI account check failed: %s", e)
    return None


def check_and_alert() -> None:
    """Check remaining searches and send Slack alert if below threshold."""
    account = check_account()
    if not account:
        return
    remaining = account.get("total_searches_left", 0)
    monthly_limit = account.get("searches_per_month", 250)
    used = account.get("this_month_usage", 0)

    with _lock:
        for threshold in ALERT_THRESHOLDS:
            if remaining <= threshold and threshold not in _alerted_thresholds:
                _alerted_thresholds.add(threshold)
                notify(
                    f"⚠️ SerpAPI残り{remaining}回 (月{monthly_limit}回中{used}回使用)\n"
                    f"閾値: {threshold}回を下回りました"
                )
                break


def send_daily_summary() -> None:
    """Send daily usage summary to Slack."""
    account = check_account()
    counts = get_daily_counts()
    total_today = sum(counts.values())

    if account:
        remaining = account.get("total_searches_left", 0)
        monthly_limit = account.get("searches_per_month", 250)
        used = account.get("this_month_usage", 0)
        summary = (
            f"📊 SerpAPI日次レポート\n"
            f"本日: flight {counts.get('flight', 0)}回, amazon {counts.get('amazon', 0)}回, maps {counts.get('maps', 0)}回 (計{total_today}回)\n"
            f"今月: {used}/{monthly_limit}回使用, 残り{remaining}回"
        )
    else:
        summary = (
            f"📊 SerpAPI日次レポート\n"
            f"本日: flight {counts.get('flight', 0)}回, amazon {counts.get('amazon', 0)}回, maps {counts.get('maps', 0)}回 (計{total_today}回)\n"
            f"(アカウント情報取得失敗)"
        )
    notify(summary)


def _scheduler_loop() -> None:
    """Background thread: check thresholds hourly, send daily summary at 1:00 AM JST (16:00 UTC)."""
    last_summary_date = ""
    while True:
        try:
            now = datetime.now(timezone.utc)
            today = now.strftime("%Y-%m-%d")

            # Hourly threshold check
            check_and_alert()

            # Daily summary at 1:00 AM JST = 16:00 UTC
            if now.hour == 16 and last_summary_date != today:
                send_daily_summary()
                last_summary_date = today

            time.sleep(3600)  # Check every hour
        except Exception as e:
            logger.error("SerpAPI monitor error: %s", e)
            time.sleep(3600)


def start_monitor() -> None:
    """Start the background monitoring thread."""
    if not SERPAPI_KEY:
        logger.info("SerpAPI monitor disabled (no API key)")
        return
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="serpapi-monitor")
    t.start()
    logger.info("SerpAPI usage monitor started")
