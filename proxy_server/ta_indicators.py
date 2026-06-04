"""TA-Lib technical analysis (https://ta-lib.org/) with numpy fallback."""

from __future__ import annotations

import math
from typing import Any

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


def _arr(values: list[float]):
    if np is None:
        raise RuntimeError("numpy is required for TA indicators. pip install numpy")
    return np.array(values, dtype=float)


def _null_list(n: int) -> list[float | None]:
    return [None] * n


def _to_list(arr) -> list[float | None]:
    if arr is None:
        return []
    out: list[float | None] = []
    for v in arr:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            out.append(None)
        else:
            out.append(float(v))
    return out


def ema(values: list[float], period: int) -> list[float | None]:
    if HAS_TALIB:
        return _to_list(talib.EMA(_arr(values), timeperiod=period))
    out = _null_list(len(values))
    if len(values) < period:
        return out
    k = 2 / (period + 1)
    prev = sum(values[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rsi(values: list[float], period: int = 14) -> list[float | None]:
    if HAS_TALIB:
        return _to_list(talib.RSI(_arr(values), timeperiod=period))
    out = _null_list(len(values))
    if len(values) <= period:
        return out
    avg_gain = avg_loss = 0.0
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        if diff >= 0:
            avg_gain += diff
        else:
            avg_loss -= diff
    avg_gain /= period
    avg_loss /= period
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(values)):
        diff = values[i] - values[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def macd(values: list[float], fast=12, slow=26, signal=9) -> dict[str, list[float | None]]:
    if HAS_TALIB:
        m, s, h = talib.MACD(_arr(values), fastperiod=fast, slowperiod=slow, signalperiod=signal)
        return {"macd": _to_list(m), "signal": _to_list(s), "hist": _to_list(h)}
    ema_f = ema(values, fast)
    ema_s = ema(values, slow)
    line = [
        (ema_f[i] - ema_s[i]) if ema_f[i] is not None and ema_s[i] is not None else None
        for i in range(len(values))
    ]
    nums = [x if x is not None else 0.0 for x in line]
    sig = ema(nums, signal)
    hist = [line[i] - sig[i] if line[i] is not None and sig[i] is not None else None for i in range(len(values))]
    return {"macd": line, "signal": sig, "hist": hist}


def bbands(values: list[float], period=20, std=2.0) -> dict[str, list[float | None]]:
    if HAS_TALIB:
        u, m, l = talib.BBANDS(_arr(values), timeperiod=period, nbdevup=std, nbdevdn=std)
        return {"upper": _to_list(u), "middle": _to_list(m), "lower": _to_list(l)}
    middle = sma(values, period)
    upper = _null_list(len(values))
    lower = _null_list(len(values))
    for i in range(period - 1, len(values)):
        slice_ = values[i - period + 1 : i + 1]
        mean = middle[i]
        if mean is None:
            continue
        variance = sum((v - mean) ** 2 for v in slice_) / period
        sd = math.sqrt(variance)
        upper[i] = mean + std * sd
        lower[i] = mean - std * sd
    return {"upper": upper, "middle": middle, "lower": lower}


def sma(values: list[float], period: int) -> list[float | None]:
    if HAS_TALIB:
        return _to_list(talib.SMA(_arr(values), timeperiod=period))
    out = _null_list(len(values))
    for i in range(period - 1, len(values)):
        out[i] = sum(values[i - period + 1 : i + 1]) / period
    return out


def atr(high: list[float], low: list[float], close: list[float], period=14) -> list[float | None]:
    if HAS_TALIB:
        return _to_list(talib.ATR(_arr(high), _arr(low), _arr(close), timeperiod=period))
    out = _null_list(len(close))
    if len(close) < 2:
        return out
    tr = [high[0] - low[0]]
    for i in range(1, len(close)):
        tr.append(max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1])))
    if len(tr) < period:
        return out
    sm = sum(tr[:period])
    out[period - 1] = sm / period
    for i in range(period, len(tr)):
        sm = (out[i - 1] * (period - 1) + tr[i]) / period
        out[i] = sm
    return out


