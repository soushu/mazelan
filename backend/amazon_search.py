"""Amazon product search via SerpAPI."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SERPAPI_BASE = "https://serpapi.com/search.json"


def is_available() -> bool:
    """Check if SerpAPI is configured."""
    return bool(SERPAPI_KEY)


# Tool definition for Claude function calling
AMAZON_SEARCH_TOOL = {
    "name": "amazon_product_search",
    "description": (
        "Search Amazon.co.jp for products matching a query. "
        "Returns product titles, prices, ratings, and direct links. "
        "Use this when the user asks about purchasing products, "
        "recommends items, or wants product comparisons."
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
    """Search Amazon.co.jp via SerpAPI and return product info."""
    if not SERPAPI_KEY:
        return [{"error": "Amazon search is not configured (SERPAPI_KEY not set)"}]

    max_results = max(1, min(5, max_results))

    params = {
        "engine": "amazon",
        "amazon_domain": "amazon.co.jp",
        "k": query,
        "api_key": SERPAPI_KEY,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(SERPAPI_BASE, params=params)
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
            # Clean up None values
            products.append({k: v for k, v in product.items() if v is not None})

        if not products:
            return [{"error": f"No products found for '{query}'"}]

        return products

    except httpx.TimeoutException:
        logger.warning("SerpAPI timeout for query: %s", query)
        return [{"error": "Amazon search timed out. Please try again."}]
    except Exception as e:
        logger.error("SerpAPI error: %s", e)
        return [{"error": f"Amazon search failed: {str(e)}"}]
