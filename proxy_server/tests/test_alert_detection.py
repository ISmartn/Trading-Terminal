"""Unit tests for candle anomaly detection pipeline."""

from __future__ import annotations

import unittest

from proxy_server.alert_pipeline.detection import append_candle, evaluate_anomaly, process_candle_event
from proxy_server.alert_pipeline.models import Candle
from proxy_server.alert_pipeline.ticker import normalize_ticker


def _candle(
    ts: int,
    *,
    o: float,
    h: float,
    l: float,
    c: float,
    v: float,
    ticker: str = "NIFTY",
) -> Candle:
    return Candle(timestamp=ts, ticker=ticker, open=o, high=h, low=l, close=c, volume=v)


def _quiet_buffer(start_ts: int, n: int = 25) -> list[Candle]:
    buf: list[Candle] = []
    for i in range(n):
        base = 24000 + i * 0.5
        buf.append(
            _candle(
                start_ts + i * 60_000,
                o=base,
                h=base + 5,
                l=base - 5,
                c=base + 1,
                v=100_000,
            )
        )
    return buf


class TestTicker(unittest.TestCase):
    def test_aliases(self) -> None:
        self.assertEqual(normalize_ticker("Nifty 50"), "NIFTY")
        self.assertEqual(normalize_ticker("NIFTY BANK"), "BANKNIFTY")
        self.assertEqual(normalize_ticker("NIFTY SMALLCAP 50"), "NIFTYSC50")
        self.assertEqual(normalize_ticker("NIFTY SMALLCAP 100"), "NIFTYSC100")
        self.assertEqual(normalize_ticker("NIFTY SMALLCAP 250"), "NIFTYSC250")
        self.assertIsNone(normalize_ticker("RELIANCE"))


class TestAnomalyGates(unittest.TestCase):
    def test_spike_triggers_gates(self) -> None:
        buf = _quiet_buffer(1_700_000_000_000)
        spike = _candle(
            buf[-1].timestamp + 60_000,
            o=24050,
            h=24180,
            l=24040,
            c=24170,
            v=500_000,
        )
        passed, rng, atr_b, vol_b = evaluate_anomaly(buf, spike)
        self.assertTrue(passed)
        self.assertGreater(rng, 0)
        self.assertGreater(atr_b, 0)
        self.assertGreater(vol_b, 0)

    def test_normal_candle_fails_gates(self) -> None:
        buf = _quiet_buffer(1_700_000_000_000)
        calm = _candle(
            buf[-1].timestamp + 60_000,
            o=24020,
            h=24025,
            l=24018,
            c=24022,
            v=110_000,
        )
        passed, _, _, _ = evaluate_anomaly(buf, calm)
        self.assertFalse(passed)


class TestProcessEvent(unittest.TestCase):
    def test_out_of_order_rejected(self) -> None:
        buf = _quiet_buffer(1_000)
        c = _candle(500, o=1, h=2, l=0.5, c=1.5, v=1)
        result, _, ts = process_candle_event(buf, c, last_processed_ts=1000, now_ms=2000, max_stale_ms=999_999)
        self.assertFalse(result.accepted)
        self.assertEqual(result.reason, "out_of_order_or_duplicate")

    def test_anomaly_builds_ce_alert(self) -> None:
        buf = _quiet_buffer(1_700_000_000_000)
        ts = buf[-1].timestamp + 60_000
        spike = _candle(ts, o=24050, h=24180, l=24040, c=24170, v=500_000)
        result, updated, new_ts = process_candle_event(
            buf,
            spike,
            last_processed_ts=0,
            now_ms=ts + 1000,
            max_stale_ms=300_000,
        )
        self.assertTrue(result.accepted)
        if result.alert_fired:
            self.assertIn("CE", result.alert.action)
            self.assertEqual(result.alert.stop_loss, spike.low)


if __name__ == "__main__":
    unittest.main()
