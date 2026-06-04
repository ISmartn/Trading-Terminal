"""Nifty Smallcap constituent universe: NSE CSV symbols + live LTP enrichment."""

from __future__ import annotations

import csv
import io
import time
from typing import Any
from urllib.parse import quote

import aiohttp

from . import cache, upstox_sdk
from .config import get_access_token

NSE_BASE = "https://www.nseindia.com"
NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.nseindia.com/market-data/constituents",
}
TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/india/scan"

SMALLCAP_INDEX_API_NAMES = {
    "SC50": "NIFTY SMALLCAP 50",
    "SC100": "NIFTY SMALLCAP 100",
    "SC250": "NIFTY SMALLCAP 250",
}

SMALLCAP_CSV_URLS = {
    "SC50": "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap50list.csv",
    "SC100": "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap100list.csv",
    "SC250": "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv",
}

TV_CHUNK_SIZE = 50
UPSTOX_LTP_CHUNK_SIZE = 100


def _parse_constituent_csv(text: str) -> list[str]:
    symbols: list[str] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        sym = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
        if sym:
            symbols.append(sym)
    return symbols


async def _fetch_csv_symbols(session: aiohttp.ClientSession, index_key: str) -> list[str]:
    url = SMALLCAP_CSV_URLS[index_key]
    headers = {"User-Agent": NSE_HEADERS["User-Agent"], "Accept": "text/csv,*/*"}
    async with session.get(url, headers=headers) as res:
        if not res.ok:
            raise RuntimeError(f"NSE archive CSV failed [{index_key}]: HTTP {res.status}")
        text = await res.text()
    symbols = _parse_constituent_csv(text)
    if not symbols:
        raise RuntimeError(f"NSE archive CSV empty for {index_key}")
    return symbols


