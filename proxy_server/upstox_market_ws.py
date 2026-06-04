"""
Upstox Market Data Feed V3 WebSocket (official SDK streamer).

Docs: https://upstox.com/developer/api-documentation/websocket
Connects to wss://api.upstox.com/v3/feed/market-data-feed, subscribes in ltpc mode,
decodes protobuf → JSON ticks for the local browser WebSocket relay.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Awaitable

import upstox_client

from .config import INSTRUMENT_KEY_TO_TICK, TICK_INSTRUMENT_KEYS
from .upstox_sdk import _create_configuration

TickHandler = Callable[[dict[str, Any]], Awaitable[None]]


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        n = float(value)
        return n if n == n else None
    except (TypeError, ValueError):
        return None


def _extract_ltpc(feed_entry: dict[str, Any]) -> dict[str, Any] | None:
    """Pull LTPC from ltpc or full/index full feed shapes."""
    if not feed_entry:
        return None

    ltpc = feed_entry.get("ltpc")
    if isinstance(ltpc, dict) and ltpc.get("ltp") is not None:
        return ltpc

    full = feed_entry.get("fullFeed") or feed_entry.get("full_feed")
    if isinstance(full, dict):
        for branch_key in ("indexFF", "indexFf", "marketFF", "marketFf"):
            branch = full.get(branch_key)
            if isinstance(branch, dict):
                inner = branch.get("ltpc")
                if isinstance(inner, dict) and inner.get("ltp") is not None:
                    return inner
        inner = full.get("ltpc")
        if isinstance(inner, dict) and inner.get("ltp") is not None:
            return inner

    return None


def parse_market_feed_message(message: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """
    Parse MarketDataStreamerV3 message dict into (instrument_key, ltpc) pairs.
    """
    feeds = message.get("feeds") or message.get("Feeds")
    if not isinstance(feeds, dict):
        return []

    out: list[tuple[str, dict[str, Any]]] = []
    for instrument_key, feed_entry in feeds.items():
        if not isinstance(feed_entry, dict):
            continue
        ltpc = _extract_ltpc(feed_entry)
        if ltpc:
            out.append((instrument_key, ltpc))
    return out


def build_tick_from_ltpc(instrument_key: str, ltpc: dict[str, Any]) -> dict[str, Any] | None:
    meta = INSTRUMENT_KEY_TO_TICK.get(instrument_key)
    if not meta:
        return None

    ltp = _num(ltpc.get("ltp"))
    if ltp is None or ltp <= 0:
        return None

    prev_close = _num(ltpc.get("cp")) or ltp
    change = ltp - prev_close
    change_percent = (change / prev_close * 100) if prev_close else 0.0
    ltt = ltpc.get("ltt")
    ts = int(ltt) if ltt else int(time.time() * 1000)

    return {
        "type": "quote",
        "securityId": meta["securityId"],
        "symbol": meta["symbol"],
        "exchangeSegment": meta["exchangeSegment"],
        "instrumentKey": instrument_key,
        "ltp": ltp,
        "open": ltp,
        "high": ltp,
        "low": ltp,
        "close": prev_close,
        "prevClose": prev_close,
        "change": change,
        "changePercent": change_percent,
        "volume": 0,
        "timestamp": ts,
    }


class UpstoxMarketWsFeed:
    """Thread-backed Upstox V3 market WebSocket → async tick handler."""

    def __init__(self, loop: asyncio.AbstractEventLoop, on_tick: TickHandler) -> None:
        self._loop = loop
        self._on_tick = on_tick
        self._streamer: upstox_client.MarketDataStreamerV3 | None = None
        self._connected = False
        self._messages_received = 0
        self._last_error: str | None = None

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def messages_received(self) -> int:
        return self._messages_received

    def start(self, access_token: str, *, mode: str = "ltpc") -> None:
        self.stop()

        configuration = _create_configuration(access_token)
        api_client = upstox_client.ApiClient(configuration)
        self._streamer = upstox_client.MarketDataStreamerV3(
            api_client,
            list(TICK_INSTRUMENT_KEYS),
            mode,
        )

        self._streamer.on("open", self._handle_open)
        self._streamer.on("message", self._handle_message)
        self._streamer.on("error", self._handle_error)
        self._streamer.on("close", self._handle_close)
        self._streamer.auto_reconnect(True, interval=2, retry_count=15)
        self._streamer.connect()
        print(f"  🔌 Upstox Market Data WebSocket V3 starting (mode={mode}, {len(TICK_INSTRUMENT_KEYS)} instruments)")

    def stop(self) -> None:
        self._connected = False
        if self._streamer:
            try:
                if hasattr(self._streamer, "auto_reconnect"):
                    self._streamer.auto_reconnect(False)
                self._streamer.disconnect()
            except Exception:
                pass
            self._streamer = None

    def _handle_open(self, _ws: Any = None) -> None:
        self._connected = True
        self._last_error = None
        print("  ✅ Upstox market WebSocket V3 connected")
        asyncio.run_coroutine_threadsafe(self._emit_status(True), self._loop)

    def _handle_close(self, _ws: Any = None, *_args: Any) -> None:
        self._connected = False
        print("  🔌 Upstox market WebSocket V3 closed")
        asyncio.run_coroutine_threadsafe(self._emit_status(False), self._loop)

    def _handle_error(self, error: Any) -> None:
        self._last_error = str(error)
        self._connected = False
        print(f"  ⚠️ Upstox market WebSocket error: {error}")
        asyncio.run_coroutine_threadsafe(self._emit_status(False), self._loop)

    def _handle_message(self, message: dict[str, Any]) -> None:
        self._messages_received += 1
        for instrument_key, ltpc in parse_market_feed_message(message):
            tick = build_tick_from_ltpc(instrument_key, ltpc)
            if tick:
                asyncio.run_coroutine_threadsafe(self._on_tick(tick), self._loop)

    async def _emit_status(self, connected: bool) -> None:
        await self._on_tick(
            {
                "type": "status",
                "connected": connected,
                "feed": "upstox_market_ws_v3",
                "instrumentCount": len(TICK_INSTRUMENT_KEYS),
            }
        )
