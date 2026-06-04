"""Environment configuration for the market webhook alert pipeline."""

from __future__ import annotations

import os

from ..config import ROOT_DIR
from dotenv import load_dotenv

load_dotenv(ROOT_DIR / ".env")

REDIS_URL = os.getenv("REDIS_URL", "").strip() or None

ALERT_OUTBOUND_WEBHOOK_URL = os.getenv("ALERT_OUTBOUND_WEBHOOK_URL", "").strip() or None
ALERT_WEBHOOK_SECRET = os.getenv("ALERT_WEBHOOK_SECRET", "").strip() or None
MARKET_WEBHOOK_SECRET = os.getenv("MARKET_WEBHOOK_SECRET", "").strip() or None

BUFFER_MAX_CANDLES = int(os.getenv("ALERT_BUFFER_MAX_CANDLES", "30"))
ATR_PERIOD = int(os.getenv("ALERT_ATR_PERIOD", "14"))
VOLUME_SMA_PERIOD = int(os.getenv("ALERT_VOLUME_SMA_PERIOD", "20"))
PRICE_RANGE_ATR_MULT = float(os.getenv("ALERT_PRICE_RANGE_ATR_MULT", "2.0"))
VOLUME_SMA_MULT = float(os.getenv("ALERT_VOLUME_SMA_MULT", "2.5"))
MAX_STALE_MS = int(os.getenv("ALERT_MAX_STALE_MS", str(5 * 60 * 1000)))
MIN_WARMUP_CANDLES = max(ATR_PERIOD, VOLUME_SMA_PERIOD)

REDIS_STREAM_PREFIX = os.getenv("ALERT_REDIS_STREAM_PREFIX", "market:candles")
REDIS_STATE_PREFIX = os.getenv("ALERT_REDIS_STATE_PREFIX", "market:buffer")

from .assets import DISPLAY_LABELS, INDEX_ONLY_ASSETS, SUPPORTED_ASSETS, STRIKE_STEP

__all__ = [
    "DISPLAY_LABELS",
    "INDEX_ONLY_ASSETS",
    "SUPPORTED_ASSETS",
    "STRIKE_STEP",
]
