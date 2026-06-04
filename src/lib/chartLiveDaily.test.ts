import { describe, expect, it } from "vitest";
import type { OHLCVCandle } from "@/hooks/useChartData";
import { formatIstDate } from "@/lib/chartIntervals";
import { istDayKey } from "@/lib/taCompute";
import {
  appendTodayFromLtp,
  enrichDailyWithLiveToday,
  istSessionOpenUnix,
  mergeIntradayForDay,
} from "@/lib/chartLiveDaily";

describe("formatIstDate", () => {
  it("uses Asia/Kolkata calendar day", () => {
    const utcLate = new Date("2025-06-02T20:00:00Z");
    expect(formatIstDate(utcLate)).toBe("2025-06-03");
  });
});

describe("mergeIntradayForDay", () => {
  const dayKey = "2025-06-03";
  const openUnix = istSessionOpenUnix(dayKey);

  it("appends today when missing from daily history", () => {
    const daily: OHLCVCandle[] = [
      { time: openUnix - 86_400, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    ];
    const intra: OHLCVCandle[] = [
      { time: openUnix + 60, open: 200, high: 210, low: 195, close: 205, volume: 10 },
      { time: openUnix + 120, open: 205, high: 215, low: 200, close: 212, volume: 12 },
    ];
    const merged = mergeIntradayForDay(daily, intra, dayKey);
    expect(merged).toHaveLength(2);
    expect(merged[1].close).toBe(212);
  });
});

describe("enrichDailyWithLiveToday", () => {
  it("appends today from LTP when intraday empty and series missing today", () => {
    const realToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const prevDay = istSessionOpenUnix("2020-01-02");
    const daily: OHLCVCandle[] = [
      { time: prevDay, open: 100, high: 105, low: 99, close: 102, volume: 1 },
    ];
    const merged = enrichDailyWithLiveToday(daily, [], 110);
    expect(merged.length).toBeGreaterThanOrEqual(2);
    expect(merged[merged.length - 1].close).toBe(110);
    expect(istDayKey(merged[merged.length - 1].time)).toBe(realToday);
  });

  it("does not use yesterday intraday as today", () => {
    const june2 = istSessionOpenUnix("2020-06-02");
    const june3 = istSessionOpenUnix("2020-06-03");
    const daily: OHLCVCandle[] = [
      { time: june2 - 86_400, open: 90, high: 91, low: 89, close: 90, volume: 1 },
      { time: june2, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    ];
    const yesterdayIntra: OHLCVCandle[] = [
      { time: june2 + 3600, open: 100, high: 120, low: 98, close: 115, volume: 5 },
    ];
    const merged = mergeIntradayForDay(daily, yesterdayIntra, "2020-06-03");
    const appended = appendTodayFromLtp(merged, 200, "2020-06-03");
    expect(appended.some((c) => c.time === june3 && c.close === 200)).toBe(true);
  });
});

describe("appendTodayFromLtp", () => {
  it("replaces existing day bar when present", () => {
    const dayKey = "2025-06-03";
    const t = istSessionOpenUnix(dayKey);
    const daily: OHLCVCandle[] = [{ time: t, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
    const merged = appendTodayFromLtp(daily, 150, dayKey);
    expect(merged[0].close).toBe(150);
  });
});
