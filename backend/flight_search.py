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
TRAVELPAYOUTS_TOKEN = os.environ.get("TRAVELPAYOUTS_TOKEN", "")
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



def _build_aviasales_link(origin: str, dest: str, dep_date: str, ret_date: str | None) -> str:
    """Build Aviasales search URL."""
    try:
        dep_dt = datetime.strptime(dep_date, "%Y-%m-%d")
        dep_ddmm = dep_dt.strftime("%d%m")
        if ret_date:
            ret_dt = datetime.strptime(ret_date, "%Y-%m-%d")
            ret_ddmm = ret_dt.strftime("%d%m")
            return f"https://www.aviasales.com/search/{origin}{dep_ddmm}{dest}{ret_ddmm}1"
        return f"https://www.aviasales.com/search/{origin}{dep_ddmm}{dest}1"
    except ValueError:
        return f"https://www.aviasales.com/search/{origin}{dest}1"


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
        params["type"] = "1"
    else:
        params["type"] = "2"

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(SEARCHAPI_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

        # Get Google Flights URL from SerpAPI response (reliable, pre-built by Google)
        gf_url = data.get("search_metadata", {}).get("google_flights_url", "")

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
                    "search_link": _build_aviasales_link(dep_airport, arr_airport, departure_date, return_date),
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


async def _search_oneway_cheapest(
    origin: str, destination: str, dates: list[str], adults: int = 1,
) -> list[tuple[str, int]]:
    """Search one-way flights for multiple dates in parallel, return (date, cheapest_price) pairs."""
    async def _get_cheapest_for_date(dep_date: str) -> tuple[str, int]:
        results = await _search_google_flights(origin, destination, dep_date, None, adults, max_results=1)
        if _has_api_error(results):
            return (dep_date, -1)  # Signal API error
        if results and results[0].get("price"):
            return (dep_date, results[0]["price"])
        return (dep_date, 999999)

    tasks = [_get_cheapest_for_date(d) for d in dates]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    prices = []
    for r in results:
        if isinstance(r, tuple):
            prices.append(r)
    prices.sort(key=lambda x: x[1])
    return prices


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
    """Flight search using Google Flights calendar method.

    Searches exactly the dates the user specified:
    1. Check one-way outbound prices for all dates in user's range → find 2 cheapest
    2. For each cheap departure, check return prices (±1 day from trip_weeks) → find cheapest
    3. Search round-trip for top 2 date combos → get detailed results
    4. Score, merge, return best + cheapest
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

    # Step 1: Generate departure date candidates from user-specified range
    try:
        year, month = map(int, departure_month.split("-"))
    except ValueError:
        return [{"error": f"Invalid departure_month: {departure_month}"}]

    dep_candidates = []
    if departure_day_from == departure_day_to:
        # Specific day (e.g. "4月1日頃") → search ±1 day
        for offset in [-1, 0, 1]:
            try:
                d = date(year, month, departure_day_from) + timedelta(days=offset)
                if d >= date.today():
                    dep_candidates.append(d.isoformat())
            except ValueError:
                continue
    else:
        # Range (e.g. "4月最初の週") → search all days in range
        for day in range(departure_day_from, departure_day_to + 1):
            try:
                d = date(year, month, day)
                if d >= date.today():
                    dep_candidates.append(d.isoformat())
            except ValueError:
                continue
    if not dep_candidates:
        return [{"error": f"No valid dates in {departure_month} day {departure_day_from}-{departure_day_to}"}]

    logger.info("Flight search %s→%s: checking outbound dates %s", origin, destination, dep_candidates)

    # Step 2: Find cheapest outbound dates (one-way search, parallel)
    dep_prices = await _search_oneway_cheapest(origin, destination, dep_candidates, adults)

    # Check for API errors (price == -1 signals API failure)
    if dep_prices and all(p == -1 for _, p in dep_prices):
        return [{"error": f"flight_search is temporarily unavailable. DO NOT tell the user the service is unavailable. Instead, use web search to find flight prices for {origin}→{destination} and present the results."}]

    best_dep_dates = [d for d, p in dep_prices[:2] if p < 999999 and p != -1]

    if not best_dep_dates:
        # Fallback: use first and middle dates
        best_dep_dates = dep_candidates[:2]

    logger.info("Flight search %s→%s: cheapest outbound dates %s", origin, destination, best_dep_dates)

    # Step 3: Find cheapest return dates
    date_pairs: list[tuple[str, str]] = []

    if return_month and return_day_from and return_day_to:
        # User specified explicit return date range (e.g. "5月第3週に帰国")
        try:
            ret_year, ret_month = map(int, return_month.split("-"))
        except ValueError:
            ret_year, ret_month = year, month  # fallback

        ret_candidates = []
        if return_day_from == return_day_to:
            # Specific return day → ±1 day
            for offset in [-1, 0, 1]:
                try:
                    d = date(ret_year, ret_month, return_day_from) + timedelta(days=offset)
                    ret_candidates.append(d.isoformat())
                except ValueError:
                    continue
        else:
            # Return date range → all days
            for day in range(return_day_from, return_day_to + 1):
                try:
                    ret_candidates.append(date(ret_year, ret_month, day).isoformat())
                except ValueError:
                    continue

        if ret_candidates:
            ret_prices = await _search_oneway_cheapest(destination, origin, ret_candidates, adults)
            best_ret = ret_prices[0][0] if ret_prices and ret_prices[0][1] < 999999 else ret_candidates[len(ret_candidates) // 2]
            for dep_str in best_dep_dates:
                date_pairs.append((dep_str, best_ret))

    if not date_pairs:
        # Fallback: calculate return from trip_weeks
        trip_days_center = trip_weeks * 7
        for dep_str in best_dep_dates:
            dep_d = datetime.strptime(dep_str, "%Y-%m-%d").date()
            ret_candidates = []
            for offset in [-1, 0, 1]:
                ret_d = dep_d + timedelta(days=trip_days_center + offset)
                ret_candidates.append(ret_d.isoformat())

            ret_prices = await _search_oneway_cheapest(destination, origin, ret_candidates, adults)
            best_ret = ret_prices[0][0] if ret_prices and ret_prices[0][1] < 999999 else (dep_d + timedelta(days=trip_days_center)).isoformat()
            date_pairs.append((dep_str, best_ret))

    logger.info("Flight search %s→%s: searching round-trips %s", origin, destination, date_pairs)

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
