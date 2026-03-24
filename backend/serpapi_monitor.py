"""API usage monitoring with daily summary and threshold alerts (SerpAPI / SearchApi.io)."""

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
_API_KEY = SERPAPI_KEY if _PROVIDER == "serpapi" else SEARCHAPI_KEY
SEARCHAPI_ACCOUNT_URL = "https://www.searchapi.io/api/v1/me"
SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json"
_PROVIDER_LABEL = "SerpAPI" if _PROVIDER == "serpapi" else "SearchApi.io"

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


def _normalize_account(raw: dict) -> dict:
    """Normalize account info from either provider into a common format."""
    if _PROVIDER == "serpapi":
        return {
            "remaining": raw.get("total_searches_left", 0),
            "monthly_limit": raw.get("searches_per_month", 100),
            "used": raw.get("this_month_usage", 0),
        }
    else:
        return {
            "remaining": raw.get("remaining_credits", 0),
            "monthly_limit": raw.get("monthly_allowance", 10000),
            "used": raw.get("current_month_usage", 0),
        }


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
                return _normalize_account(resp.json())
    except Exception as e:
        logger.warning("API account check failed (%s): %s", _PROVIDER, e)
    return None


def check_and_alert() -> None:
    """Check remaining searches and send Slack alert if below threshold."""
    account = check_account()
    if not account:
        return
    remaining = account["remaining"]
    monthly_limit = account["monthly_limit"]
    used = account["used"]

    with _lock:
        for threshold in ALERT_THRESHOLDS:
            if remaining <= threshold and threshold not in _alerted_thresholds:
                _alerted_thresholds.add(threshold)
                notify(
                    f"⚠️ {_PROVIDER_LABEL}残り{remaining}回 (月{monthly_limit}回中{used}回使用)\n"
                    f"閾値: {threshold}回を下回りました"
                )
                break


def send_daily_summary() -> None:
    """Send daily usage summary to Slack."""
    account = check_account()
    counts = get_daily_counts()
    total_today = sum(counts.values())

    if account:
        remaining = account["remaining"]
        monthly_limit = account["monthly_limit"]
        used = account["used"]
        summary = (
            f"📊 {_PROVIDER_LABEL}日次レポート\n"
            f"本日: flight {counts.get('flight', 0)}回, amazon {counts.get('amazon', 0)}回, maps {counts.get('maps', 0)}回 (計{total_today}回)\n"
            f"今月: {used}/{monthly_limit}回使用, 残り{remaining}回"
        )
    else:
        summary = (
            f"📊 {_PROVIDER_LABEL}日次レポート\n"
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
            logger.error("%s monitor error: %s", _PROVIDER_LABEL, e)
            time.sleep(3600)


def start_monitor() -> None:
    """Start the background monitoring thread."""
    if not _API_KEY:
        logger.info("%s monitor disabled (no API key)", _PROVIDER_LABEL)
        return
    # Pre-populate alerted thresholds so restart doesn't re-trigger alerts
    account = check_account()
    if account:
        remaining = account["remaining"]
        with _lock:
            for threshold in ALERT_THRESHOLDS:
                if remaining <= threshold:
                    _alerted_thresholds.add(threshold)
        logger.info("%s monitor: %d searches remaining, pre-set thresholds %s", _PROVIDER_LABEL, remaining, _alerted_thresholds)
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="api-monitor")
    t.start()
    logger.info("%s usage monitor started", _PROVIDER_LABEL)
