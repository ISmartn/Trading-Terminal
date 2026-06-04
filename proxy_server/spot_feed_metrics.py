"""Spot price pipeline metrics (Upstox LTP poll → local WS vs NSE REST fallback)."""

from __future__ import annotations

import os
import time
from typing import Any

_metrics: dict[str, Any] = {
    "ltp_poll_attempts": 0,
    "ltp_poll_ok": 0,
    "ltp_poll_fail": 0,
    "ltp_poll_no_token": 0,
    "ticks_broadcast": 0,
    "last_ltp_poll_ms": 0,
    "last_ltp_error": None,
    "last_tick_ms_by_symbol": {},
    "nse_proxy_by_endpoint": {},
    "last_nse_indices_ms": 0,
    "feed_started_ms": 0,
    "last_summary_ms": 0,
    "ws_messages": 0,
}


def _spot_debug_enabled() -> bool:
    return os.getenv("SPOT_FEED_DEBUG", "").strip().lower() in ("1", "true", "yes", "on") or os.getenv(
        "PROXY_DEBUG", ""
    ).strip().lower() in ("1", "true", "yes", "on")


def record_ltp_poll(*, ok: bool, error: str | None = None, no_token: bool = False) -> None:
    _metrics["ltp_poll_attempts"] += 1
    now = int(time.time() * 1000)
    _metrics["last_ltp_poll_ms"] = now
    if no_token:
        _metrics["ltp_poll_no_token"] += 1
    elif ok:
        _metrics["ltp_poll_ok"] += 1
        _metrics["last_ltp_error"] = None
    else:
        _metrics["ltp_poll_fail"] += 1
        _metrics["last_ltp_error"] = error


def record_tick_broadcast(symbol: str) -> None:
    _metrics["ticks_broadcast"] += 1
    by_sym: dict[str, int] = _metrics["last_tick_ms_by_symbol"]
    by_sym[symbol] = int(time.time() * 1000)


def record_nse_proxy(endpoint: str) -> None:
    counts: dict[str, int] = _metrics["nse_proxy_by_endpoint"]
    counts[endpoint] = counts.get(endpoint, 0) + 1
    if endpoint == "indices":
        _metrics["last_nse_indices_ms"] = int(time.time() * 1000)


def mark_feed_started() -> None:
    _metrics["feed_started_ms"] = int(time.time() * 1000)


def get_metrics_snapshot(
    *,
    upstox_connected: bool,
    browser_clients: int,
    cached_ticks: int,
    poll_interval_ms: int,
    feed_mode: str = "ws",
    ws_messages: int = 0,
) -> dict[str, Any]:
    now = int(time.time() * 1000)
    last_ticks = _metrics["last_tick_ms_by_symbol"]
    return {
        "upstoxLtpPoll": {
            "attempts": _metrics["ltp_poll_attempts"],
            "ok": _metrics["ltp_poll_ok"],
            "fail": _metrics["ltp_poll_fail"],
            "noTokenSkips": _metrics["ltp_poll_no_token"],
            "pollIntervalMs": poll_interval_ms,
            "lastPollMs": _metrics["last_ltp_poll_ms"],
            "lastError": _metrics["last_ltp_error"],
            "feedStartedMs": _metrics["feed_started_ms"],
        },
        "localWebSocket": {
            "upstoxConnected": upstox_connected,
            "browserClients": browser_clients,
            "ticksBroadcast": _metrics["ticks_broadcast"],
            "cachedTicks": cached_ticks,
            "lastTickAgeMsBySymbol": {
                sym: (now - ts) if ts else None for sym, ts in last_ticks.items()
            },
        },
        "upstoxMarketWs": {
            "feedMode": feed_mode,
            "messagesReceived": ws_messages,
        },
        "nseFallback": {
            "requestsByEndpoint": dict(_metrics["nse_proxy_by_endpoint"]),
            "lastIndicesRequestMs": _metrics["last_nse_indices_ms"],
        },
        "interpretation": _interpret(upstox_connected, last_ticks, now, feed_mode, ws_messages),
    }


def _interpret(
    upstox_connected: bool,
    last_ticks: dict[str, int],
    now: int,
    feed_mode: str,
    ws_messages: int,
) -> str:
    fresh = [s for s, ts in last_ticks.items() if ts and now - ts < 10_000]
    if feed_mode in ("ws", "websocket") and ws_messages > 0 and len(fresh) >= 1:
        return f"Upstox V3 WebSocket → browser relay active ({', '.join(fresh)})."
    if not upstox_connected:
        return "Browser spot likely uses NSE indices poll (~5s) — Upstox feed not active (no token or connection failed)."
    if len(fresh) >= 2:
        return f"Live ticks on local WS for {', '.join(fresh)}."
    if feed_mode == "auto" and ws_messages == 0:
        return "Upstox V3 WS not receiving messages yet — auto mode may fall back to REST LTP poll."
    return "Upstox feed connected but few recent ticks on browser WebSocket — check token or instrument keys."


def maybe_log_summary(
    *,
    upstox_connected: bool,
    browser_clients: int,
    cached_ticks: int,
    poll_interval_ms: int,
    feed_mode: str = "ws",
    ws_messages: int = 0,
) -> None:
    if not _spot_debug_enabled():
        return
    now = int(time.time() * 1000)
    if now - _metrics["last_summary_ms"] < 30_000:
        return
    _metrics["last_summary_ms"] = now

    snap = get_metrics_snapshot(
        upstox_connected=upstox_connected,
        browser_clients=browser_clients,
        cached_ticks=cached_ticks,
        poll_interval_ms=poll_interval_ms,
        feed_mode=feed_mode,
        ws_messages=ws_messages,
    )
    ltp = snap["upstoxLtpPoll"]
    nse = snap["nseFallback"]
    ws = snap["localWebSocket"]
    um = snap["upstoxMarketWs"]
    ages = ws.get("lastTickAgeMsBySymbol") or {}
    age_str = ", ".join(f"{k}={v // 1000}s" if v is not None else f"{k}=never" for k, v in ages.items()) or "none"
    nse_indices = nse["requestsByEndpoint"].get("indices", 0)
    print(
        f"  📡 [SPOT-FEED] mode={um['feedMode']} upstoxMsgs={um['messagesReceived']} "
        f"| LTP polls ok={ltp['ok']} fail={ltp['fail']} "
        f"| browser ticks={ws['ticksBroadcast']} upstox={ws['upstoxConnected']} clients={ws['browserClients']} "
        f"| tick age: {age_str} | NSE indices hits={nse_indices}"
    )
    print(f"      → {snap['interpretation']}")
