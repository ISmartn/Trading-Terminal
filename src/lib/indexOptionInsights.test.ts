import { describe, it, expect } from "vitest";
import { buildIndexOptionInsight } from "./indexOptionInsights";
import {
  evaluateTrackOutcome,
  refreshHistoryTracking,
  saveInsightToHistory,
  clearInsightHistory,
  TRACK_MOVE_THRESHOLD_PCT,
} from "./indexInsightsHistory";
import type { OptionData } from "./mockData";

function row(strike: number, ceOI: number, peOI: number, ceChg = 0, peChg = 0): OptionData {
  const leg = (oi: number, chg: number) => ({
    ltp: 50,
    oi,
    oiChange: chg,
    volume: 1000,
    iv: 14,
    delta: 0.5,
    gamma: 0.01,
    theta: -1,
    vega: 1,
    bidPrice: 49,
    askPrice: 51,
  });
  return { strikePrice: strike, ce: leg(ceOI, ceChg), pe: leg(peOI, peChg) };
}

describe("buildIndexOptionInsight", () => {
  it("returns null for empty chain", () => {
    expect(buildIndexOptionInsight({ symbol: "NIFTY", chain: [], spotPrice: 24000, stepSize: 50 })).toBeNull();
  });

  it("leans bullish on high PCR and put OI buildup", () => {
    const chain = [
      row(23950, 80_000, 200_000, -5000, 20_000),
      row(24000, 60_000, 180_000, -3000, 15_000),
      row(24050, 90_000, 220_000, -2000, 18_000),
    ];
    const insight = buildIndexOptionInsight({
      symbol: "NIFTY",
      chain,
      spotPrice: 24000,
      stepSize: 50,
      oiMetrics: { pcrOI: 1.4, priorPcrOI: 1.2, pcrDelta: 0.2, totalCEOI: 1, totalPEOI: 1, totalCEOIChange: 0, totalPEOIChange: 0, snapshotAt: Date.now() },
    });
    expect(insight).not.toBeNull();
    expect(["bullish", "mixed"]).toContain(insight!.bias);
    expect(insight!.pcrOI).toBeGreaterThan(1);
    expect(insight!.bullets.length).toBeGreaterThan(2);
  });
});

describe("indexInsightsHistory", () => {
  beforeEach(() => clearInsightHistory());

  it("evaluates track outcomes", () => {
    expect(evaluateTrackOutcome("up", 0.5, TRACK_MOVE_THRESHOLD_PCT)).toBe("correct");
    expect(evaluateTrackOutcome("up", -0.5, TRACK_MOVE_THRESHOLD_PCT)).toBe("wrong");
    expect(evaluateTrackOutcome("down", -0.3, TRACK_MOVE_THRESHOLD_PCT)).toBe("correct");
    expect(evaluateTrackOutcome("up", 0.05, TRACK_MOVE_THRESHOLD_PCT)).toBe("range_hit");
  });

  it("saves and refreshes tracking", () => {
    const chain = [row(24000, 100_000, 150_000, 0, 5000), row(24050, 90_000, 140_000)];
    const insight = buildIndexOptionInsight({ symbol: "BANKNIFTY", chain, spotPrice: 51000, stepSize: 100 })!;
    saveInsightToHistory(insight);
    const refreshed = refreshHistoryTracking({ BANKNIFTY: 51100 });
    expect(refreshed.length).toBe(1);
    expect(refreshed[0].changePct).not.toBeNull();
    expect(refreshed[0].lastPrice).toBe(51100);
  });
});
