"""Flight search via SerpAPI or SearchApi.io (Google Flights). Switchable via env var.

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

# Provider switch: "serpapi" (default) or "searchapi"
_PROVIDER = os.environ.get("FLIGHT_API_PROVIDER", "serpapi").lower()

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SEARCHAPI_KEY = os.environ.get("SEARCHAPI_KEY", "")

_API_KEY = SEARCHAPI_KEY if _PROVIDER == "searchapi" else SERPAPI_KEY
_API_BASE = "https://www.searchapi.io/api/v1/search" if _PROVIDER == "searchapi" else "https://serpapi.com/search.json"
_HAS_CALENDAR_API = _PROVIDER == "searchapi"  # Calendar API is SearchApi.io only


def is_available() -> bool:
    return bool(_API_KEY)


# ── Tool definition ──

FLIGHT_SEARCH_TOOL = {
    "name": "flight_search",
    "description": (
        "Search for flights between two cities/airports. "
        "ONLY use this when the user EXPLICITLY asks to search for flights, prices, or tickets. "
        "Do NOT use for general airline questions. "
        "Call ONCE per destination — the tool internally searches multiple dates to find the best deals. "
        "IMPORTANT: Before calling this tool, you MUST first use web search to verify the destination has only 1 airport. "
        "If the city has multiple airports, ask the user which airport they prefer BEFORE calling this tool."
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


# ── Google Flights search (works with both providers) ──

async def _search_google_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search Google Flights for a specific date."""
    if not _API_KEY:
        return []

    params: dict = {
        "engine": "google_flights",
        "departure_id": origin.upper(), "arrival_id": destination.upper(),
        "outbound_date": departure_date, "adults": adults,
        "currency": "JPY", "hl": "ja", "api_key": _API_KEY,
    }
    if return_date:
        params["return_date"] = return_date
        if _PROVIDER == "searchapi":
            params["flight_type"] = "round_trip"
        else:
            params["type"] = "1"  # SerpAPI: 1=round_trip
    else:
        if _PROVIDER == "searchapi":
            params["flight_type"] = "one_way"
        else:
            params["type"] = "2"  # SerpAPI: 2=one_way

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(_API_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

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
        logger.warning("Google Flights timeout (%s): %s→%s on %s", _PROVIDER, origin, destination, departure_date)
        return [{"_api_error": "timeout"}]
    except httpx.HTTPStatusError as e:
        logger.error("Google Flights HTTP %s (%s): %s→%s: %s", e.response.status_code, _PROVIDER, origin, destination, e.response.text[:200])
        return [{"_api_error": f"HTTP {e.response.status_code}"}]
    except Exception as e:
        logger.error("Google Flights error (%s): %s→%s: %s", _PROVIDER, origin, destination, repr(e))
        return []


# ── Helpers ──

def _has_api_error(results: list[dict]) -> str | None:
    for r in results:
        if "_api_error" in r:
            return r["_api_error"]
    return None


async def _search_oneway_cheapest(
    origin: str, destination: str, dates: list[str], adults: int = 1,
) -> list[tuple[str, int]]:
    """Search one-way flights for multiple dates in parallel (SerpAPI method)."""
    async def _get_cheapest(dep_date: str) -> tuple[str, int]:
        results = await _search_google_flights(origin, destination, dep_date, None, adults, max_results=1)
        if _has_api_error(results):
            return (dep_date, -1)
        if results and results[0].get("price"):
            return (dep_date, results[0]["price"])
        return (dep_date, 999999)

    tasks = [_get_cheapest(d) for d in dates]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    prices = [(d, p) for r in results if isinstance(r, tuple) for d, p in [r]]
    prices.sort(key=lambda x: x[1])
    return prices


async def _search_calendar(
    origin: str, destination: str,
    outbound_date: str,
    return_date: str | None = None,
    outbound_date_start: str | None = None,
    outbound_date_end: str | None = None,
    return_date_start: str | None = None,
    return_date_end: str | None = None,
) -> list[dict]:
    """Search Google Flights Calendar API (SearchApi.io only)."""
    if not SEARCHAPI_KEY or _PROVIDER != "searchapi":
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
    if outbound_date_start:
        params["outbound_date_start"] = outbound_date_start
    if outbound_date_end:
        params["outbound_date_end"] = outbound_date_end
    if return_date:
        params["return_date"] = return_date
        params["flight_type"] = "round_trip"
    else:
        params["flight_type"] = "one_way"
    if return_date_start:
        params["return_date_start"] = return_date_start
    if return_date_end:
        params["return_date_end"] = return_date_end

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.get(_API_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
        return data.get("calendar", [])
    except Exception as e:
        logger.warning("Calendar API error: %s→%s: %s", origin, destination, repr(e))
        return []


# ── Main search function ──

async def search_flights(
    origin: str, destination: str,
    departure_month: str = "",
    departure_day_from: int = 1, departure_day_to: int = 10,
    return_month: str = "",
    return_day_from: int = 0, return_day_to: int = 0,
    trip_weeks: int = 2, adults: int = 1,
    departure_date: str = "", return_date: str | None = None, max_results: int = 5,
) -> list[dict]:
    """Flight search. Uses Calendar API (SearchApi.io) or per-date search (SerpAPI)."""
    if not _API_KEY:
        return [{"error": "Google Flights search not configured"}]

    origin = origin.upper()
    destination = destination.upper()

    # Gemini protobuf Struct returns integers as floats — cast to int
    departure_day_from = int(departure_day_from)
    departure_day_to = int(departure_day_to)
    return_day_from = int(return_day_from)
    return_day_to = int(return_day_to)
    trip_weeks = int(trip_weeks)
    adults = int(adults)

    # Handle legacy single-date calls
    if departure_date and not departure_month:
        departure_date = _fix_date(departure_date)
        if return_date:
            return_date = _fix_date(return_date)
        cache_params = {"origin": origin, "dest": destination, "dep": departure_date, "ret": return_date, "adults": adults}
        cached = cache_get("flight", cache_params)
        if cached is not None:
            return cached
        results = await _search_google_flights(origin, destination, departure_date, return_date, adults, max_results)
        api_err = _has_api_error(results)
        if api_err:
            return [{"error": f"flight_search is temporarily unavailable ({api_err}). DO NOT fabricate flight data. Use web search to find approximate flight prices for {origin}→{destination} and present the results with the web search fallback format."}]
        if not results:
            return [{"error": f"No flights found for {origin}→{destination} on {departure_date}. DO NOT fabricate flight data. Use web search as fallback."}]
        cache_put("flight", cache_params, results)
        return results

    # === Date range search ===

    if not departure_month:
        departure_month = date.today().strftime("%Y-%m")

    cache_params = {"origin": origin, "dest": destination, "month": departure_month, "from": departure_day_from, "to": departure_day_to, "ret_month": return_month, "ret_from": return_day_from, "ret_to": return_day_to, "weeks": trip_weeks, "adults": adults, "provider": _PROVIDER}
    cached = cache_get("flight", cache_params)
    if cached is not None:
        return cached

    try:
        year, month = map(int, departure_month.split("-"))
    except ValueError:
        return [{"error": f"Invalid departure_month: {departure_month}"}]

    # Generate departure date candidates
    if departure_day_from == departure_day_to:
        dep_candidates = []
        for offset in [-1, 0, 1]:
            try:
                d = date(year, month, departure_day_from) + timedelta(days=offset)
                if d >= date.today():
                    dep_candidates.append(d)
            except ValueError:
                continue
    else:
        dep_candidates = []
        for day in range(departure_day_from, min(departure_day_to + 1, 29)):
            try:
                d = date(year, month, day)
                if d >= date.today():
                    dep_candidates.append(d)
            except ValueError:
                continue

    if not dep_candidates:
        return [{"error": f"No valid dates in {departure_month} day {departure_day_from}-{departure_day_to}"}]

    dep_start = dep_candidates[0]
    dep_end = dep_candidates[-1]

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

    logger.info("Flight search %s→%s (%s): dates %s~%s, return %s~%s", origin, destination, _PROVIDER, dep_start, dep_end, ret_start, ret_end)

    date_pairs: list[tuple[str, str]] = []

    if _HAS_CALENDAR_API:
        # === SearchApi.io: Use Calendar API (efficient, ~3 API calls) ===
        dep_mid = dep_start + (dep_end - dep_start) // 2
        ret_mid_date = datetime.strptime(ret_start, "%Y-%m-%d").date() + (datetime.strptime(ret_end, "%Y-%m-%d").date() - datetime.strptime(ret_start, "%Y-%m-%d").date()) // 2
        calendar = await _search_calendar(
            origin, destination,
            outbound_date=dep_mid.isoformat(),
            return_date=ret_mid_date.isoformat(),
            outbound_date_start=dep_start.isoformat(),
            outbound_date_end=dep_end.isoformat(),
            return_date_start=ret_start,
            return_date_end=ret_end,
        )

        if calendar:
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

        if not date_pairs:
            dep_mid_str = dep_mid.isoformat()
            ret_fallback = (dep_mid + timedelta(days=trip_weeks * 7)).isoformat()
            date_pairs.append((dep_mid_str, ret_fallback))
    else:
        # === SerpAPI: Per-date search (more API calls) ===
        dep_date_strs = [d.isoformat() for d in dep_candidates]
        dep_prices = await _search_oneway_cheapest(origin, destination, dep_date_strs, adults)

        if dep_prices and all(p == -1 for _, p in dep_prices):
            return [{"error": f"flight_search is temporarily unavailable. DO NOT fabricate flight data. Use web search to find flight prices for {origin}→{destination}."}]

        best_dep_dates = [d for d, p in dep_prices[:2] if p < 999999 and p != -1]
        if not best_dep_dates:
            best_dep_dates = dep_date_strs[:2]

        # Find return dates
        if return_month and return_day_from and return_day_to:
            try:
                ret_year_val, ret_month_val = map(int, return_month.split("-"))
            except ValueError:
                ret_year_val, ret_month_val = year, month
            ret_candidates = []
            for day in range(return_day_from, min(return_day_to + 1, 29)):
                try:
                    ret_candidates.append(date(ret_year_val, ret_month_val, day).isoformat())
                except ValueError:
                    continue
            if ret_candidates:
                ret_prices = await _search_oneway_cheapest(destination, origin, ret_candidates, adults)
                best_ret = ret_prices[0][0] if ret_prices and ret_prices[0][1] < 999999 else ret_candidates[len(ret_candidates) // 2]
                for dep_str in best_dep_dates:
                    date_pairs.append((dep_str, best_ret))

        if not date_pairs:
            trip_days = trip_weeks * 7
            for dep_str in best_dep_dates:
                dep_d = datetime.strptime(dep_str, "%Y-%m-%d").date()
                ret_candidates = [(dep_d + timedelta(days=trip_days + offset)).isoformat() for offset in [-1, 0, 1]]
                ret_prices = await _search_oneway_cheapest(destination, origin, ret_candidates, adults)
                best_ret = ret_prices[0][0] if ret_prices and ret_prices[0][1] < 999999 else (dep_d + timedelta(days=trip_days)).isoformat()
                date_pairs.append((dep_str, best_ret))

    logger.info("Flight search %s→%s: round-trip pairs %s", origin, destination, date_pairs)

    # Search round-trips
    rt_tasks = [_search_google_flights(origin, destination, dep, ret, adults, max_results) for dep, ret in date_pairs]
    rt_results = await asyncio.gather(*rt_tasks, return_exceptions=True)

    all_flights = []
    for r in rt_results:
        if isinstance(r, list):
            all_flights.extend([f for f in r if "_api_error" not in f])

    if not all_flights:
        return [{"error": f"No flights found for {origin}→{destination} in {departure_month}. DO NOT fabricate flight data. Use web search to find approximate prices and airlines for this route instead."}]

    all_flights.sort(key=lambda f: f.get("_score", 999999))
    best_flights = all_flights[:max_results]

    cheapest = min(all_flights, key=lambda f: f.get("price") or 999999)
    cheapest_id = (cheapest.get("airline"), cheapest.get("price"), cheapest.get("departure"))
    best_ids = {(f.get("airline"), f.get("price"), f.get("departure")) for f in best_flights}
    if cheapest_id not in best_ids:
        cheapest_copy = dict(cheapest)
        cheapest_copy["_cheapest"] = True
        best_flights.append(cheapest_copy)

    cache_put("flight", cache_params, best_flights)
    return best_flights
