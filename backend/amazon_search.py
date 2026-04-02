"""Amazon product search via Scrape.do Amazon API (primary) or SerpAPI (fallback)."""

import logging
import os

import httpx

from backend.serpapi_cache import get as cache_get, put as cache_put

logger = logging.getLogger(__name__)

# Scrape.do (primary)
SCRAPEDO_TOKEN = os.environ.get("SCRAPEDO_TOKEN", "")

# SerpAPI (fallback)
SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")


def is_available() -> bool:
    return bool(SCRAPEDO_TOKEN) or bool(SERPAPI_KEY)


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


async def _search_scrapedo(query: str, max_results: int) -> list[dict]:
    """Search Amazon.co.jp via Scrape.do Amazon API."""
    params = {
        "token": SCRAPEDO_TOKEN,
        "keyword": query,
        "geocode": "jp",
        "zipcode": "100-0001",
        "language": "JA",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get("https://api.scrape.do/plugin/amazon/search", params=params)
        resp.raise_for_status()
        data = resp.json()

    if data.get("status") != "success":
        raise ValueError(data.get("errorMessage", "Unknown error from Scrape.do"))

    raw_products = data.get("products", [])[:max_results]

    products = []
    for r in raw_products:
        price_data = r.get("price", {})
        price_str = f"¥{price_data['amount']:,}" if isinstance(price_data, dict) and price_data.get("amount") else "N/A"

        product = {
            "title": r.get("title", ""),
            "link": r.get("url", ""),
            "price": price_str,
            "rating": r.get("rating", {}).get("value") if isinstance(r.get("rating"), dict) else r.get("rating"),
            "reviews_count": r.get("reviewCount"),
            "asin": r.get("asin", ""),
        }
        products.append({k: v for k, v in product.items() if v is not None})

    return products


async def _search_serpapi(query: str, max_results: int) -> list[dict]:
    """Search Amazon.co.jp via SerpAPI (fallback)."""
    params = {
        "engine": "amazon",
        "amazon_domain": "amazon.co.jp",
        "k": query,
        "api_key": SERPAPI_KEY,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get("https://serpapi.com/search.json", params=params)
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

    return products


async def search_amazon(query: str, max_results: int = 3) -> list[dict]:
    """Search Amazon.co.jp and return product info. Scrape.do primary, SerpAPI fallback."""
    if not is_available():
        return [{"error": "Amazon search is not configured"}]

    max_results = max(1, min(5, max_results))

    cache_params = {"query": query, "max_results": max_results}
    cached = cache_get("amazon", cache_params)
    if cached is not None:
        return cached

    error_msg = f"amazon_product_search is temporarily unavailable. DO NOT tell the user the service is unavailable. Instead, use web search to find '{query}' on Amazon and present the results."

    # Try Scrape.do first
    if SCRAPEDO_TOKEN:
        try:
            products = await _search_scrapedo(query, max_results)
            if products:
                cache_put("amazon", cache_params, products, ttl=3600)
                return products
            logger.warning("Scrape.do returned no results for: %s", query)
        except httpx.TimeoutException:
            logger.warning("Scrape.do Amazon search timeout: %s", query)
        except Exception as e:
            logger.warning("Scrape.do Amazon search error: %s", e)

    # Fallback to SerpAPI
    if SERPAPI_KEY:
        try:
            products = await _search_serpapi(query, max_results)
            if products:
                cache_put("amazon", cache_params, products, ttl=3600)
                return products
            return [{"error": f"No products found for '{query}'"}]
        except httpx.TimeoutException:
            logger.warning("SerpAPI Amazon search timeout: %s", query)
            return [{"error": error_msg}]
        except Exception as e:
            logger.error("SerpAPI Amazon search error: %s", e)
            return [{"error": error_msg}]

    return [{"error": error_msg}]
