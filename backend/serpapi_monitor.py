"""SearchApi.io usage monitoring with daily summary and threshold alerts."""

import logging
import os
import threading
import time
from datetime import datetime, timezone

import httpx

from backend.slack_notify import notify

logger = logging.getLogger(__name__)

_PROVIDER = os.environ.get("FLIGHT_API_PROVIDER", "serpapi").lower()
SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SEARCHAPI_KEY = os.environ.get("SEARCHAPI_KEY", "")
_API_KEY = SEARCHAPI_KEY if _PROVIDER == "searchapi" else SERPAPI_KEY
SEARCHAPI_ACCOUNT_URL = "https://www.searchapi.io/api/v1/me"
SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json"

# In-memory daily counters (reset at midnight UTC)
_lock = threading.Lock()
_daily_counts: dict[str, int] = {"flight": 0, "amazon": 0, "maps": 0}
_daily_date: str = ""
_alerted_thresholds: set[int] = set()

ALERT_THRESHOLDS = [500, 200, 100]


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
    """Fetch API account info."""
    if not _API_KEY:
        return None
    try:
        if _PROVIDER == "searchapi":
            url = SEARCHAPI_ACCOUNT_URL
        else:
            url = SERPAPI_ACCOUNT_URL
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, params={"api_key": _API_KEY})
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning("API account check failed (%s): %s", _PROVIDER, e)
    return None


def check_and_alert() -> None:
    """Check remaining searches and send Slack alert if below threshold."""
    account = check_account()
    if not account:
        return
    remaining = account.get("remaining_credits", 0)
    monthly_limit = account.get("monthly_allowance", 10000)
    used = account.get("current_month_usage", 0)

    with _lock:
        for threshold in ALERT_THRESHOLDS:
            if remaining <= threshold and threshold not in _alerted_thresholds:
                _alerted_thresholds.add(threshold)
                notify(
                    f"⚠️ SearchApi.io残り{remaining}回 (月{monthly_limit}回中{used}回使用)\n"
                    f"閾値: {threshold}回を下回りました"
                )
                break


def send_daily_summary() -> None:
    """Send daily usage summary to Slack."""
    account = check_account()
    counts = get_daily_counts()
    total_today = sum(counts.values())

    if account:
        remaining = account.get("remaining_credits", 0)
        monthly_limit = account.get("monthly_allowance", 10000)
        used = account.get("current_month_usage", 0)
        summary = (
            f"📊 SearchApi.io日次レポート\n"
            f"本日: flight {counts.get('flight', 0)}回, amazon {counts.get('amazon', 0)}回, maps {counts.get('maps', 0)}回 (計{total_today}回)\n"
            f"今月: {used}/{monthly_limit}回使用, 残り{remaining}回"
        )
    else:
        summary = (
            f"📊 SearchApi.io日次レポート\n"
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
            logger.error("SearchApi.io monitor error: %s", e)
            time.sleep(3600)


def start_monitor() -> None:
    """Start the background monitoring thread."""
    if not SEARCHAPI_KEY:
        logger.info("SearchApi.io monitor disabled (no API key)")
        return
    # Pre-populate alerted thresholds so restart doesn't re-trigger alerts
    account = check_account()
    if account:
        remaining = account.get("remaining_credits", 0)
        with _lock:
            for threshold in ALERT_THRESHOLDS:
                if remaining <= threshold:
                    _alerted_thresholds.add(threshold)
        logger.info("SearchApi.io monitor: %d searches remaining, pre-set thresholds %s", remaining, _alerted_thresholds)
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="searchapi-monitor")
    t.start()
    logger.info("SearchApi.io usage monitor started")
