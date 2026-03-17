"""Flight search via SerpAPI (Google Flights) and Travelpayouts (Aviasales)."""

import asyncio
import logging
import os
from datetime import date, datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
TRAVELPAYOUTS_TOKEN = os.environ.get("TRAVELPAYOUTS_TOKEN", "")
SERPAPI_BASE = "https://serpapi.com/search.json"
TRAVELPAYOUTS_BASE = "https://api.travelpayouts.com"


def is_available() -> bool:
    """Check if at least one flight search provider is configured."""
    return bool(SERPAPI_KEY) or bool(TRAVELPAYOUTS_TOKEN)


# ── Tool definition for LLM function calling ──

FLIGHT_SEARCH_TOOL = {
    "name": "flight_search",
    "description": (
        "Search for flights between two cities/airports. "
        "Returns flight options with prices, airlines, duration, and booking links. "
        "Searches Google Flights and Travelpayouts/Aviasales (728+ airlines including LCCs) for comprehensive results. "
        "Use this when the user asks about flights, airfares, or travel between cities."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "origin": {
                "type": "string",
                "description": "Departure airport IATA code (e.g. 'NRT', 'LAX', 'BKK')",
            },
            "destination": {
                "type": "string",
                "description": "Arrival airport IATA code (e.g. 'BKK', 'CDG', 'HND')",
            },
            "departure_date": {
                "type": "string",
                "description": "Departure date in YYYY-MM-DD format",
            },
            "return_date": {
                "type": "string",
                "description": "Return date in YYYY-MM-DD format (omit for one-way)",
            },
            "adults": {
                "type": "integer",
                "description": "Number of adult passengers (default: 1)",
                "default": 1,
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum results per source (default: 5)",
                "default": 5,
            },
        },
        "required": ["origin", "destination", "departure_date"],
    },
}


# ── Google Flights via SerpAPI ──

def _flight_score(price: int | None, duration_min: int | None, stops: int) -> float:
    """Score a flight Google Flights-style: balance price, duration, and stops.
    Lower score = better flight."""
    p = price or 999999
    d = duration_min or 1440  # default 24h if unknown
    return p * 1.0 + d * 50 + stops * 10000


async def _search_google_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search Google Flights via SerpAPI."""
    if not SERPAPI_KEY:
        return []

    params: dict = {
        "engine": "google_flights",
        "departure_id": origin.upper(),
        "arrival_id": destination.upper(),
        "outbound_date": departure_date,
        "adults": adults,
        "currency": "JPY",
        "hl": "ja",
        "api_key": SERPAPI_KEY,
    }
    if return_date:
        params["return_date"] = return_date
        params["type"] = "1"  # round trip
    else:
        params["type"] = "2"  # one way

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(SERPAPI_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

        flights = []
        # Collect all flights from both best and other lists
        for flight_list in [data.get("best_flights", []), data.get("other_flights", [])]:
            for f in flight_list:
                legs = f.get("flights", [])
                if not legs:
                    continue

                first_leg = legs[0]
                last_leg = legs[-1]
                stops = len(legs) - 1

                # Skip 3+ stops (unreasonable)
                if stops > 2:
                    continue

                airlines = list({leg.get("airline", "") for leg in legs})
                price = f.get("price")
                duration = f.get("total_duration", 0)

                # Build Google Flights search link
                dep_airport = first_leg.get("departure_airport", {}).get("id", origin.upper())
                arr_airport = last_leg.get("arrival_airport", {}).get("id", destination.upper())
                gf_link = f"https://www.google.com/travel/flights?q=flights+from+{dep_airport}+to+{arr_airport}+on+{departure_date}"
                if return_date:
                    gf_link += f"+returning+{return_date}"

                flight_info = {
                    "source": "Google Flights",
                    "airline": ", ".join(airlines),
                    "departure": first_leg.get("departure_airport", {}).get("time", ""),
                    "arrival": last_leg.get("arrival_airport", {}).get("time", ""),
                    "departure_airport": dep_airport,
                    "arrival_airport": arr_airport,
                    "duration_min": duration,
                    "stops": stops,
                    "price": price,
                    "currency": "JPY",
                    "return_date": return_date or "",
                    "google_flights_link": gf_link,
                    "_score": _flight_score(price, duration, stops),
                }
                flights.append({k: v for k, v in flight_info.items() if v is not None})

        # Sort by score (Google Flights-style: balance price, duration, stops)
        flights.sort(key=lambda f: f.get("_score", 999999))
        return flights[:max_results]

    except httpx.TimeoutException:
        logger.warning("Google Flights search timeout for %s→%s on %s", origin, destination, departure_date)
        return []
    except httpx.HTTPStatusError as e:
        logger.error("Google Flights search HTTP %s for %s→%s: %s", e.response.status_code, origin, destination, e.response.text[:200])
        return []
    except Exception as e:
        logger.error("Google Flights search error for %s→%s: %s", origin, destination, repr(e))
        return []


# ── Travelpayouts / Aviasales API ──

async def _search_travelpayouts(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search Travelpayouts cheapest tickets API (cached data, 728+ airlines including LCCs)."""
    if not TRAVELPAYOUTS_TOKEN:
        return []

    # Use the cheapest tickets endpoint (fast, cached)
    params: dict = {
        "origin": origin.upper(),
        "destination": destination.upper(),
        "depart_date": departure_date,
        "currency": "JPY",
        "token": TRAVELPAYOUTS_TOKEN,
    }
    if return_date:
        params["return_date"] = return_date

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{TRAVELPAYOUTS_BASE}/v1/prices/cheap", params=params)
            resp.raise_for_status()
            data = resp.json()

        if not data.get("success"):
            return []

        flights = []
        dest_data = data.get("data", {}).get(destination.upper(), {})

        for key, ticket in dest_data.items():
            if len(flights) >= max_results:
                break

            # Build Aviasales deep link
            dep_date_compact = departure_date.replace("-", "")
            link_params = f"{origin.upper()}{dep_date_compact}{destination.upper()}"
            if return_date:
                ret_date_compact = return_date.replace("-", "")
                link_params += ret_date_compact
            booking_link = f"https://www.aviasales.com/search/{link_params}1"

            flight_info = {
                "source": "Aviasales",
                "airline_code": ticket.get("airline", ""),
                "departure_date": ticket.get("departure_at", departure_date),
                "return_date": ticket.get("return_at", ""),
                "stops": ticket.get("number_of_changes", 0),
                "price": ticket.get("price"),
                "currency": "JPY",
                "booking_link": booking_link,
                "flight_number": ticket.get("flight_number"),
                "expires_at": ticket.get("expires_at", ""),
            }
            flights.append({k: v for k, v in flight_info.items() if v and v != ""})

        return flights

    except Exception as e:
        logger.error("Travelpayouts search error: %s", e)
        return []


