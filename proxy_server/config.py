"""Configuration, constants, and environment loading for the Python proxy server."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

PORT = int(os.getenv("PROXY_PORT", "4002"))
PROXY_DEBUG = os.getenv("PROXY_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
UPSTOX_BASE = "https://api.upstox.com"
NSE_BASE = "https://www.nseindia.com"
TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/india/scan"

CACHE_DIR = ROOT_DIR / ".cache"
LAST_GOOD_TTL_MS = 18 * 60 * 60 * 1000
UPSTOX_POLL_INTERVAL_MS = 2000
# NSE OI ~3 min; server cache dedupes client polls (see src/lib/dataRefreshPolicy.ts)
OI_CHAIN_CACHE_MS = 180_000

# NSE India can be slow; timeouts trigger last-good cache instead of 500 tracebacks.
NSE_CONNECT_TIMEOUT_SEC = 12
NSE_SOCK_READ_TIMEOUT_SEC = 35
NSE_TOTAL_TIMEOUT_SEC = 45

UNDERLYING_MAP = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
    "SENSEX": "BSE_INDEX|SENSEX",
}

INDEX_INSTRUMENT_KEYS = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
    "NIFTYSC50": "NSE_INDEX|NIFTY SMLCAP 50",
    "NIFTYSC100": "NSE_INDEX|NIFTY SMLCAP 100",
    "NIFTYSC250": "NSE_INDEX|NIFTY SMLCAP 250",
    "INDIAVIX": "NSE_INDEX|India VIX",
    "SENSEX": "BSE_INDEX|SENSEX",
}

# NSE equity instrument keys for F&O stocks (matches frontend useChartData INSTRUMENT_MAP)
EQUITY_INSTRUMENT_KEYS = {
    "RELIANCE": "NSE_EQ|INE002A01018",
    "TCS": "NSE_EQ|INE467B01029",
    "HDFCBANK": "NSE_EQ|INE040A01034",
    "INFY": "NSE_EQ|INE009A01021",
    "ICICIBANK": "NSE_EQ|INE090A01021",
    "HINDUNILVR": "NSE_EQ|INE030A01027",
    "ITC": "NSE_EQ|INE154A01025",
    "SBIN": "NSE_EQ|INE062A01020",
    "BHARTIARTL": "NSE_EQ|INE397D01024",
    "KOTAKBANK": "NSE_EQ|INE237A01036",
    "LT": "NSE_EQ|INE018A01030",
    "AXISBANK": "NSE_EQ|INE238A01034",
    "ASIANPAINT": "NSE_EQ|INE021A01026",
    "MARUTI": "NSE_EQ|INE585B01010",
    "TITAN": "NSE_EQ|INE280A01028",
    "SUNPHARMA": "NSE_EQ|INE044A01036",
    "BAJFINANCE": "NSE_EQ|INE296A01032",
    "BAJAJFINSV": "NSE_EQ|INE918I01026",
    "WIPRO": "NSE_EQ|INE075A01022",
    "HCLTECH": "NSE_EQ|INE860A01027",
    "TATAMOTORS": "NSE_EQ|INE155A01022",
    "TATASTEEL": "NSE_EQ|INE081A01020",
    "NTPC": "NSE_EQ|INE733E01010",
    "POWERGRID": "NSE_EQ|INE752E01010",
    "ONGC": "NSE_EQ|INE213A01029",
    "JSWSTEEL": "NSE_EQ|INE019A01038",
    "M_M": "NSE_EQ|INE101A01026",
    "M&M": "NSE_EQ|INE101A01026",
    "ADANIENT": "NSE_EQ|INE423A01024",
    "ADANIPORTS": "NSE_EQ|INE742F01042",
    "ULTRACEMCO": "NSE_EQ|INE481G01011",
    "TECHM": "NSE_EQ|INE669C01036",
    "INDUSINDBK": "NSE_EQ|INE095A01012",
    "DRREDDY": "NSE_EQ|INE089A01031",
    "CIPLA": "NSE_EQ|INE059A01026",
    "EICHERMOT": "NSE_EQ|INE066A01021",
    "DIVISLAB": "NSE_EQ|INE361B01024",
    "BPCL": "NSE_EQ|INE029A01011",
    "COALINDIA": "NSE_EQ|INE522F01014",
    "GRASIM": "NSE_EQ|INE047A01021",
    "APOLLOHOSP": "NSE_EQ|INE437A01024",
    "HEROMOTOCO": "NSE_EQ|INE158A01026",
    "TATACONSUM": "NSE_EQ|INE192A01025",
    "SBILIFE": "NSE_EQ|INE123W01016",
    "BRITANNIA": "NSE_EQ|INE216A01030",
    "NESTLEIND": "NSE_EQ|INE239A01024",
    "BAJAJ_AUTO": "NSE_EQ|INE917I01010",
    "HDFCLIFE": "NSE_EQ|INE795G01014",
    "VEDL": "NSE_EQ|INE205A01025",
    "HINDALCO": "NSE_EQ|INE038A01020",
    "BANKBARODA": "NSE_EQ|INE028A01039",
    "PNB": "NSE_EQ|INE160A01022",
    "DLF": "NSE_EQ|INE271C01023",
    "TRENT": "NSE_EQ|INE849A01020",
}


SYMBOL_ALIASES: dict[str, str] = {
    "M&M": "M_M",
    "BAJAJ-AUTO": "BAJAJ_AUTO",
}


def resolve_instrument_key(symbol: str) -> str | None:
    upper = SYMBOL_ALIASES.get(symbol, symbol.upper())
    return INDEX_INSTRUMENT_KEYS.get(upper) or EQUITY_INSTRUMENT_KEYS.get(upper)

# Subscribed on Upstox Market Data WebSocket V3 (ltpc). Fin/Midcap Nifty are NSE-only elsewhere.
INSTRUMENT_KEY_TO_TICK = {
    "NSE_INDEX|Nifty 50": {"securityId": 1, "symbol": "NIFTY", "exchangeSegment": "NSE_INDEX"},
    "NSE_INDEX|Nifty Bank": {"securityId": 2, "symbol": "BANKNIFTY", "exchangeSegment": "NSE_INDEX"},
    "NSE_INDEX|India VIX": {"securityId": 5, "symbol": "INDIAVIX", "exchangeSegment": "NSE_INDEX"},
    "BSE_INDEX|SENSEX": {"securityId": 6, "symbol": "SENSEX", "exchangeSegment": "BSE_INDEX"},
    "NSE_INDEX|NIFTY SMLCAP 50": {"securityId": 7, "symbol": "NIFTYSC50", "exchangeSegment": "NSE_INDEX"},
    "NSE_INDEX|NIFTY SMLCAP 100": {"securityId": 8, "symbol": "NIFTYSC100", "exchangeSegment": "NSE_INDEX"},
    "NSE_INDEX|NIFTY SMLCAP 250": {"securityId": 9, "symbol": "NIFTYSC250", "exchangeSegment": "NSE_INDEX"},
}

TICK_INSTRUMENT_KEYS = list(INSTRUMENT_KEY_TO_TICK.keys())

FNO_STOCKS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "SBIN", "BHARTIARTL",
    "ITC", "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA",
    "TITAN", "WIPRO", "ULTRACEMCO", "BAJFINANCE", "HCLTECH", "NTPC", "POWERGRID", "ONGC",
    "ADANIENT", "ADANIPORTS", "COALINDIA", "DRREDDY", "NESTLEIND", "CIPLA", "BAJAJFINSV",
    "GRASIM", "JSWSTEEL", "BRITANNIA", "TECHM", "INDUSINDBK", "HINDALCO", "M&M", "APOLLOHOSP",
    "EICHERMOT", "DIVISLAB", "BPCL", "HEROMOTOCO", "TATASTEEL", "SBILIFE", "HDFCLIFE",
    "SHRIRAMFIN", "TRENT", "BAJAJ-AUTO", "BANKBARODA", "PNB", "CANBK", "IDFCFIRSTB",
    "FEDERALBNK", "BANDHANBNK", "RBLBANK", "AUBANK", "MANAPPURAM", "MUTHOOTFIN",
    "CHOLAFIN", "LICHSGFIN", "CANFINHOME", "RECLTD", "PFC", "HAL", "BEL", "BHEL",
    "IRCTC", "ZOMATO", "PAYTM", "DLF", "GODREJPROP", "OBEROIRLTY", "VEDL", "JINDALSTEL",
    "SAIL", "NMDC", "IOC", "GAIL", "TATAPOWER", "SIEMENS", "ABB", "VOLTAS", "HAVELLS",
    "POLYCAB", "LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "TORNTPHARM", "LUPIN",
    "AUROPHARMA", "BIOCON", "GODREJCP", "DABUR", "MARICO", "COLPAL", "MCX", "INDIGO",
    "TVSMOTOR", "MRF", "ASHOKLEY", "ESCORTS", "DIXON", "CROMPTON", "JUBLFOOD", "SUNTV",
]

FNO_TICKERS = [f"NSE:{s}" for s in FNO_STOCKS]
INDEX_TICKERS = ["NSE:NIFTY", "NSE:BANKNIFTY", "NSE:CNXFINANCE", "BSE:SENSEX"]

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-upstox-access-token, x-dhan-access-token",
}


def get_access_token(custom_token: str | None = None) -> str | None:
    return custom_token or os.getenv("UPSTOX_ACCESS_TOKEN")
