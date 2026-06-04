"""One sequential worker per supported asset (NIFTY, BANKNIFTY, Nifty Smallcap indices)."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from .config import SUPPORTED_ASSETS
from . import queue, state_store
from .processor import process_one

_workers: list[asyncio.Task] = []
_running = False
_http_session: aiohttp.ClientSession | None = None


async def _worker_loop(asset: str) -> None:
    assert _http_session is not None
    while _running:
        candle = await queue.dequeue_candle(asset, block_ms=2000)
        if candle is None:
            continue
        try:
            await process_one(_http_session, candle)
        except Exception as exc:
            print(f"  ⚠️ Alert worker [{asset}] error: {exc}")


def start_workers() -> None:
    global _running, _http_session, _workers
    if _running:
        return
    _running = True
    _http_session = aiohttp.ClientSession()
    for asset in sorted(SUPPORTED_ASSETS):
        task = asyncio.create_task(_worker_loop(asset), name=f"alert-worker-{asset}")
        _workers.append(task)
    print(
        f"  🔔 Alert pipeline workers started "
        f"(queue={queue.queue_backend_label()}, state={state_store.backend_label()})"
    )


async def stop_workers() -> None:
    global _running, _http_session, _workers
    _running = False
    for task in _workers:
        task.cancel()
    if _workers:
        await asyncio.gather(*_workers, return_exceptions=True)
    _workers.clear()
    if _http_session:
        await _http_session.close()
        _http_session = None


def get_pipeline_status() -> dict[str, Any]:
    return {
        "running": _running,
        "assets": list(SUPPORTED_ASSETS),
        "queueBackend": queue.queue_backend_label(),
        "stateBackend": state_store.backend_label(),
        "queueStats": queue.queue_stats(),
        "workers": len(_workers),
    }
