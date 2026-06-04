"""Append/replace today's daily bar from intraday session or Upstox LTP."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import aiohttp

from . import upstox_sdk
from .config import resolve_instrument_key

IST = ZoneInfo("Asia/Kolkata")


def ist_day_key(unix_sec: int) -> str:
    return datetime.fromtimestamp(unix_sec, tz=IST).strftime("%Y-%m-%d")


def today_ist_key() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def ist_session_open_unix(day_key: str) -> int:
    y, m, d = (int(x) for x in day_key.split("-"))
    dt = datetime(y, m, d, 9, 15, tzinfo=IST)
    return int(dt.timestamp())


def daily_missing_today(daily: list[dict[str, Any]]) -> bool:
    if not daily:
        return True
    return ist_day_key(int(daily[-1]["time"])) != today_ist_key()


def merge_intraday_session_for_day(
    daily: list[dict[str, Any]],
    intraday: list[dict[str, Any]],
    day_key: str,
) -> list[dict[str, Any]]:
    if not intraday:
        return daily

    session = [c for c in intraday if ist_day_key(int(c["time"])) == day_key]
    if not session:
        return daily

    session.sort(key=lambda x: int(x["time"]))
    o = session[0]["open"]
    h = max(float(c["high"]) for c in session)
    l = min(float(c["low"]) for c in session)
    cl = session[-1]["close"]
    vol = sum(float(c.get("volume") or 0) for c in session)

    existing = next((c for c in daily if ist_day_key(int(c["time"])) == day_key), None)
    bar_time = int(existing["time"]) if existing else ist_session_open_unix(day_key)
    bar = {
        "time": bar_time,
        "open": float(o),
        "high": h,
        "low": l,
        "close": cl,
        "volume": vol,
    }
    history = [c for c in daily if ist_day_key(int(c["time"])) != day_key]
    merged = history + [bar]
    merged.sort(key=lambda c: int(c["time"]))
    return merged


def append_today_from_ltp(
    daily: list[dict[str, Any]],
    ltp: float,
    day_key: str | None = None,
) -> list[dict[str, Any]]:
    key = day_key or today_ist_key()
    if any(ist_day_key(int(c["time"])) == key for c in daily):
        return merge_intraday_session_for_day(
            daily,
            [
                {
                    "time": ist_session_open_unix(key),
                    "open": ltp,
                    "high": ltp,
                    "low": ltp,
                    "close": ltp,
                    "volume": 0,
                }
            ],
            key,
        )

    prev_close = float(daily[-1]["close"]) if daily else ltp
    o = prev_close
    bar = {
        "time": ist_session_open_unix(key),
        "open": o,
        "high": max(o, ltp),
        "low": min(o, ltp),
        "close": ltp,
        "volume": 0,
    }
    return [*daily, bar]


def parse_ltp_from_upstox_response(data: Any, instrument_key: str) -> float | None:
    if not isinstance(data, dict):
        return None
    payload = data.get("data", data)
    if not isinstance(payload, dict):
        return None
    quote = payload.get(instrument_key) or payload.get(instrument_key.upper())
    if not isinstance(quote, dict) and payload:
        quote = next(iter(payload.values()), None)
    if not isinstance(quote, dict):
        return None
    for key in ("last_price", "lastPrice", "ltp", "close"):
        val = quote.get(key)
        if val is not None:
            try:
                return float(val)
            except (TypeError, ValueError):
                continue
    return None


async def fetch_symbol_ltp(
    session: aiohttp.ClientSession,
    symbol: str,
    user_access_token: str | None,
) -> float | None:
    instrument_key = resolve_instrument_key(symbol.upper())
    if not instrument_key:
        return None
    try:
        raw = await upstox_sdk.get_ltp(user_access_token, instrument_key)
        return parse_ltp_from_upstox_response(raw, instrument_key)
    except RuntimeError:
        return None


async def enrich_daily_candles(
    daily: list[dict[str, Any]],
    intraday: list[dict[str, Any]],
    *,
    session: aiohttp.ClientSession | None = None,
    symbol: str | None = None,
    user_access_token: str | None = None,
) -> list[dict[str, Any]]:
    """Ensure the series includes today's IST bar (intraday aggregate, else LTP)."""
    today_key = today_ist_key()
    merged = merge_intraday_session_for_day(daily, intraday, today_key)
    if not daily_missing_today(merged):
        return merged
    if session and symbol:
        ltp = await fetch_symbol_ltp(session, symbol, user_access_token)
        if ltp is not None and ltp > 0:
            return append_today_from_ltp(merged, ltp, today_key)
    return merged
