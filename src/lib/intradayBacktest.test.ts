import { describe, it, expect } from "vitest";
import type { OHLCVCandle } from "@/hooks/useChartData";
import { estimateRoundTripFuturesCosts } from "@/lib/indiaTradingCosts";
import { evaluateOiMomentum } from "@/lib/intradayAlpha";
import { backtestOrbMomentum } from "@/lib/intradayBacktest";

function intraday(minutes: number, open: number, high: number, low: number, close: number): OHLCVCandle {
  const base = new Date("2024-01-15T00:00:00+05:30").getTime() / 1000;
  return { time: base + minutes * 60, open, high, low, close, volume: 5000 };
}

describe("indiaTradingCosts", () => {
  it("charges more on round trip than zero", () => {
    const c = estimateRoundTripFuturesCosts(24000, 24050, 25);
    expect(c.total).toBeGreaterThan(0);
    expect(c.brokerage).toBe(40);
  });
});

describe("intradayAlpha OI rule", () => {
  it("fires long on blueprint conditions", () => {
    const sig = evaluateOiMomentum({
      spot: 24000,
      aboveVwap: true,
      totalCallOiChange: -50000,
      totalPutOiChange: 30000,
      pcr: 1.1,
      priorPcr: 1.0,
    });
    expect(sig.side).toBe("long");
    expect(sig.confidence).toBe("high");
  });
});

describe("intradayBacktest", () => {
  it("runs without error on synthetic uptrend session", () => {
    const bars: OHLCVCandle[] = [];
    for (let m = 9 * 60 + 15; m <= 9 * 60 + 45; m += 5) {
      bars.push(intraday(m, 100, 101, 99, 100.5));
    }
    for (let m = 9 * 60 + 50; m <= 11 * 60; m += 5) {
      const step = (m - (9 * 60 + 50)) / 5;
      const p = 101 + step * 0.4;
      bars.push(intraday(m, p, p + 0.5, p - 0.2, p + 0.3));
    }
    const result = backtestOrbMomentum(bars, { quantity: 25, slippagePointsPerLeg: 1 });
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(result.tradeCount).toBeGreaterThanOrEqual(0);
  });
});
