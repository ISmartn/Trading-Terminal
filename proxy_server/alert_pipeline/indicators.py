"""ATR and volume SMA baselines for anomaly gates."""

from __future__ import annotations

from ..ta_indicators import atr as ta_atr
from .models import Candle


def sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    window = values[-period:]
    return sum(window) / period


def compute_atr_baseline(candles: list[Candle], period: int = 14) -> float | None:
    if len(candles) < period:
        return None
    high = [c.high for c in candles]
    low = [c.low for c in candles]
    close = [c.close for c in candles]
    series = ta_atr(high, low, close, period)
    for v in reversed(series):
        if v is not None:
            return float(v)
    return None


def compute_volume_sma(candles: list[Candle], period: int = 20) -> float | None:
    volumes = [c.volume for c in candles]
    return sma(volumes, period)
