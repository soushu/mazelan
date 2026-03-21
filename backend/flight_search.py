"""Flight search via SearchApi.io (Google Flights) and Travelpayouts (Aviasales).

Smart search: searches Google Flights for detailed results on specified dates.
One tool call returns comprehensive results.
"""

import asyncio
import logging
import os
from datetime import date, datetime, timedelta

import httpx

from backend.serpapi_cache import get as cache_get, put as cache_put

logger = logging.getLogger(__name__)

SEARCHAPI_KEY = os.environ.get("SEARCHAPI_KEY", "")
SEARCHAPI_BASE = "https://www.searchapi.io/api/v1/search"


def is_available() -> bool:
    return bool(SEARCHAPI_KEY)


# ── Tool definition ──

FLIGHT_SEARCH_TOOL = {
    "name": "flight_search",
    "description": (
        "Search for flights between two cities/airports. "
        "ONLY use this when the user EXPLICITLY asks to search for flights, prices, or tickets. "
        "Do NOT use for general airline questions. "
        "Call ONCE per destination — the tool internally searches multiple dates to find the best deals."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "origin": {
                "type": "string",
                "description": "Departure airport IATA code (e.g. 'NRT', 'HIJ', 'BKK')",
            },
            "destination": {
                "type": "string",
                "description": "Arrival airport IATA code (e.g. 'SGN', 'DAD', 'HND')",
            },
            "departure_month": {
                "type": "string",
                "description": "Target departure month in YYYY-MM format (e.g. '2026-04')",
            },
            "departure_day_from": {
                "type": "integer",
                "description": "Earliest departure day of month. Default: 1",
                "default": 1,
            },
            "departure_day_to": {
                "type": "integer",
                "description": "Latest departure day of month. Default: 10",
                "default": 10,
            },
            "return_month": {
                "type": "string",
                "description": "Return month in YYYY-MM format. If omitted, calculated from departure + trip_weeks.",
            },
            "return_day_from": {
                "type": "integer",
                "description": "Earliest return day of month. Used with return_month.",
            },
            "return_day_to": {
                "type": "integer",
                "description": "Latest return day of month. Used with return_month.",
            },
            "trip_weeks": {
                "type": "integer",
                "description": "Approximate trip duration in weeks (fallback if return_month not set). Default: 2",
                "default": 2,
            },
            "adults": {
                "type": "integer",
                "description": "Number of adult passengers. Default: 1",
                "default": 1,
            },
        },
        "required": ["origin", "destination", "departure_month"],
    },
}


# ── Airline websites ──

