"""Image search via DuckDuckGo (free, no API key required)."""

import logging

from backend.serpapi_cache import get as cache_get, put as cache_put

logger = logging.getLogger(__name__)


def is_available() -> bool:
    """Always available — no API key needed."""
    return True


IMAGE_SEARCH_TOOL = {
    "name": "image_search",
    "description": (
        "Search for images on the web and return image URLs. "
        "Use this when the user asks for images, screenshots, visual examples, or "
        "says '画像を見せて', '画像を探して', 'スクリーンショット', '写真', '画像検索'. "
        "IMPORTANT: After receiving the results, you MUST include each image in your text response "
        "using markdown image syntax: ![image title](image_url) — one per line. "
        "Also add a brief description of each image in Japanese."
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
    """Search for images using DuckDuckGo and return image URLs."""
    max_results = max(1, min(5, max_results))

    cache_params = {"query": query, "max_results": max_results}
    cached = cache_get("image", cache_params)
    if cached is not None:
        return cached

    try:
        # Try new package name first, fall back to old name
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS

        import asyncio
        # Run sync DDGS in thread to avoid blocking event loop
        def _search():
            with DDGS() as ddgs:
                return list(ddgs.images(query=query, max_results=max_results, safesearch="moderate"))

        results = await asyncio.to_thread(_search)

        if not results:
            return [{"error": f"No images found for '{query}'"}]

        images = []
        for r in results:
            image = {
                "title": r.get("title", ""),
                "image_url": r.get("image", ""),
                "thumbnail_url": r.get("thumbnail", ""),
                "source_url": r.get("url", ""),
            }
            images.append({k: v for k, v in image.items() if v})

        cache_put("image", cache_params, images, ttl=86400)  # 24h cache
        return images

    except ImportError:
        logger.error("ddgs/duckduckgo-search package not installed")
        return [{"error": "Image search is not available (ddgs package not installed). Install with: pip install ddgs"}]
    except Exception as e:
        err_str = repr(e).lower()
        if "ratelimit" in err_str or "429" in err_str or "403" in err_str:
            logger.warning("Image search rate limited: %s", query)
            return [{"error": "Image search is temporarily rate limited. Please try again in a moment."}]
        logger.error("Image search error: %s", repr(e))
        return [{"error": f"Image search failed: {repr(e)}"}]
