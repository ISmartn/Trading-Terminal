"""Structured debug logging for the Python proxy (enable with PROXY_DEBUG=1)."""

from __future__ import annotations

import os
import sys
import traceback
from datetime import datetime, timezone
from typing import Any


def is_debug_enabled() -> bool:
    return os.getenv("PROXY_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")


def is_verbose_enabled() -> bool:
    return os.getenv("PROXY_DEBUG_VERBOSE", "").strip().lower() in ("1", "true", "yes", "on") or is_debug_enabled()


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def _write(prefix: str, message: str, *, stream=None) -> None:
    out = stream or sys.stderr
    out.write(f"[{_stamp()}] [{prefix}] {message}\n")
    out.flush()


def debug_log(message: str, **fields: Any) -> None:
    if not is_debug_enabled():
        return
    extra = ""
    if fields:
        parts = [f"{key}={value!r}" for key, value in fields.items()]
        extra = " | " + " ".join(parts)
    _write("DEBUG", f"{message}{extra}")


def debug_verbose(message: str, **fields: Any) -> None:
    if not is_verbose_enabled():
        return
    debug_log(message, **fields)


def debug_error(message: str, exc: BaseException | None = None, **fields: Any) -> None:
    if not is_debug_enabled():
        return
    extra = ""
    if fields:
        parts = [f"{key}={value!r}" for key, value in fields.items()]
        extra = " | " + " ".join(parts)
    _write("ERROR", f"{message}{extra}")
    if exc is not None:
        _write("ERROR", "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).rstrip())


def debug_request(method: str, path: str, *, status: int | None = None, error: str | None = None) -> None:
    if not is_debug_enabled():
        return
    bits = [method, path]
    if status is not None:
        bits.append(f"→ {status}")
    if error:
        bits.append(f"({error})")
    _write("HTTP", " ".join(bits))
