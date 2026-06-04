import { describe, it, expect } from "vitest";
import type { OHLCVCandle } from "@/hooks/useChartData";
import { htfRangePosition, scoreMultiDayConfluence } from "@/lib/strategyConfluence";

function c(day: number, o: number, h: number, l: number, cl: number, vol = 1000): OHLCVCandle {
  return { time: 1700000000 + day * 86400, open: o, high: h, low: l, close: cl, volume: vol };
}

describe("strategyConfluence", () => {
  it("scores higher at HTF discount for bullish pattern", () => {
    const history: OHLCVCandle[] = [];
    for (let i = 0; i < 17; i++) {
      history.push(c(i, 100 + i, 105 + i, 98 + i, 103 + i, 5000));
    }
    const c1 = c(17, 118, 120, 115, 119, 4000);
    const c2 = c(18, 119, 122, 118, 121, 4500);
    const c3 = c(19, 121, 125, 120, 124, 6000);
    const daily = [...history, c1, c2, c3];
    const result = scoreMultiDayConfluence("bullish", "three_white_soldiers", c1, c2, c3, daily);
    expect(result.score).toBeGreaterThan(0);
    expect(result.maxScore).toBe(7);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("htfRangePosition near low for discount zone", () => {
    const daily = [
      c(0, 100, 110, 90, 95),
      c(1, 95, 105, 92, 98),
      c(2, 98, 102, 94, 96),
      c(3, 96, 100, 91, 93),
      c(4, 93, 97, 90, 92),
    ];
    const pos = htfRangePosition(91, daily);
    expect(pos).not.toBeNull();
    expect(pos!).toBeLessThan(0.4);
  });
});
