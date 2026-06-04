import { describe, expect, it, vi } from "vitest";
import {
  clearCandleCache,
  fetchCandlesWithCache,
  getCachedCandles,
  setCachedCandles,
} from "@/lib/candleCache";

describe("candleCache", () => {
  it("returns cached candles within TTL", () => {
    clearCandleCache();
    const candles = [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 10 }];
    setCachedCandles("RELIANCE", "3M", "D", candles);
    expect(getCachedCandles("RELIANCE", "3M", "D")).toEqual(candles);
  });

  it("deduplicates concurrent fetches", async () => {
    clearCandleCache();
    const fetcher = vi.fn(async () => [{ time: 2, open: 3, high: 4, low: 2, close: 4 }]);

    const [a, b] = await Promise.all([
      fetchCandlesWithCache("TCS", "3M", "D", fetcher),
      fetchCandlesWithCache("TCS", "3M", "D", fetcher),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});
