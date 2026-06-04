"""NSE equity / F&O regular session window (IST). Used to gate Upstox market WebSocket."""

from __future__ import annotations

import os
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def _parse_hhmm(value: str, default: time) -> time:
    raw = (value or "").strip()
    if not raw:
        return default
    parts = raw.split(":")
    if len(parts) != 2:
        return default
    try:
        h, m = int(parts[0]), int(parts[1])
        if 0 <= h <= 23 and 0 <= m <= 59:
            return time(h, m)
    except ValueError:
        pass
    return default


SESSION_OPEN = _parse_hhmm(os.getenv("NSE_SESSION_OPEN", ""), time(9, 15))
SESSION_CLOSE = _parse_hhmm(os.getenv("NSE_SESSION_CLOSE", ""), time(15, 30))


def is_nse_live_session(moment: datetime | None = None) -> bool:
    """True during NSE cash/F&O regular session (Mon–Fri, open–close IST)."""
    if os.getenv("UPSTOX_WS_IGNORE_SESSION", "").strip().lower() in ("1", "true", "yes"):
        return True

    now = moment or datetime.now(IST)
    if now.tzinfo is None:
        now = now.replace(tzinfo=IST)
    else:
        now = now.astimezone(IST)

    if now.weekday() >= 5:
        return False

    t = now.time()
    return SESSION_OPEN <= t <= SESSION_CLOSE


def seconds_until_session_change(moment: datetime | None = None) -> float:
    """Seconds until the next open or close boundary (for scheduler sleep)."""
    now = moment or datetime.now(IST)
    if now.tzinfo is None:
        now = now.replace(tzinfo=IST)
    else:
        now = now.astimezone(IST)

    open_dt = datetime.combine(now.date(), SESSION_OPEN, IST)
    close_dt = datetime.combine(now.date(), SESSION_CLOSE, IST)

    if is_nse_live_session(now):
        target = close_dt + timedelta(seconds=1)
    elif now.time() < SESSION_OPEN:
        target = open_dt
    else:
        target = open_dt + timedelta(days=1)
        while target.weekday() >= 5:
            target += timedelta(days=1)

    delta = (target - now).total_seconds()
    return max(15.0, min(delta, 300.0))
