# Algo Strategies

Implemented scanners from [Indian F&O Trading Strategy Generation.md](./Indian%20F%26O%20Trading%20Strategy%20Generation.md).

**UI:** Sidebar → **Algo Strategies** (`/strategy-scanner`) · Shortcut `⌘0`

## Systematic intraday blueprint (Phases 1–3)

| Phase | Module | Purpose |
|-------|--------|---------|
| **1 — Alpha** | `src/lib/intradayAlpha.ts` · `src/lib/vwapMeanReversion.ts` · `src/lib/orderFlowSignals.ts` | ORB momentum, VWAP MR (Z-score + ADX), OI + VWAP, order-flow absorption proxy |
| **2 — Data** | `useChartData` + Upstox proxy | 5m historical + live LTP (WebSocket via proxy poll) |
| **3 — Backtest** | `src/lib/intradayBacktest.ts` | Bar-by-bar ORB sim, Indian costs, walk-forward split |

Cost model: `src/lib/indiaTradingCosts.ts` (brokerage, STT, exchange, GST, slippage).

## Live scanners

| Strategy | Horizon | Product | Rules |
|----------|---------|---------|-------|
| **BTST / STBT** | Overnight | NRML | T-1 small body → T strong reversal candle, close beyond T-1 extreme, volume expansion |
| **Three Soldiers / Crows / CRT** | 2–3 days | NRML | Continuation + CRT (AMD) · **confluence-scored** |
| **ORB + VWAP + Supertrend** | Intraday | MIS | 09:15–09:45 range break + VWAP + Supertrend(10,3) · backtest panel on tab |
| **VWAP Mean Reversion** | Intraday | MIS | ±2σ/±3σ from session VWAP · ADX≤22 · vol spike + rejection · 1×ATR stop · VWAP target |
| **Order Flow (proxy)** | Intraday | MIS | Effort vs. result absorption · approximate CVD divergence (OHLCV until tick feed) |

**Code:** `src/lib/fnoStrategies.ts` · `src/lib/strategyConfluence.ts` · Tests: `src/lib/fnoStrategies.test.ts`, `src/lib/intradayBacktest.test.ts`

Analytics only — no broker order execution.
