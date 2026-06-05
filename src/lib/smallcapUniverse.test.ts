import { describe, expect, it } from "vitest";
import {
  mergeConstituentUniverse,
  parseIndexConstituents,
  parseSmallcapUniverseResponse,
} from "./smallcapUniverse";

describe("parseSmallcapUniverseResponse", () => {
  it("parses proxy smallcap-universe payload", () => {
    const rows = parseSmallcapUniverseResponse({
      stocks: [
        {
          symbol: "RELIANCE",
          ltp: 100,
          change: 1,
          changePercent: 1,
          open: 99,
          high: 101,
          low: 98,
          prevClose: 99,
          volume: 0,
          indices: ["SC250"],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("RELIANCE");
  });
});

describe("parseIndexConstituents", () => {
  it("parses NSE equity-stockIndices shape", () => {
    const rows = parseIndexConstituents(
      {
        data: [{ symbol: "TCS", lastPrice: 3500, pChange: 0.5, open: 3490, dayHigh: 3510, dayLow: 3480, previousClose: 3485 }],
      },
      "SC50",
    );
    expect(rows[0]?.symbol).toBe("TCS");
    expect(rows[0]?.ltp).toBe(3500);
  });
});

describe("mergeConstituentUniverse", () => {
  it("merges index tags for same symbol", () => {
    const merged = mergeConstituentUniverse([
      {
        key: "SC50",
        rows: [
          {
            symbol: "ABC",
            ltp: 10,
            change: 0,
            changePercent: 0,
            open: 10,
            high: 10,
            low: 10,
            prevClose: 10,
            volume: 0,
            indices: ["SC50"],
          },
        ],
      },
      {
        key: "SC250",
        rows: [
          {
            symbol: "ABC",
            ltp: 11,
            change: 1,
            changePercent: 10,
            open: 10,
            high: 11,
            low: 9,
            prevClose: 10,
            volume: 0,
            indices: ["SC250"],
          },
        ],
      },
    ]);
    expect(merged[0].indices).toEqual(expect.arrayContaining(["SC50", "SC250"]));
    expect(merged[0].ltp).toBe(11);
  });
});
