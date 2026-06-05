"""Poll Upstox LTP for F&O stocks and feed the live momentum engine."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp

from . import upstox_sdk
from . import cache
from .config import EQUITY_INSTRUMENT_KEYS, get_access_token
from .fno_scan_universe import get_fno_scan_stocks, refresh_fno_scan_stocks
from .live_scanner import engine

_scanner_task: asyncio.Task | None = None
_access_token: str | None = None
_universe: str = "all"
# V3 LTP accepts up to 500 instruments/request; we poll the whole universe each
# cycle (in parallel chunks) so every symbol updates every poll — essential for
# second-level momentum detection.
_chunk_size = 150
_poll_interval_s = 2.0
_equity_keys_cache: dict[str, str] = {}
_seeding_task: asyncio.Task | None = None


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
    return get_fno_scan_stocks(universe)


async def _seed_all_volume_baselines(session: aiohttp.ClientSession, token: str, symbols: list[str]) -> None:
    """Background: seed 20-min volume averages for the full F&O universe."""
    chunk = 25
    for i in range(0, len(symbols), chunk):
        await seed_volume_baselines(session, token, symbols[i : i + chunk])
        await asyncio.sleep(0.2)


def _maybe_start_volume_seeding(session: aiohttp.ClientSession, token: str, symbols: list[str]) -> None:
    global _seeding_task
    if _seeding_task and not _seeding_task.done():
        return
    _seeding_task = asyncio.create_task(_seed_all_volume_baselines(session, token, symbols))


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
        return 0

    quotes = result.get("data") or {}
    if isinstance(quotes, list):
        quotes = {
            q.get("instrument_token") or q.get("instrument_key"): q
            for q in quotes
            if isinstance(q, dict)
        }
    now_ms = int(time.time() * 1000)
    updated = 0

    # Match by request instrument_key first, then fall back to the
    # instrument_token carried inside each quote (V3 keys can differ).
    key_to_sym = {k: s for s, k in pairs}
    for resp_key, quote in quotes.items():
        if not isinstance(quote, dict) or quote.get("last_price") is None:
            continue
        inst = quote.get("instrument_token") or resp_key
        sym = key_to_sym.get(resp_key) or key_to_sym.get(inst)
        if not sym:
            continue
        ltp = float(quote["last_price"])
        cum_vol = float(quote.get("volume") or 0)
        engine.update_quote(sym, inst, ltp, cum_vol, now_ms)
        updated += 1

    return updated


async def _scanner_loop(session: aiohttp.ClientSession) -> None:
    token = _access_token or get_access_token()
    if not token:
        await asyncio.sleep(5)
        return

    symbols = _symbols_for_universe(_universe)
    if not symbols:
        await asyncio.sleep(_poll_interval_s)
        return

    if engine.status().get("pollCount", 0) == 0:
        _maybe_start_volume_seeding(session, token, symbols)

    chunks = [symbols[i : i + _chunk_size] for i in range(0, len(symbols), _chunk_size)]
    results = await asyncio.gather(
        *(_poll_batch(session, token, chunk) for chunk in chunks),
        return_exceptions=True,
    )
    updated = sum(r for r in results if isinstance(r, int))
    engine.set_meta(running=True, last_poll_ms=int(time.time() * 1000), symbols_polled=updated)
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


def start_live_scanner(session: aiohttp.ClientSession, access_token: str | None, universe: str = "all") -> None:
    global _scanner_task, _access_token, _universe

    _access_token = access_token or get_access_token()
    _universe = universe

    if not _access_token:
        print("  ⚠️ Live momentum scanner skipped — no Upstox token")
        return

    if _scanner_task and not _scanner_task.done():
        _scanner_task.cancel()

    symbols = get_fno_scan_stocks(universe)
    print(
        f"  📡 Starting live momentum scanner ({universe}, {len(symbols)} symbols, "
        f"full-universe poll every {_poll_interval_s:.0f}s, chunk={_chunk_size})..."
    )
    _scanner_task = asyncio.create_task(_loop_wrapper(session))


def stop_live_scanner() -> None:
    global _scanner_task
    if _scanner_task and not _scanner_task.done():
        _scanner_task.cancel()
        _scanner_task = None


def get_scanner_response(params: dict[str, str]) -> dict[str, Any]:
    from .fno_intelligence import _scan_config_from_params

    universe = params.get("universe") or "all"
    cfg = _scan_config_from_params(params)

    cache_key = (
        f"live-scanner:{universe}:{cfg.fast_secs}:{cfg.slow_secs}:{cfg.move_fast_pct}:"
        f"{cfg.move_slow_pct}:{cfg.volume_mult}:{cfg.require_volume}:{cfg.require_vwap}"
    )
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    symbols = _symbols_for_universe(universe)

    rows = engine.scan(cfg, symbols=symbols)

    result = {
        "rows": rows,
        "count": len(rows),
        "universe": universe,
        "universeSize": len(symbols),
        "thresholds": {
            "fastSecs": cfg.fast_secs,
            "slowSecs": cfg.slow_secs,
            "move15sPct": cfg.move_fast_pct,
            "move1mPct": cfg.move_slow_pct,
            "volumeMult": cfg.volume_mult,
            "requireVolume": cfg.require_volume,
            "requireVwap": cfg.require_vwap,
            "volumeAvgBars": 20,
        },
        "status": engine.status(),
        "timestamp": int(time.time() * 1000),
    }
    cache.set_cache(cache_key, result, 2000)
    return result


async def bootstrap_fno_scanner(session: aiohttp.ClientSession, token: str | None) -> None:
    """Load full F&O stock list from Upstox, then start live polling."""
    global _equity_keys_cache
    _equity_keys_cache = {}
    stocks = await refresh_fno_scan_stocks(session)
    print(f"  📋 F&O scanner universe: {len(stocks)} stocks (Upstox instrument master)")
    if token:
        start_live_scanner(session, token, "all")


def ensure_scanner_universe(session: aiohttp.ClientSession, universe: str = "all") -> None:
    global _universe
    if _universe != universe:
        token = _access_token or get_access_token()
        if token:
            start_live_scanner(session, token, universe)
