"""Supported index assets for the market webhook alert pipeline."""

from __future__ import annotations

# Internal keys (webhook ticker field after normalization)
NIFTY = "NIFTY"
BANKNIFTY = "BANKNIFTY"
NIFTYSC50 = "NIFTYSC50"
NIFTYSC100 = "NIFTYSC100"
NIFTYSC250 = "NIFTYSC250"

SUPPORTED_ASSETS = frozenset(
    {
        NIFTY,
        BANKNIFTY,
        NIFTYSC50,
        NIFTYSC100,
        NIFTYSC250,
    }
)

# ATM rounding for outbound strike hints (index-only symbols have no NSE F&O chain)
STRIKE_STEP: dict[str, int] = {
    NIFTY: 50,
    BANKNIFTY: 100,
    NIFTYSC50: 25,
    NIFTYSC100: 50,
    NIFTYSC250: 100,
}

# No listed index options — alerts use index-level strike rounding only
INDEX_ONLY_ASSETS = frozenset({NIFTYSC50, NIFTYSC100, NIFTYSC250})

DISPLAY_LABELS: dict[str, str] = {
    NIFTY: "Nifty 50",
    BANKNIFTY: "Bank Nifty",
    NIFTYSC50: "Nifty Smallcap 50",
    NIFTYSC100: "Nifty Smallcap 100",
    NIFTYSC250: "Nifty Smallcap 250",
}
