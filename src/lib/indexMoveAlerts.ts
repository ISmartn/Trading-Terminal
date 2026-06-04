/**
 * Symbols monitored on Index Move Alerts (F&O indices + Nifty Smallcap benchmarks).
 */

import { FNO_INDEX_SYMBOLS } from "@/lib/fnoUniverse";
import { isUpstoxWsIndexSymbol, UPSTOX_WS_INDEX_SYMBOLS } from "@/lib/upstoxLiveFeed";

export { UPSTOX_WS_INDEX_SYMBOLS };

export const INDEX_MOVE_ALERT_SYMBOLS = [
  "NIFTY",
  "BANKNIFTY",
  "NIFTYSC50",
  "NIFTYSC100",
  "NIFTYSC250",
] as const;

export type IndexMoveAlertSymbol = (typeof INDEX_MOVE_ALERT_SYMBOLS)[number];

/** Indices with NSE F&O option chains (OI-backed alerts). */
export const INDEX_FO_MOVE_SYMBOLS = ["NIFTY", "BANKNIFTY"] as const;

export type IndexFoMoveSymbol = (typeof INDEX_FO_MOVE_SYMBOLS)[number];

export const INDEX_MOVE_ALERT_LABELS: Record<IndexMoveAlertSymbol, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Bank Nifty",
  NIFTYSC50: "Nifty Smallcap 50",
  NIFTYSC100: "Nifty Smallcap 100",
  NIFTYSC250: "Nifty Smallcap 250",
};

export const MOVE_ALERT_STRIKE_STEP: Record<IndexMoveAlertSymbol, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  NIFTYSC50: 25,
  NIFTYSC100: 50,
  NIFTYSC250: 100,
};

export const INDEX_ONLY_MOVE_SYMBOLS = new Set<IndexMoveAlertSymbol>([
  "NIFTYSC50",
  "NIFTYSC100",
  "NIFTYSC250",
]);

const MOVE_SET = new Set<string>(INDEX_MOVE_ALERT_SYMBOLS);

export function isMoveAlertSymbol(s: string): s is IndexMoveAlertSymbol {
  return MOVE_SET.has(s);
}

export function isIndexOnlyMoveSymbol(s: IndexMoveAlertSymbol): boolean {
  return INDEX_ONLY_MOVE_SYMBOLS.has(s);
}

export function isFoMoveSymbol(s: IndexMoveAlertSymbol): s is IndexFoMoveSymbol {
  return s === "NIFTY" || s === "BANKNIFTY";
}

/** Spot merge treats these as indices (Upstox WS and/or NSE poll). */
export function isSpotTrackedIndexSymbol(s: string): boolean {
  return (
    (FNO_INDEX_SYMBOLS as readonly string[]).includes(s) ||
    isMoveAlertSymbol(s) ||
    isUpstoxWsIndexSymbol(s)
  );
}
