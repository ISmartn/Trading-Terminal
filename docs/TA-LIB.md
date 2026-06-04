# TA-Lib Technical Analysis Integration
# https://ta-lib.org/

## Overview

This project integrates [TA-Lib](https://ta-lib.org/) for price-based technical analysis alongside existing options analytics (OI, PCR, IV rank).

### Indicators (Phase 1–3)

| Indicator | Use case |
|-----------|----------|
| RSI (14) | Overbought / oversold |
| MACD (12,26,9) | Momentum shifts |
| Bollinger Bands (20,2) | Volatility regime |
| ATR (14) | Realized vol vs implied |
| EMA 20 / SMA 50 | Trend direction |
| ADX (14) | Trend strength |
| Stochastic | Timing entries |
| OBV | Volume confirmation |

### Candlestick patterns

DOJI, HAMMER, SHOOTING_STAR, BULLISH/BEARISH ENGULFING

## Architecture

```
Frontend (React)
  useChartData(symbol, range)           → OHLCV candles
  useTechnicalIndicators(...)           → client-side TA from candles
  useTAScanner / TechnicalSnapshot      → batch via proxy when available

Python proxy (recommended for scanner)
  GET /api/ta/indicators?symbol=NIFTY&range=3M&indicators=rsi,macd,bbands
  GET /api/ta/snapshot?symbol=NIFTY
  GET /api/ta/scanner?filter=oversold
```

Client-side computation works with **any** proxy (`npm run dev` or `npm run dev:python`). Server endpoints add caching and batch scanning.

## Install TA-Lib (optional, for Python native engine)

1. Install C library: https://ta-lib.org/install/
   ```bash
   # Ubuntu/WSL
   sudo apt-get install ta-lib
   ```
2. Python deps:
   ```bash
   uv pip install -r requirements.txt
   uv pip install TA-Lib   # after C library is installed
   ```
3. Run: `npm run dev:python`

Without TA-Lib C library, the proxy uses **numpy fallback** (same algorithms as the browser).

## UI surfaces

| Location | Feature |
|----------|---------|
| **StockChart** (Option Chain, Watchlist) | Indicator toolbar, EMA/BB overlays, RSI/MACD pane, pattern markers |
| **Dashboard** | Technical Snapshot cards (NIFTY + BANKNIFTY) |
| **OI Analysis** | Spot context strip (RSI, ADX, ATR + trend) |
| **TA Scanner** (`/ta-scanner`) | F&O screener with filters |

## API examples

```bash
curl "http://localhost:4002/api/ta/indicators?symbol=NIFTY&indicators=rsi,macd,bbands,atr,adx,ema"
curl "http://localhost:4002/api/ta/snapshot?symbol=BANKNIFTY"
curl "http://localhost:4002/api/ta/scanner?filter=oversold"
```

## Phased rollout status

- [x] Phase 0: Core math + RSI/EMA on charts
- [x] Phase 1: MACD, BB, ATR sub-panels + indicator picker
- [x] Phase 2: Candlestick patterns + dashboard snapshot
- [x] Phase 3: F&O scanner + OI confluence strip

## Files

- `src/lib/taCompute.ts` — client indicator engine
- `src/hooks/useTechnicalIndicators.ts` — React hooks
- `proxy_server/ta_indicators.py` — server engine (TA-Lib + numpy)
- `proxy_server/handlers.py` — `/api/ta/*` handlers
