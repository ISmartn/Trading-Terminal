"""Live momentum scanner — rolling tick state and rule evaluation."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

# Default thresholds (query-param overridable)
DEFAULT_MOVE_15S_PCT = 0.4
DEFAULT_MOVE_1M_PCT = 0.8
DEFAULT_VOLUME_SPIKE_MULT = 3.0
DEFAULT_VOLUME_AVG_BARS = 20

POPULAR_SCAN_SYMBOLS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC",
    "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA",
    "TITAN", "WIPRO", "BAJFINANCE", "HCLTECH", "NTPC", "POWERGRID", "ONGC", "ADANIENT",
    "ADANIPORTS", "COALINDIA", "TATASTEEL", "JSWSTEEL", "HINDALCO", "M&M", "BAJAJFINSV",
    "TECHM", "INDUSINDBK", "DRREDDY", "CIPLA", "EICHERMOT", "DIVISLAB", "BPCL",
    "HEROMOTOCO", "SBILIFE", "HDFCLIFE", "TRENT", "DLF", "VEDL", "BANKBARODA", "PNB",
]


def _ist_day_key(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=IST).strftime("%Y-%m-%d")


def _ist_minute_key(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=IST).strftime("%Y-%m-%d %H:%M")


def _price_at(samples: deque[tuple[int, float]], ts_ms: int, lookback_ms: int) -> float | None:
    target = ts_ms - lookback_ms
    for t, price in reversed(samples):
        if t <= target:
            return price
    return None


def _pct_change(from_price: float | None, to_price: float) -> float | None:
    if from_price is None or from_price <= 0:
        return None
    return (to_price - from_price) / from_price * 100


@dataclass
class SymbolLiveState:
    symbol: str
    instrument_key: str
    price_samples: deque[tuple[int, float]] = field(default_factory=lambda: deque(maxlen=600))
    vol_samples: deque[tuple[int, float]] = field(default_factory=lambda: deque(maxlen=600))
    minute_volumes: deque[float] = field(default_factory=lambda: deque(maxlen=20))
    current_minute_key: str | None = None
    current_minute_vol: float = 0.0
    session_day: str | None = None
    session_vwap_num: float = 0.0
    session_vwap_den: float = 0.0
    last_cum_vol: float | None = None
    last_ltp: float = 0.0
    last_ts_ms: int = 0
    seeded: bool = False

    def seed_minute_volumes(self, volumes: list[float]) -> None:
        for v in volumes[-20:]:
            if v > 0:
                self.minute_volumes.append(float(v))
        self.seeded = True

    def update(self, ltp: float, cum_vol: float, ts_ms: int) -> None:
        day = _ist_day_key(ts_ms)
        if self.session_day != day:
            self.session_day = day
            self.session_vwap_num = 0.0
            self.session_vwap_den = 0.0
            self.last_cum_vol = None
            self.current_minute_key = None
            self.current_minute_vol = 0.0

        vol_delta = 0.0
        if self.last_cum_vol is not None and cum_vol >= self.last_cum_vol:
            vol_delta = cum_vol - self.last_cum_vol
        elif self.last_cum_vol is None and cum_vol > 0:
            vol_delta = cum_vol

        if vol_delta > 0:
            self.session_vwap_num += ltp * vol_delta
            self.session_vwap_den += vol_delta

            minute_key = _ist_minute_key(ts_ms)
            if self.current_minute_key != minute_key:
                if self.current_minute_key and self.current_minute_vol > 0:
                    self.minute_volumes.append(self.current_minute_vol)
                self.current_minute_key = minute_key
                self.current_minute_vol = vol_delta
            else:
                self.current_minute_vol += vol_delta

        if cum_vol > 0 or self.last_cum_vol is None:
            self.last_cum_vol = cum_vol

        self.price_samples.append((ts_ms, ltp))
        self.vol_samples.append((ts_ms, cum_vol))
        self.last_ltp = ltp
        self.last_ts_ms = ts_ms

    def session_vwap(self) -> float | None:
        if self.session_vwap_den > 0:
            return self.session_vwap_num / self.session_vwap_den
        return None

    def metrics(
        self,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
        min_avg_bars: int = 5,
    ) -> dict[str, Any] | None:
        if self.last_ltp <= 0 or self.last_ts_ms <= 0:
            return None

        ts = self.last_ts_ms
        ltp = self.last_ltp
        p15 = _price_at(self.price_samples, ts, 15_000)
        p1m = _price_at(self.price_samples, ts, 60_000)
        chg_15s = _pct_change(p15, ltp)
        chg_1m = _pct_change(p1m, ltp)
        vwap = self.session_vwap()
        avg_min_vol = (
            sum(self.minute_volumes) / len(self.minute_volumes)
            if len(self.minute_volumes) >= min_avg_bars
            else None
        )
        vol_spike = (
            avg_min_vol is not None
            and self.current_minute_vol > volume_mult * avg_min_vol
        )
        return {
            "symbol": self.symbol,
            "ltp": round(ltp, 2),
            "move15sPct": round(chg_15s, 3) if chg_15s is not None else None,
            "move1mPct": round(chg_1m, 3) if chg_1m is not None else None,
            "volume1m": int(self.current_minute_vol),
            "avgVolume20m": int(avg_min_vol) if avg_min_vol else None,
            "volumeRatio": round(self.current_minute_vol / avg_min_vol, 2) if avg_min_vol else None,
            "vwap": round(vwap, 2) if vwap else None,
            "aboveVwap": vwap is not None and ltp > vwap,
            "belowVwap": vwap is not None and ltp < vwap,
            "volSpike": vol_spike,
            "timestamp": ts,
            "checks": {
                "move15sLong": chg_15s is not None and chg_15s >= move_15s_pct,
                "move1mLong": chg_1m is not None and chg_1m >= move_1m_pct,
                "move15sShort": chg_15s is not None and chg_15s <= -move_15s_pct,
                "move1mShort": chg_1m is not None and chg_1m <= -move_1m_pct,
                "volumeSpike": vol_spike,
                "aboveVwap": vwap is not None and ltp > vwap,
                "belowVwap": vwap is not None and ltp < vwap,
            },
        }

    def _score(self, checks: dict[str, bool], keys: list[str]) -> int:
        return sum(1 for k in keys if checks.get(k))

    def evaluate(
        self,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
        min_avg_bars: int = 5,
    ) -> dict[str, Any] | None:
        m = self.metrics(
            move_15s_pct=move_15s_pct,
            move_1m_pct=move_1m_pct,
            volume_mult=volume_mult,
            min_avg_bars=min_avg_bars,
        )
        if not m or not m["checks"]["move15sLong"] or not m["checks"]["move1mLong"]:
            return None
        if not (m["checks"]["volumeSpike"] and m["checks"]["aboveVwap"]):
            return None
        return {
            "symbol": m["symbol"],
            "direction": "long",
            "strength": "signal",
            "score": 4,
            "ltp": m["ltp"],
            "move15sPct": m["move15sPct"],
            "move1mPct": m["move1mPct"],
            "volume1m": m["volume1m"],
            "avgVolume20m": m["avgVolume20m"],
            "volumeRatio": m["volumeRatio"],
            "vwap": m["vwap"],
            "aboveVwap": m["aboveVwap"],
            "timestamp": m["timestamp"],
        }

    def evaluate_short(
        self,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
        min_avg_bars: int = 5,
    ) -> dict[str, Any] | None:
        m = self.metrics(
            move_15s_pct=move_15s_pct,
            move_1m_pct=move_1m_pct,
            volume_mult=volume_mult,
            min_avg_bars=min_avg_bars,
        )
        if not m or not m["checks"]["move15sShort"] or not m["checks"]["move1mShort"]:
            return None
        if not (m["checks"]["volumeSpike"] and m["checks"]["belowVwap"]):
            return None
        return {
            "symbol": m["symbol"],
            "direction": "short",
            "strength": "signal",
            "score": 4,
            "ltp": m["ltp"],
            "move15sPct": m["move15sPct"],
            "move1mPct": m["move1mPct"],
            "volume1m": m["volume1m"],
            "avgVolume20m": m["avgVolume20m"],
            "volumeRatio": m["volumeRatio"],
            "vwap": m["vwap"],
            "belowVwap": m["belowVwap"],
            "timestamp": m["timestamp"],
        }

    def evaluate_watch(
        self,
        direction: str,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
        min_avg_bars: int = 5,
    ) -> dict[str, Any] | None:
        m = self.metrics(
            move_15s_pct=move_15s_pct,
            move_1m_pct=move_1m_pct,
            volume_mult=volume_mult,
            min_avg_bars=min_avg_bars,
        )
        if not m:
            return None
        checks = m["checks"]
        if direction == "long":
            keys = ["move15sLong", "move1mLong", "volumeSpike", "aboveVwap"]
        else:
            keys = ["move15sShort", "move1mShort", "volumeSpike", "belowVwap"]
        score = self._score(checks, keys)
        if score < 2 or score >= 4:
            return None
        return {
            "symbol": m["symbol"],
            "direction": direction,
            "strength": "watch",
            "score": score,
            "ltp": m["ltp"],
            "move15sPct": m["move15sPct"],
            "move1mPct": m["move1mPct"],
            "volume1m": m["volume1m"],
            "avgVolume20m": m["avgVolume20m"],
            "volumeRatio": m["volumeRatio"],
            "vwap": m["vwap"],
            "checks": {k: checks[k] for k in keys},
            "timestamp": m["timestamp"],
        }


class LiveMomentumEngine:
    def __init__(self) -> None:
        self._states: dict[str, SymbolLiveState] = {}
        self._running = False
        self._last_poll_ms = 0
        self._poll_count = 0
        self._symbols_polled = 0

    def register(self, symbol: str, instrument_key: str) -> SymbolLiveState:
        sym = symbol.upper()
        if sym not in self._states:
            self._states[sym] = SymbolLiveState(symbol=sym, instrument_key=instrument_key)
        return self._states[sym]

    def get_state(self, symbol: str) -> SymbolLiveState | None:
        return self._states.get(symbol.upper())

    def update_quote(self, symbol: str, instrument_key: str, ltp: float, cum_vol: float, ts_ms: int) -> None:
        st = self.register(symbol, instrument_key)
        st.update(ltp, cum_vol, ts_ms)

    def scan(
        self,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
        symbols: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        allowed = {s.upper() for s in symbols} if symbols else None
        hits: list[dict[str, Any]] = []
        for sym, st in self._states.items():
            if allowed is not None and sym not in allowed:
                continue
            row = st.evaluate(
                move_15s_pct=move_15s_pct,
                move_1m_pct=move_1m_pct,
                volume_mult=volume_mult,
            )
            if row:
                hits.append(row)
        hits.sort(key=lambda r: (r.get("move1mPct") or 0, r.get("volumeRatio") or 0), reverse=True)
        return hits

    def scan_intelligence(
        self,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
        symbols: list[str] | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        allowed = {s.upper() for s in symbols} if symbols else None
        bullish: list[dict[str, Any]] = []
        bearish: list[dict[str, Any]] = []
        watch_long: list[dict[str, Any]] = []
        watch_short: list[dict[str, Any]] = []
        kw = {
            "move_15s_pct": move_15s_pct,
            "move_1m_pct": move_1m_pct,
            "volume_mult": volume_mult,
        }

        for sym, st in self._states.items():
            if allowed is not None and sym not in allowed:
                continue
            long_sig = st.evaluate(**kw)
            short_sig = st.evaluate_short(**kw)
            if long_sig:
                bullish.append(long_sig)
            elif wl := st.evaluate_watch("long", **kw):
                watch_long.append(wl)
            if short_sig:
                bearish.append(short_sig)
            elif ws := st.evaluate_watch("short", **kw):
                watch_short.append(ws)

        bullish.sort(key=lambda r: (r.get("move1mPct") or 0, r.get("volumeRatio") or 0), reverse=True)
        bearish.sort(key=lambda r: (r.get("move1mPct") or 0, r.get("volumeRatio") or 0))
        watch_long.sort(key=lambda r: r.get("score", 0), reverse=True)
        watch_short.sort(key=lambda r: r.get("score", 0), reverse=True)

        return {
            "bullish": bullish,
            "bearish": bearish,
            "watchLong": watch_long,
            "watchShort": watch_short,
        }

    def snapshot(
        self,
        symbol: str,
        *,
        move_15s_pct: float = DEFAULT_MOVE_15S_PCT,
        move_1m_pct: float = DEFAULT_MOVE_1M_PCT,
        volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT,
    ) -> dict[str, Any] | None:
        st = self.get_state(symbol)
        if not st or st.last_ltp <= 0:
            return None
        ts = st.last_ts_ms
        ltp = st.last_ltp
        p15 = _price_at(st.price_samples, ts, 15_000)
        p1m = _price_at(st.price_samples, ts, 60_000)
        vwap = st.session_vwap()
        avg_min = sum(st.minute_volumes) / len(st.minute_volumes) if st.minute_volumes else None
        return {
            "symbol": st.symbol,
            "ltp": round(ltp, 2),
            "move15sPct": round(_pct_change(p15, ltp) or 0, 3) if p15 else None,
            "move1mPct": round(_pct_change(p1m, ltp) or 0, 3) if p1m else None,
            "volume1m": int(st.current_minute_vol),
            "avgVolume20m": int(avg_min) if avg_min else None,
            "volumeRatio": round(st.current_minute_vol / avg_min, 2) if avg_min and avg_min > 0 else None,
            "vwap": round(vwap, 2) if vwap else None,
            "aboveVwap": vwap is not None and ltp > vwap,
            "priceSamples": len(st.price_samples),
            "seeded": st.seeded,
        }

    def set_meta(self, *, running: bool, last_poll_ms: int, symbols_polled: int) -> None:
        self._running = running
        self._last_poll_ms = last_poll_ms
        self._poll_count += 1
        self._symbols_polled = symbols_polled

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "lastPollMs": self._last_poll_ms,
            "pollCount": self._poll_count,
            "symbolsTracked": len(self._states),
            "symbolsPolledLast": self._symbols_polled,
        }


engine = LiveMomentumEngine()
