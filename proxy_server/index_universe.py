"""Nifty index constituents from NSE archives (equity-stockIndices often 404 off NSE site)."""

from __future__ import annotations

import csv
import io
import time
from typing import Any

import aiohttp

from . import cache

NSE_ARCHIVE_BASE = "https://nsearchives.nseindia.com/content/indices"

INDEX_TAB_META: dict[str, dict[str, str]] = {
    "N50": {"label": "Nifty 50", "csv": "ind_nifty50list.csv"},
    "N100": {"label": "Nifty 100", "csv": "ind_nifty100list.csv"},
    "N200": {"label": "Nifty 200", "csv": "ind_nifty200list.csv"},
    "BANK": {"label": "Nifty Bank", "csv": "ind_niftybanklist.csv"},
    "IT": {"label": "Nifty IT", "csv": "ind_niftyitlist.csv"},
    "MID50": {"label": "Nifty Midcap 50", "csv": "ind_niftymidcap50list.csv"},
    "MID150": {"label": "Nifty Midcap 150", "csv": "ind_niftymidcap150list.csv"},
}


def _parse_csv_symbols(text: str) -> list[str]:
    symbols: list[str] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        sym = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
        if sym:
            symbols.append(sym)
    return symbols


async def fetch_index_symbols_csv(session: aiohttp.ClientSession, tab: str) -> list[str]:
    meta = INDEX_TAB_META.get(tab)
    if not meta:
        raise ValueError(f"Unknown index tab: {tab}")

    url = f"{NSE_ARCHIVE_BASE}/{meta['csv']}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv,*/*"}
    async with session.get(url, headers=headers) as res:
        if not res.ok:
            raise RuntimeError(f"NSE archive CSV failed [{tab}]: HTTP {res.status}")
        text = await res.text()

    symbols = _parse_csv_symbols(text)
    if not symbols:
        raise RuntimeError(f"NSE archive CSV empty for {tab}")
    return symbols


async def handle_index_universe(
    session: aiohttp.ClientSession,
    params: dict[str, str],
) -> tuple[dict[str, Any], bool]:
    tab = (params.get("tab") or "N50").strip().upper()
    if tab not in INDEX_TAB_META:
        tab = "N50"

    cache_key = f"index:universe:{tab}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    symbols = await fetch_index_symbols_csv(session, tab)
    payload = {
        "symbols": symbols,
        "symbolCount": len(symbols),
        "tab": tab,
        "label": INDEX_TAB_META[tab]["label"],
        "source": "nse_archive_csv",
        "fetchedAt": int(time.time() * 1000),
    }
    cache.set_cache(cache_key, payload, 3600000)
    cache.set_last_good(f"lastgood:index:universe:{tab}", payload)
    return payload, False
