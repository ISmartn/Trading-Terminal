import { describe, it, expect } from "vitest";
import { parseUpstoxOptionChain, parseNSEOptionChain } from "@/lib/marketApi";

describe("parseUpstoxOptionChain", () => {
  it("returns empty chain for null/undefined input", () => {
    const result = parseUpstoxOptionChain(null as any);
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(0);
  });

  it("returns empty chain for empty data array", () => {
    const result = parseUpstoxOptionChain({
      data: [],
      status: "success",
    });
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(0);
  });

  it("parses Upstox option chain format with greeks", () => {
    const result = parseUpstoxOptionChain({
      status: "success",
      data: [
        {
          strike_price: 24000,
          underlying_spot_price: 24100,
          call_options: {
            market_data: { ltp: 150, oi: 500000, volume: 100000, bid_price: 149, ask_price: 151, prev_oi: 490000 },
            option_greeks: { iv: 15.5, delta: 0.55, gamma: 0.01, theta: -5, vega: 10 },
          },
          put_options: {
            market_data: { ltp: 80, oi: 600000, volume: 80000, bid_price: 79, ask_price: 81, prev_oi: 610000 },
            option_greeks: { iv: 16.2, delta: -0.45, gamma: 0.01, theta: -4, vega: 9 },
          },
        },
        {
          strike_price: 24200,
          underlying_spot_price: 24100,
          call_options: {
            market_data: { ltp: 50, oi: 300000, volume: 60000, prev_oi: 300000 },
            option_greeks: { iv: 14.8, delta: 0.35, gamma: 0.008, theta: -3, vega: 8 },
          },
          put_options: {
            market_data: { ltp: 200, oi: 400000, volume: 90000, prev_oi: 400000 },
            option_greeks: { iv: 17.1, delta: -0.65, gamma: 0.008, theta: -6, vega: 11 },
          },
        },
      ],
    });

    expect(result.chain).toHaveLength(2);
    expect(result.spotPrice).toBe(24100);
    expect(result.chain[0].strikePrice).toBe(24000);
    expect(result.chain[0].ce.ltp).toBe(150);
    expect(result.chain[0].ce.iv).toBe(15.5);
    expect(result.chain[0].ce.delta).toBe(0.55);
    expect(result.chain[0].ce.oiChange).toBe(10000);
    expect(result.totalCEOI).toBe(800000);
    expect(result.totalPEOI).toBe(1000000);
  });

  it("sorts chain by strike price ascending", () => {
    const result = parseUpstoxOptionChain({
      status: "success",
      data: [
        { strike_price: 24200, call_options: { market_data: { ltp: 10 } }, put_options: { market_data: { ltp: 10 } } },
        { strike_price: 23800, call_options: { market_data: { ltp: 10 } }, put_options: { market_data: { ltp: 10 } } },
        { strike_price: 24000, call_options: { market_data: { ltp: 10 } }, put_options: { market_data: { ltp: 10 } } },
      ],
    });
    expect(result.chain.map(r => r.strikePrice)).toEqual([23800, 24000, 24200]);
  });
});

describe("parseNSEOptionChain", () => {
  it("returns empty for malformed input", () => {
    const result = parseNSEOptionChain({} as any);
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(0);
  });

  it("parses standard NSE response format", () => {
    const result = parseNSEOptionChain({
      records: {
        expiryDates: ["08-May-2026", "15-May-2026"],
        strikePrices: [24000, 24100],
        data: [
          {
            strikePrice: 24000,
            expiryDate: "08-May-2026",
            CE: { lastPrice: 150, openInterest: 500000, changeinOpenInterest: 10000, totalTradedVolume: 100000, impliedVolatility: 15.5, bidprice: 149, askPrice: 151, underlyingValue: 24050 },
            PE: { lastPrice: 80, openInterest: 600000, changeinOpenInterest: -5000, totalTradedVolume: 80000, impliedVolatility: 16, bidprice: 79, askPrice: 81, underlyingValue: 24050 },
          },
          {
            strikePrice: 24100,
            expiryDate: "08-May-2026",
            CE: { lastPrice: 100, openInterest: 300000, changeinOpenInterest: 8000, totalTradedVolume: 60000, impliedVolatility: 14.5, bidprice: 99, askPrice: 101, underlyingValue: 24050 },
            PE: { lastPrice: 130, openInterest: 400000, changeinOpenInterest: 12000, totalTradedVolume: 70000, impliedVolatility: 17, bidprice: 129, askPrice: 131, underlyingValue: 24050 },
          },
        ],
      },
      filtered: {
        CE: { totOI: 800000, totVol: 160000 },
        PE: { totOI: 1000000, totVol: 150000 },
      },
    });

    expect(result.chain).toHaveLength(2);
    expect(result.spotPrice).toBe(24050);
    expect(result.expiries).toHaveLength(2);
    expect(result.totalCEOI).toBe(800000);
    expect(result.totalPEOI).toBe(1000000);
    expect(result.chain[0].ce.ltp).toBe(150);
    expect(result.chain[0].pe.oiChange).toBe(-5000);
  });
});
