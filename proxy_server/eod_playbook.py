"""End-of-day F&O analysis → next-session playbook."""

from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from . import cache, ta_indicators
from .config import CACHE_DIR, FNO_STOCKS
from .live_scanner import POPULAR_SCAN_SYMBOLS

IST = ZoneInfo("Asia/Kolkata")


def _ist_today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _ist_day_from_ts(unix_sec: int) -> str:
    return datetime.fromtimestamp(unix_sec, tz=IST).strftime("%Y-%m-%d")


def _latest_session_candles(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not candles:
        return []
    last_day = _ist_day_from_ts(int(candles[-1].get("time") or 0))
    return [c for c in candles if _ist_day_from_ts(int(c.get("time") or 0)) == last_day]


def _playbook_cache_key(session_date: str) -> str:
    return f"fno:playbook:{session_date}"


def _playbook_disk_path(session_date: str):
    return CACHE_DIR / f"fno-playbook-{session_date}.json"


def load_playbook(session_date: str | None = None) -> dict[str, Any] | None:
    day = session_date or _ist_today()
    cached = cache.get_cached(_playbook_cache_key(day))
    if cached:
        return cached
    path = _playbook_disk_path(day)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            cache.set_cache(_playbook_cache_key(day), data, 86400000)
            return data
        except (json.JSONDecodeError, OSError):
            pass
    return None


def save_playbook(payload: dict[str, Any]) -> None:
    day = payload.get("sessionDate") or _ist_today()
    cache.set_cache(_playbook_cache_key(day), payload, 86400000)
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _playbook_disk_path(day).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"  ⚠️ Failed to write playbook to disk: {exc}")


def build_playbook_row(symbol: str, candles: list[dict[str, Any]]) -> dict[str, Any] | None:
    session = _latest_session_candles(candles)
    if len(session) < 5:
        return None

    close = float(session[-1]["close"])
    open_ = float(session[0]["open"])
    high = max(float(c["high"]) for c in session)
    low = min(float(c["low"]) for c in session)
    day_range = high - low or 1e-9
    change_pct = (close - open_) / open_ * 100 if open_ else 0
    close_position = (close - low) / day_range

    vwap_vals = ta_indicators.vwap(session)
    vwap_close = next((v for v in reversed(vwap_vals) if v is not None), None)

    core = ta_indicators.compute_from_candles(
        session,
        ["rsi", "macd", "adx", "ema", "vwap"],
    )
    summary = core.get("summary") or {}

    reasons: list[str] = []
    score_long = 0
    score_short = 0

    if vwap_close is not None:
        if close > vwap_close:
            score_long += 1
            reasons.append("Closed above session VWAP")
        else:
            score_short += 1
            reasons.append("Closed below session VWAP")

    if change_pct >= 0.6:
        score_long += 1
        reasons.append(f"Strong day +{change_pct:.1f}%")
    elif change_pct <= -0.6:
        score_short += 1
        reasons.append(f"Weak day {change_pct:.1f}%")

    trend = summary.get("trend") or "sideways"
    if trend == "uptrend":
        score_long += 1
        reasons.append("Intraday trend up (EMA)")
    elif trend == "downtrend":
        score_short += 1
        reasons.append("Intraday trend down (EMA)")

    macd = summary.get("macdSignal") or "neutral"
    if macd == "bullish":
        score_long += 1
        reasons.append("MACD bullish")
    elif macd == "bearish":
        score_short += 1
        reasons.append("MACD bearish")

    if close_position >= 0.72:
        score_long += 1
        reasons.append("Closed in upper third of range")
    elif close_position <= 0.28:
        score_short += 1
        reasons.append("Closed in lower third of range")

    rsi = summary.get("rsi")
    if rsi is not None:
        if rsi > 60:
            score_long += 1
        elif rsi < 40:
            score_short += 1

    if score_long >= score_short + 2:
        bias = "LONG"
        confidence = "high" if score_long >= 4 else "medium"
        action = (
            f"Next session: prefer longs above VWAP ₹{vwap_close:.0f}. "
            f"Trigger on break above ₹{high:.0f}; avoid shorts until below VWAP."
        )
        stop_loss = round(low, 2)
        trigger_up = round(high, 2)
        trigger_down = round(vwap_close, 2) if vwap_close else round(low, 2)
    elif score_short >= score_long + 2:
        bias = "SHORT"
        confidence = "high" if score_short >= 4 else "medium"
        action = (
            f"Next session: prefer shorts below VWAP ₹{vwap_close:.0f}. "
            f"Trigger on break below ₹{low:.0f}; avoid longs until above VWAP."
        )
        stop_loss = round(high, 2)
        trigger_up = round(vwap_close, 2) if vwap_close else round(high, 2)
        trigger_down = round(low, 2)
    else:
        bias = "RANGE"
        confidence = "low"
        action = (
            f"Next session: range-bound ₹{low:.0f}–₹{high:.0f}. "
            f"Wait for open drive; trade breakouts only with volume."
        )
        stop_loss = None
        trigger_up = round(high, 2)
        trigger_down = round(low, 2)

    return {
        "symbol": symbol.upper(),
        "bias": bias,
        "confidence": confidence,
        "action": action,
        "close": round(close, 2),
        "changePct": round(change_pct, 2),
        "dayHigh": round(high, 2),
        "dayLow": round(low, 2),
        "vwap": round(vwap_close, 2) if vwap_close else None,
        "stopLoss": stop_loss,
        "triggerUp": trigger_up,
        "triggerDown": trigger_down,
        "rsi": round(rsi, 1) if rsi is not None else None,
        "trend": trend,
        "macdSignal": macd,
        "scoreLong": score_long,
        "scoreShort": score_short,
        "reasons": reasons[:5],
    }


