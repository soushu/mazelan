"""Google Maps place verification via SerpAPI.

Used to verify business status (open/closed) and get current info
before recommending places to users.
"""

import logging
import os

import httpx

from backend.serpapi_cache import get as cache_get, put as cache_put

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SERPAPI_BASE = "https://serpapi.com/search.json"


def is_available() -> bool:
    return bool(SERPAPI_KEY)


MAPS_SEARCH_TOOL = {
    "name": "google_maps_search",
    "description": (
        "Search Google Maps for a place/business to verify it is currently open and get details. "
        "Use this AFTER finding candidate places via web search, to verify they are still operating. "
        "Do NOT use this for general place discovery — use web search first, then verify with this tool."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Place name and location (e.g. 'Café de Flore Paris', '一蘭 博多本店')",
            },
        },
        "required": ["query"],
    },
}


async def search_maps(query: str) -> list[dict]:
    """Search Google Maps via SerpAPI and return place info."""
    if not SERPAPI_KEY:
        return [{"error": "Google Maps search is not configured"}]

    cache_params = {"query": query}
    cached = cache_get("maps", cache_params)
    if cached is not None:
        return cached

    params = {
        "engine": "google_maps",
        "q": query,
        "hl": "ja",
        "api_key": SERPAPI_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(SERPAPI_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("local_results", [])[:1]

        if not results:
            return [{"not_found": True, "query": query}]

        r = results[0]
        place = {
            "name": r.get("title", ""),
            "address": r.get("address", ""),
            "rating": r.get("rating"),
            "reviews": r.get("reviews"),
            "type": r.get("type", ""),
            "open_now": r.get("open_state", ""),
            "hours": r.get("hours", ""),
            "phone": r.get("phone", ""),
            "website": r.get("website", ""),
            "maps_link": r.get("link", ""),
            "permanently_closed": "permanently closed" in (r.get("open_state", "") or "").lower()
                or "閉業" in (r.get("open_state", "") or ""),
        }
        result = [{k: v for k, v in place.items() if v is not None and v != ""}]

        cache_put("maps", cache_params, result, ttl=1209600)  # 2 week cache
        return result

    except httpx.TimeoutException:
        logger.warning("Google Maps search timeout: %s", query)
        return [{"error": "Google Maps search timed out"}]
    except httpx.HTTPStatusError as e:
        logger.error("Google Maps HTTP %s: %s", e.response.status_code, query)
        return [{"error": "Google Maps search temporarily unavailable"}]
    except Exception as e:
        logger.error("Google Maps error: %s", repr(e))
        return [{"error": "Google Maps search temporarily unavailable"}]
