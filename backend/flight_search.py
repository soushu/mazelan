"""Flight search via SerpAPI (Google Flights) and Kiwi.com Tequila API."""

import logging
import os
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
KIWI_API_KEY = os.environ.get("KIWI_API_KEY", "")
SERPAPI_BASE = "https://serpapi.com/search.json"
KIWI_BASE = "https://api.tequila.kiwi.com/v2/search"


def is_available() -> bool:
    """Check if at least one flight search provider is configured."""
    return bool(SERPAPI_KEY) or bool(KIWI_API_KEY)


# ── Tool definition for LLM function calling ──

FLIGHT_SEARCH_TOOL = {
    "name": "flight_search",
    "description": (
        "Search for flights between two cities/airports. "
        "Returns flight options with prices, airlines, duration, and booking links. "
        "Searches both Google Flights and Kiwi.com for comprehensive results including LCCs. "
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
                "description": "Maximum results per source (default: 3)",
                "default": 3,
            },
        },
        "required": ["origin", "destination", "departure_date"],
    },
}


# ── Google Flights via SerpAPI ──

async def _search_google_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 3,
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
        for flight_list in [data.get("best_flights", []), data.get("other_flights", [])]:
            for f in flight_list:
                if len(flights) >= max_results:
                    break
                legs = f.get("flights", [])
                if not legs:
                    continue

                first_leg = legs[0]
                last_leg = legs[-1]
                stops = len(legs) - 1
                airlines = list({leg.get("airline", "") for leg in legs})

                flight_info = {
                    "source": "Google Flights",
                    "airline": ", ".join(airlines),
                    "departure": first_leg.get("departure_airport", {}).get("time", ""),
                    "arrival": last_leg.get("arrival_airport", {}).get("time", ""),
                    "departure_airport": first_leg.get("departure_airport", {}).get("id", ""),
                    "arrival_airport": last_leg.get("arrival_airport", {}).get("id", ""),
                    "duration": f.get("total_duration", 0),
                    "stops": stops,
                    "price": f.get("price"),
                    "currency": "JPY",
                    "booking_token": f.get("booking_token", ""),
                }
                flights.append({k: v for k, v in flight_info.items() if v is not None})

        return flights

    except Exception as e:
        logger.error("Google Flights search error: %s", e)
        return []


# ── Kiwi.com Tequila API ──

async def _search_kiwi(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 3,
) -> list[dict]:
    """Search Kiwi.com Tequila API for flights (including LCCs)."""
    if not KIWI_API_KEY:
        return []

    # Convert YYYY-MM-DD to DD/MM/YYYY for Kiwi
    try:
        dt = datetime.strptime(departure_date, "%Y-%m-%d")
        date_from = dt.strftime("%d/%m/%Y")
    except ValueError:
        return []

    params: dict = {
        "fly_from": origin.upper(),
        "fly_to": destination.upper(),
        "date_from": date_from,
        "date_to": date_from,  # exact date
        "adults": adults,
        "curr": "JPY",
        "locale": "ja",
        "limit": max_results,
        "sort": "price",
    }

    if return_date:
        try:
            rt = datetime.strptime(return_date, "%Y-%m-%d")
            params["return_from"] = rt.strftime("%d/%m/%Y")
            params["return_to"] = rt.strftime("%d/%m/%Y")
            params["flight_type"] = "round"
        except ValueError:
            pass
    else:
        params["flight_type"] = "oneway"

    headers = {"apikey": KIWI_API_KEY}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(KIWI_BASE, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        flights = []
        for item in data.get("data", [])[:max_results]:
            route = item.get("route", [])
            airlines = list({leg.get("airline", "") for leg in route})
            stops = max(0, len([r for r in route if r.get("return") == 0]) - 1)

            flight_info = {
                "source": "Kiwi.com",
                "airline": ", ".join(airlines),
                "departure": item.get("local_departure", ""),
                "arrival": item.get("local_arrival", ""),
                "departure_airport": item.get("flyFrom", ""),
                "arrival_airport": item.get("flyTo", ""),
                "duration": round(item.get("duration", {}).get("departure", 0) / 3600, 1) if isinstance(item.get("duration"), dict) else None,
                "stops": stops,
                "price": item.get("price"),
                "currency": "JPY",
                "booking_link": item.get("deep_link", ""),
            }
            flights.append({k: v for k, v in flight_info.items() if v is not None})

        return flights

    except Exception as e:
        logger.error("Kiwi.com search error: %s", e)
        return []


# ── Combined search ──

async def search_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 3,
) -> list[dict]:
    """Search both Google Flights and Kiwi.com, merge and deduplicate results."""
    import asyncio

    tasks = []
    if SERPAPI_KEY:
        tasks.append(_search_google_flights(origin, destination, departure_date, return_date, adults, max_results))
    if KIWI_API_KEY:
        tasks.append(_search_kiwi(origin, destination, departure_date, return_date, adults, max_results))

    if not tasks:
        return [{"error": "No flight search API configured (SERPAPI_KEY or KIWI_API_KEY)"}]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_flights = []
    for r in results:
        if isinstance(r, list):
            all_flights.extend(r)

    # Sort by price
    all_flights.sort(key=lambda f: f.get("price") or 999999)

    if not all_flights:
        return [{"error": f"No flights found for {origin} → {destination} on {departure_date}"}]

    return all_flights
