/**
 * Sudden-move detection for Nifty Smallcap index constituent stocks (poll-based).
 */

import type { SmallcapConstituent, SmallcapIndexKey } from "./smallcapUniverse";

export type StockMoveDirection = "up" | "down";

export interface StockPollSnapshot {
  ts: number;
  prices: Map<string, number>;
}

export interface SmallcapStockAlert {
  id: string;
  symbol: string;
  direction: StockMoveDirection;
  movePct: number;
  fromPrice: number;
  toPrice: number;
  pollMs: number;
  triggeredAt: number;
  ltp: number;
  dayChangePercent: number;
  indices: SmallcapIndexKey[];
  headline: string;
  tradeHint: string;
}

export const DEFAULT_STOCK_POLL_MOVE_PCT = 0.4;

export function detectPollMoves(
  prev: StockPollSnapshot | null,
  constituents: SmallcapConstituent[],
  now: number,
  minMovePct: number,
): SmallcapStockAlert[] {
  if (!prev || prev.prices.size === 0) return [];

  const pollMs = Math.max(now - prev.ts, 1000);
  const alerts: SmallcapStockAlert[] = [];

  for (const row of constituents) {
    const from = prev.prices.get(row.symbol);
    if (from == null || from <= 0 || row.ltp <= 0) continue;

    const movePct = Math.round(((row.ltp - from) / from) * 10000) / 100;
    if (Math.abs(movePct) < minMovePct) continue;

    const direction: StockMoveDirection = movePct >= 0 ? "up" : "down";
    const indexLabel = row.indices.join("/");
    const dirWord = direction === "up" ? "UP" : "DOWN";

    alerts.push({
      id: `${row.symbol}-${now}-${direction}`,
      symbol: row.symbol,
      direction,
      movePct,
      fromPrice: from,
      toPrice: row.ltp,
      pollMs,
      triggeredAt: now,
      ltp: row.ltp,
      dayChangePercent: row.changePercent,
      indices: row.indices,
      headline: `${row.symbol} ${dirWord} ${movePct >= 0 ? "+" : ""}${movePct}% (~${Math.round(pollMs / 1000)}s)`,
      tradeHint:
        direction === "up"
          ? `Momentum long — check ${row.symbol} F&O chain if listed; else cash. Index: ${indexLabel}.`
          : `Momentum short / hedge — verify liquidity; index: ${indexLabel}.`,
    });
  }

  return alerts.sort((a, b) => Math.abs(b.movePct) - Math.abs(a.movePct));
}

export function alertCooldownKey(alert: SmallcapStockAlert): string {
  return `${alert.symbol}:${alert.direction}`;
}

export function snapshotFromConstituents(
  constituents: SmallcapConstituent[],
  ts: number,
): StockPollSnapshot {
  const prices = new Map<string, number>();
  for (const c of constituents) {
    if (c.ltp > 0) prices.set(c.symbol, c.ltp);
  }
  return { ts, prices };
}
