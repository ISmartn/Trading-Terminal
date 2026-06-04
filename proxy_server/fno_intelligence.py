"""Unified F&O intelligence API — live signals + EOD playbook."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from . import eod_playbook, live_scanner_feed
from . import cache
from .config import get_access_token
from .eod_playbook import is_market_hours_ist, load_playbook, should_auto_generate_playbook
from .live_scanner import DEFAULT_MOVE_15S_PCT, DEFAULT_MOVE_1M_PCT, DEFAULT_VOLUME_SPIKE_MULT, engine
from .live_scanner_feed import _symbols_for_universe, start_live_scanner

_playbook_task: asyncio.Task | None = None


def get_live_intelligence(params: dict[str, str]) -> dict[str, Any]:
    universe = params.get("universe") or "all"
    move_15s = float(params.get("move15s") or DEFAULT_MOVE_15S_PCT)
    move_1m = float(params.get("move1m") or DEFAULT_MOVE_1M_PCT)
    vol_mult = float(params.get("volumeMult") or DEFAULT_VOLUME_SPIKE_MULT)

    cache_key = f"fno:live:{universe}:{move_15s}:{move_1m}:{vol_mult}"
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    symbols = _symbols_for_universe(universe)

    scans = engine.scan_intelligence(
        move_15s_pct=move_15s,
        move_1m_pct=move_1m,
        volume_mult=vol_mult,
        symbols=symbols,
    )

    import time

    result = {
        "mode": "live" if is_market_hours_ist() else "afterHours",
        "marketOpen": is_market_hours_ist(),
        "universe": universe,
        "universeSize": len(symbols),
        "thresholds": {
            "move15sPct": move_15s,
            "move1mPct": move_1m,
            "volumeMult": vol_mult,
        },
        "bullish": scans["bullish"],
        "bearish": scans["bearish"],
        "watchLong": scans["watchLong"],
        "watchShort": scans["watchShort"],
        "counts": {
            "bullish": len(scans["bullish"]),
            "bearish": len(scans["bearish"]),
            "watchLong": len(scans["watchLong"]),
            "watchShort": len(scans["watchShort"]),
        },
        "status": engine.status(),
        "timestamp": int(time.time() * 1000),
    }
    cache.set_cache(cache_key, result, 2000)
    return result


async def get_playbook_handler(
    session: aiohttp.ClientSession,
    params: dict[str, str],
    token: str | None,
) -> dict[str, Any]:
    session_date = params.get("date")
    generate = params.get("generate", "").lower() in ("1", "true", "yes")
    universe = params.get("universe") or "popular"

    if generate:
        if not token:
            raise RuntimeError("Upstox token required to generate playbook")
        return await eod_playbook.generate_playbook(session, token, universe=universe)

    cached = load_playbook(session_date)
    if cached:
        return cached

    if token and should_auto_generate_playbook():
        return await eod_playbook.generate_playbook(session, token, universe=universe)

    return {
        "sessionDate": session_date or eod_playbook._ist_today(),
        "generatedAt": None,
        "message": "No playbook yet. Generate after market close (3:45 PM IST) or pass ?generate=1",
        "longPlays": [],
        "shortPlays": [],
        "rangePlays": [],
        "topLong": [],
        "topShort": [],
    }


async def maybe_schedule_eod_playbook(session: aiohttp.ClientSession, token: str | None) -> None:
    global _playbook_task
    if not token or not should_auto_generate_playbook():
        return
    if _playbook_task and not _playbook_task.done():
        return

    async def _run() -> None:
        try:
            await eod_playbook.generate_playbook(session, token, universe="popular")
        except Exception as exc:
            print(f"  ⚠️ Auto playbook generation failed: {exc}")

    _playbook_task = asyncio.create_task(_run())


def ensure_scanner_for_universe(session: aiohttp.ClientSession, universe: str = "all") -> None:
    token = get_access_token()
    if token:
        start_live_scanner(session, token, universe)
