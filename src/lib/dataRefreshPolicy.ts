/**
 * Decoupled refresh policy: price action vs option-chain OI.
 * NSE OI updates ~every 3 minutes — polling faster wastes rate limits.
 */

/** Spot/index LTP when Upstox ticks are not fresh (NSE indices via proxy). */
export const PRICE_WS_FALLBACK_POLL_MS = 5_000;

/** Index Move Alerts: Nifty Smallcap benchmarks (no Upstox WS) — always fast NSE poll. */
export const INDEX_MOVE_SMALLCAP_POLL_MS = 5_000;

/** When Upstox ticks are fresh, REST index poll is slowed (ticks are primary). */
export const PRICE_WS_CONNECTED_INDEX_POLL_MS = 120_000;

/** Index OI Insights: poll option chain slightly faster than global OI cadence. */
export const INDEX_OI_INSIGHTS_CHAIN_POLL_MS = 90_000;

export const INDEX_OI_INSIGHTS_CHAIN_STALE_MS = 60_000;

/** Full option chain (OI, volume, Greeks from broker) — align with NSE OI cadence. */
export const OI_CHAIN_POLL_MS = 180_000;

/** After hours: chain is static; rare refresh for UI consistency. */
export const OI_CHAIN_AFTER_HOURS_POLL_MS = 120_000;

/** Retry / offline option chain. */
export const OI_CHAIN_RETRY_POLL_MS = 30_000;

/** React Query: treat OI snapshot fresh for most of the poll window. */
export const OI_CHAIN_STALE_MS = 120_000;

/** Server-side cache TTL for option-chain responses (dedupe parallel clients). */
export const OI_CHAIN_SERVER_CACHE_MS = 180_000;

/** Intraday strategy scanners (5m OHLCV) — not tick data. */
export const STRATEGY_SCANNER_POLL_MS = 60_000;

/** Momentum / F&O intelligence rows (price-led, not full chain). */
export const MOMENTUM_POLL_MS = 2_500;