AIRLINE_WEBSITES: dict[str, str] = {
    "ANA": "https://www.ana.co.jp/", "全日本空輸": "https://www.ana.co.jp/",
    "JAL": "https://www.jal.co.jp/", "日本航空": "https://www.jal.co.jp/",
    "Peach": "https://www.flypeach.com/", "ピーチ": "https://www.flypeach.com/",
    "Jetstar": "https://www.jetstar.com/jp/", "ジェットスター": "https://www.jetstar.com/jp/",
    "Spring Japan": "https://jp.ch.com/", "スプリング・ジャパン": "https://jp.ch.com/",
    "Jeju Air": "https://www.jejuair.net/", "チェジュ航空": "https://www.jejuair.net/",
    "Korean Air": "https://www.koreanair.com/", "大韓航空": "https://www.koreanair.com/",
    "Asiana Airlines": "https://flyasiana.com/", "アシアナ航空": "https://flyasiana.com/",
    "T'way Air": "https://www.twayair.com/", "ティーウェイ航空": "https://www.twayair.com/",
    "Jin Air": "https://www.jinair.com/", "ジンエアー": "https://www.jinair.com/",
    "Air Busan": "https://www.airbusan.com/", "エアプサン": "https://www.airbusan.com/",
    "Air Premia": "https://www.airpremia.com/",
    "VietJet": "https://www.vietjetair.com/", "ベトジェット・エア": "https://www.vietjetair.com/", "ベトジェット": "https://www.vietjetair.com/",
    "Vietnam Airlines": "https://www.vietnamairlines.com/", "ベトナム航空": "https://www.vietnamairlines.com/",
    "AirAsia": "https://www.airasia.com/", "エアアジア": "https://www.airasia.com/",
    "Thai Airways": "https://www.thaiairways.com/", "タイ国際航空": "https://www.thaiairways.com/",
    "Singapore Airlines": "https://www.singaporeair.com/", "シンガポール航空": "https://www.singaporeair.com/",
    "Cebu Pacific": "https://www.cebupacificair.com/", "セブパシフィック航空": "https://www.cebupacificair.com/",
    "Scoot": "https://www.flyscoot.com/", "スクート": "https://www.flyscoot.com/",
    "China Airlines": "https://www.china-airlines.com/", "チャイナ エアライン": "https://www.china-airlines.com/",
    "China Eastern": "https://www.ceair.com/", "中国東方航空": "https://www.ceair.com/",
    "China Southern": "https://www.csair.com/", "中国南方航空": "https://www.csair.com/",
    "Spring Airlines": "https://www.ch.com/", "春秋航空": "https://www.ch.com/",
    "EVA Air": "https://www.evaair.com/", "エバー航空": "https://www.evaair.com/",
    "Starlux": "https://www.starlux-airlines.com/", "スターラックス航空": "https://www.starlux-airlines.com/",
    "Cathay Pacific": "https://www.cathaypacific.com/", "キャセイパシフィック航空": "https://www.cathaypacific.com/",
    "HK Express": "https://www.hkexpress.com/", "香港エクスプレス航空": "https://www.hkexpress.com/", "香港エクスプレス": "https://www.hkexpress.com/",
    "Emirates": "https://www.emirates.com/", "エミレーツ航空": "https://www.emirates.com/",
    "Qatar Airways": "https://www.qatarairways.com/", "カタール航空": "https://www.qatarairways.com/",
    "Turkish Airlines": "https://www.turkishairlines.com/", "トルコ航空": "https://www.turkishairlines.com/",
    "United Airlines": "https://www.united.com/", "ユナイテッド航空": "https://www.united.com/",
    "Delta Air Lines": "https://www.delta.com/", "デルタ航空": "https://www.delta.com/",
    "Hawaiian Airlines": "https://www.hawaiianairlines.co.jp/", "ハワイアン航空": "https://www.hawaiianairlines.co.jp/",
}


def _get_airline_url(airline_name: str) -> str:
    if airline_name in AIRLINE_WEBSITES:
        return AIRLINE_WEBSITES[airline_name]
    for key, url in AIRLINE_WEBSITES.items():
        if key in airline_name:
            return url
    return ""


# ── Scoring ──

def _flight_score(price: int | None, duration_min: int | None, stops: int) -> float:
    """Google Flights-style score: balance price, duration, stops. Lower = better."""
    p = price or 999999
    d = duration_min or 1440
    return p * 1.0 + d * 50 + stops * 10000


# ── Date utilities ──

def _fix_date(date_str: str) -> str:
    """Fix past-year dates by replacing year with current/next year."""
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



# ── Google Flights search ──

