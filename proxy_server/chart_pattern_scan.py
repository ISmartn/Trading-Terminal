"""Chart pattern scanner API — index universe + Upstox daily candles + TA-Lib CDL*."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp

from . import cache, handlers, ta_patterns
from .chart_live_daily import enrich_daily_candles
from .index_universe import INDEX_TAB_META, handle_index_universe

SCAN_RANGE = "5Y"
SCAN_INTERVAL = "D"
SCAN_CONCURRENCY = 5

# In-memory TTL (ms)
SCAN_RESULT_CACHE_TTL = 15 * 60 * 1000
ENRICHED_CANDLES_CACHE_TTL = 10 * 60 * 1000
DETECT_CACHE_TTL = 5 * 60 * 1000


def _scan_cache_key(tab: str, selected: list[str], range_key: str) -> str:
    return f"chart-pattern:scan:{tab}:{range_key}:{','.join(sorted(selected))}"


def _scan_last_good_key(tab: str, range_key: str) -> str:
    return f"chart-pattern-scan-{tab}-{range_key}"


def _enriched_candles_key(symbol: str, range_key: str) -> str:
    return f"chart-pattern:candles:{symbol.upper()}:{range_key}:{SCAN_INTERVAL}"


async def fetch_daily_candles_enriched(
    session: aiohttp.ClientSession,
    symbol: str,
    user_access_token: str | None,
    range_key: str = SCAN_RANGE,
) -> list[dict[str, Any]]:
    cache_key = _enriched_candles_key(symbol, range_key)
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    daily = await handlers.fetch_candles_for_ta(
        session, symbol, range_key, user_access_token, SCAN_INTERVAL
    )
    if not daily:
        return []
    try:
        intra = await handlers.fetch_candles_for_ta(
            session, symbol, "1D", user_access_token, "1", bypass_cache=True
        )
    except RuntimeError:
        intra = []
    enriched = await enrich_daily_candles(
        daily,
        intra,
        session=session,
        symbol=symbol,
        user_access_token=user_access_token,
    )
    if enriched:
        cache.set_cache(cache_key, enriched, ENRICHED_CANDLES_CACHE_TTL)
    return enriched


def _parse_patterns_param(raw: str | None) -> list[str]:
    if not raw:
        return list(ta_patterns.ALL_PATTERN_IDS)
    ids = [p.strip().upper() for p in raw.split(",") if p.strip()]
    valid = [p for p in ids if p in ta_patterns.ALL_PATTERN_IDS]
    return valid or list(ta_patterns.ALL_PATTERN_IDS)


def _parse_range_param(raw: str | None) -> str:
    key = (raw or SCAN_RANGE).strip().upper()
    return key if key in ("1Y", "5Y", "3M", "6M") else SCAN_RANGE


async def _scan_one(
    session: aiohttp.ClientSession,
    symbol: str,
    selected: list[str],
    user_access_token: str | None,
    range_key: str,
    sem: asyncio.Semaphore,
) -> list[dict[str, Any]]:
    async with sem:
        try:
            candles = await fetch_daily_candles_enriched(
                session, symbol, user_access_token, range_key
            )
            return ta_patterns.scan_symbol_patterns(symbol, candles, selected, lookback_bars=1)
        except RuntimeError:
            return []


def _payload_from_rows(
    *,
    rows: list[dict[str, Any]],
    symbols: list[str],
    index_label: str,
    tab: str,
    selected: list[str],
    range_key: str,
    from_cache: bool,
    cache_layer: str,
) -> dict[str, Any]:
    return {
        "rows": rows,
        "symbolCount": len(symbols),
        "indexLabel": index_label,
        "tab": tab,
        "patterns": selected,
        "range": range_key,
        "interval": SCAN_INTERVAL,
        "engine": "talib" if ta_patterns.HAS_TALIB else "unavailable",
        "cachedAt": int(time.time() * 1000),
        "fromCache": from_cache,
        "cacheLayer": cache_layer,
    }


async def handle_chart_pattern_scan(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[dict[str, Any], bool]:
    tab = (params.get("tab") or "N50").strip().upper()
    selected = _parse_patterns_param(params.get("patterns"))
    range_key = _parse_range_param(params.get("range"))

    mem_key = _scan_cache_key(tab, selected, range_key)
    cached = cache.get_cached(mem_key)
    if cached:
        cached = {**cached, "fromCache": True, "cacheLayer": "memory"}
        return cached, True

    universe, _ = await handle_index_universe(session, {"tab": tab})
    symbols: list[str] = universe.get("symbols") or []
    index_label = universe.get("label") or INDEX_TAB_META.get(tab, {}).get("label", tab)

    sem = asyncio.Semaphore(SCAN_CONCURRENCY)
    tasks = [
        _scan_one(session, sym, selected, user_access_token, range_key, sem)
        for sym in symbols
    ]
    batches = await asyncio.gather(*tasks)

    rows: list[dict[str, Any]] = []
    for batch in batches:
        rows.extend(batch)

    rows.sort(key=lambda r: (r.get("symbol", ""), r.get("pattern", "")))

    payload = _payload_from_rows(
        rows=rows,
        symbols=symbols,
        index_label=index_label,
        tab=tab,
        selected=selected,
        range_key=range_key,
        from_cache=False,
        cache_layer="live",
    )
    cache.set_cache(mem_key, payload, SCAN_RESULT_CACHE_TTL)
    cache.set_last_good(_scan_last_good_key(tab, range_key), payload)
    return payload, False


async def handle_chart_pattern_detect(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[dict[str, Any], bool]:
    """All TA-Lib pattern hits for one symbol (chart overlays)."""
    symbol = (params.get("symbol") or "").strip().upper()
    if not symbol:
        raise RuntimeError("Missing symbol parameter")

    range_key = _parse_range_param(params.get("range"))
    selected = _parse_patterns_param(params.get("patterns"))

    cache_key = f"chart-pattern:detect:{symbol}:{range_key}:{','.join(sorted(selected))}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    candles = await fetch_daily_candles_enriched(session, symbol, user_access_token, range_key)
    if len(candles) < 2:
        raise RuntimeError(f"Insufficient candle data for {symbol}")

    from .chart_patterns_structural import STRUCTURAL_PATTERN_IDS, detect_structural_patterns

    selected_set = set(selected)
    cdl_hits = ta_patterns.detect_cdl_patterns(candles)
    structural_hits = detect_structural_patterns(candles)
    patterns = [
        p for p in cdl_hits + structural_hits if p["name"] in selected_set
    ]
    formations = [
        p for p in structural_hits
        if p["name"] in selected_set and p.get("overlay")
    ]

    payload = {
        "symbol": symbol,
        "patterns": patterns,
        "formations": formations,
        "range": range_key,
        "interval": SCAN_INTERVAL,
        "engine": "talib" if ta_patterns.HAS_TALIB else "unavailable",
        "cachedAt": int(time.time() * 1000),
    }
    cache.set_cache(cache_key, payload, DETECT_CACHE_TTL)
    return payload, False
