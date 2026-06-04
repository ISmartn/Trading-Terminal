import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchHistorical, preloadInstrumentCache } from "@/hooks/useChartData";
import {
  evaluateThreeCandleRule,
  filterThreeCandleRows,
  resolveThreeCandleScanSymbols,
  sortThreeCandleRows,
  type ThreeCandlePatternFilter,
  type ThreeCandleStatusFilter,
  type ThreeCandleScanRow,
  DEFAULT_CLOSE_TOLERANCE,
} from "@/lib/threeCandleRule";

const SCAN_CONCURRENCY = 5;

export interface ThreeCandleScanResult {
  rows: ThreeCandleScanRow[];
  symbolCount: number;
}

async function scanOneSymbol(
  symbol: string,
  tolerance: number,
): Promise<ThreeCandleScanRow[]> {
  try {
    const candles = await fetchHistorical(symbol, "3M");
    const matches = evaluateThreeCandleRule(candles, tolerance);
    return matches.map((match) => ({ ...match, symbol }));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[3-candle-scanner]", symbol, err);
    }
    return [];
  }
}

async function scanSymbols(symbols: string[], tolerance: number): Promise<ThreeCandleScanRow[]> {
  const rows: ThreeCandleScanRow[] = [];

  for (let i = 0; i < symbols.length; i += SCAN_CONCURRENCY) {
    const chunk = symbols.slice(i, i + SCAN_CONCURRENCY);
    const batch = await Promise.all(chunk.map((symbol) => scanOneSymbol(symbol, tolerance)));
    for (const matches of batch) {
      rows.push(...matches);
    }
    if (i + SCAN_CONCURRENCY < symbols.length) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  return sortThreeCandleRows(rows);
}

export function useThreeCandleScanner(
  patternFilter: ThreeCandlePatternFilter = "popular",
  statusFilter: ThreeCandleStatusFilter = "all",
  tolerance = DEFAULT_CLOSE_TOLERANCE,
) {
  return useQuery({
    queryKey: ["three-candle-scanner", patternFilter, statusFilter, tolerance],
    queryFn: async (): Promise<ThreeCandleScanResult> => {
      const symbols = await resolveThreeCandleScanSymbols(patternFilter);
      await preloadInstrumentCache();
      const all = await scanSymbols(symbols, tolerance);
      return {
        rows: filterThreeCandleRows(all, patternFilter, statusFilter),
        symbolCount: symbols.length,
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