async def _search_google_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search Google Flights via SearchApi.io for a specific date."""
    if not SEARCHAPI_KEY:
        return []

    params: dict = {
        "engine": "google_flights",
        "departure_id": origin.upper(), "arrival_id": destination.upper(),
        "outbound_date": departure_date, "adults": adults,
        "currency": "JPY", "hl": "ja", "api_key": SEARCHAPI_KEY,
    }
    if return_date:
        params["return_date"] = return_date
        params["flight_type"] = "round_trip"
    else:
        params["flight_type"] = "one_way"

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(SEARCHAPI_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

        # Get Google Flights URL from response
        metadata = data.get("search_metadata", {})
        gf_url = metadata.get("google_flights_url", "") or metadata.get("request_url", "")

        flights = []
        for flight_list in [data.get("best_flights", []), data.get("other_flights", [])]:
            for f in flight_list:
                legs = f.get("flights", [])
                if not legs:
                    continue
                first_leg, last_leg = legs[0], legs[-1]
                stops = len(legs) - 1
                if stops > 2:
                    continue

                dep_airport = first_leg.get("departure_airport", {}).get("id", origin.upper())
                arr_airport = last_leg.get("arrival_airport", {}).get("id", destination.upper())
                airlines = list({leg.get("airline", "") for leg in legs})
                airline_str = ", ".join(airlines)
                price = f.get("price")
                duration = f.get("total_duration", 0)

                flights.append({
                    "source": "Google Flights",
                    "airline": airline_str,
                    "airline_url": _get_airline_url(airline_str),
                    "departure": first_leg.get("departure_airport", {}).get("time", ""),
                    "arrival": last_leg.get("arrival_airport", {}).get("time", ""),
                    "departure_airport": dep_airport,
                    "arrival_airport": arr_airport,
                    "duration_min": duration,
                    "stops": stops,
                    "price": price,
                    "currency": "JPY",
                    "departure_date": departure_date,
                    "return_date": return_date or "",
                    "google_flights_link": gf_url,
                    "_score": _flight_score(price, duration, stops),
                })

        flights.sort(key=lambda f: f.get("_score", 999999))
        return flights[:max_results]

    except httpx.TimeoutException:
        logger.warning("Google Flights timeout: %s→%s on %s", origin, destination, departure_date)
        return [{"_api_error": "timeout"}]
    except httpx.HTTPStatusError as e:
        logger.error("Google Flights HTTP %s: %s→%s: %s", e.response.status_code, origin, destination, e.response.text[:200])
        return [{"_api_error": f"HTTP {e.response.status_code}"}]
    except Exception as e:
        logger.error("Google Flights error: %s→%s: %s", origin, destination, repr(e))
        return []


# ── Main search: Google Flights calendar method ──

def _has_api_error(results: list[dict]) -> str | None:
    """Check if results contain an API error. Returns error string or None."""
    for r in results:
        if "_api_error" in r:
            return r["_api_error"]
    return None


async def _search_calendar(
    origin: str, destination: str,
    outbound_date: str, return_date: str | None = None,
) -> list[dict]:
    """Search Google Flights Calendar API. API auto-searches ±1 week around given dates."""
    if not SEARCHAPI_KEY:
        return []

    params: dict = {
        "engine": "google_flights_calendar",
        "departure_id": origin.upper(),
        "arrival_id": destination.upper(),
        "outbound_date": outbound_date,
        "currency": "JPY",
        "hl": "ja",
        "api_key": SEARCHAPI_KEY,
    }
    if return_date:
        params["return_date"] = return_date
        params["flight_type"] = "round_trip"
    else:
        params["flight_type"] = "one_way"

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.get(SEARCHAPI_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
        return data.get("calendar", [])
    except Exception as e:
        logger.warning("Calendar API error: %s→%s: %s", origin, destination, repr(e))
        return []


async def search_flights(
    origin: str, destination: str,
    departure_month: str = "",  # YYYY-MM
    departure_day_from: int = 1, departure_day_to: int = 10,
    return_month: str = "",  # YYYY-MM (optional, explicit return date range)
    return_day_from: int = 0, return_day_to: int = 0,
    trip_weeks: int = 2, adults: int = 1,
    # Legacy params (backward compat)
    departure_date: str = "", return_date: str | None = None, max_results: int = 5,
) -> list[dict]:
    """Flight search using Google Flights Calendar API + detail search.

    Efficient 2-step approach:
    1. Calendar API: find cheapest date combos in range (1 API call)
    2. Detail search: get full flight info for top 2 cheapest combos (2 API calls)
    Total: ~3 API calls (vs 30+ with old per-day method)
    """
    if not SEARCHAPI_KEY:
        return [{"error": "Google Flights search not configured (SEARCHAPI_KEY)"}]

    origin = origin.upper()
    destination = destination.upper()

    # Handle legacy single-date calls
    if departure_date and not departure_month:
        departure_date = _fix_date(departure_date)
        if return_date:
            return_date = _fix_date(return_date)
        # Check cache
        cache_params = {"origin": origin, "dest": destination, "dep": departure_date, "ret": return_date, "adults": adults}
        cached = cache_get("flight", cache_params)
        if cached is not None:
            return cached
        results = await _search_google_flights(origin, destination, departure_date, return_date, adults, max_results)
        api_err = _has_api_error(results)
        if api_err:
            return [{"error": f"flight_search is temporarily unavailable ({api_err}). DO NOT tell the user the service is unavailable. Instead, use web search to find flight prices for {origin}→{destination} and present the results."}]
        if not results:
            return [{"error": f"No flights found for {origin}→{destination} on {departure_date}"}]
        cache_put("flight", cache_params, results)
        return results

    # === Google Flights calendar method ===

    if not departure_month:
        departure_month = date.today().strftime("%Y-%m")

    # Check cache for calendar method
    cache_params = {"origin": origin, "dest": destination, "month": departure_month, "from": departure_day_from, "to": departure_day_to, "ret_month": return_month, "ret_from": return_day_from, "ret_to": return_day_to, "weeks": trip_weeks, "adults": adults}
    cached = cache_get("flight", cache_params)
    if cached is not None:
        return cached

    # Step 1: Calculate date ranges
    try:
        year, month = map(int, departure_month.split("-"))
    except ValueError:
        return [{"error": f"Invalid departure_month: {departure_month}"}]

    # Departure date range
    if departure_day_from == departure_day_to:
        try:
            center = date(year, month, departure_day_from)
            dep_start = max(center - timedelta(days=1), date.today())
            dep_end = center + timedelta(days=1)
        except ValueError:
            return [{"error": f"Invalid date: {departure_month}-{departure_day_from}"}]
    else:
        try:
            dep_start = max(date(year, month, departure_day_from), date.today())
            dep_end = date(year, month, min(departure_day_to, 28))
        except ValueError:
            return [{"error": f"Invalid date range in {departure_month}"}]

    # Return date range
    if return_month and return_day_from and return_day_to:
        try:
            ret_year, ret_month_val = map(int, return_month.split("-"))
            if return_day_from == return_day_to:
                ret_center = date(ret_year, ret_month_val, return_day_from)
                ret_start = (ret_center - timedelta(days=1)).isoformat()
                ret_end = (ret_center + timedelta(days=1)).isoformat()
            else:
                ret_start = date(ret_year, ret_month_val, return_day_from).isoformat()
                ret_end = date(ret_year, ret_month_val, min(return_day_to, 28)).isoformat()
        except ValueError:
            ret_start = (dep_start + timedelta(days=trip_weeks * 7 - 1)).isoformat()
            ret_end = (dep_start + timedelta(days=trip_weeks * 7 + 1)).isoformat()
    else:
        ret_start = (dep_start + timedelta(days=trip_weeks * 7 - 1)).isoformat()
        ret_end = (dep_end + timedelta(days=trip_weeks * 7 + 1)).isoformat()

    logger.info("Flight search %s→%s: calendar %s~%s, return %s~%s", origin, destination, dep_start, dep_end, ret_start, ret_end)

    # Step 2: Use Calendar API to find cheapest date combination (1 API call)
    dep_mid = dep_start + (dep_end - dep_start) // 2
    calendar = await _search_calendar(origin, destination, dep_mid.isoformat(), ret_start)

    date_pairs: list[tuple[str, str]] = []

    if calendar:
        # Find best date pairs from calendar (filter to user's requested departure range)
        dep_start_str = dep_start.isoformat()
        dep_end_str = dep_end.isoformat()
        valid_entries = [
            e for e in calendar
            if e.get("price") and not e.get("has_no_flights")
            and dep_start_str <= e.get("departure", "") <= dep_end_str
        ]
        if valid_entries:
            valid_entries.sort(key=lambda e: e.get("price", 999999))
            for entry in valid_entries[:2]:
                dep = entry.get("departure", "")
                ret = entry.get("return", "")
                if dep and ret:
                    date_pairs.append((dep, ret))
            logger.info("Flight search %s→%s: cheapest combos from calendar %s", origin, destination, date_pairs)

    # Fallback: if Calendar API failed or returned no results, use dep_mid + default return
    if not date_pairs:
        ret_date_fallback = (dep_mid + timedelta(days=trip_weeks * 7)).isoformat()
        date_pairs.append((dep_mid.isoformat(), ret_date_fallback))
        logger.info("Flight search %s→%s: calendar fallback, using %s", origin, destination, date_pairs)

    # Step 4: Search round-trip for best date pairs (parallel)
    rt_tasks = [
        _search_google_flights(origin, destination, dep, ret, adults, max_results)
        for dep, ret in date_pairs
    ]
    rt_results = await asyncio.gather(*rt_tasks, return_exceptions=True)

    all_flights = []
    for r in rt_results:
        if isinstance(r, list):
            all_flights.extend(r)

    if not all_flights:
        return [{"error": f"No flights found for {origin}→{destination} in {departure_month}. Try different dates."}]

    # Step 5: Score and return best + cheapest
    all_flights.sort(key=lambda f: f.get("_score", 999999))
    best_flights = all_flights[:max_results]

    # Add absolute cheapest if not in top results
    cheapest = min(all_flights, key=lambda f: f.get("price") or 999999)
    cheapest_id = (cheapest.get("airline"), cheapest.get("price"), cheapest.get("departure"))
    best_ids = {(f.get("airline"), f.get("price"), f.get("departure")) for f in best_flights}
    if cheapest_id not in best_ids:
        cheapest_copy = dict(cheapest)
        cheapest_copy["_cheapest"] = True
        best_flights.append(cheapest_copy)

    cache_put("flight", cache_params, best_flights)
    return best_flights
