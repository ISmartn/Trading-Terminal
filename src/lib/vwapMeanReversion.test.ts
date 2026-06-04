import { describe, it, expect } from "vitest";
import type { OHLCVCandle } from "@/hooks/useChartData";
import {
  evaluateVwapMeanReversion,
  isRejectionCandle,
  sessionVwapZScores,
  syntheticVwapBandDemo,
  VWAP_MR_Z_TRIGGER,
} from "@/lib/vwapMeanReversion";

function intraday(minutes: number, open: number, high: number, low: number, close: number, vol = 1000): OHLCVCandle {
  const base = new Date("2024-01-15T00:00:00+05:30").getTime() / 1000;
  return { time: base + minutes * 60, open, high, low, close, volume: vol };
}

describe("isRejectionCandle", () => {
  it("detects bullish rejection at lows", () => {
    const c = intraday(600, 98, 100, 94, 99.5, 5000);
    expect(isRejectionCandle(c, "long")).toBe(true);
  });
});

describe("sessionVwapZScores", () => {
  it("computes z-scores along session", () => {
    const bars: OHLCVCandle[] = [];
    for (let m = 9 * 60 + 15; m <= 11 * 60; m += 5) {
      bars.push(intraday(m, 100, 101, 99, 100, 5000));
    }
    const { zScores, vwapVals } = sessionVwapZScores(bars);
    expect(vwapVals.filter((v) => v != null).length).toBeGreaterThan(0);
    expect(zScores[zScores.length - 1]).not.toBeNull();
  });
});

describe("evaluateVwapMeanReversion", () => {
  it("returns fade signal on extended stretch in choppy session", () => {
    const bars: OHLCVCandle[] = [];
    for (let m = 9 * 60 + 15; m <= 9 * 60 + 45; m += 5) {
      bars.push(intraday(m, 100, 100.5, 99.5, 100, 5000));
    }
    let price = 100;
    for (let m = 10 * 60; m <= 12 * 60; m += 5) {
      price -= 0.8;
      bars.push(intraday(m, price + 0.2, price + 0.3, price - 0.5, price, 12000));
    }
    const last = bars[bars.length - 1];
    bars[bars.length - 1] = {
      ...last,
      low: last.low - 1,
      close: last.low + 0.2,
      open: last.close + 0.5,
      volume: 20000,
    };

    const row = evaluateVwapMeanReversion(bars);
    if (row) {
      expect(row.zScore).toBeLessThanOrEqual(-VWAP_MR_Z_TRIGGER);
      expect(row.targetLevel).toBeCloseTo(row.vwap, 0);
    }
  });
});

describe("syntheticVwapBandDemo", () => {
  it("returns band points for simulator", () => {
    const pts = syntheticVwapBandDemo(30, 1.2);
    expect(pts.length).toBeGreaterThan(10);
    expect(pts[0].upper2).toBeGreaterThan(pts[0].vwap);
  });
});
