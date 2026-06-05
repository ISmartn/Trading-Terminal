import { describe, it, expect } from "vitest";
import {
  buildSuddenMoveAlert,
  detectSuddenMove,
  priceAt,
  type PriceSample,
} from "./indexSuddenMove";

function samples(prices: number[], start = 1_000_000): PriceSample[] {
  return prices.map((ltp, i) => ({ ts: start + i * 5000, ltp }));
}

describe("detectSuddenMove", () => {
  it("flags 30s spike", () => {
    const s = samples([24000, 24000, 24000, 24055], 1_000_000);
    const move = detectSuddenMove(s, { pct15s: 0.5, pct30s: 0.2, pct60s: 0.5, pct3m: 1 }, 1_000_000 + 15000);
    expect(move).not.toBeNull();
    expect(move!.direction).toBe("up");
  });

  it("returns null for flat", () => {
    const s = samples([24000, 24001, 24000], 1_000_000);
    const move = detectSuddenMove(s, undefined, 1_000_000 + 10000);
    expect(move).toBeNull();
  });
});

describe("buildSuddenMoveAlert", () => {
  it("suggests CE on bullish spike", () => {
    const move = {
      window: "30s" as const,
      movePct: 0.25,
      movePoints: 60,
      direction: "up" as const,
      fromPrice: 24000,
      toPrice: 24060,
      lookbackMs: 30_000,
    };
    const alert = buildSuddenMoveAlert("NIFTY", move, 24060, 50, null);
    expect(alert.trade.primary).toContain("CE");
    expect(alert.headline).toContain("Nifty");
    expect(alert.indexOnly).toBe(false);
  });

  it("frames smallcap as index-only", () => {
    const move = {
      window: "60s" as const,
      movePct: -0.35,
      movePoints: -63,
      direction: "down" as const,
      fromPrice: 18000,
      toPrice: 17937,
      lookbackMs: 60_000,
    };
    const alert = buildSuddenMoveAlert("NIFTYSC100", move, 17937, 50, null);
    expect(alert.indexOnly).toBe(true);
    expect(alert.trade.primary).toContain("no NSE index options");
    expect(alert.label).toContain("Smallcap 100");
  });
});

describe("priceAt", () => {
  it("finds lookback price", () => {
    const s = [{ ts: 1000, ltp: 100 }, { ts: 20000, ltp: 110 }];
    expect(priceAt(s, 25000, 10000)).toBe(100);
  });
});
