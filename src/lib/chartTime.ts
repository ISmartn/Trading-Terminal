import type { Time } from "lightweight-charts";
import type { OHLCVCandle } from "@/hooks/useChartData";
import { isIntradayInterval, type ChartInterval, type ChartRange } from "@/lib/chartIntervals";
import { isIntradaySeries, istDayKey } from "@/lib/taCompute";

export type ChartReadyCandle = OHLCVCandle & { chartTime: Time };

/** Lightweight Charts time: business-day string for daily, unix seconds for intraday. */
export function toChartTime(unixSec: number, interval: ChartInterval): Time {
  if (interval === "D") {
    return new Date(unixSec * 1000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    }) as Time;
  }
  return unixSec as Time;
}

/** Dedupe, sort ascending, attach chartTime for LW Charts. */
export function prepareChartCandles(
  candles: OHLCVCandle[],
  interval: ChartInterval,
): ChartReadyCandle[] {
  const byTime = new Map<number, OHLCVCandle>();
  for (const c of candles) {
    byTime.set(c.time, c);
  }
  return Array.from(byTime.values())
    .sort((a, b) => a.time - b.time)
    .map((c) => ({
      ...c,
      chartTime: toChartTime(c.time, interval),
    }));
}

/** Keep only the most recent IST session (for 1D intraday view). */
export function latestSessionCandles(candles: OHLCVCandle[]): OHLCVCandle[] {
  if (candles.length === 0) return candles;
  const lastDay = istDayKey(candles[candles.length - 1].time);
  return candles.filter((c) => istDayKey(c.time) === lastDay);
}

/**
 * Candles to plot: for 1D + intraday show the latest session only
 * (avoids VWAP line jumping across overnight gaps).
 */
export function candlesForDisplay(
  candles: OHLCVCandle[],
  range: ChartRange,
  interval: ChartInterval,
): OHLCVCandle[] {
  if (range === "1D" && isIntradayInterval(interval)) {
    return latestSessionCandles(candles);
  }
  return candles;
}

export interface VwapLinePoint {
  time: Time;
  value: number;
}

/**
 * Build VWAP line segments — one segment per session so LW Charts
 * does not draw a diagonal connector across the overnight gap.
 */
export function vwapLineSegments(
  chartCandles: ChartReadyCandle[],
  values: (number | null)[],
): VwapLinePoint[][] {
  if (!chartCandles.length) return [];

  const sessionAware = isIntradaySeries(chartCandles);
  const segments: VwapLinePoint[][] = [];
  let current: VwapLinePoint[] = [];
  let lastDay: string | null = null;

  const n = Math.min(chartCandles.length, values.length);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;

    const day = istDayKey(chartCandles[i].time);
    if (sessionAware && lastDay != null && day !== lastDay) {
      if (current.length) segments.push(current);
      current = [];
    }
    lastDay = day;
    current.push({ time: chartCandles[i].chartTime, value: v });
  }

  if (current.length) segments.push(current);
  return segments;
}
