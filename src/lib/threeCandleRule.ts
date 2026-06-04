import type { OHLCVCandle } from "@/hooks/useChartData";
import { fetchAllFnoSymbols } from "@/lib/fnoUniverse";

/** Close within this fraction of candle range from high/low counts as "≈ High/Low" */
export const DEFAULT_CLOSE_TOLERANCE = 0.15;

export type ThreeCandleStatus = "setup" | "triggered" | "confirmed";

export interface ThreeCandleScanRow {
  symbol: string;
  side: "bullish" | "bearish";
  status: ThreeCandleStatus;
  ltp: number;
  day1High: number;
  day1Low: number;
  day1Close: number;
  day1Mid: number;
  day2High: number;
  day2Low: number;
  day3High: number;
  day3Low: number;
  day3Close: number;
  entryLevel: number;
  stopLoss: number;
  targetLevel: number;
  label: string;
}

function candleRange(c: OHLCVCandle): number {
  const r = c.high - c.low;
  return r > 0 ? r : 0;
}

function closeNearHigh(c: OHLCVCandle, tolerance: number): boolean {
  const range = candleRange(c);
  if (range === 0) return false;
  return (c.high - c.close) / range <= tolerance;
}

function closeNearLow(c: OHLCVCandle, tolerance: number): boolean {
  const range = candleRange(c);
  if (range === 0) return false;
  return (c.close - c.low) / range <= tolerance;
}

function midpoint(c: OHLCVCandle): number {
  return (c.high + c.low) / 2;
}

function statusLabel(side: "bullish" | "bearish", status: ThreeCandleStatus): string {
  const emoji = side === "bullish" ? "🟢" : "🔴";
  const phase =
    status === "confirmed" ? "Confirmed" : status === "triggered" ? "Entry triggered" : "Setup forming";
  return `${emoji} ${side === "bullish" ? "Bullish" : "Bearish"} · ${phase}`;
}

function evaluateBullish(d1: OHLCVCandle, d2: OHLCVCandle, d3: OHLCVCandle, tolerance: number): ThreeCandleScanRow | null {
  const d1Mid = midpoint(d1);
  if (!closeNearHigh(d1, tolerance)) return null;
  if (!(d2.high < d1.high && d2.low > d1Mid)) return null;

  const entryLevel = d1.high;
  const stopLoss = d2.low;
  const entryTriggered = d3.high > d1.high;
  const confirmed = d3.close > d1.high;

  let status: ThreeCandleStatus = "setup";
  if (confirmed) status = "confirmed";
  else if (entryTriggered) status = "triggered";

  return {
    symbol: "",
    side: "bullish",
    status,
    ltp: d3.close,
    day1High: d1.high,
    day1Low: d1.low,
    day1Close: d1.close,
    day1Mid: d1Mid,
    day2High: d2.high,
    day2Low: d2.low,
    day3High: d3.high,
    day3Low: d3.low,
    day3Close: d3.close,
    entryLevel,
    stopLoss,
    targetLevel: d1.high,
    label: statusLabel("bullish", status),
  };
}

function evaluateBearish(d1: OHLCVCandle, d2: OHLCVCandle, d3: OHLCVCandle, tolerance: number): ThreeCandleScanRow | null {
  const d1Mid = midpoint(d1);
  if (!closeNearLow(d1, tolerance)) return null;
  if (!(d2.low > d1.low && d2.high < d1Mid)) return null;

  const entryLevel = d1.low;
  const stopLoss = d2.high;
  const entryTriggered = d3.low < d1.low;
  const confirmed = d3.close < d1.low;

  let status: ThreeCandleStatus = "setup";
  if (confirmed) status = "confirmed";
  else if (entryTriggered) status = "triggered";

  return {
    symbol: "",
    side: "bearish",
    status,
    ltp: d3.close,
    day1High: d1.high,
    day1Low: d1.low,
    day1Close: d1.close,
    day1Mid: d1Mid,
    day2High: d2.high,
    day2Low: d2.low,
    day3High: d3.high,
    day3Low: d3.low,
    day3Close: d3.close,
    entryLevel,
    stopLoss,
    targetLevel: d1.low,
    label: statusLabel("bearish", status),
  };
}

/** Evaluate last 3 daily candles for bullish and/or bearish 3-candle rule setups. */
export function evaluateThreeCandleRule(
  candles: OHLCVCandle[],
  tolerance = DEFAULT_CLOSE_TOLERANCE,
): ThreeCandleScanRow[] {
  if (candles.length < 3) return [];

  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const d1 = sorted[sorted.length - 3];
  const d2 = sorted[sorted.length - 2];
  const d3 = sorted[sorted.length - 1];

  const results: ThreeCandleScanRow[] = [];
  const bull = evaluateBullish(d1, d2, d3, tolerance);
  const bear = evaluateBearish(d1, d2, d3, tolerance);
  if (bull) results.push(bull);
  if (bear) results.push(bear);
  return results;
}

export type ThreeCandlePatternFilter = "popular" | "bullish" | "bearish" | "all";

export type ThreeCandleStatusFilter = "all" | "confirmed" | "triggered" | "setup";

/** @deprecated use ThreeCandlePatternFilter + ThreeCandleStatusFilter */
export type ThreeCandleFilter = ThreeCandlePatternFilter | ThreeCandleStatusFilter;

/** Indices + highest-liquidity F&O names */
export const POPULAR_FNO_SYMBOLS = [
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "MIDCPNIFTY",
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "SBIN",
  "ITC",
  "BHARTIARTL",
  "KOTAKBANK",
  "LT",
  "AXISBANK",
];

export function filterThreeCandleRows(
  rows: ThreeCandleScanRow[],
  patternFilter: ThreeCandlePatternFilter,
  statusFilter: ThreeCandleStatusFilter = "all",
): ThreeCandleScanRow[] {
  return rows.filter((row) => {
    if (patternFilter === "bullish" && row.side !== "bullish") return false;
    if (patternFilter === "bearish" && row.side !== "bearish") return false;
    if (statusFilter === "confirmed" && row.status !== "confirmed") return false;
    if (statusFilter === "triggered" && row.status !== "triggered") return false;
    if (statusFilter === "setup" && row.status !== "setup") return false;
    return true;
  });
}

/** Symbols to fetch for each pattern filter (universe is chosen at scan time, not post-filter). */
export async function resolveThreeCandleScanSymbols(
  patternFilter: ThreeCandlePatternFilter,
): Promise<string[]> {
  if (patternFilter === "popular") return [...POPULAR_FNO_SYMBOLS];
  return fetchAllFnoSymbols();
}

export function describeThreeCandleScan(
  patternFilter: ThreeCandlePatternFilter,
  symbolCount: number,
): {
  universe: string;
  patterns: string;
  symbolCount: number;
} {
  const symbols =
    patternFilter === "popular"
      ? `${symbolCount} most popular F&O symbols`
      : `${symbolCount} NSE F&O underlyings (full market list)`;
  const patterns =
    patternFilter === "bullish"
      ? "🟢 bullish patterns only"
      : patternFilter === "bearish"
        ? "🔴 bearish patterns only"
        : "bullish & bearish patterns";
  return { universe: symbols, patterns, symbolCount };
}

const STATUS_RANK: Record<ThreeCandleStatus, number> = {
  confirmed: 3,
  triggered: 2,
  setup: 1,
};

export function sortThreeCandleRows(rows: ThreeCandleScanRow[]): ThreeCandleScanRow[] {
  return [...rows].sort((a, b) => {
    const sr = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (sr !== 0) return sr;
    return a.symbol.localeCompare(b.symbol);
  });
}
