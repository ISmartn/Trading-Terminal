"""Sequential processing of one dequeued candle event."""

from __future__ import annotations

import aiohttp

from .config import MAX_STALE_MS
from .detection import process_candle_event
from .models import Candle, ProcessResult
from .outbound import dispatch_alert
from . import state_store


async def process_one(
    session: aiohttp.ClientSession,
    candle: Candle,
) -> ProcessResult:
    asset = candle.ticker
    buffer, last_ts = state_store.load_state(asset)
    result, updated, new_ts = process_candle_event(
        buffer,
        candle,
        last_ts,
        max_stale_ms=MAX_STALE_MS,
    )
    state_store.save_state(asset, updated, new_ts)

    if result.alert_fired and result.alert:
        await dispatch_alert(session, result.alert)

    return result
