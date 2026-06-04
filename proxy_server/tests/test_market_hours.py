"""Tests for NSE session window helpers."""

from __future__ import annotations

import unittest
from datetime import datetime

from zoneinfo import ZoneInfo

from proxy_server.market_hours import SESSION_CLOSE, SESSION_OPEN, is_nse_live_session, seconds_until_session_change

IST = ZoneInfo("Asia/Kolkata")


class TestMarketHours(unittest.TestCase):
    def test_open_mid_session(self) -> None:
        dt = datetime(2026, 6, 3, 11, 0, tzinfo=IST)
        self.assertTrue(is_nse_live_session(dt))

    def test_closed_before_open(self) -> None:
        dt = datetime(2026, 6, 3, 9, 0, tzinfo=IST)
        self.assertFalse(is_nse_live_session(dt))

    def test_closed_after_close(self) -> None:
        dt = datetime(2026, 6, 3, 16, 0, tzinfo=IST)
        self.assertFalse(is_nse_live_session(dt))

    def test_weekend(self) -> None:
        dt = datetime(2026, 6, 6, 11, 0, tzinfo=IST)  # Saturday
        self.assertFalse(is_nse_live_session(dt))

    def test_session_boundaries(self) -> None:
        self.assertEqual(SESSION_OPEN, datetime(2026, 1, 1, 9, 15).time())
        self.assertEqual(SESSION_CLOSE, datetime(2026, 1, 1, 15, 30).time())

    def test_seconds_until_change_positive(self) -> None:
        dt = datetime(2026, 6, 3, 11, 0, tzinfo=IST)
        self.assertGreater(seconds_until_session_change(dt), 0)


if __name__ == "__main__":
    unittest.main()