async def generate_playbook(
    session: Any,
    token: str,
    symbols: list[str] | None = None,
    *,
    universe: str = "popular",
) -> dict[str, Any]:
    from .handlers import fetch_candles_for_ta

    if symbols is None:
        symbols = list(FNO_STOCKS) if universe == "all" else list(POPULAR_SCAN_SYMBOLS)

    rows: list[dict[str, Any]] = []
    errors = 0
    session_date = _ist_today()

    for i, symbol in enumerate(symbols):
        try:
            candles = await fetch_candles_for_ta(session, symbol, "1D", token, "1")
            row = build_playbook_row(symbol, candles)
            if row:
                rows.append(row)
        except Exception:
            errors += 1
        if i % 10 == 9:
            await __import__("asyncio").sleep(0.1)

    longs = sorted([r for r in rows if r["bias"] == "LONG"], key=lambda x: x["scoreLong"], reverse=True)
    shorts = sorted([r for r in rows if r["bias"] == "SHORT"], key=lambda x: x["scoreShort"], reverse=True)
    ranges = [r for r in rows if r["bias"] == "RANGE"]

    payload = {
        "sessionDate": session_date,
        "generatedAt": int(time.time() * 1000),
        "universe": universe,
        "symbolCount": len(symbols),
        "analyzed": len(rows),
        "errors": errors,
        "longPlays": longs[:30],
        "shortPlays": shorts[:30],
        "rangePlays": ranges[:20],
        "topLong": longs[:10],
        "topShort": shorts[:10],
    }
    save_playbook(payload)
    print(f"  📋 F&O playbook saved for {session_date}: {len(longs)} long, {len(shorts)} short ideas")
    return payload


def is_market_hours_ist() -> bool:
    now = datetime.now(IST)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 9 * 60 + 15 <= minutes <= 15 * 60 + 30


def should_auto_generate_playbook() -> bool:
    now = datetime.now(IST)
    if now.weekday() >= 5:
        return False
    # After 3:45 PM IST, before midnight
    minutes = now.hour * 60 + now.minute
    if minutes < 15 * 60 + 45:
        return False
    return load_playbook(_ist_today()) is None
