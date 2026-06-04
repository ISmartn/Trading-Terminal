import { describe, it, expect } from "vitest";
import type { OHLCVCandle } from "@/hooks/useChartData";
import {
  detectAbsorption,
  footprintProxy,
  approximateCvd,
  resolveOrderFlowBias,
} from "@/lib/orderFlowSignals";

function bar(
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  t = 1700000000,
): OHLCVCandle {
  return { time: t, open, high, low, close, volume };
}

describe("footprintProxy", () => {
  it("assigns more ask volume when close near high", () => {
    const fp = footprintProxy(bar(100, 110, 100, 108, 1000));
    expect(fp.askVolumeProxy).toBeGreaterThan(fp.bidVolumeProxy);
    expect(fp.delta).toBeGreaterThan(0);
  });
});

describe("detectAbsorption", () => {
  it("flags selling absorption when sell effort fails to push price down", () => {
    const c = bar(94.5, 98, 94, 95.2, 5000);
    const ev = detectAbsorption(c, 2000);
    expect(ev?.kind).toBe("selling_absorption");
  });
});

describe("resolveOrderFlowBias", () => {
  it("returns mixed when buying absorption conflicts with bullish CVD", () => {
    expect(resolveOrderFlowBias("buying_absorption", "bullish")).toBe("mixed");
  });

  it("returns long when selling absorption aligns with bullish CVD", () => {
    expect(resolveOrderFlowBias("selling_absorption", "bullish")).toBe("long");
  });
});

describe("approximateCvd", () => {
  it("accumulates signed delta", () => {
    const session = [
      bar(100, 101, 99, 100.5, 1000, 1),
      bar(100.5, 101, 99, 100, 1000, 2),
    ];
    const cvd = approximateCvd(session);
    expect(cvd.length).toBe(2);
    expect(typeof cvd[1]).toBe("number");
  });
});
