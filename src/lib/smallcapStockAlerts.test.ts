import { describe, it, expect } from "vitest";
import { detectPollMoves, snapshotFromConstituents } from "./smallcapStockAlerts";
import type { SmallcapConstituent } from "./smallcapUniverse";

const row = (symbol: string, ltp: number, volume = 50_000): SmallcapConstituent => ({
  symbol,
  ltp,
  change: 0,
  changePercent: 0,
  open: ltp,
  high: ltp,
  low: ltp,
  prevClose: ltp,
  volume,
  indices: ["SC250"],
});

describe("detectPollMoves", () => {
  it("flags large short-window move", () => {
    const prev = snapshotFromConstituents([row("ABC", 100)], 1_000);
    const now = 6_000;
    const alerts = detectPollMoves(prev, [row("ABC", 100.5, 80_000)], now, 0.4);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe("up");
    expect(alerts[0].symbol).toBe("ABC");
    expect(alerts[0].movePoints).toBe(0.5);
    expect(alerts[0].headline).toContain("pts");
  });

  it("ignores small move", () => {
    const prev = snapshotFromConstituents([row("XYZ", 200)], 1_000);
    const alerts = detectPollMoves(prev, [row("XYZ", 200.2)], 6_000, 0.4);
    expect(alerts).toHaveLength(0);
  });
});
