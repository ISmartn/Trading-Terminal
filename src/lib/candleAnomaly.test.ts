import { describe, it, expect } from "vitest";
import {
  appendCandle,
  atmStrike,
  evaluateAnomalyGates,
  formatOutboundAlert,
  normalizeTicker,
  type OhlcvCandle,
} from "./candleAnomaly";

function quietBuffer(start: number, n = 25): OhlcvCandle[] {
  const buf: OhlcvCandle[] = [];
  for (let i = 0; i < n; i++) {
    const base = 24000 + i * 0.5;
    buf.push({
      timestamp: start + i * 60_000,
      ticker: "NIFTY",
      open: base,
      high: base + 5,
      low: base - 5,
      close: base + 1,
      volume: 100_000,
    });
  }
  return buf;
}

describe("normalizeTicker", () => {
  it("maps index names", () => {
    expect(normalizeTicker("Nifty 50")).toBe("NIFTY");
    expect(normalizeTicker("NIFTY BANK")).toBe("BANKNIFTY");
    expect(normalizeTicker("NIFTY SMALLCAP 50")).toBe("NIFTYSC50");
    expect(normalizeTicker("NIFTY SMALLCAP 100")).toBe("NIFTYSC100");
    expect(normalizeTicker("NIFTY SMALLCAP 250")).toBe("NIFTYSC250");
  });
});

describe("evaluateAnomalyGates", () => {
  it("passes on range and volume spike", () => {
    const buf = quietBuffer(1_700_000_000_000);
    const spike: OhlcvCandle = {
      timestamp: buf[buf.length - 1].timestamp + 60_000,
      ticker: "NIFTY",
      open: 24050,
      high: 24180,
      low: 24040,
      close: 24170,
      volume: 500_000,
    };
    const gates = evaluateAnomalyGates(buf, spike);
    expect(gates.passed).toBe(true);
  });

  it("fails on calm candle", () => {
    const buf = quietBuffer(1_700_000_000_000);
    const calm: OhlcvCandle = {
      timestamp: buf[buf.length - 1].timestamp + 60_000,
      ticker: "NIFTY",
      open: 24020,
      high: 24025,
      low: 24018,
      close: 24022,
      volume: 110_000,
    };
    expect(evaluateAnomalyGates(buf, calm).passed).toBe(false);
  });
});

describe("formatOutboundAlert", () => {
  it("formats CE on bullish bar", () => {
    const alert = formatOutboundAlert(
      {
        timestamp: 1,
        ticker: "NIFTY",
        open: 100,
        high: 120,
        low: 99,
        close: 115,
        volume: 1,
      },
      { range: 21, atr: 5, volumeSma: 1000 },
      50,
    );
    expect(alert.action).toContain("CE");
    expect(alert.stopLoss).toBe(99);
    expect(atmStrike(24123, 50)).toBe(24100);
  });
});

describe("appendCandle", () => {
  it("trims buffer", () => {
    const buf = quietBuffer(0, 5);
    const next = appendCandle(buf, buf[0], 3);
    expect(next).toHaveLength(3);
  });
});
