"""Unified F&O intelligence API — live signals + EOD playbook."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from . import eod_playbook, live_scanner_feed
from . import cache
from .config import get_access_token
from .eod_playbook import is_market_hours_ist, load_playbook, should_auto_generate_playbook
from .live_scanner import ScanConfig, engine
from .live_scanner_feed import _symbols_for_universe, start_live_scanner

_playbook_task: asyncio.Task | None = None


def _bool_param(params: dict[str, str], key: str, default: bool) -> bool:
    raw = params.get(key)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _scan_config_from_params(params: dict[str, str]) -> ScanConfig:
    cfg = ScanConfig()
    cfg.fast_secs = int(float(params.get("fastSecs") or cfg.fast_secs))
    cfg.slow_secs = int(float(params.get("slowSecs") or cfg.slow_secs))
    # Accept both new (moveFast/moveSlow) and legacy (move15s/move1m) names.
    cfg.move_fast_pct = float(params.get("moveFast") or params.get("move15s") or cfg.move_fast_pct)
    cfg.move_slow_pct = float(params.get("moveSlow") or params.get("move1m") or cfg.move_slow_pct)
    cfg.volume_mult = float(params.get("volumeMult") or cfg.volume_mult)
    cfg.require_volume = _bool_param(params, "requireVolume", cfg.require_volume)
    cfg.require_vwap = _bool_param(params, "requireVwap", cfg.require_vwap)
    return cfg


def get_live_intelligence(params: dict[str, str]) -> dict[str, Any]:
    universe = params.get("universe") or "all"
    cfg = _scan_config_from_params(params)

    cache_key = (
        f"fno:live:{universe}:{cfg.fast_secs}:{cfg.slow_secs}:{cfg.move_fast_pct}:"
        f"{cfg.move_slow_pct}:{cfg.volume_mult}:{cfg.require_volume}:{cfg.require_vwap}"
    )
    cached = cache.get_cached(cache_key)
    if cached:
        return cached

    symbols = _symbols_for_universe(universe)

    scans = engine.scan_intelligence(cfg, symbols=symbols)

    import time

    result = {
        "mode": "live" if is_market_hours_ist() else "afterHours",
        "marketOpen": is_market_hours_ist(),
        "universe": universe,
        "universeSize": len(symbols),
        "thresholds": {
            "fastSecs": cfg.fast_secs,
            "slowSecs": cfg.slow_secs,
            "move15sPct": cfg.move_fast_pct,
            "move1mPct": cfg.move_slow_pct,
            "moveFastPct": cfg.move_fast_pct,
            "moveSlowPct": cfg.move_slow_pct,
            "volumeMult": cfg.volume_mult,
            "requireVolume": cfg.require_volume,
            "requireVwap": cfg.require_vwap,
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
    universe = params.get("universe") or "all"

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
            await eod_playbook.generate_playbook(session, token, universe="all")
        except Exception as exc:
            print(f"  ⚠️ Auto playbook generation failed: {exc}")

    _playbook_task = asyncio.create_task(_run())


def ensure_scanner_for_universe(session: aiohttp.ClientSession, universe: str = "all") -> None:
    token = get_access_token()
    if token:
        start_live_scanner(session, token, universe)
