"""In-memory and disk-backed caching (mirrors proxy-server.mjs)."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from .config import CACHE_DIR, LAST_GOOD_TTL_MS

_cache: dict[str, dict[str, Any]] = {}
_last_good: dict[str, dict[str, Any]] = {}


def _disk_filename(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", key) + ".json"


def _ensure_cache_dir() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def rehydrate_from_disk() -> int:
    """Load last-good cache entries from disk on startup."""
    count = 0
    try:
        _ensure_cache_dir()
        now_ms = int(time.time() * 1000)
        for filepath in CACHE_DIR.glob("*.json"):
            try:
                raw = json.loads(filepath.read_text(encoding="utf-8"))
                if raw.get("data") and raw.get("timestamp") and now_ms - raw["timestamp"] < LAST_GOOD_TTL_MS:
                    disk_key = filepath.stem
                    _last_good[disk_key] = raw
                    count += 1
            except (json.JSONDecodeError, OSError):
                continue
    except OSError:
        pass
    return count


def get_cached(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry and time.time() * 1000 < entry["expiry"]:
        return entry["data"]
    if entry:
        _cache.pop(key, None)
    return None


def set_cache(key: str, data: Any, ttl_ms: int) -> None:
    _cache[key] = {"data": data, "expiry": time.time() * 1000 + ttl_ms}
    if len(_cache) > 200:
        oldest = next(iter(_cache))
        _cache.pop(oldest, None)


def delete_cache(key: str) -> None:
    _cache.pop(key, None)


def set_last_good_to_disk(key: str, data: Any) -> None:
    try:
        _ensure_cache_dir()
        filepath = CACHE_DIR / _disk_filename(key)
        filepath.write_text(
            json.dumps({"data": data, "timestamp": int(time.time() * 1000)}),
            encoding="utf-8",
        )
    except OSError as exc:
        print(f"  ⚠️ Failed to write cache to disk for {key}: {exc}")


def get_last_good_from_disk(key: str) -> dict[str, Any] | None:
    try:
        filepath = CACHE_DIR / _disk_filename(key)
        if not filepath.exists():
            return None
        raw = json.loads(filepath.read_text(encoding="utf-8"))
        now_ms = int(time.time() * 1000)
        if raw.get("data") and raw.get("timestamp") and now_ms - raw["timestamp"] < LAST_GOOD_TTL_MS:
            return raw
    except (json.JSONDecodeError, OSError):
        pass
    return None


def set_last_good(key: str, data: Any) -> None:
    disk_key = _disk_filename(key)
    entry = {"data": data, "timestamp": int(time.time() * 1000)}
    _last_good[disk_key] = entry
    set_last_good_to_disk(key, data)


def get_last_good(key: str) -> dict[str, Any] | None:
    disk_key = _disk_filename(key)
    entry = _last_good.get(disk_key)
    now_ms = int(time.time() * 1000)
    if entry and now_ms - entry["timestamp"] < LAST_GOOD_TTL_MS:
        return entry
    if entry:
        _last_good.pop(disk_key, None)

    disk_entry = get_last_good_from_disk(key)
    if disk_entry:
        _last_good[disk_key] = disk_entry
        return disk_entry
    return None
