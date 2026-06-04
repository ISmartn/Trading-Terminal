/**
 * Append/replace today's daily bar from intraday session or Upstox LTP.
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import { aggregateSessionCandle } from "@/lib/fnoStrategies";
import { istDayKey } from "@/lib/taCompute";

export function todayIstDayKey(nowMs = Date.now()): string {
  return istDayKey(Math.floor(nowMs / 1000));
}

/** Unix seconds for 09:15 IST on a given YYYY-MM-DD day key. */
export function istSessionOpenUnix(dayKey: string): number {
  return Math.floor(new Date(`${dayKey}T09:15:00+05:30`).getTime() / 1000);
}

export function sessionCandlesForIstDay(candles: OHLCVCandle[], dayKey: string): OHLCVCandle[] {
  return candles.filter((c) => istDayKey(c.time) === dayKey);
}

export function dailySeriesMissingToday(daily: OHLCVCandle[]): boolean {
  if (!daily.length) return true;
  return istDayKey(daily[daily.length - 1].time) !== todayIstDayKey();
}

export function mergeIntradayForDay(
  daily: OHLCVCandle[],
  intraday: OHLCVCandle[],
  dayKey: string,
): OHLCVCandle[] {
  const session = sessionCandlesForIstDay(intraday, dayKey);
  const today = aggregateSessionCandle(session);
  if (!today) return daily;

  const existing = daily.find((c) => istDayKey(c.time) === dayKey);
  const time = existing?.time ?? istSessionOpenUnix(dayKey);
  const bar: OHLCVCandle = { ...today, time };
  const history = daily.filter((c) => istDayKey(c.time) !== dayKey);
  return [...history, bar].sort((a, b) => a.time - b.time);
}

export function appendTodayFromLtp(daily: OHLCVCandle[], ltp: number, dayKey?: string): OHLCVCandle[] {
  const key = dayKey ?? todayIstDayKey();
  if (daily.some((c) => istDayKey(c.time) === key)) {
    return mergeIntradayForDay(daily, [
      {
        time: istSessionOpenUnix(key),
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: 0,
      },
    ], key);
  }

  const prevClose = daily.length ? daily[daily.length - 1].close : ltp;
  const bar: OHLCVCandle = {
    time: istSessionOpenUnix(key),
    open: prevClose,
    high: Math.max(prevClose, ltp),
    low: Math.min(prevClose, ltp),
    close: ltp,
    volume: 0,
  };
  return [...daily, bar];
}

/** @deprecated Use mergeIntradayForDay with todayIstDayKey() */
export function mergeLiveTodayIntoDaily(
  daily: OHLCVCandle[],
  todayIntraday: OHLCVCandle[],
): OHLCVCandle[] {
  return mergeIntradayForDay(daily, todayIntraday, todayIstDayKey());
}

export function enrichDailyWithLiveToday(
  daily: OHLCVCandle[],
  intraday: OHLCVCandle[],
  ltp?: number | null,
): OHLCVCandle[] {
  const todayKey = todayIstDayKey();
  let merged = mergeIntradayForDay(daily, intraday, todayKey);
  if (!dailySeriesMissingToday(merged)) return merged;
  if (ltp != null && ltp > 0) {
    merged = appendTodayFromLtp(merged, ltp, todayKey);
  }
  return merged;
}

export function parseLtpFromUpstoxJson(data: unknown, instrumentKey: string): number | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const payload = (root.data ?? root) as Record<string, unknown>;
  if (!payload || typeof payload !== "object") return null;

  let quote = payload[instrumentKey] as Record<string, unknown> | undefined;
  if (!quote) {
    const values = Object.values(payload);
    quote = values.find((v) => v && typeof v === "object") as Record<string, unknown> | undefined;
  }
  if (!quote) return null;

  for (const key of ["last_price", "lastPrice", "ltp", "close"]) {
    const val = quote[key];
    if (val != null && Number.isFinite(Number(val))) return Number(val);
  }
  return null;
}
