"""Normalize provider tickers to internal asset keys."""

from __future__ import annotations

from .assets import (
    BANKNIFTY,
    NIFTY,
    NIFTYSC50,
    NIFTYSC100,
    NIFTYSC250,
    SUPPORTED_ASSETS,
)

_TICKER_ALIASES: dict[str, str] = {
    "NIFTY": NIFTY,
    "NIFTY50": NIFTY,
    "NIFTY 50": NIFTY,
    "NSE:NIFTY": NIFTY,
    "NSE:NIFTY50": NIFTY,
    "BANKNIFTY": BANKNIFTY,
    "BANK NIFTY": BANKNIFTY,
    "NIFTY BANK": BANKNIFTY,
    "NIFTYBANK": BANKNIFTY,
    "NSE:BANKNIFTY": BANKNIFTY,
    "NSE:NIFTYBANK": BANKNIFTY,
    # Nifty Smallcap indices (NSE index names + compact keys)
    "NIFTYSC50": NIFTYSC50,
    "NIFTY SMALLCAP 50": NIFTYSC50,
    "NIFTY SMALLCAP50": NIFTYSC50,
    "NIFTY SMALL CAP 50": NIFTYSC50,
    "NSE:NIFTYSC50": NIFTYSC50,
    "NIFTYSC100": NIFTYSC100,
    "NIFTY SMALLCAP 100": NIFTYSC100,
    "NIFTY SMALLCAP100": NIFTYSC100,
    "NIFTY SMALL CAP 100": NIFTYSC100,
    "NSE:NIFTYSC100": NIFTYSC100,
    "NIFTYSC250": NIFTYSC250,
    "NIFTY SMALLCAP 250": NIFTYSC250,
    "NIFTY SMALLCAP250": NIFTYSC250,
    "NIFTY SMALL CAP 250": NIFTYSC250,
    "NSE:NIFTYSC250": NIFTYSC250,
}


def normalize_ticker(raw: str) -> str | None:
    key = raw.strip().upper()
    if key in _TICKER_ALIASES:
        return _TICKER_ALIASES[key]
    compact = key.replace(" ", "")
    if compact in _TICKER_ALIASES:
        return _TICKER_ALIASES[compact]
    if key in SUPPORTED_ASSETS:
        return key
    return None
