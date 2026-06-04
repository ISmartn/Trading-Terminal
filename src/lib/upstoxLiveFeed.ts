/**
 * Indices on Upstox Market Data WebSocket V3 (must match proxy INSTRUMENT_KEY_TO_TICK).
 * Fin Nifty / Midcap Nifty are intentionally excluded — use NSE indices poll instead.
 */

export const UPSTOX_WS_INDEX_SYMBOLS = [
  "NIFTY",
  "BANKNIFTY",
  "NIFTYSC50",
  "NIFTYSC100",
  "NIFTYSC250",
  "INDIAVIX",
  "SENSEX",
] as const;

export type UpstoxWsIndexSymbol = (typeof UPSTOX_WS_INDEX_SYMBOLS)[number];

/** Browser securityId routing (aligned with proxy_server/config.py). */
export const UPSTOX_WS_SECURITY_IDS: Record<UpstoxWsIndexSymbol, number> = {
  NIFTY: 1,
  BANKNIFTY: 2,
  INDIAVIX: 5,
  SENSEX: 6,
  NIFTYSC50: 7,
  NIFTYSC100: 8,
  NIFTYSC250: 9,
};

const WS_SET = new Set<string>(UPSTOX_WS_INDEX_SYMBOLS);

export function isUpstoxWsIndexSymbol(s: string): s is UpstoxWsIndexSymbol {
  return WS_SET.has(s);
}
