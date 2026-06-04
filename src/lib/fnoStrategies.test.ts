import { describe, it, expect } from "vitest";
import type { OHLCVCandle } from "@/hooks/useChartData";
import {
  evaluateBtstStbt,
  evaluateThreeWhiteSoldiers,
  evaluateThreeBlackCrows,
  evaluateCrtBullish,
  evaluateCrtBearish,
  evaluateOrbVwapSupertrend,
  sortBtstRows,
  sortMultiDayRows,
  sortOrbRows,
  toDailyCandles,
  type BtstScanRow,
  type MultiDayScanRow,
  type OrbScanRow,
} from "@/lib/fnoStrategies";

function c(
  day: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): OHLCVCandle {
  return { time: 1700000000 + day * 86400, open, high, low, close, volume };
}

/** Intraday bar at IST minutes from midnight on a fixed day */
function intraday(minutes: number, open: number, high: number, low: number, close: number, vol = 1000): OHLCVCandle {
  const base = new Date("2024-01-15T00:00:00+05:30").getTime() / 1000;
  return { time: base + minutes * 60, open, high, low, close, volume: vol };
}

describe("evaluateBtstStbt", () => {
  it("detects bullish BTST setup", () => {
    const history: OHLCVCandle[] = [];
    for (let i = 0; i < 11; i++) {
      history.push(c(i, 100, 103, 99, 102, 5000));
    }
    // T-1: small red (tiny body)
    history.push(c(11, 102, 102.5, 101, 101.2, 4000));
    // T: strong green, close above prev high, vol up
    history.push(c(12, 101, 106, 101, 105, 9000));

    const rows = evaluateBtstStbt(history);
    expect(rows.some((r) => r.side === "btst")).toBe(true);
    const btst = rows.find((r) => r.side === "btst");
    expect(btst?.stopLoss).toBeLessThan(btst!.entryLevel);
    expect(btst?.targetLevel).toBeGreaterThan(btst!.entryLevel);
    expect(btst?.riskRewardRatio).toBeGreaterThan(0);
  });

  it("detects bearish STBT setup", () => {
    const history: OHLCVCandle[] = [];
    for (let i = 0; i < 11; i++) {
      history.push(c(i, 100, 103, 99, 102, 5000));
    }
    history.push(c(11, 100, 100.5, 99.8, 100.2, 4000));
    history.push(c(12, 100, 100.5, 94, 95, 9000));

    const rows = evaluateBtstStbt(history);
    expect(rows.some((r) => r.side === "stbt")).toBe(true);
  });
});

describe("multi-day patterns", () => {
  it("detects three white soldiers", () => {
    const daily = [
      c(0, 100, 105, 99, 104, 1000),
      c(1, 103, 108, 102, 107, 1100),
      c(2, 106, 111, 105, 110, 1200),
    ];
    const row = evaluateThreeWhiteSoldiers(daily);
    expect(row?.pattern).toBe("three_white_soldiers");
    expect(row?.entryLevel).toBe(111);
    expect(row?.stopLoss).toBeLessThan(row!.entryLevel);
    expect(row?.targetLevel).toBeGreaterThan(row!.entryLevel);
    expect(row?.riskRewardRatio).toBeGreaterThanOrEqual(2);
    expect(row?.holdDays).toMatch(/session/);
  });

  it("detects CRT bullish", () => {
    const daily = [
      c(0, 100, 110, 95, 105, 1000),
      c(1, 104, 106, 92, 94, 1200),
      c(2, 95, 102, 94, 100, 1100),
    ];
    const row = evaluateCrtBullish(daily);
    expect(row?.pattern).toBe("crt_bullish");
  });

  it("detects three black crows", () => {
    const daily = [
      c(0, 110, 111, 105, 106, 1000),
      c(1, 106, 107, 100, 101, 1100),
      c(2, 101, 102, 95, 96, 1200),
    ];
    const row = evaluateThreeBlackCrows(daily);
    expect(row?.pattern).toBe("three_black_crows");
  });

  it("detects CRT bearish", () => {
    const daily = [
      c(0, 100, 110, 95, 105, 1000),
      c(1, 104, 115, 103, 112, 1200),
      c(2, 111, 112, 100, 102, 1100),
    ];
    const row = evaluateCrtBearish(daily);
    expect(row?.pattern).toBe("crt_bearish");
  });
});

describe("evaluateOrbVwapSupertrend", () => {
  it("returns long signal when ORB, VWAP, and Supertrend align", () => {
    const bars: OHLCVCandle[] = [];
    // Opening range 9:15–9:45 — tight range
    for (let m = 9 * 60 + 15; m <= 9 * 60 + 45; m += 5) {
      bars.push(intraday(m, 100, 101, 99, 100.5, 5000));
    }
    // Trend up after ORB
    for (let m = 9 * 60 + 50; m <= 10 * 60 + 30; m += 5) {
      const step = (m - (9 * 60 + 50)) / 5;
      const price = 101 + step * 0.5;
      bars.push(intraday(m, price, price + 0.6, price - 0.2, price + 0.4, 8000));
    }

    const row = evaluateOrbVwapSupertrend(bars);
    expect(row).not.toBeNull();
    expect(row?.state === "long" || row?.state === "watch_long").toBe(true);
    expect(row!.riskRewardRatio).toBeGreaterThanOrEqual(1);
    expect(row!.stopLoss).toBeLessThan(row!.entryLevel);
  });
});

describe("toDailyCandles", () => {
  it("aggregates intraday into daily bars", () => {
    const intradayBars = [
      intraday(9 * 60 + 15, 100, 105, 99, 104, 1000),
      intraday(10 * 60, 104, 106, 103, 105, 2000),
    ];
    const daily = toDailyCandles(intradayBars);
    expect(daily).toHaveLength(1);
    expect(daily[0].open).toBe(100);
    expect(daily[0].close).toBe(105);
    expect(daily[0].volume).toBe(3000);
  });
});

describe("strategy row sorting", () => {
  it("sorts BTST rows by signal bullish first", () => {
    const rows: BtstScanRow[] = [
      { symbol: "Z", side: "stbt" } as BtstScanRow,
      { symbol: "A", side: "btst" } as BtstScanRow,
    ];
    const sorted = sortBtstRows(rows, "signal", "asc");
    expect(sorted.map((r) => r.symbol)).toEqual(["A", "Z"]);
  });

  it("sorts multi-day rows by signal", () => {
    const rows: MultiDayScanRow[] = [
      { symbol: "X", side: "bearish", label: "Crows" } as MultiDayScanRow,
      { symbol: "Y", side: "bullish", label: "Soldiers" } as MultiDayScanRow,
    ];
    const sorted = sortMultiDayRows(rows, "signal", "asc");
    expect(sorted[0].side).toBe("bullish");
  });

  it("sorts ORB rows by signal strength", () => {
    const rows: OrbScanRow[] = [
      { symbol: "A", state: "short" } as OrbScanRow,
      { symbol: "B", state: "long" } as OrbScanRow,
      { symbol: "C", state: "watch_long" } as OrbScanRow,
    ];
    const sorted = sortOrbRows(rows, "signal", "asc");
    expect(sorted.map((r) => r.state)).toEqual(["long", "watch_long", "short"]);
  });
});
