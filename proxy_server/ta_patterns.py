"""Candlestick pattern detection via TA-Lib CDL* functions (https://ta-lib.org/)."""

from __future__ import annotations

from typing import Any, Literal

from .chart_patterns_structural import (
    STRUCTURAL_PATTERN_IDS,
    STRUCTURAL_SIGNAL_LOOKBACK,
    detect_structural_patterns,
)

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

try:
    import talib
    HAS_TALIB = True
except ImportError:
    talib = None
    HAS_TALIB = False

ChartPatternId = Literal[
    "DOJI",
    "HAMMER",
    "SHOOTING_STAR",
    "BULLISH_ENGULFING",
    "BEARISH_ENGULFING",
    "HEAD_AND_SHOULDERS",
    "INVERSE_HEAD_AND_SHOULDERS",
    "CUP_AND_HANDLE",
]

CDL_PATTERN_IDS: tuple[str, ...] = (
    "DOJI",
    "HAMMER",
    "SHOOTING_STAR",
    "BULLISH_ENGULFING",
    "BEARISH_ENGULFING",
)

ALL_PATTERN_IDS: tuple[str, ...] = CDL_PATTERN_IDS + STRUCTURAL_PATTERN_IDS

PatternDirection = Literal["bullish", "bearish", "neutral"]


def _require_talib() -> None:
    if not HAS_TALIB or talib is None:
        raise RuntimeError(
            "TA-Lib is required for chart pattern detection. "
            "Install the C library (https://ta-lib.org/install/) then: pip install TA-Lib"
        )
    if np is None:
        raise RuntimeError("numpy is required for TA-Lib patterns. pip install numpy")


def _ohlc_arrays(candles: list[dict[str, Any]]):
    _require_talib()
    o = np.array([float(c["open"]) for c in candles], dtype=float)
    h = np.array([float(c["high"]) for c in candles], dtype=float)
    l = np.array([float(c["low"]) for c in candles], dtype=float)
    c = np.array([float(c["close"]) for c in candles], dtype=float)
    return o, h, l, c


def detect_cdl_patterns(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """TA-Lib CDL* candlestick patterns only."""
    if len(candles) < 2:
        return []

    o, h, l, c = _ohlc_arrays(candles)
    n = len(candles)

    doji = talib.CDLDOJI(o, h, l, c)
    hammer = talib.CDLHAMMER(o, h, l, c)
    shooting = talib.CDLSHOOTINGSTAR(o, h, l, c)
    engulf = talib.CDLENGULFING(o, h, l, c)

    out: list[dict[str, Any]] = []
    for i in range(n):
        t = int(candles[i]["time"])
        if doji[i] != 0:
            out.append({"time": t, "name": "DOJI", "direction": "neutral", "strength": int(doji[i])})
        if hammer[i] != 0:
            direction: PatternDirection = "bullish" if hammer[i] > 0 else "bearish"
            out.append({"time": t, "name": "HAMMER", "direction": direction, "strength": int(hammer[i])})
        if shooting[i] != 0:
            direction = "bearish" if shooting[i] < 0 else "bullish"
            out.append({"time": t, "name": "SHOOTING_STAR", "direction": direction, "strength": int(shooting[i])})
        if engulf[i] > 0:
            out.append({"time": t, "name": "BULLISH_ENGULFING", "direction": "bullish", "strength": int(engulf[i])})
        elif engulf[i] < 0:
            out.append({"time": t, "name": "BEARISH_ENGULFING", "direction": "bearish", "strength": int(engulf[i])})

    return out


def detect_patterns(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """CDL (TA-Lib) + structural formations (H&S, cup & handle)."""
    return detect_cdl_patterns(candles) + detect_structural_patterns(candles)


def scan_symbol_patterns(
    symbol: str,
    candles: list[dict[str, Any]],
    selected: list[str],
    lookback_bars: int = 1,
) -> list[dict[str, Any]]:
    """Keep only selected patterns on the latest `lookback_bars` daily bar(s)."""
    if len(candles) < 2 or not selected:
        return []

    selected_set = set(selected)
    all_hits = detect_patterns(candles)
    cdl_set = set(CDL_PATTERN_IDS)
    struct_set = set(STRUCTURAL_PATTERN_IDS)

    last_times = {int(candles[-k]["time"]) for k in range(1, min(lookback_bars, len(candles)) + 1)}
    struct_times = {
        int(candles[-k]["time"])
        for k in range(1, min(STRUCTURAL_SIGNAL_LOOKBACK, len(candles)) + 1)
    }
    latest_time = max(last_times)

    by_time = {int(c["time"]): c for c in candles}
    latest = by_time.get(latest_time)
    if not latest:
        return []

    latest_hits: list[dict[str, Any]] = []
    for p in all_hits:
        if p["name"] not in selected_set:
            continue
        if p["name"] in cdl_set and p["time"] == latest_time:
            latest_hits.append(p)
        elif p["name"] in struct_set and p["time"] in struct_times:
            latest_hits.append(p)

    if not latest_hits:
        return []

    hits_in_lookback = sum(
        1
        for p in all_hits
        if p["name"] in selected_set
        and (
            (p["name"] in cdl_set and p["time"] in last_times)
            or (p["name"] in struct_set and p["time"] in struct_times)
        )
    )

    latest_close = float(latest["close"])
    rows: list[dict[str, Any]] = []
    for hit in latest_hits:
        signal_time = int(hit["time"])
        signal_candle = by_time.get(signal_time, latest)
        prev_idx = next(
            (i for i, c in enumerate(candles) if int(c["time"]) == signal_time),
            len(candles) - 1,
        )
        prev = candles[prev_idx - 1] if prev_idx > 0 else None
        prev_close = float(prev["close"]) if prev else 0.0
        signal_close = float(signal_candle["close"])
        change_pct = (
            ((signal_close - prev_close) / prev_close * 100) if prev_close else 0.0
        )
        rows.append({
            "symbol": symbol,
            "pattern": hit["name"],
            "direction": hit["direction"],
            "signalTime": signal_time,
            "signalDate": _format_signal_date(signal_time),
            "ltp": latest_close,
            "changePercent": change_pct,
            "hitsInLookback": hits_in_lookback,
            "strength": hit.get("strength"),
        })
    return rows


def _format_signal_date(unix_sec: int) -> str:
    from datetime import datetime, timezone

    dt = datetime.fromtimestamp(unix_sec, tz=timezone.utc)
    return dt.strftime("%d %b %Y")
