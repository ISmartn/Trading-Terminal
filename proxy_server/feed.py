"""Upstox Market Data Feed V3 WebSocket + local browser WebSocket relay."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import aiohttp
from aiohttp import web

from . import upstox_sdk
from .config import INSTRUMENT_KEY_TO_TICK, TICK_INSTRUMENT_KEYS, UPSTOX_POLL_INTERVAL_MS, get_access_token
from . import spot_feed_metrics
from .market_hours import is_nse_live_session, seconds_until_session_change
from .upstox_market_ws import UpstoxMarketWsFeed, build_tick_from_ltpc

latest_ticks: dict[int, dict[str, Any]] = {}
upstox_feed_connected = False
upstox_feed_credentials: dict[str, str | None] = {"accessToken": None}
_feed_task: asyncio.Task | None = None
_session_task: asyncio.Task | None = None
_upstox_ws: UpstoxMarketWsFeed | None = None
_main_loop: asyncio.AbstractEventLoop | None = None
_last_session_live: bool | None = None
_last_ws_tick_at: float = 0.0

# auto = WS during session + REST when WS idle; poll = REST only; ws = WS when possible + REST fallback
UPSTOX_FEED_MODE = os.getenv("UPSTOX_FEED_MODE", "auto").strip().lower()
UPSTOX_AFTER_HOURS_POLL_MS = int(os.getenv("UPSTOX_AFTER_HOURS_POLL_MS", "60000"))
UPSTOX_WS_TICK_STALE_SEC = int(os.getenv("UPSTOX_WS_TICK_STALE_SEC", "90"))


def _use_market_websocket() -> bool:
    return UPSTOX_FEED_MODE in ("ws", "websocket", "auto")


def _use_poll_fallback() -> bool:
    return UPSTOX_FEED_MODE in ("poll", "auto")


async def broadcast_to_clients(data: dict[str, Any]) -> None:
    if data.get("type") == "status":
        global upstox_feed_connected
        upstox_feed_connected = bool(data.get("connected"))

    payload = json.dumps(data)
    dead: list[web.WebSocketResponse] = []
    for ws in _ws_clients:
        if ws.closed:
            dead.append(ws)
            continue
        try:
            await ws.send_str(payload)
        except (RuntimeError, ConnectionError):
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws)


async def _handle_upstream_tick(data: dict[str, Any]) -> None:
    global _last_ws_tick_at
    if data.get("type") == "quote":
        _last_ws_tick_at = time.time()
        sec_id = data.get("securityId")
        symbol = data.get("symbol")
        if sec_id is not None:
            latest_ticks[int(sec_id)] = data
        if symbol:
            spot_feed_metrics.record_tick_broadcast(str(symbol))
    await broadcast_to_clients(data)


def _normalize_ltp_quote(quote: dict[str, Any]) -> dict[str, Any]:
    """Accept snake_case or camelCase from Upstox REST."""
    if "last_price" in quote or "lastPrice" in quote:
        return quote
    nested = quote.get("ltp") or quote.get("last_trade_price")
    if isinstance(nested, dict):
        return nested
    return quote


async def poll_upstox_ltp() -> None:
    """REST LTP — used outside NSE session and as fallback when WebSocket is down."""
    global upstox_feed_connected

    token = upstox_feed_credentials.get("accessToken") or get_access_token()
    if not token:
        spot_feed_metrics.record_ltp_poll(ok=False, no_token=True)
        spot_feed_metrics.maybe_log_summary(
            upstox_connected=upstox_feed_connected,
            browser_clients=len(_ws_clients),
            cached_ticks=len(latest_ticks),
            poll_interval_ms=UPSTOX_POLL_INTERVAL_MS,
            feed_mode=UPSTOX_FEED_MODE,
        )
        return

    try:
        instrument_keys = ",".join(TICK_INSTRUMENT_KEYS)
        result = await upstox_sdk.get_ltp(token, instrument_keys)
        data = result.get("data") or result.get("Data") or {}
        if isinstance(data, list):
            data = {item.get("instrument_key") or item.get("instrumentKey"): item for item in data if isinstance(item, dict)}

        ticks_sent = 0
        for instrument_key, raw_quote in data.items():
            if not isinstance(raw_quote, dict):
                continue
            quote = _normalize_ltp_quote(raw_quote)
            meta = INSTRUMENT_KEY_TO_TICK.get(instrument_key)
            ltp = quote.get("last_price") or quote.get("lastPrice")
            if not meta or ltp is None:
                continue

            ltp_f = float(ltp)
            prev_close = (
                quote.get("close")
                or quote.get("prev_close")
                or quote.get("previous_close")
                or quote.get("cp")
                or ltp_f
            )
            prev_close = float(prev_close)
            ohlc = quote.get("ohlc") or {}
            ltpc = {
                "ltp": ltp_f,
                "cp": prev_close,
                "ltt": int(time.time() * 1000),
            }
            tick = build_tick_from_ltpc(instrument_key, ltpc)
            if not tick:
                continue
            if ohlc:
                tick["open"] = ohlc.get("open") or tick["open"]
                tick["high"] = ohlc.get("high") or tick["high"]
                tick["low"] = ohlc.get("low") or tick["low"]
            tick["volume"] = quote.get("volume") or 0
            await _handle_upstream_tick(tick)
            ticks_sent += 1

        upstox_feed_connected = ticks_sent > 0
        spot_feed_metrics.record_ltp_poll(ok=ticks_sent > 0)
        if ticks_sent == 0 and data:
            spot_feed_metrics.record_ltp_poll(ok=False, error="no_matching_instrument_keys")
        if ticks_sent > 0:
            await broadcast_to_clients(
                {
                    "type": "status",
                    "connected": True,
                    "feed": "upstox_ltp_rest",
                    "instrumentCount": len(TICK_INSTRUMENT_KEYS),
                    "marketSessionOpen": is_nse_live_session(),
                }
            )
    except RuntimeError as exc:
        upstox_feed_connected = False
        spot_feed_metrics.record_ltp_poll(ok=False, error=str(exc))
        await broadcast_to_clients(
            {"type": "status", "connected": False, "feed": "upstox_ltp_rest", "marketSessionOpen": is_nse_live_session()}
        )
        if "429" in str(exc):
            print("  ⏳ Upstox LTP rate-limited, backing off...")
    finally:
        spot_feed_metrics.maybe_log_summary(
            upstox_connected=upstox_feed_connected,
            browser_clients=len(_ws_clients),
            cached_ticks=len(latest_ticks),
            poll_interval_ms=UPSTOX_POLL_INTERVAL_MS,
            feed_mode=UPSTOX_FEED_MODE,
            ws_messages=_upstox_ws.messages_received if _upstox_ws else 0,
        )


def _ws_is_healthy() -> bool:
    return _upstox_ws is not None and _upstox_ws.connected


def _ws_is_delivering_ticks() -> bool:
    """True when WebSocket recently pushed at least one quote tick."""
    if not _ws_is_healthy():
        return False
    if _upstox_ws is not None and _upstox_ws.messages_received <= 0:
        return False
    if _last_ws_tick_at <= 0:
        return False
    return (time.time() - _last_ws_tick_at) < UPSTOX_WS_TICK_STALE_SEC


def _should_use_websocket(live: bool) -> bool:
    if not live:
        return False
    return UPSTOX_FEED_MODE in ("ws", "websocket", "auto")


def _should_run_rest_poll(live: bool) -> bool:
    """Off-hours: REST only. Session: REST if poll mode or WebSocket not delivering."""
    if not live:
        return True
    if UPSTOX_FEED_MODE == "poll":
        return True
    if not _should_use_websocket(live):
        return True
    return not _ws_is_delivering_ticks()


def _ensure_ws_started(access_token: str) -> None:
    global _upstox_ws, _main_loop

    if _upstox_ws is not None:
        return

    _main_loop = _main_loop or asyncio.get_running_loop()
    _upstox_ws = UpstoxMarketWsFeed(_main_loop, _handle_upstream_tick)
    mode = os.getenv("UPSTOX_WS_MODE", "ltpc").strip() or "ltpc"
    _upstox_ws.start(access_token, mode=mode)
    print("  📡 Upstox market WebSocket started (NSE session open)")


def _ensure_ws_stopped(reason: str) -> None:
    global _upstox_ws

    if _upstox_ws is None:
        return

    _upstox_ws.stop()
    _upstox_ws = None
    print(f"  📴 Upstox market WebSocket stopped ({reason}) — using REST LTP")


async def _session_supervisor_loop() -> None:
    """Gate WebSocket to NSE session hours; use REST API off-hours and when WS is down."""
    global _last_session_live

    while True:
        live = is_nse_live_session()
        token = upstox_feed_credentials.get("accessToken") or get_access_token()

        if _last_session_live is not None and _last_session_live != live:
            state = "open" if live else "closed"
            print(f"  🕐 NSE session now {state} ({UPSTOX_FEED_MODE} feed — {'WebSocket+REST fallback' if live and _should_use_websocket(live) else 'REST API'})")
        _last_session_live = live

        if not token:
            await asyncio.sleep(30)
            continue

        if _should_use_websocket(live):
            _ensure_ws_started(token)
        else:
            reason = "outside_trading_hours" if not live else "rest_only_mode"
            _ensure_ws_stopped(reason)

        if _should_run_rest_poll(live):
            await poll_upstox_ltp()
            delay_s = (UPSTOX_POLL_INTERVAL_MS if live else UPSTOX_AFTER_HOURS_POLL_MS) / 1000
        elif live and _ws_is_delivering_ticks():
            delay_s = min(30.0, seconds_until_session_change())
        else:
            delay_s = min(15.0, seconds_until_session_change())

        await asyncio.sleep(delay_s)


def start_upstox_feed(access_token: str | None) -> None:
    global _feed_task, _session_task, _main_loop, upstox_feed_credentials, _last_session_live

    if not access_token:
        print("  ⚠️  No Upstox access token for live feed — skipping")
        return

    upstox_feed_credentials = {"accessToken": access_token}
    _last_session_live = None

    if _session_task and not _session_task.done():
        _session_task.cancel()
    if _feed_task and not _feed_task.done():
        _feed_task.cancel()
    global _last_ws_tick_at
    _last_ws_tick_at = 0.0
    _ensure_ws_stopped("restarting_feed")

    spot_feed_metrics.mark_feed_started()
    _main_loop = asyncio.get_running_loop()

    live = is_nse_live_session()
    if not live:
        transport = "REST LTP only (market closed — no WebSocket)"
    elif _should_run_rest_poll(live) and not _should_use_websocket(live):
        transport = "REST LTP only"
    elif UPSTOX_FEED_MODE == "poll":
        transport = "REST LTP only (poll mode)"
    else:
        transport = "WebSocket + REST fallback when WS idle"
    print(f"  🔌 Upstox spot feed scheduler — {transport} · mode={UPSTOX_FEED_MODE}")

    _session_task = asyncio.create_task(_session_supervisor_loop())
    _feed_task = asyncio.create_task(_spot_metrics_loop())


async def _spot_metrics_loop() -> None:
    while True:
        await asyncio.sleep(30)
        spot_feed_metrics.maybe_log_summary(
            upstox_connected=upstox_feed_connected,
            browser_clients=len(_ws_clients),
            cached_ticks=len(latest_ticks),
            poll_interval_ms=UPSTOX_POLL_INTERVAL_MS,
            feed_mode=UPSTOX_FEED_MODE,
            ws_messages=_upstox_ws.messages_received if _upstox_ws else 0,
        )


def stop_upstox_feed() -> None:
    global _feed_task, _session_task, _upstox_ws, upstox_feed_connected, _last_session_live

    if _session_task and not _session_task.done():
        _session_task.cancel()
        _session_task = None
    if _feed_task and not _feed_task.done():
        _feed_task.cancel()
        _feed_task = None
    _ensure_ws_stopped("shutdown")
    upstox_feed_connected = False
    _last_session_live = None


_ws_clients: set[web.WebSocketResponse] = set()


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    _ws_clients.add(ws)

    print("  🌐 Browser WebSocket client connected")

    live = is_nse_live_session()
    feed_name = (
        "upstox_market_ws_v3"
        if live and _ws_is_delivering_ticks()
        else "upstox_ltp_rest"
    )
    await ws.send_str(
        json.dumps(
            {
                "type": "status",
                "connected": upstox_feed_connected,
                "feed": feed_name,
                "instrumentCount": len(TICK_INSTRUMENT_KEYS),
                "marketSessionOpen": live,
            }
        )
    )

    for tick in latest_ticks.values():
        await ws.send_str(json.dumps(tick))

    try:
        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                parsed = json.loads(msg.data)
            except json.JSONDecodeError:
                continue

            if parsed.get("type") == "configure":
                access_token = parsed.get("accessToken")
                if access_token:
                    print("  🔑 Received Upstox credentials from browser, starting market feed...")
                    start_upstox_feed(access_token)
    finally:
        _ws_clients.discard(ws)
        print("  🔌 Browser WebSocket client disconnected")

    return ws


def get_feed_stats() -> dict[str, Any]:
    live = is_nse_live_session()
    if live and _ws_is_delivering_ticks():
        feed_type = "upstox_market_ws_v3"
    else:
        feed_type = "upstox_ltp_rest"

    base = {
        "upstoxConnected": upstox_feed_connected,
        "dhanConnected": upstox_feed_connected,
        "feedType": feed_type,
        "feedMode": UPSTOX_FEED_MODE,
        "marketSessionOpen": live,
        "spotTransport": "websocket" if feed_type == "upstox_market_ws_v3" else "rest",
        "upstoxWsConnected": _upstox_ws.connected if _upstox_ws else False,
        "upstoxWsMessages": _upstox_ws.messages_received if _upstox_ws else 0,
        "browserClients": len(_ws_clients),
        "instrumentsSubscribed": len(TICK_INSTRUMENT_KEYS),
        "cachedTicks": len(latest_ticks),
        "pollIntervalMs": UPSTOX_POLL_INTERVAL_MS if live else UPSTOX_AFTER_HOURS_POLL_MS,
    }
    base["spotMetrics"] = spot_feed_metrics.get_metrics_snapshot(
        upstox_connected=upstox_feed_connected,
        browser_clients=len(_ws_clients),
        cached_ticks=len(latest_ticks),
        poll_interval_ms=base["pollIntervalMs"],
        feed_mode=UPSTOX_FEED_MODE,
        ws_messages=_upstox_ws.messages_received if _upstox_ws else 0,
    )
    return base
