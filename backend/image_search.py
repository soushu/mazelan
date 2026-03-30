"""Google Image Search via Custom Search JSON API (free: 100 queries/day)."""

import logging
import os

import httpx

from backend.serpapi_cache import get as cache_get, put as cache_put

logger = logging.getLogger(__name__)

# Google Custom Search API
_API_KEY = os.environ.get("GOOGLE_CSE_API_KEY", "")
_CSE_CX = os.environ.get("GOOGLE_CSE_CX", "")


def is_available() -> bool:
    return bool(_API_KEY and _CSE_CX)


IMAGE_SEARCH_TOOL = {
    "name": "image_search",
    "description": (
        "Search Google Images and return image URLs. "
        "Use this when the user asks for images, screenshots, visual examples, or "
        "says '画像を見せて', '画像を探して', 'スクリーンショット', '写真', '画像検索'. "
        "Returns image URLs that you should embed in your response using markdown: ![description](url)"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords for images (e.g. 'フォートナイト ギャラリー 保存場所', 'バンコク ワットアルン')",
            },
            "max_results": {
                "type": "integer",
                "description": "Number of images to return (1-5)",
                "default": 3,
            },
        },
        "required": ["query"],
    },
}


async def search_images(query: str, max_results: int = 3) -> list[dict]:
    """Search Google Images and return image URLs."""
    if not _API_KEY or not _CSE_CX:
        return [{"error": "Image search is not configured (GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX not set)"}]

    max_results = max(1, min(5, max_results))

    cache_params = {"query": query, "max_results": max_results}
    cached = cache_get("image", cache_params)
    if cached is not None:
        return cached

    params = {
        "key": _API_KEY,
        "cx": _CSE_CX,
        "q": query,
        "searchType": "image",
        "num": max_results,
        "safe": "active",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://www.googleapis.com/customsearch/v1", params=params)
            resp.raise_for_status()
            data = resp.json()

        items = data.get("items", [])[:max_results]

        images = []
        for item in items:
            image = {
                "title": item.get("title", ""),
                "image_url": item.get("link", ""),
                "thumbnail_url": item.get("image", {}).get("thumbnailLink", ""),
                "source_url": item.get("image", {}).get("contextLink", ""),
                "width": item.get("image", {}).get("width"),
                "height": item.get("image", {}).get("height"),
            }
            images.append({k: v for k, v in image.items() if v is not None})

        if not images:
            return [{"error": f"No images found for '{query}'"}]

        cache_put("image", cache_params, images, ttl=86400)  # 24h cache
        return images

    except httpx.TimeoutException:
        logger.warning("Image search timeout: %s", query)
        return [{"error": "Image search timed out"}]
    except httpx.HTTPStatusError as e:
        logger.error("Image search HTTP %s: %s", e.response.status_code, query)
        if e.response.status_code == 429:
            return [{"error": "Image search daily quota exceeded (100/day)"}]
        return [{"error": f"Image search error: HTTP {e.response.status_code}"}]
    except Exception as e:
        logger.error("Image search error: %s", e)
        return [{"error": f"Image search failed: {repr(e)}"}]
