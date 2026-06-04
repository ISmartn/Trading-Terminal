"""Rolling candle buffer + last-processed timestamp (Redis or in-memory)."""

from __future__ import annotations

import json
from typing import Any

from .config import BUFFER_MAX_CANDLES, REDIS_STATE_PREFIX, REDIS_URL
from .models import Candle

_redis_client: Any | None = None
_memory: dict[str, dict[str, Any]] = {}


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
        print(f"  ⚠️ Redis unavailable for alert state ({exc}); using in-memory buffers")
        _redis_client = False
        return None


def _state_key(asset: str) -> str:
    return f"{REDIS_STATE_PREFIX}:{asset}"


def load_state(asset: str) -> tuple[list[Candle], int]:
    client = _redis()
    key = _state_key(asset)

    if client:
        raw = client.get(key)
        if raw:
            parsed = json.loads(raw)
            candles = [Candle.from_dict(c) for c in parsed.get("candles", [])]
            return candles[-BUFFER_MAX_CANDLES:], int(parsed.get("lastProcessedTs", 0))

    entry = _memory.get(asset)
    if not entry:
        return [], 0
    candles = [Candle.from_dict(c) for c in entry.get("candles", [])]
    return candles[-BUFFER_MAX_CANDLES:], int(entry.get("lastProcessedTs", 0))


def save_state(asset: str, candles: list[Candle], last_processed_ts: int) -> None:
    payload = {
        "candles": [c.to_dict() for c in candles[-BUFFER_MAX_CANDLES:]],
        "lastProcessedTs": last_processed_ts,
    }
    client = _redis()
    key = _state_key(asset)

    if client:
        client.set(key, json.dumps(payload))
        return

    _memory[asset] = payload


def backend_label() -> str:
    client = _redis()
    if client:
        return "redis"
    if _redis_client is False:
        return "memory"
    return "memory"
