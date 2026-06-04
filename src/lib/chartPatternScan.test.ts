import { describe, expect, it } from "vitest";
import { CHART_PATTERN_OPTIONS, DEFAULT_CHART_PATTERN_IDS, patternLabel } from "./chartPatternScan";

describe("chartPatternScan types", () => {
  it("default pattern set is candlestick-only (five)", () => {
    expect(DEFAULT_CHART_PATTERN_IDS).toHaveLength(5);
  });

  it("includes structural formations in options", () => {
    expect(CHART_PATTERN_OPTIONS.some((o) => o.id === "CUP_AND_HANDLE")).toBe(true);
    expect(CHART_PATTERN_OPTIONS).toHaveLength(8);
  });

  it("patternLabel returns human label", () => {
    expect(patternLabel("BULLISH_ENGULFING")).toBe("Bullish engulfing");
  });
});
