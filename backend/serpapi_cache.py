"""Simple in-memory TTL cache for SerpAPI results."""

import hashlib
import json
import logging
import time

logger = logging.getLogger(__name__)

_cache: dict[str, tuple[float, object]] = {}  # key -> (expiry_timestamp, value)
DEFAULT_TTL = 3 * 3600  # 3 hours


def _make_key(prefix: str, params: dict) -> str:
    raw = prefix + ":" + json.dumps(params, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def get(prefix: str, params: dict) -> object | None:
    key = _make_key(prefix, params)
    entry = _cache.get(key)
    if entry is None:
        return None
    expiry, value = entry
    if time.time() > expiry:
        del _cache[key]
        return None
    logger.info("SerpAPI cache hit: %s", prefix)
    return value


def put(prefix: str, params: dict, value: object, ttl: int = DEFAULT_TTL) -> None:
    key = _make_key(prefix, params)
    _cache[key] = (time.time() + ttl, value)
    # Lazy cleanup when cache grows large
    if len(_cache) > 200:
        now = time.time()
        expired = [k for k, (exp, _) in _cache.items() if now > exp]
        for k in expired:
            del _cache[k]
