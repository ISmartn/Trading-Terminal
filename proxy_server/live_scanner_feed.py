"""Poll Upstox LTP for F&O stocks and feed the live momentum engine."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp

from . import upstox_sdk
from . import cache
from .config import EQUITY_INSTRUMENT_KEYS, FNO_STOCKS, get_access_token
from .live_scanner import POPULAR_SCAN_SYMBOLS, engine

_scanner_task: asyncio.Task | None = None
_access_token: str | None = None
_universe: str = "popular"
_batch_size = 40
_poll_interval_s = 2.0
_equity_keys_cache: dict[str, str] = {}


async def _resolve_equity_keys(session: aiohttp.ClientSession) -> dict[str, str]:
    global _equity_keys_cache
    if _equity_keys_cache:
        return _equity_keys_cache

    from .handlers import _get_fno_equity_keys

    try:
        keys = await _get_fno_equity_keys(session)
        _equity_keys_cache = {**EQUITY_INSTRUMENT_KEYS, **keys}
    except Exception:
        _equity_keys_cache = dict(EQUITY_INSTRUMENT_KEYS)
    return _equity_keys_cache


def _symbols_for_universe(universe: str) -> list[str]:
    if universe == "all":
        return list(FNO_STOCKS)
    return list(POPULAR_SCAN_SYMBOLS)


async def seed_volume_baselines(session: aiohttp.ClientSession, token: str, symbols: list[str]) -> None:
    """Seed 20-min avg from today's 1-min historical candles (once per symbol)."""
    from .handlers import fetch_candles_for_ta

    keys = await _resolve_equity_keys(session)
    for symbol in symbols:
        st = engine.get_state(symbol)
        if st and st.seeded:
            continue
        key = keys.get(symbol.upper()) or keys.get(symbol)
        if not key:
            continue
        try:
            candles = await fetch_candles_for_ta(session, symbol, "1D", token, "1")
            vols = [float(c.get("volume") or 0) for c in candles if float(c.get("volume") or 0) > 0]
            if vols:
                state = engine.register(symbol, key)
                state.seed_minute_volumes(vols[-20:])
        except Exception:
            continue
        await asyncio.sleep(0.05)


async def _poll_batch(session: aiohttp.ClientSession, token: str, symbols: list[str]) -> int:
    keys_map = await _resolve_equity_keys(session)
    pairs: list[tuple[str, str]] = []
    for sym in symbols:
        key = keys_map.get(sym.upper()) or keys_map.get(sym)
        if key:
            pairs.append((sym.upper(), key))
            engine.register(sym.upper(), key)

    if not pairs:
        return 0

    instrument_keys = ",".join(k for _, k in pairs)
    try:
        result = await upstox_sdk.get_ltp(token, instrument_keys)
    except RuntimeError:
        engine.set_meta(running=False, last_poll_ms=int(time.time() * 1000), symbols_polled=0)
        return 0

    quotes = result.get("data") or {}
    now_ms = int(time.time() * 1000)
    updated = 0

    key_to_sym = {k: s for s, k in pairs}
    for instrument_key, quote in quotes.items():
        sym = key_to_sym.get(instrument_key)
        if not sym or quote.get("last_price") is None:
            continue
        ltp = float(quote["last_price"])
        cum_vol = float(quote.get("volume") or 0)
        engine.update_quote(sym, instrument_key, ltp, cum_vol, now_ms)
        updated += 1

    engine.set_meta(running=True, last_poll_ms=now_ms, symbols_polled=updated)
    return updated


_batch_offset = 0


async def _scanner_loop(session: aiohttp.ClientSession) -> None:
    global _batch_offset

    token = _access_token or get_access_token()
    if not token:
        await asyncio.sleep(5)
        return

    symbols = _symbols_for_universe(_universe)
    if not symbols:
        await asyncio.sleep(_poll_interval_s)
        return

    if _batch_offset == 0 and engine.status().get("pollCount", 0) == 0:
        asyncio.create_task(seed_volume_baselines(session, token, symbols[: min(len(symbols), 50)]))

    start = _batch_offset
    end = min(start + _batch_size, len(symbols))
    batch = symbols[start:end]
    _batch_offset = 0 if end >= len(symbols) else end

    await _poll_batch(session, token, batch)
    await asyncio.sleep(_poll_interval_s)


async def _loop_wrapper(session: aiohttp.ClientSession) -> None:
    while True:
        try:
            await _scanner_loop(session)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"  ⚠️ Live scanner poll error: {exc}")
            await asyncio.sleep(_poll_interval_s)


def start_live_scanner(session: aiohttp.ClientSession, access_token: str | None, universe: str = "popular") -> None:
    global _scanner_task, _access_token, _universe, _batch_offset

    _access_token = access_token or get_access_token()
    _universe = universe
    _batch_offset = 0

    if not _access_token:
        print("  ⚠️ Live momentum scanner skipped — no Upstox token")
        return

    if _scanner_task and not _scanner_task.done():
        _scanner_task.cancel()

    print(f"  📡 Starting live momentum scanner ({universe}, batch={_batch_size})...")
    _scanner_task = asyncio.create_task(_loop_wrapper(session))


def stop_live_scanner() -> None:
    global _scanner_task
    if _scanner_task and not _scanner_task.done():
        _scanner_task.cancel()
        _scanner_task = None


def get_scanner_response(params: dict[str, str]) -> dict[str, Any]:
    from .live_scanner import DEFAULT_MOVE_15S_PCT, DEFAULT_MOVE_1M_PCT, DEFAULT_VOLUME_SPIKE_MULT

    universe = params.get("universe") or "popular"
    move_15s = float(params.get("move15s") or DEFAULT_MOVE_15S_PCT)
    move_1m = float(params.get("move1m") or DEFAULT_MOVE_1M_PCT)
    vol_mult = float(params.get("volumeMult") or DEFAULT_VOLUME_SPIKE_MULT)

    cache_key = f"live-scanner:{universe}:{move_15s}:{move_1m}:{vol_mult}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    symbols = _symbols_for_universe(universe)

    rows = engine.scan(
        move_15s_pct=move_15s,
        move_1m_pct=move_1m,
        volume_mult=vol_mult,
        symbols=symbols,
    )

    result = {
        "rows": rows,
        "count": len(rows),
        "universe": universe,
        "universeSize": len(symbols),
        "thresholds": {
            "move15sPct": move_15s,
            "move1mPct": move_1m,
            "volumeMult": vol_mult,
            "volumeAvgBars": 20,
        },
        "status": engine.status(),
        "timestamp": int(time.time() * 1000),
    }
    cache.set_cache(cache_key, result, 2000)
    return result


def ensure_scanner_universe(session: aiohttp.ClientSession, universe: str = "all") -> None:
    global _universe
    if _universe != universe:
        token = _access_token or get_access_token()
        if token:
            start_live_scanner(session, token, universe)
