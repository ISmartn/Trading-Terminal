import { describe, expect, it } from "vitest";
import { evaluateThreeCandleRule, filterThreeCandleRows } from "./threeCandleRule";
import type { OHLCVCandle } from "@/hooks/useChartData";

function c(open: number, high: number, low: number, close: number, time: number): OHLCVCandle {
  return { time, open, high, low, close };
}

describe("evaluateThreeCandleRule", () => {
  it("detects bullish confirmed setup", () => {
    const candles = [
      c(100, 110, 98, 109, 1),
      c(108, 109, 105, 107, 2),
      c(107, 112, 106, 111, 3),
    ];
    const rows = evaluateThreeCandleRule(candles, 0.15);
    expect(rows).toHaveLength(1);
    expect(rows[0].side).toBe("bullish");
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].stopLoss).toBe(105);
  });

  it("detects bearish setup forming", () => {
    const candles = [
      c(100, 102, 90, 91, 1),
      c(92, 94, 91, 93, 2),
      c(93, 95, 92, 94, 3),
    ];
    const rows = evaluateThreeCandleRule(candles, 0.15);
    expect(rows.some((r) => r.side === "bearish" && r.status === "setup")).toBe(true);
  });

  it("filters all, bullish, and bearish patterns", () => {
    const rows = [
      { symbol: "NIFTY", side: "bullish" as const, status: "confirmed" as const },
      { symbol: "ZOMATO", side: "bearish" as const, status: "setup" as const },
    ].map((r) => ({
      ...r,
      ltp: 1,
      day1High: 1,
      day1Low: 1,
      day1Close: 1,
      day1Mid: 1,
      day2High: 1,
      day2Low: 1,
      day3High: 1,
      day3Low: 1,
      day3Close: 1,
      entryLevel: 1,
      stopLoss: 1,
      targetLevel: 1,
      label: "",
    }));

    expect(filterThreeCandleRows(rows, "all", "all")).toHaveLength(2);
    expect(filterThreeCandleRows(rows, "bullish", "all")).toHaveLength(1);
    expect(filterThreeCandleRows(rows, "bearish", "all")).toHaveLength(1);
  });
});
