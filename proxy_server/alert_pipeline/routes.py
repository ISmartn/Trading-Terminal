"""Phase 1 ingestion gateway — validate, enqueue, return 200 immediately."""

from __future__ import annotations

import json
from typing import Any

from aiohttp import web

from .config import MARKET_WEBHOOK_SECRET
from .models import Candle
from . import queue
from .ticker import normalize_ticker


def _parse_body(raw: dict[str, Any]) -> Candle | None:
    ticker_raw = raw.get("ticker") or raw.get("symbol") or raw.get("Ticker")
    if not ticker_raw:
        return None
    asset = normalize_ticker(str(ticker_raw))
    if asset is None:
        return None

    ts = raw.get("timestamp") or raw.get("Timestamp") or raw.get("ts")
    if ts is None:
        return None

    try:
        return Candle(
            timestamp=int(ts),
            ticker=asset,
            open=float(raw.get("open") or raw.get("Open")),
            high=float(raw.get("high") or raw.get("High")),
            low=float(raw.get("low") or raw.get("Low")),
            close=float(raw.get("close") or raw.get("Close")),
            volume=float(raw.get("volume") or raw.get("Volume") or 0),
        )
    except (TypeError, ValueError):
        return None


async def market_webhook_handler(request: web.Request) -> web.Response:
    if MARKET_WEBHOOK_SECRET:
        provided = request.headers.get("X-Market-Webhook-Secret") or request.query.get("secret")
        if provided != MARKET_WEBHOOK_SECRET:
            return web.json_response({"ok": False, "error": "unauthorized"}, status=401)

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"ok": False, "error": "invalid_json"}, status=400)

    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "expected_object"}, status=400)

    candle = _parse_body(body)
    if candle is None:
        return web.json_response(
            {
                "ok": False,
                "error": "invalid_payload",
                "hint": "NIFTY|BANKNIFTY|NIFTYSC50|NIFTYSC100|NIFTYSC250 OHLCV + timestamp",
            },
            status=400,
        )

    if candle.high < candle.low or candle.open <= 0 or candle.close <= 0:
        return web.json_response({"ok": False, "error": "invalid_ohlc"}, status=400)

    try:
        msg_id = await queue.enqueue_candle(candle)
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)

    return web.json_response(
        {"ok": True, "queued": True, "messageId": msg_id, "ticker": candle.ticker},
        status=200,
    )


async def alert_pipeline_status_handler(request: web.Request) -> web.Response:
    from .worker import get_pipeline_status

    return web.json_response(get_pipeline_status())
