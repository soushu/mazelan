"""Flight search via SerpAPI (Google Flights) and Travelpayouts (Aviasales).

Smart search: uses Travelpayouts month matrix to find cheapest dates,
then searches Google Flights for detailed results on those dates.
One tool call returns comprehensive results.
"""

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
    return bool(SERPAPI_KEY) or bool(TRAVELPAYOUTS_TOKEN)


# ── Tool definition ──

FLIGHT_SEARCH_TOOL = {
    "name": "flight_search",
    "description": (
        "Search for flights between two cities/airports. Call this ONCE per destination — "
        "the tool internally searches multiple dates and return periods to find the best deals. "
        "Returns top recommended flights + cheapest option with prices, airlines, and booking links."
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
                "description": "Earliest departure day of month (e.g. 1 for 'early month'). Default: 1",
                "default": 1,
            },
            "departure_day_to": {
                "type": "integer",
                "description": "Latest departure day of month (e.g. 10 for 'early month'). Default: 10",
                "default": 10,
            },
            "trip_weeks": {
                "type": "integer",
                "description": "Approximate trip duration in weeks (2 or 3). Default: 2",
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


# ── Travelpayouts month matrix ──

async def _get_month_prices(origin: str, destination: str, month: str) -> dict[str, int]:
    """Get daily cheapest prices for a month. Returns {date_str: price}."""
    if not TRAVELPAYOUTS_TOKEN:
        return {}
    params = {
        "origin": origin.upper(), "destination": destination.upper(),
        "month": month, "currency": "JPY", "token": TRAVELPAYOUTS_TOKEN,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{TRAVELPAYOUTS_BASE}/v2/prices/month-matrix", params=params)
            resp.raise_for_status()
            data = resp.json()
        if not data.get("success"):
            return {}
        return {item["depart_date"]: item["value"] for item in data.get("data", []) if item.get("depart_date") and item.get("value")}
    except Exception as e:
        logger.error("Travelpayouts month-matrix error: %s", e)
        return {}


# ── Google Flights search ──

async def _search_google_flights(
    origin: str, destination: str, departure_date: str,
    return_date: str | None = None, adults: int = 1, max_results: int = 5,
) -> list[dict]:
    """Search Google Flights via SerpAPI for a specific date."""
    if not SERPAPI_KEY:
        return []

    params: dict = {
        "engine": "google_flights",
        "departure_id": origin.upper(), "arrival_id": destination.upper(),
        "outbound_date": departure_date, "adults": adults,
        "currency": "JPY", "hl": "ja", "api_key": SERPAPI_KEY,
    }
    if return_date:
        params["return_date"] = return_date
        params["type"] = "1"
    else:
        params["type"] = "2"

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(SERPAPI_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()

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
                    "_score": _flight_score(price, duration, stops),
                })

        flights.sort(key=lambda f: f.get("_score", 999999))
        return flights[:max_results]

    except httpx.TimeoutException:
        logger.warning("Google Flights timeout: %s→%s on %s", origin, destination, departure_date)
        return []
    except httpx.HTTPStatusError as e:
        logger.error("Google Flights HTTP %s: %s→%s: %s", e.response.status_code, origin, destination, e.response.text[:200])
        return []
    except Exception as e:
        logger.error("Google Flights error: %s→%s: %s", origin, destination, repr(e))
        return []


# ── Main search function (called once per destination) ──

async def search_flights(
    origin: str, destination: str,
    departure_month: str = "",  # YYYY-MM
    departure_day_from: int = 1, departure_day_to: int = 10,
    trip_weeks: int = 2, adults: int = 1,
    # Legacy params (backward compat)
    departure_date: str = "", return_date: str | None = None, max_results: int = 5,
) -> list[dict]:
    """Smart flight search: find best dates automatically, then get detailed results.

    1. Use Travelpayouts month matrix to find cheapest departure dates
    2. Generate return date candidates (trip_weeks ± 3 days)
    3. Use Travelpayouts to find cheapest return dates
    4. Search Google Flights for top 2 date combinations (parallel)
    5. Score, merge, and return best + cheapest
    """
    if not SERPAPI_KEY and not TRAVELPAYOUTS_TOKEN:
        return [{"error": "No flight search API configured"}]

    origin = origin.upper()
    destination = destination.upper()

    # Handle legacy single-date calls
    if departure_date and not departure_month:
        departure_date = _fix_date(departure_date)
        if return_date:
            return_date = _fix_date(return_date)
        results = await _search_google_flights(origin, destination, departure_date, return_date, adults, max_results)
        if not results:
            return [{"error": f"No flights found for {origin}→{destination} on {departure_date}"}]
        return results

    # === Smart search flow ===

    # Step 1: Get departure month prices from Travelpayouts
    if not departure_month:
        departure_month = date.today().strftime("%Y-%m")

    dep_prices = await _get_month_prices(origin, destination, departure_month)

    # Filter to requested day range
    candidate_dates = []
    for d_str, price in dep_prices.items():
        try:
            d = datetime.strptime(d_str, "%Y-%m-%d").date()
            if departure_day_from <= d.day <= departure_day_to:
                candidate_dates.append((d_str, price))
        except ValueError:
            continue

    # If no Travelpayouts data, generate dates manually
    if not candidate_dates:
        try:
            year, month = map(int, departure_month.split("-"))
            for day in range(departure_day_from, min(departure_day_to + 1, 29)):
                d = date(year, month, day)
                if d >= date.today():
                    candidate_dates.append((d.isoformat(), 999999))
        except ValueError:
            return [{"error": f"Invalid departure_month: {departure_month}"}]

    # Pick top 2 cheapest departure dates
    candidate_dates.sort(key=lambda x: x[1])
    best_dep_dates = [d for d, _ in candidate_dates[:2]]

    if not best_dep_dates:
        return [{"error": f"No valid departure dates for {origin}→{destination} in {departure_month}"}]

    # Step 2: For each departure date, find best return dates
    trip_days_min = trip_weeks * 7 - 3
    trip_days_max = trip_weeks * 7 + 4

    # Get return month prices
    ret_months = set()
    for dep_str in best_dep_dates:
        dep_d = datetime.strptime(dep_str, "%Y-%m-%d").date()
        for offset in [trip_days_min, trip_days_max]:
            ret_d = dep_d + timedelta(days=offset)
            ret_months.add(ret_d.strftime("%Y-%m"))

    ret_price_tasks = [_get_month_prices(destination, origin, m) for m in ret_months]
    ret_price_results = await asyncio.gather(*ret_price_tasks, return_exceptions=True)
    ret_prices: dict[str, int] = {}
    for r in ret_price_results:
        if isinstance(r, dict):
            ret_prices.update(r)

    # Step 3: Build best date pairs (departure, return)
    date_pairs: list[tuple[str, str]] = []
    for dep_str in best_dep_dates:
        dep_d = datetime.strptime(dep_str, "%Y-%m-%d").date()
        ret_candidates = []
        for offset in range(trip_days_min, trip_days_max + 1):
            ret_d = dep_d + timedelta(days=offset)
            ret_str = ret_d.isoformat()
            ret_price = ret_prices.get(ret_str, 999999)
            ret_candidates.append((ret_str, ret_price))
        ret_candidates.sort(key=lambda x: x[1])
        best_ret = ret_candidates[0][0] if ret_candidates else (dep_d + timedelta(days=trip_weeks * 7)).isoformat()
        date_pairs.append((dep_str, best_ret))

    # Step 4: Search Google Flights for best date pairs (parallel)
    search_tasks = [
        _search_google_flights(origin, destination, dep, ret, adults, max_results)
        for dep, ret in date_pairs
    ]
    search_results = await asyncio.gather(*search_tasks, return_exceptions=True)

    all_flights = []
    for r in search_results:
        if isinstance(r, list):
            all_flights.extend(r)

    if not all_flights:
        return [{"error": f"No flights found for {origin}→{destination} in {departure_month}. Try different dates."}]

    # Step 5: Score and return best + cheapest
    all_flights.sort(key=lambda f: f.get("_score", 999999))
    best_flights = all_flights[:max_results]

    # Find absolute cheapest
    cheapest = min(all_flights, key=lambda f: f.get("price") or 999999)
    cheapest_id = (cheapest.get("airline"), cheapest.get("price"), cheapest.get("departure"))
    best_ids = {(f.get("airline"), f.get("price"), f.get("departure")) for f in best_flights}
    if cheapest_id not in best_ids:
        cheapest_copy = dict(cheapest)
        cheapest_copy["_cheapest"] = True
        best_flights.append(cheapest_copy)

    return best_flights
