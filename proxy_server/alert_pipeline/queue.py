"""Strict FIFO enqueue for candle events (Redis Streams or asyncio per-asset queues)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .config import REDIS_STREAM_PREFIX, REDIS_URL, SUPPORTED_ASSETS
from .models import Candle

_redis_client: Any | None = None
_local_queues: dict[str, asyncio.Queue[str]] = {}
_last_stream_ids: dict[str, str] = {}
_stats: dict[str, int] = {"enqueued": 0, "dequeued": 0}


def _redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    if not REDIS_URL:
        return None
    try:
        import redis

        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        _redis_client.ping()
        return _redis_client
    except Exception as exc:
        print(f"  ⚠️ Redis unavailable for alert queue ({exc}); using in-process FIFO queues")
        _redis_client = False
        return None


def _stream_key(asset: str) -> str:
    return f"{REDIS_STREAM_PREFIX}:{asset}"


def _local_queue(asset: str) -> asyncio.Queue[str]:
    if asset not in _local_queues:
        _local_queues[asset] = asyncio.Queue()
    return _local_queues[asset]


async def enqueue_candle(candle: Candle) -> str:
    """Push one event; returns queue message id or synthetic id."""
    asset = candle.ticker
    if asset not in SUPPORTED_ASSETS:
        raise ValueError(f"unsupported asset: {asset}")

    payload = json.dumps(candle.to_dict())
    client = _redis()

    if client:
        msg_id = client.xadd(
            _stream_key(asset),
            {"payload": payload},
            maxlen=2000,
            approximate=True,
        )
        _stats["enqueued"] += 1
        return str(msg_id)

    q = _local_queue(asset)
    msg_id = f"local-{asset}-{_stats['enqueued']}"
    await q.put(payload)
    _stats["enqueued"] += 1
    return msg_id


async def dequeue_candle(asset: str, *, block_ms: int = 5000) -> Candle | None:
    client = _redis()

    if client:
        stream = _stream_key(asset)
        last_id = _last_stream_ids.get(asset, "0-0")
        streams = client.xread({stream: last_id}, count=1, block=block_ms)
        if not streams:
            return None
        _stream, messages = streams[0]
        msg_id, fields = messages[0]
        _last_stream_ids[asset] = msg_id
        _stats["dequeued"] += 1
        return Candle.from_dict(json.loads(fields["payload"]))

    q = _local_queue(asset)
    try:
        payload = await asyncio.wait_for(q.get(), timeout=block_ms / 1000)
    except asyncio.TimeoutError:
        return None
    _stats["dequeued"] += 1
    return Candle.from_dict(json.loads(payload))


def queue_backend_label() -> str:
    client = _redis()
    if client:
        return "redis_streams"
    return "asyncio_fifo"


def queue_stats() -> dict[str, int]:
    return dict(_stats)
