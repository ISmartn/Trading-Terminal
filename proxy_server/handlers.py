"""Upstox, NSE, and TradingView API handlers."""

from __future__ import annotations

import asyncio
import gzip
import json
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import aiohttp

from . import cache
from . import spot_feed_metrics
from . import upstox_sdk
from .debug_log import debug_error, debug_log, debug_verbose, is_debug_enabled
from .config import (
    FNO_TICKERS,
    INDEX_INSTRUMENT_KEYS,
    OI_CHAIN_CACHE_MS,
    resolve_instrument_key,
    INDEX_TICKERS,
    NSE_BASE,
    TRADINGVIEW_SCAN_URL,
    UNDERLYING_MAP,
    SYMBOL_ALIASES,
)

# ── NSE session state ──

_NSE_FETCH_ERRORS = (RuntimeError, aiohttp.ClientError, asyncio.TimeoutError, TimeoutError)
_nse_inflight: dict[str, asyncio.Task[tuple[Any, bool]]] = {}
_nse_session_cookies: str = ""
_nse_session_expiry: float = 0
_nse_session_lock = asyncio.Lock()
_nse_session_refresh_task: asyncio.Task[str] | None = None
_instruments_download_lock = asyncio.Lock()


def transform_upstox_candles(upstox_response: dict[str, Any]) -> dict[str, Any]:
    candles = upstox_response.get("data", {}).get("candles") or []
    timestamp, open_, high, low, close, volume, oi = [], [], [], [], [], [], []

    for candle in candles:
        ts_raw = candle[0]
        try:
            ts = int(datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00")).timestamp())
        except ValueError:
            ts = int(datetime.strptime(str(ts_raw)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
        timestamp.append(ts)
        open_.append(candle[1])
        high.append(candle[2])
        low.append(candle[3])
        close.append(candle[4])
        volume.append(candle[5] or 0)
        oi.append(candle[6] or 0)

    return {
        "status": "success",
        "data": {
            "timestamp": timestamp,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
            "oi": oi,
        },
    }


def _normalize_expiry_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if not text:
        return None
    return text[:10] if len(text) >= 10 else text


def extract_expiry_dates(payload: dict[str, Any]) -> list[str]:
    arr = payload.get("data") or []
    if not arr:
        return []
    first = arr[0]
    if isinstance(first, (str, datetime, date)):
        raw_dates = arr
    elif isinstance(first, dict):
        raw_dates = [c.get("expiry") for c in arr]
    else:
        raw_dates = [getattr(c, "expiry", None) for c in arr]
    dates = [_normalize_expiry_value(d) for d in raw_dates]
    return sorted(set(d for d in dates if d))


def pick_nearest_expiry(dates: list[str], preferred: str | None) -> str | None:
    if preferred:
        return _normalize_expiry_value(preferred)
    normalized = [_normalize_expiry_value(d) for d in dates]
    normalized = [d for d in normalized if d]
    if not normalized:
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    upcoming = [d for d in normalized if d >= today]
    return (upcoming or normalized)[0]


async def _get_fno_equity_keys(session: aiohttp.ClientSession) -> dict[str, str]:
    """Symbol → NSE_EQ instrument key for all F&O stocks."""
    cache_key = "fno:equity:keys"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    fno_cached = cache.get_cached("fno:symbols:list")
    if fno_cached and fno_cached.get("equityKeys"):
        keys = fno_cached["equityKeys"]
        cache.set_cache(cache_key, keys, 3600000)
        return keys

    disk = cache.get_last_good("fno:symbols:list")
    if disk and disk.get("data", {}).get("equityKeys"):
        keys = disk["data"]["equityKeys"]
        cache.set_cache(cache_key, keys, 3600000)
        return keys

    payload, _ = await _handle_instruments(session)
    _, _, equity_keys = extract_fno_symbols(payload.get("instruments") or [])
    cache.set_cache(cache_key, equity_keys, 3600000)
    return equity_keys


def _symbol_lookup_keys(symbol: str) -> set[str]:
    """Candidate symbol strings for instrument master lookup."""
    raw = symbol.strip().upper()
    keys = {raw}
    if symbol in SYMBOL_ALIASES:
        keys.add(SYMBOL_ALIASES[symbol].upper())
    if raw in SYMBOL_ALIASES.values():
        for alias, canonical in SYMBOL_ALIASES.items():
            if canonical.upper() == raw:
                keys.add(alias.upper())
    return keys


async def resolve_equity_instrument_key(
    session: aiohttp.ClientSession,
    symbol: str,
) -> str | None:
    """Resolve NSE_EQ / index key — F&O master overrides stale static map."""
    lookup = _symbol_lookup_keys(symbol)

    for key in lookup:
        if key in INDEX_INSTRUMENT_KEYS:
            return INDEX_INSTRUMENT_KEYS[key]
        if key in UNDERLYING_MAP:
            return UNDERLYING_MAP[key]

    try:
        equity_keys = await _get_fno_equity_keys(session)
    except Exception:
        equity_keys = {}
    for key in lookup:
        if key in equity_keys:
            return equity_keys[key]

    for key in lookup:
        resolved = resolve_instrument_key(key)
        if resolved:
            return resolved

    return None


async def resolve_option_underlying_key(
    session: aiohttp.ClientSession,
    symbol: str,
) -> str | None:
    """Resolve Upstox underlying instrument key for option chain (indices + F&O stocks)."""
    lookup = _symbol_lookup_keys(symbol)

    resolved = await resolve_equity_instrument_key(session, symbol)
    if resolved:
        return resolved

    equity_keys = await _get_fno_equity_keys(session)
    for key in lookup:
        if key in equity_keys:
            return equity_keys[key]

    payload, _ = await _handle_instruments(session)
    for inst in payload.get("instruments") or []:
        if inst.get("exchangeSegment") != "NSE_EQ":
            continue
        inst_key = inst.get("instrumentKey")
        if not inst_key:
            continue
        names = {
            str(inst.get("symbol") or "").upper(),
            str(inst.get("tradingSymbol") or "").split("-")[0].split(" ")[0].upper(),
        }
        if lookup & names:
            return str(inst_key)

    return None


async def fetch_option_contracts(
    instrument_key: str,
    symbol: str,
    user_access_token: str | None,
    user_prefix: str,
) -> dict[str, Any]:
    contracts_cache_key = f"upstox:{user_prefix}contracts:{symbol}"
    contracts = cache.get_cached(contracts_cache_key)
    if not contracts:
        contracts = await upstox_sdk.get_option_contracts(user_access_token, instrument_key)
        cache.set_cache(contracts_cache_key, contracts, 300000)
    return contracts


async def handle_upstox_proxy(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[Any, bool]:
    endpoint = params.get("endpoint", "")
    symbol = (params.get("symbol") or "NIFTY").upper()
    expiry = params.get("expiry")
    user_prefix = f"user:{user_access_token[:8]}:" if user_access_token else ""
    cache_key = f"upstox:{user_prefix}{endpoint}:{symbol}:{expiry or ''}"
    force_refresh = params.get("refresh", "").lower() in ("1", "true", "yes")

    if not force_refresh:
        cached = cache.get_cached(cache_key)
        if cached:
            if endpoint == "expiry-list":
                dates = extract_expiry_dates(cached)
                return {"status": "success", "data": dates}, True
            return cached, True

    if endpoint == "option-chain":
        return await _handle_option_chain(session, params, symbol, expiry, user_access_token, user_prefix, cache_key)

    if endpoint == "expiry-list":
        return await _handle_expiry_list(session, symbol, user_access_token, user_prefix, cache_key)

    if endpoint == "ltp":
        instrument_key = await resolve_option_underlying_key(session, symbol) or params.get("instrumentKey")
        if not instrument_key:
            raise RuntimeError(f"Unknown symbol: {symbol}")
        result = await upstox_sdk.get_ltp(user_access_token, instrument_key)
        cache.set_cache(cache_key, result, 2000)
        return result, False

    if endpoint == "instruments":
        return await _handle_instruments(session)

    if endpoint == "historical":
        return await _handle_historical(session, params, user_access_token)

    raise RuntimeError(
        f"Unknown endpoint: {endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical"
    )


async def _handle_option_chain(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    symbol: str,
    expiry: str | None,
    user_access_token: str | None,
    user_prefix: str,
    cache_key: str,
) -> tuple[Any, bool]:
    instrument_key = await resolve_option_underlying_key(session, symbol)
    if not instrument_key:
        raise RuntimeError(
            f"Unknown symbol: {symbol}. Use an F&O index (NIFTY, BANKNIFTY, …) or F&O stock (e.g. TATAMOTORS)."
        )

    last_good_key = f"lastgood:oc:{symbol}:{expiry or 'nearest'}"

    try:
        expiry_date = expiry
        if not expiry_date:
            try:
                contracts = await fetch_option_contracts(
                    instrument_key, symbol, user_access_token, user_prefix
                )
                dates = extract_expiry_dates(contracts)
                expiry_date = pick_nearest_expiry(dates, None)
            except RuntimeError as exc:
                print(f"  ⚠️ Expiry list fetch failed for {symbol}: {exc}")

        if not expiry_date:
            raise RuntimeError(f"No expiry dates available for {symbol}")

        result = await upstox_sdk.get_put_call_option_chain(
            user_access_token,
            instrument_key,
            expiry_date,
        )

        has_data = isinstance(result.get("data"), list) and len(result["data"]) > 0
        if has_data:
            cache.set_last_good(last_good_key, result)
            oc_ttl = (
                120_000
                if symbol in ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY")
                else OI_CHAIN_CACHE_MS
            )
            cache.set_cache(cache_key, result, oc_ttl)
            return result, False

        last_good = cache.get_last_good(last_good_key)
        if last_good:
            age_min = round((time.time() * 1000 - last_good["timestamp"]) / 60000)
            print(f"  📦 Serving last-good OC for {symbol} (cached {age_min}min ago)")
            after_hours = {**last_good["data"], "afterHours": True, "cachedAt": last_good["timestamp"]}
            cache.set_cache(cache_key, after_hours, 30000)
            return after_hours, False

        cache.set_cache(cache_key, result, 30000)
        return result, False

    except RuntimeError as exc:
        last_good = cache.get_last_good(last_good_key)
        if last_good:
            print(f"  📦 Upstox error, serving last-good OC for {symbol}: {exc}")
            return {**last_good["data"], "afterHours": True, "cachedAt": last_good["timestamp"]}, False

        msg = str(exc)
        is_429 = "429" in msg or "Too many" in msg
        cache_ttl = 120000 if is_429 else 60000
        suffix = " [rate-limited, backing off 2min]" if is_429 else ""
        print(f"  ⚠️ OC unavailable for {symbol} (no cache): {msg}{suffix}")
        empty = {"status": "success", "data": [], "afterHours": True}
        cache.set_cache(cache_key, empty, cache_ttl)
        return empty, False


async def _handle_expiry_list(
    session: aiohttp.ClientSession,
    symbol: str,
    user_access_token: str | None,
    user_prefix: str,
    cache_key: str,
) -> tuple[Any, bool]:
    instrument_key = await resolve_option_underlying_key(session, symbol)
    if not instrument_key:
        raise RuntimeError(f"Unknown symbol: {symbol}")

    last_good_key = f"lastgood:expiry:{symbol}"
    try:
        contracts = await fetch_option_contracts(
            instrument_key, symbol, user_access_token, user_prefix
        )
        dates = extract_expiry_dates(contracts)
        result = {"status": "success", "data": dates}
        if dates:
            cache.set_last_good(last_good_key, result)
        cache.set_cache(cache_key, result, 300000)
        return result, False
    except RuntimeError as exc:
        last_good = cache.get_last_good(last_good_key)
        if last_good:
            print(f"  📦 Serving last-good expiry list for {symbol}: {exc}")
            return last_good["data"], False
        raise


async def _handle_instruments(session: aiohttp.ClientSession) -> tuple[Any, bool]:
    instrument_cache_key = "upstox:instruments-master"
    cached = cache.get_cached(instrument_cache_key)
    if cached:
        return cached, True

    disk = cache.get_last_good(instrument_cache_key)
    if disk and disk.get("data"):
        payload = disk["data"]
        cache.set_cache(instrument_cache_key, payload, 3600000)
        return payload, True

    async with _instruments_download_lock:
        cached = cache.get_cached(instrument_cache_key)
        if cached:
            return cached, True

        print("  📥 Downloading Upstox instrument master JSON...")
        json_url = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
        async with session.get(json_url) as res:
            if not res.ok:
                raise RuntimeError(f"Failed to download instrument master: {res.status}")
            buffer = await res.read()

        json_text = gzip.decompress(buffer).decode("utf-8")
        raw_instruments = json.loads(json_text)

        allowed_segments = {"NSE_EQ", "NSE_FO", "NSE_INDEX"}
        instruments = []

        for item in raw_instruments:
            segment = item.get("segment") or item.get("exchange")
            if segment not in allowed_segments:
                continue

            if segment == "NSE_FO":
                exchange_segment = "NSE_FNO"
            elif segment == "NSE_INDEX":
                exchange_segment = "IDX_I"
            else:
                exchange_segment = segment

            trading_symbol = item.get("trading_symbol") or item.get("tradingsymbol") or ""
            if segment == "NSE_EQ":
                ts = str(trading_symbol).strip()
                base_symbol = (ts.split("-")[0].split(" ")[0] if ts else None) or item.get("underlying_symbol")
            elif segment == "NSE_FO":
                base_symbol = item.get("underlying_symbol") or (
                    trading_symbol.split(" ")[0] if trading_symbol else None
                )
            else:
                base_symbol = item.get("name") or (
                    trading_symbol.split(" ")[0] if trading_symbol else None
                )

            instrument_type = item.get("instrument_type") or item.get("instrumentType")
            option_type = None
            if instrument_type in ("CE", "PE"):
                option_type = instrument_type
            else:
                option_type = item.get("option_type")

            instruments.append(
                {
                    "securityId": item.get("exchange_token") or item.get("instrument_key"),
                    "instrumentKey": item.get("instrument_key"),
                    "symbol": base_symbol,
                    "tradingSymbol": trading_symbol,
                    "exchangeSegment": exchange_segment,
                    "instrumentType": instrument_type,
                    "underlyingKey": item.get("underlying_key"),
                    "underlyingSymbol": item.get("underlying_symbol"),
                    "underlyingType": item.get("underlying_type"),
                    "lotSize": item.get("lot_size") or item.get("lotSize") or 1,
                    "expiryDate": item.get("expiry"),
                    "strikePrice": item.get("strike_price") or item.get("strike"),
                    "optionType": option_type,
                }
            )

        print(f"  ✅ Parsed {len(instruments)} instruments from Upstox JSON")
        payload = {"instruments": instruments, "count": len(instruments)}
        cache.set_cache(instrument_cache_key, payload, 3600000)
        cache.set_last_good(instrument_cache_key, payload)
        return payload, False


FNO_INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]

_INDEX_NAME_MAP = {
    "NIFTY": "NIFTY",
    "NIFTY 50": "NIFTY",
    "BANKNIFTY": "BANKNIFTY",
    "NIFTY BANK": "BANKNIFTY",
    "FINNIFTY": "FINNIFTY",
    "NIFTY FIN SERVICE": "FINNIFTY",
    "MIDCPNIFTY": "MIDCPNIFTY",
    "NIFTY MID SELECT": "MIDCPNIFTY",
    "NIFTY MIDCAP SELECT": "MIDCPNIFTY",
}


def _normalize_index_fno_symbol(raw: str) -> str | None:
    upper = raw.strip().upper()
    if upper in _INDEX_NAME_MAP:
        return _INDEX_NAME_MAP[upper]
    if "MID" in upper and "SELECT" in upper:
        return "MIDCPNIFTY"
    if "FIN" in upper and "SERVICE" in upper:
        return "FINNIFTY"
    if "BANK" in upper and "NIFTY" in upper:
        return "BANKNIFTY"
    if upper == "NIFTY" or upper.startswith("NIFTY "):
        return "NIFTY"
    return None


def extract_fno_symbols(instruments: list[dict[str, Any]]) -> tuple[list[str], dict[str, Any], dict[str, str]]:
    """Return unique F&O underlyings, stats, and symbol → NSE_EQ instrument key map."""
    symbols: set[str] = set(FNO_INDEX_SYMBOLS)
    equity_keys: dict[str, str] = {}
    stats: dict[str, Any] = {
        "totalInstruments": len(instruments),
        "fnoInstruments": 0,
        "instrumentTypes": {},
        "underlyingTypes": {},
        "stockSymbolsAdded": 0,
        "indexSymbolsAdded": 0,
        "skippedSamples": [],
    }

    for inst in instruments:
        seg = inst.get("exchangeSegment") or ""
        if seg not in {"NSE_FNO", "NSE_FO"}:
            continue

        stats["fnoInstruments"] += 1
        itype = str(inst.get("instrumentType") or "").upper()
        stats["instrumentTypes"][itype] = stats["instrumentTypes"].get(itype, 0) + 1

        und_type = str(inst.get("underlyingType") or "").upper()
        if und_type:
            stats["underlyingTypes"][und_type] = stats["underlyingTypes"].get(und_type, 0) + 1

        und_key = str(inst.get("underlyingKey") or "")
        und_sym = str(inst.get("underlyingSymbol") or inst.get("symbol") or "").strip().upper()
        is_index = und_type == "INDEX" or und_key.startswith("NSE_INDEX|") or und_key.startswith("BSE_INDEX|")
        is_equity = und_type in {"EQUITY", "EQ"} or und_key.startswith("NSE_EQ|")

        if is_index:
            mapped = _normalize_index_fno_symbol(und_sym)
            if mapped:
                before = len(symbols)
                symbols.add(mapped)
                if len(symbols) > before:
                    stats["indexSymbolsAdded"] += 1
            elif len(stats["skippedSamples"]) < 5:
                stats["skippedSamples"].append({"reason": "index_unmapped", "symbol": und_sym, "type": itype})
            continue

        # Upstox uses CE / PE / FUT (not legacy FUTSTK / OPTSTK labels)
        if is_equity and itype in {"CE", "PE", "FUT", "FUTSTK", "OPTSTK"}:
            if und_sym and und_sym not in FNO_INDEX_SYMBOLS:
                before = len(symbols)
                symbols.add(und_sym)
                if len(symbols) > before:
                    stats["stockSymbolsAdded"] += 1
                if und_key.startswith("NSE_EQ|"):
                    equity_keys[und_sym] = und_key
            elif len(stats["skippedSamples"]) < 5:
                stats["skippedSamples"].append({"reason": "empty_equity_symbol", "type": itype, "undKey": und_key})
            continue

        if len(stats["skippedSamples"]) < 5:
            stats["skippedSamples"].append(
                {"reason": "unclassified", "type": itype, "undType": und_type, "symbol": und_sym, "undKey": und_key}
            )

    result = sorted(symbols)
    stats["symbolCount"] = len(result)
    stats["equityKeyCount"] = len(equity_keys)
    return result, stats, equity_keys


async def handle_fno_symbols(session: aiohttp.ClientSession, *, refresh: bool = False) -> tuple[Any, bool]:
    cache_key = "fno:symbols:list"
    if refresh:
        cache.delete_cache(cache_key)
        debug_log("fno_symbols cache cleared", refresh=True)

    cached = cache.get_cached(cache_key)
    if cached and not refresh:
        debug_verbose("fno_symbols cache hit", count=cached.get("count"))
        return cached, True

    if not refresh:
        disk = cache.get_last_good(cache_key)
        if disk and disk.get("data"):
            result = disk["data"]
            cache.set_cache(cache_key, result, 3600000)
            debug_verbose("fno_symbols disk cache hit", count=result.get("count"))
            return result, True

    try:
        payload, _ = await _handle_instruments(session)
    except Exception as exc:
        debug_error("Failed to load instrument master for F&O symbols", exc)
        raise

    instruments = payload.get("instruments") or []
    symbols, stats, equity_keys = extract_fno_symbols(instruments)
    result: dict[str, Any] = {
        "symbols": symbols,
        "count": len(symbols),
        "equityKeys": equity_keys,
    }
    if is_debug_enabled():
        result["debug"] = stats
        debug_log(
            "F&O universe extracted",
            count=len(symbols),
            fnoRows=stats["fnoInstruments"],
            stocks=stats["stockSymbolsAdded"],
            types=stats["instrumentTypes"],
        )
        if len(symbols) <= len(FNO_INDEX_SYMBOLS):
            debug_error(
                "F&O extraction returned indices only — check instrument_type / underlying_type fields",
                stats=stats,
            )

    cache.set_cache(cache_key, result, 3600000)
    cache.set_last_good(cache_key, result)
    print(f"  📋 F&O universe: {len(symbols)} underlyings (indices + stocks)")
    return result, False


async def _handle_historical(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[Any, bool]:
    instrument_key = params.get("instrumentKey")
    symbol = (params.get("symbol") or "").upper()
    if not instrument_key:
        instrument_key = await resolve_equity_instrument_key(session, symbol) or params.get("securityId")
    if instrument_key and "|" not in str(instrument_key):
        instrument_key = INDEX_INSTRUMENT_KEYS.get(str(instrument_key).upper()) or instrument_key

    interval = params.get("interval") or "5"
    from_date = params.get("fromDate")
    to_date = params.get("toDate")

    if not instrument_key:
        raise RuntimeError("Missing instrumentKey (or symbol/securityId) parameter")

    is_daily = interval == "D"
    now = datetime.now(timezone.utc)
    default_days_back = 365 if is_daily else 3
    default_from = now - timedelta(days=default_days_back)

    from_str = from_date.split(" ")[0] if from_date else default_from.strftime("%Y-%m-%d")
    to_str = to_date.split(" ")[0] if to_date else now.strftime("%Y-%m-%d")

    if not is_daily:
        from_dt = datetime.strptime(from_str, "%Y-%m-%d")
        to_dt = datetime.strptime(to_str, "%Y-%m-%d")
        days_diff = (to_dt - from_dt).days
        if days_diff > 90:
            clamped = to_dt - timedelta(days=89)
            from_str = clamped.strftime("%Y-%m-%d")
            print(f"  📐 Clamped intraday date range to 90 days (was {days_diff}d)")

    historical_cache_key = f"upstox:hist:{instrument_key}:{interval}:{from_str}:{to_str}"
    cached_hist = cache.get_cached(historical_cache_key)
    if cached_hist:
        return cached_hist, True

    if is_daily:
        unit, upstox_interval = "days", "1"
    elif interval == "60":
        unit, upstox_interval = "hours", "1"
    else:
        unit, upstox_interval = "minutes", interval

    print(f"  📊 Fetching {'daily' if is_daily else 'intraday'} chart: {instrument_key} ({from_str} → {to_str}), interval={interval}")
    try:
        raw = await upstox_sdk.get_historical_candles(
            user_access_token,
            str(instrument_key),
            unit,
            upstox_interval,
            to_str,
            from_str,
        )
    except RuntimeError as exc:
        err = str(exc)
        if "Invalid Instrument key" in err or "UDAPI100011" in err:
            debug_log(
                "historical skipped — invalid instrument key",
                instrumentKey=instrument_key,
                symbol=params.get("symbol"),
            )
            return transform_upstox_candles({"data": {"candles": []}}), False
        raise
    result = transform_upstox_candles(raw)
    cache.set_cache(historical_cache_key, result, _cache_ttl_for_interval(interval))
    return result, False


# ── NSE ──

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.nseindia.com/option-chain",
}


def _extract_set_cookie_pairs(res: aiohttp.ClientResponse) -> list[str]:
    """Parse Set-Cookie headers (aiohttp jar often misses them on the homepage handshake)."""
    pairs: list[str] = []
    if hasattr(res.headers, "getall"):
        raw_headers = res.headers.getall("Set-Cookie", [])
    else:
        single = res.headers.get("Set-Cookie")
        raw_headers = [single] if single else []

    for header in raw_headers:
        if not header:
            continue
        first = header.split(";")[0].strip()
        if "=" in first:
            pairs.append(first)

    for cookie in res.cookies.values():
        pairs.append(f"{cookie.key}={cookie.value}")

    seen: set[str] = set()
    unique: list[str] = []
    for pair in pairs:
        key = pair.split("=", 1)[0]
        if key in seen:
            continue
        seen.add(key)
        unique.append(pair)
    return unique


async def _establish_nse_session_once(session: aiohttp.ClientSession) -> str:
    global _nse_session_cookies, _nse_session_expiry

    headers = {
        **NSE_HEADERS,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }

    for attempt in range(3):
        try:
            async with session.get(NSE_BASE, headers=headers, allow_redirects=True) as res:
                cookie_pairs = _extract_set_cookie_pairs(res)
                await res.read()
            if cookie_pairs:
                _nse_session_cookies = "; ".join(cookie_pairs)
                _nse_session_expiry = time.time() * 1000 + 120_000
                print(f"  🍪 NSE session established ({len(cookie_pairs)} cookies)")
                return _nse_session_cookies
            print(f"  ⚠️ NSE session: no cookies received (attempt {attempt + 1}/3)")
        except _NSE_FETCH_ERRORS as exc:
            label = "timeout" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else str(exc)
            print(f"  ⚠️ NSE session error (attempt {attempt + 1}/3): {label}")
        if attempt < 2:
            await asyncio.sleep(1.5 * (attempt + 1))

    _nse_session_cookies = ""
    _nse_session_expiry = 0
    return ""


async def get_nse_session(session: aiohttp.ClientSession) -> str:
    global _nse_session_refresh_task

    if _nse_session_cookies and time.time() * 1000 < _nse_session_expiry:
        return _nse_session_cookies

    async with _nse_session_lock:
        if _nse_session_cookies and time.time() * 1000 < _nse_session_expiry:
            return _nse_session_cookies

        if _nse_session_refresh_task is not None and not _nse_session_refresh_task.done():
            return await _nse_session_refresh_task

        _nse_session_refresh_task = asyncio.create_task(_establish_nse_session_once(session))
        try:
            return await _nse_session_refresh_task
        finally:
            _nse_session_refresh_task = None


async def warm_nse_session(session: aiohttp.ClientSession) -> None:
    """Pre-open NSE session on proxy startup so first UI load does not cold-timeout."""
    cookies = await get_nse_session(session)
    if cookies:
        print("  ✅ NSE session warmed on startup")
    else:
        print("  ⚠️ NSE session warm-up failed — will retry on first /api/nse-proxy request")


def _serve_nse_last_good(cache_key: str, last_good_key: str, endpoint: str, symbol: str | None) -> tuple[Any, bool] | None:
    last_good = cache.get_last_good(last_good_key)
    if not last_good:
        return None
    print(f"  📦 Serving last-good NSE data for {endpoint}:{symbol or ''}")
    cache.set_cache(cache_key, last_good["data"], 60000)
    return last_good["data"], False


async def handle_nse_proxy(session: aiohttp.ClientSession, params: dict[str, str]) -> tuple[Any, bool]:
    endpoint = params.get("endpoint", "")
    symbol = params.get("symbol")
    spot_feed_metrics.record_nse_proxy(endpoint)
    cache_key = f"nse:{endpoint}:{symbol or ''}"

    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    inflight = _nse_inflight.get(cache_key)
    if inflight is not None:
        return await inflight

    task = asyncio.create_task(_fetch_nse_proxy(session, params, cache_key))
    _nse_inflight[cache_key] = task
    try:
        return await task
    finally:
        if _nse_inflight.get(cache_key) is task:
            _nse_inflight.pop(cache_key, None)


async def _fetch_nse_proxy(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    cache_key: str,
) -> tuple[Any, bool]:
    global _nse_session_cookies, _nse_session_expiry

    endpoint = params.get("endpoint", "")
    symbol = params.get("symbol")
    api_path = _nse_api_path(endpoint, symbol)
    last_good_key = f"lastgood:nse:{endpoint}:{symbol or ''}"

    for attempt in range(3):
        try:
            cookies = await get_nse_session(session)
            if not cookies:
                if attempt < 2:
                    _nse_session_cookies = ""
                    _nse_session_expiry = 0
                    print(f"  ⚠️ NSE fetch skipped for {endpoint}: no session cookies (attempt {attempt + 1})")
                    await asyncio.sleep(1.0)
                    continue
                raise RuntimeError("NSE session unavailable (no cookies)")

            headers = {**NSE_HEADERS, "Cookie": cookies}
            if endpoint == "index-constituents":
                index_enc = quote((symbol or "NIFTY SMALLCAP 250").strip().upper())
                headers["Referer"] = (
                    f"https://www.nseindia.com/market-data/constituents?index={index_enc}"
                )
            async with session.get(f"{NSE_BASE}{api_path}", headers=headers) as res:
                if not res.ok:
                    raise RuntimeError(f"NSE HTTP {res.status}")

                content_type = res.headers.get("Content-Type", "")
                if "json" not in content_type:
                    _nse_session_cookies = ""
                    _nse_session_expiry = 0
                    if attempt == 0:
                        print(f"  🔄 NSE returned non-JSON for {endpoint}, retrying with fresh session...")
                        continue
                    raise RuntimeError("NSE returned non-JSON response (possible captcha)")

                data = await res.json()

            is_valid_oc = (
                endpoint != "option-chain"
                or (data.get("records", {}).get("data") and len(data["records"]["data"]) > 0)
            )
            is_valid_ic = (
                endpoint != "index-constituents"
                or (isinstance(data.get("data"), list) and len(data["data"]) > 0)
            )
            is_valid = bool(data) and len(data) > 0 and is_valid_oc and is_valid_ic

            if is_valid:
                cache.set_last_good(last_good_key, data)

            ttl = 300000 if endpoint == "fii-dii" else 30000
            cache.set_cache(cache_key, data, ttl)
            return data, False

        except _NSE_FETCH_ERRORS as exc:
            _nse_session_cookies = ""
            _nse_session_expiry = 0
            label = "timeout" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else str(exc)
            if attempt < 2:
                print(f"  ⚠️ NSE fetch failed for {endpoint} (attempt {attempt + 1}): {label}")
                await asyncio.sleep(1.0)
                continue
            print(f"  ❌ NSE fetch failed for {endpoint}: {label}")

    fallback = _serve_nse_last_good(cache_key, last_good_key, endpoint, symbol)
    if fallback:
        return fallback

    return {}, False


def _nse_api_path(endpoint: str, symbol: str | None) -> str:
    if endpoint == "option-chain":
        index_symbols = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTY NEXT 50"}
        if symbol and symbol.upper() in index_symbols:
            return f"/api/option-chain-indices?symbol={quote(symbol.upper())}"
        if symbol:
            return f"/api/option-chain-equities?symbol={quote(symbol.upper())}"
        return "/api/option-chain-indices?symbol=NIFTY"
    if endpoint == "indices":
        return "/api/allIndices"
    if endpoint == "market-status":
        return "/api/marketStatus"
    if endpoint == "equity-derivatives":
        return "/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O"
    if endpoint == "market-data-pre-open":
        return "/api/market-data-pre-open?key=FO"
    if endpoint == "fii-dii":
        return "/api/fiidiiTradeReact"
    if endpoint == "index-constituents":
        # Prefer GET /api/index-universe?tab=N50 — equity-stockIndices often 404 on NSE.
        index = (symbol or "NIFTY SMALLCAP 250").strip()
        return f"/api/equity-stockIndices?index={quote(index.upper())}"
    raise RuntimeError(f"Unknown NSE endpoint: {endpoint}")


# ── TradingView ──

async def handle_tradingview_scan(session: aiohttp.ClientSession, params: dict[str, str]) -> tuple[Any, bool]:
    scan_type = params.get("type") or "stocks"
    cache_key = f"tv:scan:{scan_type}"

    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    is_indices = scan_type == "indices"
    tickers = INDEX_TICKERS if is_indices else FNO_TICKERS

    columns = [
        "name", "description", "close", "change", "change_abs",
        "volume", "open", "high", "low", "Perf.W", "Perf.1M",
        "market_cap_basic", "average_volume_10d_calc",
    ]
    if not is_indices:
        columns.append("sector")

    body = {"symbols": {"tickers": tickers}, "columns": columns}

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.tradingview.com/",
    }

    async with session.post(TRADINGVIEW_SCAN_URL, headers=headers, json=body) as res:
        if not res.ok:
            err_text = await res.text()
            raise RuntimeError(f"TradingView scan error [{res.status}]: {err_text}")
        raw_data = await res.json()

    stocks = []
    for item in raw_data.get("data") or []:
        d = item.get("d") or []
        obj = {col: d[i] if i < len(d) else None for i, col in enumerate(columns)}
        exchange, sym = (item.get("s") or "").split(":", 1) if ":" in (item.get("s") or "") else ("", item.get("s") or "")

        stocks.append(
            {
                "symbol": sym or obj.get("name") or "",
                "name": obj.get("description") or sym or "",
                "exchange": exchange or "NSE",
                "ltp": obj.get("close") or 0,
                "change": obj.get("change") or 0,
                "changeAbs": obj.get("change_abs") or 0,
                "changePercent": obj.get("change") or 0,
                "volume": obj.get("volume") or 0,
                "open": obj.get("open") or 0,
                "high": obj.get("high") or 0,
                "low": obj.get("low") or 0,
                "weekChange": obj.get("Perf.W") or 0,
                "monthChange": obj.get("Perf.1M") or 0,
                "marketCap": obj.get("market_cap_basic") or 0,
                "avgVolume10d": obj.get("average_volume_10d_calc") or 0,
                "sector": obj.get("sector") or "",
            }
        )

    print(f"  📊 TradingView {scan_type}: {len(stocks)} results")
    payload = {"stocks": stocks, "totalCount": raw_data.get("totalCount"), "timestamp": int(time.time() * 1000)}
    cache.set_cache(cache_key, payload, 15000)
    return payload, False


# ── Technical Analysis (TA-Lib) ──

FNO_SCAN_SYMBOLS = [
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY",
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "ITC",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK",
    "TATAMOTORS", "SUNPHARMA", "TITAN", "WIPRO", "BAJFINANCE",
    "HCLTECH", "MARUTI", "ASIANPAINT", "NTPC", "POWERGRID",
]


def _candles_from_ohlcv_payload(raw_data: dict[str, Any]) -> list[dict[str, Any]]:
    closes = raw_data.get("close") or []
    if not closes:
        return []
    opens = raw_data.get("open") or []
    highs = raw_data.get("high") or []
    lows = raw_data.get("low") or []
    volumes = raw_data.get("volume") or []
    timestamps = raw_data.get("timestamp") or raw_data.get("start_Time") or []
    candles: list[dict[str, Any]] = []
    for i, cl in enumerate(closes):
        ts = timestamps[i] if i < len(timestamps) else None
        if isinstance(ts, str):
            t = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
        elif isinstance(ts, (int, float)):
            t = int(ts / 1000) if ts > 1e12 else int(ts)
        else:
            t = int(time.time())
        candles.append({
            "time": t,
            "open": opens[i] if i < len(opens) else cl,
            "high": highs[i] if i < len(highs) else cl,
            "low": lows[i] if i < len(lows) else cl,
            "close": cl,
            "volume": volumes[i] if i < len(volumes) else 0,
        })
    return sorted(candles, key=lambda c: c["time"])


def _ta_date_range(range_key: str) -> tuple[str, str]:
    from zoneinfo import ZoneInfo

    ist = ZoneInfo("Asia/Kolkata")
    now = datetime.now(ist)
    if range_key == "1D":
        from_dt = now - timedelta(days=7)
    elif range_key == "1W":
        from_dt = now - timedelta(days=10)
    elif range_key == "1M":
        from_dt = now - timedelta(days=31)
    elif range_key == "6M":
        from_dt = now - timedelta(days=183)
    elif range_key == "1Y":
        from_dt = now - timedelta(days=365)
    elif range_key == "5Y":
        from_dt = now - timedelta(days=365 * 5 + 5)
    else:
        from_dt = now - timedelta(days=92)
    # Include full calendar day through session close (IST).
    to_day = now.date()
    from_day = from_dt.date()
    return (
        f"{from_day.strftime('%Y-%m-%d')} 09:15",
        f"{to_day.strftime('%Y-%m-%d')} 15:30",
    )


def _default_interval_for_range(range_key: str) -> str:
    if range_key == "1D":
        return "1"
    if range_key == "1W":
        return "15"
    if range_key == "1M":
        return "60"
    return "D"


def _cache_ttl_for_interval(interval: str, range_key: str | None = None) -> int:
    """TTL in ms — shorter for finer candles so VWAP/intraday TA stays fresh."""
    if interval == "D":
        if range_key == "5Y":
            return 1_800_000  # 30 min — large daily history
        return 300_000
    try:
        mins = int(interval)
        if mins <= 1:
            return 30_000
        if mins <= 5:
            return 45_000
        if mins <= 15:
            return 60_000
        return 120_000
    except ValueError:
        return 60_000


async def fetch_candles_for_ta(
    session: aiohttp.ClientSession,
    symbol: str,
    range_key: str = "3M",
    user_access_token: str | None = None,
    interval: str | None = None,
    bypass_cache: bool = False,
) -> list[dict[str, Any]]:
    resolved_interval = interval or _default_interval_for_range(range_key)
    cache_key = f"ta:candles:{symbol}:{range_key}:{resolved_interval}"
    if not bypass_cache:
        cached = cache.get_cached(cache_key)
        if cached:
            return cached

    from_date, to_date = _ta_date_range(range_key)
    instrument_key = resolve_instrument_key(symbol)

    if not instrument_key:
        raise RuntimeError(f"No Upstox instrument key for {symbol}")

    params: dict[str, str] = {
        "endpoint": "historical",
        "symbol": symbol.upper(),
        "interval": resolved_interval,
        "fromDate": from_date,
        "toDate": to_date,
        "instrumentKey": instrument_key,
    }
    data, _ = await handle_upstox_proxy(session, params, user_access_token)
    raw = data.get("data", data) if isinstance(data, dict) else {}
    candles = _candles_from_ohlcv_payload(raw)
    if candles and not bypass_cache:
        cache.set_cache(cache_key, candles, _cache_ttl_for_interval(resolved_interval, range_key))
    return candles


async def handle_ta_indicators(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[Any, bool]:
    from . import ta_indicators

    symbol = (params.get("symbol") or "NIFTY").upper()
    range_key = params.get("range") or "3M"
    interval = params.get("interval") or _default_interval_for_range(range_key)
    indicators_str = params.get("indicators") or "rsi,macd,bbands,atr,adx,ema"
    selected = [s.strip() for s in indicators_str.split(",") if s.strip()]

    cache_key = f"ta:ind:{symbol}:{range_key}:{interval}:{indicators_str}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    candles = await fetch_candles_for_ta(session, symbol, range_key, user_access_token, interval)
    if not candles:
        raise RuntimeError(f"No candle data for {symbol}")

    result = ta_indicators.compute_from_candles(candles, selected)
    result["symbol"] = symbol
    result["range"] = range_key
    result["interval"] = interval
    cache.set_cache(cache_key, result, _cache_ttl_for_interval(interval))
    return result, False


async def handle_ta_snapshot(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[Any, bool]:
    data, hit = await handle_ta_indicators(
        session,
        {**params, "range": params.get("range") or "1D", "interval": params.get("interval") or "1", "indicators": "rsi,macd,bbands,atr,adx,ema,vwap"},
        user_access_token,
    )
    return {"symbol": data.get("symbol"), "summary": data.get("summary"), "engine": data.get("engine")}, hit


async def handle_ta_scanner(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    user_access_token: str | None,
) -> tuple[Any, bool]:
    from . import ta_indicators

    range_key = params.get("range") or "3M"
    filt = params.get("filter") or "all"
    symbols_str = params.get("symbols")
    symbols = [s.strip().upper() for s in symbols_str.split(",")] if symbols_str else FNO_SCAN_SYMBOLS

    cache_key = f"ta:scan:{filt}:{range_key}:{','.join(symbols[:10])}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached, True

    rows: list[dict[str, Any]] = []
    for symbol in symbols[:25]:
        try:
            candles = await fetch_candles_for_ta(session, symbol, range_key, user_access_token)
            if len(candles) < 30:
                continue
            ta = ta_indicators.compute_from_candles(candles, ["rsi", "adx", "macd"])
            summary = ta.get("summary") or {}
            rsi_v = summary.get("rsi")
            adx_v = summary.get("adx")
            macd_sig = summary.get("macdSignal", "neutral")
            signal, signal_type = ta_indicators.scanner_signal(rsi_v, adx_v, macd_sig)
            first, last = candles[0]["close"], candles[-1]["close"]
            row = {
                "symbol": symbol,
                "ltp": last,
                "changePercent": ((last - first) / first * 100) if first else 0,
                "rsi": rsi_v,
                "adx": adx_v,
                "macdSignal": macd_sig,
                "signal": signal,
                "signalType": signal_type,
            }
            if filt == "overbought" and (rsi_v is None or rsi_v <= 70):
                continue
            if filt == "oversold" and (rsi_v is None or rsi_v >= 30):
                continue
            if filt == "macd_bull" and macd_sig != "bullish":
                continue
            if filt == "macd_bear" and macd_sig != "bearish":
                continue
            if filt == "trending" and (adx_v is None or adx_v <= 25):
                continue
            rows.append(row)
        except RuntimeError:
            continue

    rows.sort(key=lambda r: abs(r.get("changePercent") or 0), reverse=True)
    payload = {"rows": rows, "count": len(rows), "filter": filt, "engine": "talib" if ta_indicators.HAS_TALIB else "numpy"}
    cache.set_cache(cache_key, payload, 300000)
    return payload, False
