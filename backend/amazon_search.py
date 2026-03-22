"""Amazon product search via SerpAPI or SearchApi.io (switchable)."""

import logging
import os

import httpx

from backend.serpapi_cache import get as cache_get, put as cache_put

logger = logging.getLogger(__name__)

# Provider switch: "serpapi" (default) or "searchapi"
_PROVIDER = os.environ.get("FLIGHT_API_PROVIDER", "serpapi").lower()

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SEARCHAPI_KEY = os.environ.get("SEARCHAPI_KEY", "")

_API_KEY = SEARCHAPI_KEY if _PROVIDER == "searchapi" else SERPAPI_KEY
_API_BASE = "https://www.searchapi.io/api/v1/search" if _PROVIDER == "searchapi" else "https://serpapi.com/search.json"
_ENGINE = "amazon_search" if _PROVIDER == "searchapi" else "amazon"
_QUERY_PARAM = "q" if _PROVIDER == "searchapi" else "k"


def is_available() -> bool:
    return bool(_API_KEY)


# Tool definition for Claude function calling
AMAZON_SEARCH_TOOL = {
    "name": "amazon_product_search",
    "description": (
        "Search Amazon.co.jp for products. "
        "ONLY use this when the user EXPLICITLY asks to search for products with purchase links "
        "(e.g. 'Amazonで調べてリンク教えて'). "
        "Do NOT use for general product recommendations or advice."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords for Amazon products (e.g. 'noise cancelling headphones', 'travel backpack carry on')",
            },
            "max_results": {
                "type": "integer",
                "description": "Number of products to return (1-5)",
                "default": 3,
            },
        },
        "required": ["query"],
    },
}


async def search_amazon(query: str, max_results: int = 3) -> list[dict]:
    """Search Amazon.co.jp and return product info."""
    if not _API_KEY:
        return [{"error": "Amazon search is not configured"}]

    max_results = max(1, min(5, max_results))

    cache_params = {"query": query, "max_results": max_results}
    cached = cache_get("amazon", cache_params)
    if cached is not None:
        return cached

    params = {
        "engine": _ENGINE,
        "amazon_domain": "amazon.co.jp",
        _QUERY_PARAM: query,
        "api_key": _API_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(_API_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("organic_results", [])[:max_results]

        products = []
        for r in results:
            product = {
                "title": r.get("title", ""),
                "link": r.get("link", ""),
                "price": r.get("price", {}).get("raw", r.get("price", "N/A")) if isinstance(r.get("price"), dict) else r.get("price", "N/A"),
                "rating": r.get("rating"),
                "reviews_count": r.get("reviews", {}).get("total_reviews") if isinstance(r.get("reviews"), dict) else None,
                "asin": r.get("asin", ""),
            }
            products.append({k: v for k, v in product.items() if v is not None})

        if not products:
            return [{"error": f"No products found for '{query}'"}]

        cache_put("amazon", cache_params, products, ttl=3600)
        return products

    except httpx.TimeoutException:
        logger.warning("Amazon search timeout (%s): %s", _PROVIDER, query)
        return [{"error": f"amazon_product_search timed out. DO NOT tell the user the service is unavailable. Instead, use web search to find '{query}' on Amazon and present the results."}]
    except httpx.HTTPStatusError as e:
        logger.error("Amazon search HTTP %s (%s): %s", e.response.status_code, _PROVIDER, query)
        return [{"error": f"amazon_product_search is temporarily unavailable. DO NOT tell the user the service is unavailable. Instead, use web search to find '{query}' on Amazon and present the results."}]
    except Exception as e:
        logger.error("Amazon search error (%s): %s", _PROVIDER, e)
        return [{"error": f"amazon_product_search is temporarily unavailable. DO NOT tell the user the service is unavailable. Instead, use web search to find '{query}' on Amazon and present the results."}]
