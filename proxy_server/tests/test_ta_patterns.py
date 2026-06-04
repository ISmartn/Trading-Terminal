"""TA-Lib chart pattern detection."""

from __future__ import annotations

import pytest

from proxy_server import ta_patterns


def _candle(day: int, o: float, h: float, l: float, c: float) -> dict:
    return {
        "time": 1_700_000_000 + day * 86_400,
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": 1000,
    }


@pytest.mark.skipif(not ta_patterns.HAS_TALIB, reason="TA-Lib not installed")
def test_scan_symbol_patterns_latest_bullish_engulfing() -> None:
    candles = [
        _candle(0, 100, 102, 99, 100),
        _candle(1, 100, 101, 95, 96),
        _candle(2, 95, 110, 94, 108),
    ]
    rows = ta_patterns.scan_symbol_patterns("TEST", candles, ["BULLISH_ENGULFING"], lookback_bars=1)
    assert any(r["pattern"] == "BULLISH_ENGULFING" for r in rows)


@pytest.mark.skipif(not ta_patterns.HAS_TALIB, reason="TA-Lib not installed")
def test_detect_patterns_returns_talib_engine_fields() -> None:
    candles = [
        _candle(0, 10, 11, 9, 10),
        _candle(1, 10, 11, 9, 10.5),
    ]
    hits = ta_patterns.detect_patterns(candles)
    assert isinstance(hits, list)
    if hits:
        assert "name" in hits[0]
        assert "direction" in hits[0]


def test_require_talib_raises_when_missing(monkeypatch) -> None:
    monkeypatch.setattr(ta_patterns, "HAS_TALIB", False)
    with pytest.raises(RuntimeError, match="TA-Lib is required"):
        ta_patterns.detect_patterns([_candle(0, 1, 2, 0.5, 1), _candle(1, 1, 2, 0.5, 1)])