def adx(high: list[float], low: list[float], close: list[float], period=14) -> list[float | None]:
    if HAS_TALIB:
        return _to_list(talib.ADX(_arr(high), _arr(low), _arr(close), timeperiod=period))
    # simplified fallback — reuse atr-style logic (same as TS port)
    n = len(close)
    out = _null_list(n)
    if n < period * 2:
        return out
    plus_dm, minus_dm, tr_arr = [], [], []
    for i in range(1, n):
        up = high[i] - high[i - 1]
        down = low[i - 1] - low[i]
        plus_dm.append(up if up > down and up > 0 else 0)
        minus_dm.append(down if down > up and down > 0 else 0)
        tr_arr.append(max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1])))
    sm_tr = sum(tr_arr[:period])
    sm_plus = sum(plus_dm[:period])
    sm_minus = sum(minus_dm[:period])
    dx: list[float | None] = _null_list(n)
    for i in range(period, len(tr_arr)):
        sm_tr = sm_tr - sm_tr / period + tr_arr[i]
        sm_plus = sm_plus - sm_plus / period + plus_dm[i]
        sm_minus = sm_minus - sm_minus / period + minus_dm[i]
        pdi = 0 if sm_tr == 0 else 100 * sm_plus / sm_tr
        mdi = 0 if sm_tr == 0 else 100 * sm_minus / sm_tr
        s = pdi + mdi
        dx[i + 1] = 0 if s == 0 else 100 * abs(pdi - mdi) / s
    adx_start = period * 2 - 1
    vals = [dx[i] for i in range(period, adx_start + 1) if dx[i] is not None]
    if not vals:
        return out
    adx_val = sum(vals) / len(vals)
    out[adx_start] = adx_val
    for i in range(adx_start + 1, n):
        if dx[i] is not None and out[i - 1] is not None:
            adx_val = (out[i - 1] * (period - 1) + dx[i]) / period
            out[i] = adx_val
    return out


def _ist_day_key(unix_sec: int) -> str:
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    dt = datetime.fromtimestamp(unix_sec, tz=timezone.utc).astimezone(ZoneInfo("Asia/Kolkata"))
    return dt.strftime("%Y-%m-%d")


def _is_intraday(candles: list[dict[str, Any]]) -> bool:
    if len(candles) < 3:
        return False
    days = {_ist_day_key(int(c.get("time") or 0)) for c in candles}
    return len(days) < len(candles) * 0.85


def vwap(candles: list[dict[str, Any]]) -> list[float | None]:
    """Session VWAP (intraday) or cumulative anchored VWAP (daily)."""
    out: list[float | None] = []
    session_reset = _is_intraday(candles)
    has_volume = any(float(c.get("volume") or 0) > 0 for c in candles)
    cum_vol_price = 0.0
    cum_vol = 0.0
    session_day: str | None = None

    for c in candles:
        day = _ist_day_key(int(c.get("time") or 0))
        if session_reset and session_day != day:
            cum_vol_price = 0.0
            cum_vol = 0.0
            session_day = day

        raw_vol = float(c.get("volume") or 0)
        vol = raw_vol if has_volume else 1.0
        tp = (float(c["high"]) + float(c["low"]) + float(c["close"])) / 3.0

        if vol > 0:
            cum_vol_price += tp * vol
            cum_vol += vol
            out.append(cum_vol_price / cum_vol)
        elif cum_vol > 0:
            out.append(cum_vol_price / cum_vol)
        else:
            out.append(None)
    return out


def obv(close: list[float], volume: list[float]) -> list[float | None]:
    if HAS_TALIB:
        return _to_list(talib.OBV(_arr(close), _arr(volume)))
    out: list[float | None] = [0.0]
    for i in range(1, len(close)):
        prev = out[-1] or 0
        if close[i] > close[i - 1]:
            out.append(prev + volume[i])
        elif close[i] < close[i - 1]:
            out.append(prev - volume[i])
        else:
            out.append(prev)
    return out