def _nse_rows_to_quotes(rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        sym = str(row.get("symbol") or row.get("symbolName") or "").strip().upper()
        if not sym:
            continue
        ltp = float(row.get("lastPrice") or row.get("ltp") or row.get("last") or 0)
        if ltp <= 0:
            continue
        prev = float(row.get("previousClose") or row.get("prevClose") or ltp)
        out[sym] = {
            "ltp": ltp,
            "change": float(row.get("change") or row.get("variation") or 0),
            "changePercent": float(row.get("pChange") or row.get("percentChange") or 0),
            "open": float(row.get("open") or ltp),
            "high": float(row.get("dayHigh") or row.get("high") or ltp),
            "low": float(row.get("dayLow") or row.get("low") or ltp),
            "prevClose": prev,
        }
    return out


async def _fetch_nse_equity_index(
    session: aiohttp.ClientSession,
    index_name: str,
    cookies: str,
) -> list[dict[str, Any]]:
    path = f"/api/equity-stockIndices?index={quote(index_name.upper())}"
    index_enc = quote(index_name.upper())
    headers = {
        **NSE_HEADERS,
        "Cookie": cookies,
        "Referer": f"https://www.nseindia.com/market-data/constituents?index={index_enc}",
    }
    async with session.get(f"{NSE_BASE}{path}", headers=headers) as res:
        if not res.ok:
            return []
        if "json" not in (res.headers.get("Content-Type") or ""):
            return []
        data = await res.json()
    rows = data.get("data") if isinstance(data, dict) else None
    return rows if isinstance(rows, list) and rows else []


async def _build_equity_key_map(session: aiohttp.ClientSession) -> dict[str, str]:
    from .handlers import _handle_instruments

    cache_key = "smallcap:equity-key-map"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    payload, _ = await _handle_instruments(session)
    out: dict[str, str] = {}
    for inst in payload.get("instruments") or []:
        if inst.get("exchangeSegment") != "NSE_EQ":
            continue
        itype = inst.get("instrumentType")
        if itype not in (None, "EQ", "EQUITY"):
            continue
        sym = str(inst.get("symbol") or "").strip().upper()
        key = inst.get("instrumentKey")
        if sym and key:
            out[sym] = str(key)
    cache.set_cache(cache_key, out, 3600000)
    return out


async def _fetch_upstox_quotes(
    session: aiohttp.ClientSession,
    symbols: list[str],
    access_token: str | None,
) -> dict[str, dict[str, float]]:
    if not access_token or not symbols:
        return {}

    key_map = await _build_equity_key_map(session)
    sym_to_key = {s: key_map[s] for s in symbols if s in key_map}
    if not sym_to_key:
        return {}

    out: dict[str, dict[str, float]] = {}
    keys = list(sym_to_key.values())
    for i in range(0, len(keys), UPSTOX_LTP_CHUNK_SIZE):
        chunk = keys[i : i + UPSTOX_LTP_CHUNK_SIZE]
        try:
            result = await upstox_sdk.get_ltp(access_token, ",".join(chunk))
        except Exception:
            continue
        data = result.get("data") or result.get("Data") or {}
        if isinstance(data, list):
            data = {
                item.get("instrument_key") or item.get("instrumentKey"): item
                for item in data
                if isinstance(item, dict)
            }
        key_to_sym = {v: k for k, v in sym_to_key.items()}
        for inst_key, quote in data.items():
            if not isinstance(quote, dict):
                continue
            sym = key_to_sym.get(inst_key)
            if not sym:
                continue
            ltp = float(quote.get("last_price") or quote.get("lastPrice") or 0)
            if ltp <= 0:
                continue
            prev = float(
                quote.get("close")
                or quote.get("prev_close")
                or quote.get("previous_close")
                or quote.get("cp")
                or ltp
            )
            ohlc = quote.get("ohlc") or {}
            out[sym] = {
                "ltp": ltp,
                "change": ltp - prev,
                "changePercent": ((ltp - prev) / prev * 100) if prev else 0,
                "open": float(ohlc.get("open") or ltp),
                "high": float(ohlc.get("high") or ltp),
                "low": float(ohlc.get("low") or ltp),
                "prevClose": prev,
            }
    return out


async def _fetch_tradingview_quotes(
    session: aiohttp.ClientSession,
    symbols: list[str],
) -> dict[str, dict[str, float]]:
    if not symbols:
        return {}

    columns = ["name", "close", "change", "open", "high", "low"]
    headers = {
        "Content-Type": "application/json",
        "User-Agent": NSE_HEADERS["User-Agent"],
        "Referer": "https://www.tradingview.com/",
    }
    out: dict[str, dict[str, float]] = {}

    for i in range(0, len(symbols), TV_CHUNK_SIZE):
        chunk = symbols[i : i + TV_CHUNK_SIZE]
        tickers = [f"NSE:{s}" for s in chunk]
        body = {"symbols": {"tickers": tickers}, "columns": columns}
        try:
            async with session.post(TRADINGVIEW_SCAN_URL, headers=headers, json=body) as res:
                if not res.ok:
                    continue
                raw = await res.json()
        except Exception:
            continue

        for item in raw.get("data") or []:
            ticker = item.get("s") or ""
            sym = ticker.split(":", 1)[-1].strip().upper()
            d = item.get("d") or []
            if not sym or len(d) < 2:
                continue
            ltp = float(d[1] or 0)
            if ltp <= 0:
                continue
            change_pct = float(d[2] or 0)
            open_p = float(d[3] or ltp) if len(d) > 3 else ltp
            high = float(d[4] or ltp) if len(d) > 4 else ltp
            low = float(d[5] or ltp) if len(d) > 5 else ltp
            prev = ltp / (1 + change_pct / 100) if change_pct else ltp
            out[sym] = {
                "ltp": ltp,
                "change": ltp - prev,
                "changePercent": change_pct,
                "open": open_p,
                "high": high,
                "low": low,
                "prevClose": prev,
            }

    return out


def _membership_sets(
    csv_sets: dict[str, set[str]],
) -> dict[str, list[str]]:
    """symbol -> list of index keys (SC50, SC100, SC250)."""
    all_symbols: set[str] = set()
    for s in csv_sets.values():
        all_symbols |= s
    membership: dict[str, list[str]] = {}
    for sym in all_symbols:
        tags: list[str] = []
        if sym in csv_sets.get("SC50", set()):
            tags.append("SC50")
        if sym in csv_sets.get("SC100", set()):
            tags.append("SC100")
        if sym in csv_sets.get("SC250", set()):
            tags.append("SC250")
        if tags:
            membership[sym] = tags
    return membership


def _build_stocks(
    symbols: list[str],
    membership: dict[str, list[str]],
    quotes: dict[str, dict[str, float]],
) -> list[dict[str, Any]]:
    stocks: list[dict[str, Any]] = []
    for sym in sorted(symbols):
        q = quotes.get(sym) or {}
        ltp = q.get("ltp", 0)
        prev = q.get("prevClose", ltp)
        stocks.append(
            {
                "symbol": sym,
                "ltp": ltp,
                "change": q.get("change", 0),
                "changePercent": q.get("changePercent", 0),
                "open": q.get("open", ltp),
                "high": q.get("high", ltp),
                "low": q.get("low", ltp),
                "prevClose": prev,
                "indices": membership.get(sym, []),
            }
        )
    return [s for s in stocks if s["ltp"] > 0]


async def fetch_smallcap_universe(
    session: aiohttp.ClientSession,
    filter_key: str = "all",
    nse_cookies: str = "",
    access_token: str | None = None,
) -> dict[str, Any]:
    """
    Build smallcap stock list with live quotes.
    filter_key: all | SC50 | SC100 | SC250
    """
    keys_to_load = (
        list(SMALLCAP_INDEX_API_NAMES.keys())
        if filter_key == "all"
        else [filter_key]
    )

    csv_sets: dict[str, set[str]] = {}
    for key in keys_to_load:
        syms = await _fetch_csv_symbols(session, key)
        csv_sets[key] = set(syms)

    membership = _membership_sets(csv_sets)
    if filter_key == "all":
        symbols = sorted(membership.keys())
    else:
        symbols = sorted(csv_sets.get(filter_key, set()))

    quotes: dict[str, dict[str, float]] = {}

    if nse_cookies:
        for key in keys_to_load:
            index_name = SMALLCAP_INDEX_API_NAMES[key]
            rows = await _fetch_nse_equity_index(session, index_name, nse_cookies)
            quotes.update(_nse_rows_to_quotes(rows))

    missing = [s for s in symbols if s not in quotes or quotes[s].get("ltp", 0) <= 0]
    if missing:
        token = access_token or get_access_token()
        upstox_q = await _fetch_upstox_quotes(session, missing, token)
        quotes.update(upstox_q)

    missing = [s for s in symbols if s not in quotes or quotes[s].get("ltp", 0) <= 0]
    if missing:
        tv_q = await _fetch_tradingview_quotes(session, missing)
        quotes.update(tv_q)

    stocks = _build_stocks(symbols, membership, quotes)
    source = "nse" if len(stocks) == len(symbols) else "mixed"
    if not stocks and symbols:
        source = "csv_only"

    return {
        "stocks": stocks,
        "symbolCount": len(symbols),
        "quotedCount": len(stocks),
        "source": source,
        "fetchedAt": int(time.time() * 1000),
        "filter": filter_key,
    }


async def handle_smallcap_universe(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    nse_cookies: str = "",
    access_token: str | None = None,
) -> tuple[dict[str, Any], bool]:
    filter_key = (params.get("filter") or "all").strip()
    if filter_key not in ("all", *SMALLCAP_INDEX_API_NAMES.keys()):
        filter_key = "all"

    cache_key = f"smallcap:universe:{filter_key}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    try:
        payload = await fetch_smallcap_universe(session, filter_key, nse_cookies, access_token)
    except Exception as exc:
        last_good = cache.get_last_good(f"lastgood:smallcap:universe:{filter_key}")
        if last_good and last_good.get("data", {}).get("stocks"):
            print(f"  📦 Smallcap universe fallback (last-good): {exc}")
            cache.set_cache(cache_key, last_good["data"], 5000)
            return last_good["data"], False
        raise

    cache.set_cache(cache_key, payload, 5000)
    last_good_key = f"lastgood:smallcap:universe:{filter_key}"
    if payload.get("stocks"):
        cache.set_last_good(last_good_key, payload)

    return payload, False
