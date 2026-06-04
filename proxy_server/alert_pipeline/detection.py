"""Phases 2–4: buffer update, anomaly gates, directional trade formatting."""

from __future__ import annotations

import time

from .assets import INDEX_ONLY_ASSETS
from .config import (
    ATR_PERIOD,
    BUFFER_MAX_CANDLES,
    MIN_WARMUP_CANDLES,
    PRICE_RANGE_ATR_MULT,
    STRIKE_STEP,
    VOLUME_SMA_MULT,
    VOLUME_SMA_PERIOD,
)
from .indicators import compute_atr_baseline, compute_volume_sma
from .models import Candle, OutboundAlert, ProcessResult
from .ticker import normalize_ticker


def append_candle(buffer: list[Candle], candle: Candle, max_len: int = BUFFER_MAX_CANDLES) -> list[Candle]:
    updated = [*buffer, candle]
    if len(updated) > max_len:
        updated = updated[-max_len:]
    return updated


def atm_strike(spot: float, step: int) -> int:
    return int(round(spot / step) * step)


def evaluate_anomaly(
    buffer: list[Candle],
    incoming: Candle,
    *,
    price_range_atr_mult: float = PRICE_RANGE_ATR_MULT,
    volume_sma_mult: float = VOLUME_SMA_MULT,
) -> tuple[bool, float, float, float]:
    """Return (passed, candle_range, atr_baseline, volume_sma)."""
    updated = append_candle(buffer, incoming)
    if len(updated) < MIN_WARMUP_CANDLES:
        return False, 0.0, 0.0, 0.0

    atr_base = compute_atr_baseline(updated, ATR_PERIOD)
    vol_base = compute_volume_sma(updated, VOLUME_SMA_PERIOD)
    if atr_base is None or vol_base is None or atr_base <= 0 or vol_base <= 0:
        return False, 0.0, atr_base or 0.0, vol_base or 0.0

    candle_range = incoming.high - incoming.low
    gate_a = candle_range > price_range_atr_mult * atr_base
    gate_b = incoming.volume > volume_sma_mult * vol_base
    passed = gate_a and gate_b
    return passed, candle_range, atr_base, vol_base


def build_alert(
    incoming: Candle,
    *,
    candle_range: float,
    atr_baseline: float,
    volume_baseline: float,
) -> OutboundAlert:
    asset = normalize_ticker(incoming.ticker) or incoming.ticker
    step = STRIKE_STEP.get(asset, 50)
    bullish = incoming.close > incoming.open
    direction = "bullish" if bullish else "bearish"
    strike = atm_strike(incoming.close, step)
    action = f"Buy {strike} CE" if bullish else f"Buy {strike} PE"
    stop_loss = incoming.low if bullish else incoming.high

    return OutboundAlert(
        ticker=asset,
        action=action,
        strike_price=strike,
        entry_price=incoming.close,
        stop_loss=stop_loss,
        direction=direction,
        timestamp=incoming.timestamp,
        anomaly_range=candle_range,
        atr_baseline=atr_baseline,
        volume_baseline=volume_baseline,
        metadata={
            "open": incoming.open,
            "high": incoming.high,
            "low": incoming.low,
            "close": incoming.close,
            "volume": incoming.volume,
            "indexOnly": asset in INDEX_ONLY_ASSETS,
        },
    )


def process_candle_event(
    buffer: list[Candle],
    incoming: Candle,
    last_processed_ts: int,
    *,
    max_stale_ms: int,
    now_ms: int | None = None,
) -> tuple[ProcessResult, list[Candle], int]:
    """
    Full pipeline for one ordered event.
    Returns (result, updated_buffer, new_last_processed_ts).
    """
    now = now_ms if now_ms is not None else int(time.time() * 1000)

    asset = normalize_ticker(incoming.ticker)
    if asset is None:
        return (
            ProcessResult(accepted=False, alert_fired=False, reason="unsupported_ticker"),
            buffer,
            last_processed_ts,
        )

    incoming = Candle(
        timestamp=incoming.timestamp,
        ticker=asset,
        open=incoming.open,
        high=incoming.high,
        low=incoming.low,
        close=incoming.close,
        volume=incoming.volume,
    )

    if incoming.timestamp <= last_processed_ts:
        return (
            ProcessResult(accepted=False, alert_fired=False, reason="out_of_order_or_duplicate"),
            buffer,
            last_processed_ts,
        )

    if now - incoming.timestamp > max_stale_ms:
        updated = append_candle(buffer, incoming)
        return (
            ProcessResult(accepted=False, alert_fired=False, reason="stale_timestamp"),
            updated,
            incoming.timestamp,
        )

    passed, candle_range, atr_base, vol_base = evaluate_anomaly(buffer, incoming)
    updated = append_candle(buffer, incoming)
    new_ts = incoming.timestamp

    if not passed:
        return (
            ProcessResult(accepted=True, alert_fired=False, reason="gates_not_met"),
            updated,
            new_ts,
        )

    alert = build_alert(
        incoming,
        candle_range=candle_range,
        atr_baseline=atr_base,
        volume_baseline=vol_base,
    )
    return (
        ProcessResult(accepted=True, alert_fired=True, reason="anomaly_detected", alert=alert),
        updated,
        new_ts,
    )