# ── Travelpayouts month matrix (cheapest dates) ──

async def _get_cheapest_dates(origin: str, destination: str, month: str) -> dict[str, int]:
    """Get daily cheapest prices for a month via Travelpayouts.
    Returns dict of {date_str: price}.
    month format: YYYY-MM
    """
    if not TRAVELPAYOUTS_TOKEN:
        return {}

    params = {
        "origin": origin.upper(),
        "destination": destination.upper(),
        "month": month,
        "currency": "JPY",
        "token": TRAVELPAYOUTS_TOKEN,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{TRAVELPAYOUTS_BASE}/v2/prices/month-matrix", params=params)
            resp.raise_for_status()
            data = resp.json()

        if not data.get("success"):
            return {}

        prices = {}
        for item in data.get("data", []):
            dep = item.get("depart_date", "")
            price = item.get("value")
            if dep and price:
                prices[dep] = price
        return prices

    except Exception as e:
        logger.error("Travelpayouts month-matrix error: %s", e)
        return {}


# ── Hub airports for connection search ──

HUB_AIRPORTS = ["ICN", "TPE", "HKG", "PVG", "HAN", "BKK", "SIN", "KUL"]


def _generate_return_dates(departure_date: str, return_date: str | None) -> list[str]:
    """Generate return date candidates.
    If return_date is specified, return [return_date].
    Otherwise, generate 2-week±3 and 3-week±3 candidates.
    """
    if return_date:
        return [return_date]

    try:
        dep = datetime.strptime(departure_date, "%Y-%m-%d").date()
    except ValueError:
        return []

    candidates = set()
    # 2 weeks ± 3 days (days 11-17)
    for offset in range(11, 18):
        candidates.add((dep + timedelta(days=offset)).isoformat())
    # 3 weeks ± 3 days (days 18-24)
    for offset in range(18, 25):
        candidates.add((dep + timedelta(days=offset)).isoformat())

    return sorted(candidates)


async def _search_direct(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search both providers for a single origin-destination pair."""
    tasks = []
    if SERPAPI_KEY:
        tasks.append(_search_google_flights(origin, destination, departure_date, return_date, adults, max_results))
    if TRAVELPAYOUTS_TOKEN:
        tasks.append(_search_travelpayouts(origin, destination, departure_date, return_date, adults, max_results))

    if not tasks:
        return []

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_flights = []
    for r in results:
        if isinstance(r, list):
            all_flights.extend(r)

    return all_flights


# ── Combined search ──

def _fix_date(date_str: str) -> str:
    """Fix past-year dates by replacing the year with the current or next year."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d").date()
        today = date.today()
        if dt < today:
            fixed = dt.replace(year=today.year)
            if fixed < today:
                fixed = dt.replace(year=today.year + 1)
            logger.warning("Fixed past date %s → %s", date_str, fixed.isoformat())
            return fixed.isoformat()
        return date_str
    except ValueError:
        return date_str


async def search_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search Google Flights and Travelpayouts with smart return-date exploration.
    If return_date is not specified, searches multiple return date candidates
    (2 weeks ± 3 days and 3 weeks ± 3 days) and picks the best deals.
    """
    if not SERPAPI_KEY and not TRAVELPAYOUTS_TOKEN:
        return [{"error": "No flight search API configured (SERPAPI_KEY or TRAVELPAYOUTS_TOKEN)"}]

    # Fix past dates (LLMs sometimes use wrong year)
    departure_date = _fix_date(departure_date)
    if return_date:
        return_date = _fix_date(return_date)

    # Generate return date candidates
    return_candidates = _generate_return_dates(departure_date, return_date)

    if not return_candidates:
        # No return date and can't generate → search one-way
        all_flights = await _search_direct(origin, destination, departure_date, None, adults, max_results)
    elif len(return_candidates) == 1:
        # Exact return date specified
        all_flights = await _search_direct(origin, destination, departure_date, return_candidates[0], adults, max_results)
    else:
        # Multiple return date candidates — use Travelpayouts month matrix to find cheapest,
        # then search top 3 return dates on Google Flights
        dep_month = departure_date[:7]  # YYYY-MM
        ret_month_set = {d[:7] for d in return_candidates}

        # Get month price data to identify cheapest return dates
        month_tasks = [_get_cheapest_dates(destination, origin, m) for m in ret_month_set]
        month_results = await asyncio.gather(*month_tasks, return_exceptions=True)
        ret_prices: dict[str, int] = {}
        for r in month_results:
            if isinstance(r, dict):
                ret_prices.update(r)

        # Rank return candidates by Travelpayouts price (cheapest first)
        if ret_prices:
            scored = [(d, ret_prices.get(d, 999999)) for d in return_candidates]
            scored.sort(key=lambda x: x[1])
            best_return_dates = [d for d, _ in scored[:3]]
        else:
            # No price data: pick 14d, 17d, 21d as defaults
            best_return_dates = return_candidates[3:4] + return_candidates[6:7] + return_candidates[10:11]
            best_return_dates = best_return_dates[:3] or return_candidates[:3]

        # Search Google Flights for the best return dates sequentially (avoid SerpAPI rate limits)
        all_flights = []
        for ret_d in best_return_dates:
            try:
                results = await _search_direct(origin, destination, departure_date, ret_d, adults, max_results)
                all_flights.extend(results)
            except Exception as e:
                logger.warning("Search failed for return date %s: %s", ret_d, e)

    # If no or very few results, try via hub airports
    if len(all_flights) < 2 and SERPAPI_KEY:
        hubs_to_try = [h for h in HUB_AIRPORTS if h != origin.upper() and h != destination.upper()][:3]
        hub_tasks = []
        for hub in hubs_to_try:
            hub_tasks.append(_search_google_flights(origin, hub, departure_date, adults=adults, max_results=1))
        hub_results = await asyncio.gather(*hub_tasks, return_exceptions=True)

        for i, r in enumerate(hub_results):
            if isinstance(r, list) and r:
                hub = hubs_to_try[i]
                cheapest = r[0]
                all_flights.append({
                    "source": "Google Flights (via hub)",
                    "route": f"{origin}→{hub}→{destination}",
                    "hub": hub,
                    "first_leg_price": cheapest.get("price"),
                    "first_leg_airline": cheapest.get("airline", ""),
                    "note": f"Connection via {hub}. Search {hub}→{destination} separately for full price.",
                    "currency": "JPY",
                })

    if not all_flights:
        return [{"error": f"No flights found for {origin} → {destination} on {departure_date}. Try alternative dates or nearby airports."}]

    # Sort by score (balance price, duration, stops) — like Google Flights "Best"
    score_key = lambda f: f.get("_score") or _flight_score(f.get("price") or f.get("first_leg_price"), f.get("duration_min"), f.get("stops", 0))
    all_flights.sort(key=score_key)
    best_flights = all_flights[:max_results]

    # Find cheapest by price only (may have long layover)
    price_key = lambda f: f.get("price") or f.get("first_leg_price") or 999999
    cheapest = min(all_flights, key=price_key)

    # Add cheapest if not already in best_flights
    cheapest_ids = {(f.get("airline"), f.get("price"), f.get("departure")) for f in best_flights}
    cheapest_id = (cheapest.get("airline"), cheapest.get("price"), cheapest.get("departure"))
    if cheapest_id not in cheapest_ids:
        cheapest_copy = dict(cheapest)
        cheapest_copy["_cheapest"] = True
        best_flights.append(cheapest_copy)

    return best_flights
