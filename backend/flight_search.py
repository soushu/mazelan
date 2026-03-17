"""Flight search via SerpAPI (Google Flights) and Travelpayouts (Aviasales)."""

import asyncio
import logging
import os
from datetime import date, datetime

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
        async with httpx.AsyncClient(timeout=15.0) as client:
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

                flight_info = {
                    "source": "Google Flights",
                    "airline": ", ".join(airlines),
                    "departure": first_leg.get("departure_airport", {}).get("time", ""),
                    "arrival": last_leg.get("arrival_airport", {}).get("time", ""),
                    "departure_airport": first_leg.get("departure_airport", {}).get("id", ""),
                    "arrival_airport": last_leg.get("arrival_airport", {}).get("id", ""),
                    "duration_min": duration,
                    "stops": stops,
                    "price": price,
                    "currency": "JPY",
                    "_score": _flight_score(price, duration, stops),
                }
                flights.append({k: v for k, v in flight_info.items() if v is not None})

        # Sort by score (Google Flights-style: balance price, duration, stops)
        flights.sort(key=lambda f: f.get("_score", 999999))
        return flights[:max_results]

    except Exception as e:
        logger.error("Google Flights search error: %s", e)
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


# ── Hub airports for connection search ──

HUB_AIRPORTS = ["ICN", "TPE", "HKG", "PVG", "HAN", "BKK", "SIN", "KUL"]


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
            # Replace year with current year; if still past, use next year
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
    """Search Google Flights and Travelpayouts, merge and sort by price.
    If no results found, suggest hub connections as alternatives.
    """
    if not SERPAPI_KEY and not TRAVELPAYOUTS_TOKEN:
        return [{"error": "No flight search API configured (SERPAPI_KEY or TRAVELPAYOUTS_TOKEN)"}]

    # Fix past dates (LLMs sometimes use wrong year)
    departure_date = _fix_date(departure_date)
    if return_date:
        return_date = _fix_date(return_date)

    all_flights = await _search_direct(origin, destination, departure_date, return_date, adults, max_results)

    # If no or very few results, try via hub airports
    if len(all_flights) < 2 and SERPAPI_KEY:
        # Pick hubs that are geographically between origin and destination (exclude origin/dest themselves)
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

    # Sort by score (balance price, duration, stops) — like Google Flights "Best"
    all_flights.sort(key=lambda f: f.get("_score") or _flight_score(f.get("price") or f.get("first_leg_price"), f.get("duration_min"), f.get("stops", 0)))

    if not all_flights:
        return [{"error": f"No flights found for {origin} → {destination} on {departure_date}. Try alternative dates or nearby airports."}]

    return all_flights
