"""Live momentum scanner — rolling tick state and rule evaluation."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

# Default thresholds (query-param / UI overridable)
DEFAULT_FAST_SECS = 15
DEFAULT_SLOW_SECS = 60
DEFAULT_MOVE_FAST_PCT = 0.3
DEFAULT_MOVE_SLOW_PCT = 0.6
DEFAULT_VOLUME_SPIKE_MULT = 2.0
DEFAULT_VOLUME_AVG_BARS = 20
DEFAULT_REQUIRE_VOLUME = False
DEFAULT_REQUIRE_VWAP = True
DEFAULT_WATCH_STICKY_SECS = 120

# Backwards-compatible aliases (older callers / params)
DEFAULT_MOVE_15S_PCT = DEFAULT_MOVE_FAST_PCT
DEFAULT_MOVE_1M_PCT = DEFAULT_MOVE_SLOW_PCT


@dataclass
class ScanConfig:
    """Tunable scan parameters — captures market nuance in seconds + minutes."""

    fast_secs: int = DEFAULT_FAST_SECS
    slow_secs: int = DEFAULT_SLOW_SECS
    move_fast_pct: float = DEFAULT_MOVE_FAST_PCT
    move_slow_pct: float = DEFAULT_MOVE_SLOW_PCT
    volume_mult: float = DEFAULT_VOLUME_SPIKE_MULT
    require_volume: bool = DEFAULT_REQUIRE_VOLUME
    require_vwap: bool = DEFAULT_REQUIRE_VWAP
    min_avg_bars: int = 5
    watch_sticky_secs: int = DEFAULT_WATCH_STICKY_SECS


@dataclass
class _WatchEntry:
    symbol: str
    direction: str
    row: dict[str, Any]
    first_seen_ms: int
    last_seen_ms: int
    peak_score: int = 0
    peak_move_fast: float | None = None
    peak_move_slow: float | None = None
    promoted_signal: bool = False

    def touch_row(self, row: dict[str, Any], now_ms: int) -> None:
        self.last_seen_ms = now_ms
        self.row = row
        score = int(row.get("score") or 1)
        self.peak_score = max(self.peak_score, score)
        if row.get("strength") == "signal":
            self.promoted_signal = True
        fast = row.get("move15sPct")
        slow = row.get("move1mPct")
        if fast is not None:
            if self.direction == "long":
                self.peak_move_fast = fast if self.peak_move_fast is None else max(self.peak_move_fast, fast)
            else:
                self.peak_move_fast = fast if self.peak_move_fast is None else min(self.peak_move_fast, fast)
        if slow is not None:
            if self.direction == "long":
                self.peak_move_slow = slow if self.peak_move_slow is None else max(self.peak_move_slow, slow)
            else:
                self.peak_move_slow = slow if self.peak_move_slow is None else min(self.peak_move_slow, slow)

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

    def metrics(self, cfg: ScanConfig) -> dict[str, Any] | None:
        if self.last_ltp <= 0 or self.last_ts_ms <= 0:
            return None

        ts = self.last_ts_ms
        ltp = self.last_ltp
        p_fast = _price_at(self.price_samples, ts, cfg.fast_secs * 1000)
        p_slow = _price_at(self.price_samples, ts, cfg.slow_secs * 1000)
        chg_fast = _pct_change(p_fast, ltp)
        chg_slow = _pct_change(p_slow, ltp)
        vwap = self.session_vwap()
        avg_min_vol = (
            sum(self.minute_volumes) / len(self.minute_volumes)
            if len(self.minute_volumes) >= cfg.min_avg_bars
            else None
        )
        have_volume = avg_min_vol is not None and avg_min_vol > 0
        vol_ratio = (self.current_minute_vol / avg_min_vol) if have_volume else None
        vol_spike = have_volume and self.current_minute_vol > cfg.volume_mult * avg_min_vol
        return {
            "symbol": self.symbol,
            "ltp": round(ltp, 2),
            "move15sPct": round(chg_fast, 3) if chg_fast is not None else None,
            "move1mPct": round(chg_slow, 3) if chg_slow is not None else None,
            "volume1m": int(self.current_minute_vol),
            "avgVolume20m": int(avg_min_vol) if avg_min_vol else None,
            "volumeRatio": round(vol_ratio, 2) if vol_ratio is not None else None,
            "haveVolume": have_volume,
            "vwap": round(vwap, 2) if vwap else None,
            "aboveVwap": vwap is not None and ltp > vwap,
            "belowVwap": vwap is not None and ltp < vwap,
            "volSpike": vol_spike,
            "timestamp": ts,
            "checks": {
                "move15sLong": chg_fast is not None and chg_fast >= cfg.move_fast_pct,
                "move1mLong": chg_slow is not None and chg_slow >= cfg.move_slow_pct,
                "move15sShort": chg_fast is not None and chg_fast <= -cfg.move_fast_pct,
                "move1mShort": chg_slow is not None and chg_slow <= -cfg.move_slow_pct,
                "volumeSpike": vol_spike,
                "aboveVwap": vwap is not None and ltp > vwap,
                "belowVwap": vwap is not None and ltp < vwap,
            },
        }

    def _score(self, checks: dict[str, bool], keys: list[str]) -> int:
        return sum(1 for k in keys if checks.get(k))

    def _row(self, m: dict[str, Any], direction: str, strength: str, score: int) -> dict[str, Any]:
        return {
            "symbol": m["symbol"],
            "direction": direction,
            "strength": strength,
            "score": score,
            "ltp": m["ltp"],
            "move15sPct": m["move15sPct"],
            "move1mPct": m["move1mPct"],
            "volume1m": m["volume1m"],
            "avgVolume20m": m["avgVolume20m"],
            "volumeRatio": m["volumeRatio"],
            "volSpike": m["volSpike"],
            "vwap": m["vwap"],
            "aboveVwap": m["aboveVwap"],
            "belowVwap": m["belowVwap"],
            "timestamp": m["timestamp"],
        }

    def _signal_keys(self, direction: str, cfg: ScanConfig) -> list[str]:
        """Active criteria for a full signal, honouring optional gates."""
        if direction == "long":
            keys = ["move15sLong", "move1mLong"]
            if cfg.require_volume:
                keys.append("volumeSpike")
            if cfg.require_vwap:
                keys.append("aboveVwap")
        else:
            keys = ["move15sShort", "move1mShort"]
            if cfg.require_volume:
                keys.append("volumeSpike")
            if cfg.require_vwap:
                keys.append("belowVwap")
        return keys

    def evaluate(self, cfg: ScanConfig) -> dict[str, Any] | None:
        m = self.metrics(cfg)
        if not m:
            return None
        keys = self._signal_keys("long", cfg)
        if not all(m["checks"][k] for k in keys):
            return None
        return self._row(m, "long", "signal", len(keys))

    def evaluate_short(self, cfg: ScanConfig) -> dict[str, Any] | None:
        m = self.metrics(cfg)
        if not m:
            return None
        keys = self._signal_keys("short", cfg)
        if not all(m["checks"][k] for k in keys):
            return None
        return self._row(m, "short", "signal", len(keys))

    def _partial_momentum(self, m: dict[str, Any], direction: str, cfg: ScanConfig) -> bool:
        """Half-threshold move on fast OR slow window — catches building momentum."""
        fast = m.get("move15sPct")
        slow = m.get("move1mPct")
        half_fast = cfg.move_fast_pct / 2
        half_slow = cfg.move_slow_pct / 2
        if direction == "long":
            return (
                (fast is not None and fast >= half_fast)
                or (slow is not None and slow >= half_slow)
            )
        return (
            (fast is not None and fast <= -half_fast)
            or (slow is not None and slow <= -half_slow)
        )

    def evaluate_watch(self, direction: str, cfg: ScanConfig) -> dict[str, Any] | None:
        m = self.metrics(cfg)
        if not m:
            return None
        checks = m["checks"]
        if direction == "long":
            watch_keys = ["move15sLong", "move1mLong", "volumeSpike", "aboveVwap"]
        else:
            watch_keys = ["move15sShort", "move1mShort", "volumeSpike", "belowVwap"]
        signal_keys = self._signal_keys(direction, cfg)
        # Don't surface as "watch" if it already qualifies as a full signal.
        if all(checks[k] for k in signal_keys):
            return None
        score = self._score(checks, watch_keys)
        if score < 1 and not self._partial_momentum(m, direction, cfg):
            return None
        row = self._row(m, direction, "watch", max(score, 1))
        row["checks"] = {k: checks[k] for k in watch_keys}
        return row


class LiveMomentumEngine:
    MAX_WATCH_HISTORY = 150

    def __init__(self) -> None:
        self._states: dict[str, SymbolLiveState] = {}
        self._watch_registry: dict[str, _WatchEntry] = {}
        self._watch_history: list[dict[str, Any]] = []
        self._session_day: str | None = None
        self._running = False
        self._last_poll_ms = 0
        self._poll_count = 0
        self._symbols_polled = 0

    def _watch_key(self, symbol: str, direction: str) -> str:
        return f"{symbol.upper()}:{direction}"

    def _maybe_reset_session(self, now_ms: int) -> None:
        day = _ist_day_key(now_ms)
        if self._session_day != day:
            self._session_day = day
            self._watch_registry.clear()
            self._watch_history.clear()

    def _register_watch(self, row: dict[str, Any], now_ms: int) -> None:
        sym = row["symbol"]
        direction = row["direction"]
        key = self._watch_key(sym, direction)
        score = int(row.get("score") or 1)
        existing = self._watch_registry.get(key)
        if existing:
            existing.touch_row(row, now_ms)
        else:
            ent = _WatchEntry(
                symbol=sym,
                direction=direction,
                row=row,
                first_seen_ms=now_ms,
                last_seen_ms=now_ms,
                peak_score=score,
            )
            ent.touch_row(row, now_ms)
            self._watch_registry[key] = ent

    def _history_row(self, ent: _WatchEntry, reason: str) -> dict[str, Any]:
        duration = max(0, int((ent.last_seen_ms - ent.first_seen_ms) / 1000))
        return {
            "symbol": ent.symbol,
            "direction": ent.direction,
            "strength": "history",
            "score": ent.peak_score,
            "peakScore": ent.peak_score,
            "ltp": ent.row.get("ltp"),
            "move15sPct": ent.peak_move_fast,
            "move1mPct": ent.peak_move_slow,
            "peakMoveFastPct": ent.peak_move_fast,
            "peakMoveSlowPct": ent.peak_move_slow,
            "volumeRatio": ent.row.get("volumeRatio"),
            "vwap": ent.row.get("vwap"),
            "firstSeenMs": ent.first_seen_ms,
            "lastSeenMs": ent.last_seen_ms,
            "durationSecs": duration,
            "endReason": reason,
            "promoted": ent.promoted_signal,
            "timestamp": ent.last_seen_ms,
        }

    def _archive_watch(self, key: str, ent: _WatchEntry, reason: str) -> None:
        self._watch_history.append(self._history_row(ent, reason))
        if len(self._watch_history) > self.MAX_WATCH_HISTORY:
            self._watch_history = self._watch_history[-self.MAX_WATCH_HISTORY :]
        del self._watch_registry[key]

    def _watch_reversed(self, st: SymbolLiveState, direction: str, cfg: ScanConfig) -> bool:
        """Drop sticky watch when price clearly flips the other way."""
        m = st.metrics(cfg)
        if not m:
            return True
        fast = m.get("move15sPct")
        if fast is None:
            return False
        flip = cfg.move_fast_pct * 0.5
        if direction == "long":
            return fast < -flip
        return fast > flip

    def _expire_inactive_watches(
        self,
        cfg: ScanConfig,
        *,
        bullish_syms: set[str],
        bearish_syms: set[str],
        active_long: set[str],
        active_short: set[str],
        now_ms: int,
    ) -> None:
        sticky_ms = cfg.watch_sticky_secs * 1000
        for key, ent in list(self._watch_registry.items()):
            if ent.direction == "long" and ent.symbol in bullish_syms:
                continue
            if ent.direction == "short" and ent.symbol in bearish_syms:
                continue
            if ent.direction == "long" and ent.symbol in active_long:
                continue
            if ent.direction == "short" and ent.symbol in active_short:
                continue

            st = self.get_state(ent.symbol)
            expired = now_ms - ent.last_seen_ms > sticky_ms
            reversed_move = bool(st and self._watch_reversed(st, ent.direction, cfg))
            if not expired and not reversed_move:
                continue

            if ent.promoted_signal:
                reason = "promoted"
            elif reversed_move:
                reason = "reversed"
            else:
                reason = "expired"
            self._archive_watch(key, ent, reason)

    def _collect_watch_history(self, direction: str) -> list[dict[str, Any]]:
        rows = [r for r in self._watch_history if r.get("direction") == direction]
        rows.sort(key=lambda r: r.get("lastSeenMs") or 0, reverse=True)
        return rows

    def _collect_sticky_watch(
        self,
        direction: str,
        cfg: ScanConfig,
        *,
        allowed: set[str] | None,
        exclude: set[str],
        now_ms: int,
    ) -> list[dict[str, Any]]:
        sticky_ms = cfg.watch_sticky_secs * 1000
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()

        for ent in self._watch_registry.values():
            if ent.direction != direction:
                continue
            if ent.symbol in exclude or ent.symbol in seen:
                continue
            if allowed is not None and ent.symbol not in allowed:
                continue
            if now_ms - ent.last_seen_ms > sticky_ms:
                continue

            st = self.get_state(ent.symbol)
            if not st or self._watch_reversed(st, direction, cfg):
                continue

            # Refresh displayed metrics from live state when available.
            fresh = st.evaluate_watch(direction, cfg) if st else None
            if fresh:
                row = fresh
                row["watchAgeSecs"] = int((now_ms - ent.first_seen_ms) / 1000)
                row["peakScore"] = ent.peak_score
            else:
                row = {**ent.row, "strength": "watch"}
                row["watchAgeSecs"] = int((now_ms - ent.first_seen_ms) / 1000)
                row["peakScore"] = ent.peak_score
                if st:
                    live_m = st.metrics(cfg)
                    if live_m:
                        row["ltp"] = live_m["ltp"]
                        row["move15sPct"] = live_m["move15sPct"]
                        row["move1mPct"] = live_m["move1mPct"]
                        row["volumeRatio"] = live_m["volumeRatio"]
                        row["vwap"] = live_m["vwap"]

            row["sticky"] = now_ms - ent.last_seen_ms > 2500
            rows.append(row)
            seen.add(ent.symbol)

        rows.sort(
            key=lambda r: (
                0 if not r.get("sticky") else 1,
                r.get("peakScore", 0),
                abs(r.get("move1mPct") or 0),
                abs(r.get("move15sPct") or 0),
            ),
            reverse=True,
        )
        return rows

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
        cfg: ScanConfig | None = None,
        *,
        symbols: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        cfg = cfg or ScanConfig()
        allowed = {s.upper() for s in symbols} if symbols else None
        hits: list[dict[str, Any]] = []
        for sym, st in self._states.items():
            if allowed is not None and sym not in allowed:
                continue
            row = st.evaluate(cfg)
            if row:
                hits.append(row)
        hits.sort(key=lambda r: (r.get("move1mPct") or 0, r.get("volumeRatio") or 0), reverse=True)
        return hits

    def scan_intelligence(
        self,
        cfg: ScanConfig | None = None,
        *,
        symbols: list[str] | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        import time

        cfg = cfg or ScanConfig()
        allowed = {s.upper() for s in symbols} if symbols else None
        bullish: list[dict[str, Any]] = []
        bearish: list[dict[str, Any]] = []
        now_ms = int(time.time() * 1000)
        self._maybe_reset_session(now_ms)

        for sym, st in self._states.items():
            if allowed is not None and sym not in allowed:
                continue
            long_sig = st.evaluate(cfg)
            short_sig = st.evaluate_short(cfg)
            if long_sig:
                bullish.append(long_sig)
                self._register_watch(long_sig, now_ms)
            elif wl := st.evaluate_watch("long", cfg):
                self._register_watch(wl, now_ms)
            if short_sig:
                bearish.append(short_sig)
                self._register_watch(short_sig, now_ms)
            elif ws := st.evaluate_watch("short", cfg):
                self._register_watch(ws, now_ms)

        bullish_syms = {r["symbol"] for r in bullish}
        bearish_syms = {r["symbol"] for r in bearish}
        watch_long = self._collect_sticky_watch(
            "long", cfg, allowed=allowed, exclude=bullish_syms, now_ms=now_ms,
        )
        watch_short = self._collect_sticky_watch(
            "short", cfg, allowed=allowed, exclude=bearish_syms, now_ms=now_ms,
        )
        self._expire_inactive_watches(
            cfg,
            bullish_syms=bullish_syms,
            bearish_syms=bearish_syms,
            active_long={r["symbol"] for r in watch_long},
            active_short={r["symbol"] for r in watch_short},
            now_ms=now_ms,
        )
        watch_history_long = self._collect_watch_history("long")
        watch_history_short = self._collect_watch_history("short")

        bullish.sort(key=lambda r: (r.get("move1mPct") or 0, r.get("volumeRatio") or 0), reverse=True)
        bearish.sort(key=lambda r: (r.get("move1mPct") or 0, r.get("volumeRatio") or 0))

        return {
            "bullish": bullish,
            "bearish": bearish,
            "watchLong": watch_long,
            "watchShort": watch_short,
            "watchHistoryLong": watch_history_long,
            "watchHistoryShort": watch_history_short,
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
