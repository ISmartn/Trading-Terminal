/**
 * Sudden-move detection for Nifty Smallcap index constituent stocks (poll-based).
 */

import {
  buildMoveHeadline,
  buildMoveNotifyBody,
  formatVolumeMultiple,
  formatVolumeShort,
} from "./alertMoveFormat";
import type { SmallcapConstituent, SmallcapIndexKey } from "./smallcapUniverse";

export type StockMoveDirection = "up" | "down";

export interface StockPollSnapshot {
  ts: number;
  prices: Map<string, number>;
  volumes: Map<string, number>;
}

export interface SmallcapStockAlert {
  id: string;
  symbol: string;
  direction: StockMoveDirection;
  movePct: number;
  movePoints: number;
  fromPrice: number;
  toPrice: number;
  pollMs: number;
  triggeredAt: number;
  ltp: number;
  dayChangePercent: number;
  volume: number;
  volumeMultiple: number | null;
  volumeSummary: string | null;
  volumeConfirmed: boolean;
  indices: SmallcapIndexKey[];
  headline: string;
  notifyBody: string;
  tradeHint: string;
}

export const DEFAULT_STOCK_POLL_MOVE_PCT = 0.4;

/** Min volume vs previous poll to confirm stock spike when volume is known. */
export const MIN_STOCK_VOLUME_MULTIPLE = 1.2;

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

    const movePoints = Math.round((row.ltp - from) * 100) / 100;
    const direction: StockMoveDirection = movePct >= 0 ? "up" : "down";
    const indexLabel = row.indices.join("/");

    const vol = row.volume > 0 ? row.volume : 0;
    const prevVol = prev.volumes.get(row.symbol);
    const volumeMultiple =
      vol > 0 && prevVol != null && prevVol > 0
        ? Math.round((vol / prevVol) * 100) / 100
        : null;

    const volumeConfirmed =
      volumeMultiple == null || volumeMultiple >= MIN_STOCK_VOLUME_MULTIPLE;
    if (vol > 0 && prevVol != null && prevVol > 0 && !volumeConfirmed) continue;

    const volumeSummary =
      vol > 0
        ? `Vol ${formatVolumeShort(vol)}${volumeMultiple != null ? ` (${formatVolumeMultiple(volumeMultiple)})` : ""}`
        : null;

    const headline = buildMoveHeadline({
      label: row.symbol,
      direction,
      movePct,
      fromPrice: from,
      toPrice: row.ltp,
      window: `~${Math.round(pollMs / 1000)}s`,
      volumeSummary,
    });

    const notifyBody = buildMoveNotifyBody({
      label: row.symbol,
      direction,
      movePct,
      fromPrice: from,
      toPrice: row.ltp,
      volumeSummary,
      extra:
        direction === "up"
          ? `Momentum long — ${indexLabel}`
          : `Momentum short / hedge — ${indexLabel}`,
    });

    alerts.push({
      id: `${row.symbol}-${now}-${direction}`,
      symbol: row.symbol,
      direction,
      movePct,
      movePoints,
      fromPrice: from,
      toPrice: row.ltp,
      pollMs,
      triggeredAt: now,
      ltp: row.ltp,
      dayChangePercent: row.changePercent,
      volume: vol,
      volumeMultiple,
      volumeSummary,
      volumeConfirmed,
      indices: row.indices,
      headline,
      notifyBody,
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
  const volumes = new Map<string, number>();
  for (const c of constituents) {
    if (c.ltp > 0) prices.set(c.symbol, c.ltp);
    if (c.volume > 0) volumes.set(c.symbol, c.volume);
  }
  return { ts, prices, volumes };
}
