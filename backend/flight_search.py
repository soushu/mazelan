"""Flight search via SerpAPI (Google Flights) and Duffel API."""

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
DUFFEL_API_KEY = os.environ.get("DUFFEL_API_KEY", "")
SERPAPI_BASE = "https://serpapi.com/search.json"
DUFFEL_BASE = "https://api.duffel.com/air/offer_requests"


def is_available() -> bool:
    """Check if at least one flight search provider is configured."""
    return bool(SERPAPI_KEY) or bool(DUFFEL_API_KEY)


# ── Tool definition for LLM function calling ──

FLIGHT_SEARCH_TOOL = {
    "name": "flight_search",
    "description": (
        "Search for flights between two cities/airports. "
        "Returns flight options with prices, airlines, duration, and booking links. "
        "Searches Google Flights and Duffel (300+ airlines including LCCs) for comprehensive results. "
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
                    "duration_min": f.get("total_duration", 0),
                    "stops": stops,
                    "price": f.get("price"),
                    "currency": "JPY",
                }
                flights.append({k: v for k, v in flight_info.items() if v is not None})

        return flights

    except Exception as e:
        logger.error("Google Flights search error: %s", e)
        return []


# ── Duffel API ──

def _parse_duration(iso_duration: str) -> int | None:
    """Parse ISO 8601 duration like 'PT2H26M' to minutes."""
    if not iso_duration or not iso_duration.startswith("PT"):
        return None
    try:
        rest = iso_duration[2:]
        hours = 0
        minutes = 0
        if "H" in rest:
            h_part, rest = rest.split("H")
            hours = int(h_part)
        if "M" in rest:
            m_part = rest.replace("M", "")
            minutes = int(m_part)
        return hours * 60 + minutes
    except (ValueError, IndexError):
        return None


async def _search_duffel(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 3,
) -> list[dict]:
    """Search Duffel API for flights (300+ airlines including LCCs)."""
    if not DUFFEL_API_KEY:
        return []

    slices = [{"origin": origin.upper(), "destination": destination.upper(), "departure_date": departure_date}]
    if return_date:
        slices.append({"origin": destination.upper(), "destination": origin.upper(), "departure_date": return_date})

    passengers = [{"type": "adult"} for _ in range(adults)]

    body = {
        "data": {
            "slices": slices,
            "passengers": passengers,
            "cabin_class": "economy",
        }
    }

    headers = {
        "Authorization": f"Bearer {DUFFEL_API_KEY}",
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                DUFFEL_BASE,
                json=body,
                headers=headers,
                params={"return_offers": "true", "supplier_timeout": "20000"},
            )
            resp.raise_for_status()
            data = resp.json()

        offers = data.get("data", {}).get("offers", [])
        # Sort by price and take top results
        offers.sort(key=lambda o: float(o.get("total_amount", "999999")))
        offers = offers[:max_results]

        flights = []
        for offer in offers:
            owner = offer.get("owner", {})
            slices_data = offer.get("slices", [])
            if not slices_data:
                continue

            # Use outbound slice for display
            outbound = slices_data[0]
            segments = outbound.get("segments", [])
            if not segments:
                continue

            first_seg = segments[0]
            last_seg = segments[-1]
            stops = len(segments) - 1

            # Collect all airlines
            airlines = list({
                seg.get("operating_carrier", {}).get("name", "")
                or seg.get("marketing_carrier", {}).get("name", "")
                for seg in segments
            })

            # Calculate total duration
            total_duration = sum(_parse_duration(seg.get("duration", "")) or 0 for seg in segments)

            flight_info = {
                "source": "Duffel",
                "airline": ", ".join([a for a in airlines if a]),
                "departure": first_seg.get("departing_at", ""),
                "arrival": last_seg.get("arriving_at", ""),
                "departure_airport": first_seg.get("origin", {}).get("iata_code", ""),
                "arrival_airport": last_seg.get("destination", {}).get("iata_code", ""),
                "duration_min": total_duration if total_duration else None,
                "stops": stops,
                "price": round(float(offer.get("total_amount", 0))),
                "currency": offer.get("total_currency", "JPY"),
                "offer_id": offer.get("id", ""),
            }
            flights.append({k: v for k, v in flight_info.items() if v is not None})

        return flights

    except httpx.HTTPStatusError as e:
        logger.error("Duffel API error %s: %s", e.response.status_code, e.response.text[:200])
        return []
    except Exception as e:
        logger.error("Duffel search error: %s", e)
        return []


# ── Combined search ──

async def search_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 3,
) -> list[dict]:
    """Search Google Flights and Duffel, merge and sort by price."""
    tasks = []
    if SERPAPI_KEY:
        tasks.append(_search_google_flights(origin, destination, departure_date, return_date, adults, max_results))
    if DUFFEL_API_KEY:
        tasks.append(_search_duffel(origin, destination, departure_date, return_date, adults, max_results))

    if not tasks:
        return [{"error": "No flight search API configured (SERPAPI_KEY or DUFFEL_API_KEY)"}]

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