def stoch(high, low, close, k_period=14, d_period=3):
    if HAS_TALIB:
        k, d = talib.STOCH(
            _arr(high), _arr(low), _arr(close),
            fastk_period=k_period, slowk_period=d_period, slowd_period=d_period,
        )
        return {"k": _to_list(k), "d": _to_list(d)}
    k = _null_list(len(close))
    for i in range(k_period - 1, len(close)):
        hh = max(high[i - k_period + 1 : i + 1])
        ll = min(low[i - k_period + 1 : i + 1])
        k[i] = 50 if hh == ll else (close[i] - ll) / (hh - ll) * 100
    d = sma([x if x is not None else 0 for x in k], d_period)
    return {"k": k, "d": d}


def detect_patterns(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    patterns = []
    for i in range(1, len(candles)):
        c, p = candles[i], candles[i - 1]
        body = abs(c["close"] - c["open"])
        rng = c["high"] - c["low"] or 1e-9
        uw = c["high"] - max(c["open"], c["close"])
        lw = min(c["open"], c["close"]) - c["low"]
        t = c.get("time")
        if body / rng < 0.1:
            patterns.append({"time": t, "name": "DOJI", "direction": "neutral"})
        if lw > body * 2 and uw < body * 0.5 and c["close"] >= c["open"]:
            patterns.append({"time": t, "name": "HAMMER", "direction": "bullish"})
        if p["close"] < p["open"] and c["close"] > c["open"] and c["open"] <= p["close"] and c["close"] >= p["open"]:
            patterns.append({"time": t, "name": "BULLISH_ENGULFING", "direction": "bullish"})
        if p["close"] > p["open"] and c["close"] < c["open"] and c["open"] >= p["close"] and c["close"] <= p["open"]:
            patterns.append({"time": t, "name": "BEARISH_ENGULFING", "direction": "bearish"})
    return patterns


def _last_valid(arr: list[float | None]) -> float | None:
    for v in reversed(arr):
        if v is not None:
            return v
    return None


def build_summary(candles: list[dict], indicators: dict) -> dict[str, Any]:
    rsi_v = _last_valid(indicators.get("rsi", {}).get("values", []))
    adx_v = _last_valid(indicators.get("adx", {}).get("values", []))
    atr_v = _last_valid(indicators.get("atr", {}).get("values", []))
    bb = indicators.get("bbands", {})
    last = len(candles) - 1
    bb_width = None
    if bb and bb.get("upper") and bb.get("lower") and bb.get("middle"):
        u, l, m = bb["upper"][last], bb["lower"][last], bb["middle"][last]
        if u is not None and l is not None and m:
            bb_width = (u - l) / m * 100
    macd_h = indicators.get("macd", {}).get("hist", [])
    h = _last_valid(macd_h)
    prev_h = macd_h[-2] if len(macd_h) > 1 else None
    macd_sig = "neutral"
    if h is not None and prev_h is not None:
        if h > 0 and prev_h <= 0:
            macd_sig = "bullish"
        elif h < 0 and prev_h >= 0:
            macd_sig = "bearish"
        elif h > 0:
            macd_sig = "bullish"
        elif h < 0:
            macd_sig = "bearish"
    close = candles[last]["close"] if candles else 0
    ema_v = _last_valid(indicators.get("ema", {}).get("values", []))
    vwap_v = _last_valid(indicators.get("vwap", {}).get("values", []))
    last_vol = candles[last].get("volume") if candles else None
    vol_window = [float(c.get("volume") or 0) for c in candles[-20:] if float(c.get("volume") or 0) > 0]
    vol_avg20 = sum(vol_window) / len(vol_window) if vol_window else None
    price_vs_vwap = "at"
    vwap_deviation_pct: float | None = None
    if vwap_v is not None and close:
        diff_pct = (close - vwap_v) / vwap_v * 100
        vwap_deviation_pct = diff_pct
        if diff_pct > 0.15:
            price_vs_vwap = "above"
        elif diff_pct < -0.15:
            price_vs_vwap = "below"
    trend = "sideways"
    if ema_v is not None:
        if close > ema_v * 1.005:
            trend = "uptrend"
        elif close < ema_v * 0.995:
            trend = "downtrend"
    return {
        "rsi": rsi_v,
        "rsiLabel": "N/A" if rsi_v is None else ("Overbought" if rsi_v > 70 else "Oversold" if rsi_v < 30 else "Neutral"),
        "adx": adx_v,
        "adxLabel": "N/A" if adx_v is None else ("Strong trend" if adx_v > 25 else "Trending" if adx_v > 20 else "Weak/range"),
        "atr": atr_v,
        "bbWidth": bb_width,
        "bbWidthLabel": "N/A" if bb_width is None else ("Squeeze (low vol)" if bb_width < 4 else "Expanded (high vol)" if bb_width > 8 else "Normal"),
        "macdSignal": macd_sig,
        "trend": trend,
        "patternToday": None,
        "volume": last_vol,
        "volumeAvg20": vol_avg20,
        "vwap": vwap_v,
        "priceVsVwap": price_vs_vwap,
        "vwapDeviationPct": vwap_deviation_pct,
    }


def compute_from_candles(candles: list[dict[str, Any]], selected: list[str]) -> dict[str, Any]:
    if not candles:
        return {"timestamps": [], "indicators": {}, "patterns": [], "summary": {}}
    close = [float(c["close"]) for c in candles]
    high = [float(c["high"]) for c in candles]
    low = [float(c["low"]) for c in candles]
    vol = [float(c.get("volume") or 0) for c in candles]
    ts = [c.get("time") for c in candles]
    indicators: dict[str, Any] = {}
    if "rsi" in selected:
        indicators["rsi"] = {"values": rsi(close)}
    if "macd" in selected:
        indicators["macd"] = macd(close)
    if "bbands" in selected:
        indicators["bbands"] = bbands(close)
    if "atr" in selected:
        indicators["atr"] = {"values": atr(high, low, close)}
    if "adx" in selected:
        indicators["adx"] = {"values": adx(high, low, close)}
    if "ema" in selected:
        indicators["ema"] = {"values": ema(close, 20), "period": 20}
    if "sma" in selected:
        indicators["sma"] = {"values": sma(close, 50), "period": 50}
    if "stoch" in selected:
        indicators["stoch"] = stoch(high, low, close)
    if "obv" in selected:
        indicators["obv"] = {"values": obv(close, vol)}
    if "vwap" in selected:
        indicators["vwap"] = {"values": vwap(candles)}
    patterns = detect_patterns(candles)
    core = {
        "rsi": {"values": rsi(close)},
        "macd": macd(close),
        "bbands": bbands(close),
        "atr": {"values": atr(high, low, close)},
        "adx": {"values": adx(high, low, close)},
        "ema": {"values": ema(close, 20), "period": 20},
        "vwap": {"values": vwap(candles)},
    }
    summary = build_summary(candles, core)
    recent = [p for p in patterns if p.get("time") == ts[-1]]
    summary["patternToday"] = recent[-1]["name"] if recent else None
    return {
        "timestamps": ts,
        "indicators": indicators,
        "patterns": patterns,
        "summary": summary,
        "engine": "talib" if HAS_TALIB else "numpy",
    }


def scanner_signal(rsi_v, adx_v, macd_sig: str) -> tuple[str, str]:
    if rsi_v is not None and rsi_v > 70:
        return "Overbought", "bearish"
    if rsi_v is not None and rsi_v < 30:
        return "Oversold", "bullish"
    if macd_sig == "bullish" and adx_v is not None and adx_v > 25:
        return "Bullish + trend", "bullish"
    if macd_sig == "bearish" and adx_v is not None and adx_v > 25:
        return "Bearish + trend", "bearish"
    if macd_sig == "bullish":
        return "MACD bull cross", "bullish"
    if macd_sig == "bearish":
        return "MACD bear cross", "bearish"
    return "Neutral", "neutral"
