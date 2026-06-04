"""Tests for Upstox V3 WebSocket message parsing."""

from __future__ import annotations

import unittest

from proxy_server.upstox_market_ws import build_tick_from_ltpc, parse_market_feed_message


class TestUpstoxMarketWsParse(unittest.TestCase):
    def test_parse_ltpc_feed(self) -> None:
        msg = {
            "feeds": {
                "NSE_INDEX|Nifty 50": {"ltpc": {"ltp": 24500.5, "cp": 24400.0, "ltt": 1710000000000}},
                "NSE_INDEX|Nifty Bank": {"ltpc": {"ltp": 51200.0, "cp": 51000.0}},
            }
        }
        pairs = parse_market_feed_message(msg)
        self.assertEqual(len(pairs), 2)
        tick = build_tick_from_ltpc("NSE_INDEX|Nifty 50", dict(pairs[0][1]))
        self.assertIsNotNone(tick)
        assert tick is not None
        self.assertEqual(tick["symbol"], "NIFTY")
        self.assertEqual(tick["ltp"], 24500.5)

    def test_parse_full_feed_index_branch(self) -> None:
        msg = {
            "feeds": {
                "NSE_INDEX|Nifty 50": {
                    "fullFeed": {
                        "indexFF": {"ltpc": {"ltp": 24000.0, "cp": 23900.0}},
                    }
                }
            }
        }
        pairs = parse_market_feed_message(msg)
        self.assertEqual(len(pairs), 1)


if __name__ == "__main__":
    unittest.main()
