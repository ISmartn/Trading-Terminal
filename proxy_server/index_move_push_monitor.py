"""Server-side index sudden-move monitor → Web Push (works when no browser is open)."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from . import web_push
from .handlers import handle_nse_proxy

MONITOR_SYMBOLS = ("NIFTY", "BANKNIFTY", "NIFTYSC50", "NIFTYSC100", "NIFTYSC250")

NSE_INDEX_TO_SYMBOL: dict[str, str] = {
    "NIFTY 50": "NIFTY",
    "NIFTY BANK": "BANKNIFTY",
    "NIFTY SMALLCAP 50": "NIFTYSC50",
    "NIFTY SMALLCAP 100": "NIFTYSC100",
    "NIFTY SMALLCAP 250": "NIFTYSC250",
}

LABELS: dict[str, str] = {
    "NIFTY": "Nifty 50",
    "BANKNIFTY": "Bank Nifty",
    "NIFTYSC50": "Nifty Smallcap 50",
    "NIFTYSC100": "Nifty Smallcap 100",
    "NIFTYSC250": "Nifty Smallcap 250",
}

DEFAULT_THRESHOLDS = {
    "pct15s": 0.12,
    "pct30s": 0.18,
    "pct60s": 0.28,
    "pct3m": 0.45,
}

WINDOW_MS = {
    "15s": 15_000,
    "30s": 30_000,
    "60s": 60_000,
    "3m": 180_000,
}

POLL_INTERVAL_SEC = 5.0
COOLDOWN_MS = 90_000


@dataclass
class Sample:
    ts: int
    ltp: float


@dataclass
class MonitorState:
    samples: dict[str, list[Sample]] = field(default_factory=dict)
    cooldown: dict[str, int] = field(default_factory=dict)


_state = MonitorState()
_task: asyncio.Task | None = None


def _price_at(samples: list[Sample], now: int, lookback_ms: int) -> float | None:
    target = now - lookback_ms
    for s in reversed(samples):
        if s.ts <= target:
            return s.ltp
    return samples[0].ltp if samples else None


def _detect_move(samples: list[Sample], now: int) -> dict[str, Any] | None:
    if len(samples) < 2:
        return None
    ltp = samples[-1].ltp
    if ltp <= 0:
        return None

    best: dict[str, Any] | None = None
    for window, pct_min in (
        ("15s", DEFAULT_THRESHOLDS["pct15s"]),
        ("30s", DEFAULT_THRESHOLDS["pct30s"]),
        ("60s", DEFAULT_THRESHOLDS["pct60s"]),
        ("3m", DEFAULT_THRESHOLDS["pct3m"]),
    ):
        ms = WINDOW_MS[window]
        from_px = _price_at(samples, now, ms)
        if from_px is None or from_px <= 0:
            continue
        move_pct = round((ltp - from_px) / from_px * 10000) / 100
        if abs(move_pct) < pct_min:
            continue
        cand = {
            "window": window,
            "movePct": move_pct,
            "direction": "up" if move_pct >= 0 else "down",
            "fromPrice": from_px,
            "toPrice": ltp,
        }
        if not best or abs(move_pct) > abs(best["movePct"]):
            best = cand
    return best


def _push_sample(symbol: str, ltp: float, now: int) -> None:
    buf = _state.samples.setdefault(symbol, [])
    buf.append(Sample(ts=now, ltp=ltp))
    cutoff = now - 300_000
    while buf and buf[0].ts < cutoff:
        buf.pop(0)
    if len(buf) > 400:
        del buf[: len(buf) - 400]


async def _fetch_index_ltps(session: aiohttp.ClientSession) -> dict[str, float]:
    out: dict[str, float] = {}
    try:
        data, _ = await handle_nse_proxy(session, {"endpoint": "indices"})
        rows = (data or {}).get("data") or []
        for row in rows:
            name = (row.get("index") or "").strip()
            sym = NSE_INDEX_TO_SYMBOL.get(name)
            if not sym or sym not in MONITOR_SYMBOLS:
                continue
            last = float(row.get("last") or row.get("lastPrice") or 0)
            if last > 0:
                out[sym] = last
    except Exception as exc:
        print(f"  ⚠️ Push monitor indices fetch: {exc}")
    return out


async def _tick(session: aiohttp.ClientSession) -> None:
    if not web_push.is_configured() or web_push.subscription_count() == 0:
        return

    now = int(time.time() * 1000)
    ltps = await _fetch_index_ltps(session)
    for symbol, ltp in ltps.items():
        _push_sample(symbol, ltp, now)
        move = _detect_move(_state.samples.get(symbol, []), now)
        if not move:
            continue

        key = f"{symbol}:{move['direction']}:{move['window']}"
        last = _state.cooldown.get(key, 0)
        if now - last < COOLDOWN_MS:
            continue
        _state.cooldown[key] = now

        label = LABELS.get(symbol, symbol)
        dir_word = "up" if move["direction"] == "up" else "down"
        move_pts = round(move["toPrice"] - move["fromPrice"], 2)
        title = (
            f"{label} sudden {dir_word} {move['movePct']:+.2f}% "
            f"({move_pts:+.2f} pts) ({move['window']})"
        )
        body = (
            f"{move['fromPrice']:.2f} → {move['toPrice']:.2f} "
            f"({move['movePct']:+.2f}%, {move_pts:+.2f} pts) · "
            f"Open app for F&O volume + trade ideas"
        )
        sent = web_push.broadcast_push(
            title=title,
            body=body,
            tag=key,
            url="/index-move-alerts",
        )
        if sent:
            print(f"  📲 Web push ({sent}): {title}")


async def _loop(session: aiohttp.ClientSession) -> None:
    while True:
        try:
            await _tick(session)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"  ⚠️ Push monitor tick: {exc}")
        await asyncio.sleep(POLL_INTERVAL_SEC)


def start(session: aiohttp.ClientSession) -> None:
    global _task
    if not web_push.is_configured():
        print("  ℹ️ Web Push: set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in .env for mobile alerts")
        return
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_loop(session))
    print("  📲 Web Push monitor started (index sudden moves → subscribed devices)")


def stop() -> None:
    global _task
    if _task:
        _task.cancel()
        _task = None
