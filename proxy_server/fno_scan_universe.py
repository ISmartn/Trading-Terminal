"""Full F&O stock universe for live scanner / intelligence (from Upstox instrument master)."""

from __future__ import annotations

from typing import Any

import aiohttp

from . import cache
from .config import FNO_STOCKS
from .handlers import FNO_INDEX_SYMBOLS, handle_fno_symbols

SCAN_STOCKS_CACHE_KEY = "fno:scanner:stock_symbols"
SCAN_STOCKS_TTL_MS = 3600_000


def _stock_symbols_only(symbols: list[str]) -> list[str]:
    index_set = set(FNO_INDEX_SYMBOLS)
    return sorted({s.upper() for s in symbols if s and s.upper() not in index_set})


async def refresh_fno_scan_stocks(session: aiohttp.ClientSession, *, refresh: bool = False) -> list[str]:
    """Load all F&O equity underlyings from Upstox; fallback to static FNO_STOCKS."""
    try:
        payload, _ = await handle_fno_symbols(session, refresh=refresh)
        symbols = _stock_symbols_only(payload.get("symbols") or [])
        if symbols:
            cache.set_cache(SCAN_STOCKS_CACHE_KEY, symbols, SCAN_STOCKS_TTL_MS)
            cache.set_last_good(SCAN_STOCKS_CACHE_KEY, {"symbols": symbols, "count": len(symbols)})
            return symbols
    except Exception as exc:
        print(f"  ⚠️ F&O scan universe refresh failed: {exc}")

    cached = cache.get_cached(SCAN_STOCKS_CACHE_KEY)
    if cached:
        return list(cached)

    disk = cache.get_last_good(SCAN_STOCKS_CACHE_KEY)
    if disk and disk.get("data", {}).get("symbols"):
        symbols = list(disk["data"]["symbols"])
        cache.set_cache(SCAN_STOCKS_CACHE_KEY, symbols, SCAN_STOCKS_TTL_MS)
        return symbols

    return list(FNO_STOCKS)


def get_fno_scan_stocks(universe: str) -> list[str]:
    """Sync symbol list for scanner loops (uses cache populated at startup)."""
    from .live_scanner import POPULAR_SCAN_SYMBOLS

    if universe != "all":
        return list(POPULAR_SCAN_SYMBOLS)

    cached = cache.get_cached(SCAN_STOCKS_CACHE_KEY)
    if cached:
        return list(cached)

    disk = cache.get_last_good(SCAN_STOCKS_CACHE_KEY)
    if disk and disk.get("data", {}).get("symbols"):
        return list(disk["data"]["symbols"])

    return list(FNO_STOCKS)


def universe_meta(universe: str) -> dict[str, Any]:
    symbols = get_fno_scan_stocks(universe)
    return {"universe": universe, "universeSize": len(symbols), "source": "upstox" if universe == "all" else "popular"}
