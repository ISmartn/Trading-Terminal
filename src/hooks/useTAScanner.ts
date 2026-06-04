import { useQuery } from "@tanstack/react-query";
import { fetchTAScanner, FNO_SCAN_SYMBOLS } from "@/lib/taIndicators";
import type { TAScannerRow } from "@/lib/taCompute";
import { computeIndicators, buildScannerSignal } from "@/lib/taCompute";
import { fetchHistorical } from "@/hooks/useChartData";

async function scanClientSide(symbols: string[]): Promise<TAScannerRow[]> {
  const rows: TAScannerRow[] = [];
  for (const symbol of symbols.slice(0, 25)) {
    try {
      const candles = await fetchHistorical(symbol, "3M");
      if (candles.length < 30) continue;
      const first = candles[0].close;
      const last = candles[candles.length - 1].close;
      const ta = computeIndicators(candles, ["rsi", "adx", "macd"]);
      const rsiVal = ta.summary?.rsi ?? null;
      const adxVal = ta.summary?.adx ?? null;
      const macdSignal = ta.summary?.macdSignal ?? "neutral";
      const { signal, signalType } = buildScannerSignal(rsiVal, adxVal, macdSignal);
      rows.push({
        symbol,
        ltp: last,
        changePercent: first ? ((last - first) / first) * 100 : 0,
        rsi: rsiVal,
        adx: adxVal,
        macdSignal,
        signal,
        signalType,
      });
    } catch {
      // skip
    }
  }
  return rows.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
}

export function useTAScanner(
  filter: "all" | "overbought" | "oversold" | "macd_bull" | "macd_bear" | "trending" = "all",
) {
  return useQuery({
    queryKey: ["ta-scanner", filter],
    queryFn: async () => {
      const server = await fetchTAScanner(FNO_SCAN_SYMBOLS, filter);
      if (server.length > 0) return server;
      const client = await scanClientSide(FNO_SCAN_SYMBOLS);
      return client.filter((row) => {
        if (filter === "overbought") return row.rsi != null && row.rsi > 70;
        if (filter === "oversold") return row.rsi != null && row.rsi < 30;
        if (filter === "macd_bull") return row.macdSignal === "bullish";
        if (filter === "macd_bear") return row.macdSignal === "bearish";
        if (filter === "trending") return row.adx != null && row.adx > 25;
        return true;
      });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
