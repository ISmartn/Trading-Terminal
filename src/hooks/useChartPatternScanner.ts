import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchChartPatternScan, type ChartPatternScanResponse } from "@/lib/chartPatternApi";
import { getSessionJSON } from "@/lib/sessionCache";
import {
  CHART_PATTERN_SCAN_INTERVAL,
  CHART_PATTERN_SCAN_RANGE,
  type ChartPatternId,
  type ChartPatternScanRow,
} from "@/lib/chartPatternScan";
import {
  CHART_PATTERN_INDEX_TABS,
  type ChartPatternIndexKey,
} from "@/lib/indexConstituents";

export interface ChartPatternScanResult {
  rows: ChartPatternScanRow[];
  symbolCount: number;
  indexLabel: string;
  engine?: string;
  fromCache?: boolean;
  cacheLayer?: string;
  cachedAt?: number;
}

export function useChartPatternScanner(
  indexTab: ChartPatternIndexKey,
  selectedPatterns: ChartPatternId[],
) {
  const patternKey = [...selectedPatterns].sort().join(",");

  const sessionScanKey = `chart-pattern-scan:${indexTab}:${CHART_PATTERN_SCAN_RANGE}:${patternKey}`;

  return useQuery({
    queryKey: [
      "chart-pattern-scanner",
      indexTab,
      patternKey,
      CHART_PATTERN_SCAN_RANGE,
      CHART_PATTERN_SCAN_INTERVAL,
      "talib",
    ],
    queryFn: async (): Promise<ChartPatternScanResult> => {
      if (!selectedPatterns.length) {
        return { rows: [], symbolCount: 0, indexLabel: CHART_PATTERN_INDEX_TABS[indexTab].label };
      }
      const data = await fetchChartPatternScan(
        indexTab,
        selectedPatterns,
        CHART_PATTERN_SCAN_RANGE,
      );
      return {
        rows: data.rows ?? [],
        symbolCount: data.symbolCount ?? 0,
        indexLabel: data.indexLabel ?? CHART_PATTERN_INDEX_TABS[indexTab].label,
        engine: data.engine,
        fromCache: data.fromCache,
        cacheLayer: data.cacheLayer,
        cachedAt: data.cachedAt,
      };
    },
    enabled: selectedPatterns.length > 0,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    placeholderData: keepPreviousData,
    initialData: () => {
      const cached = getSessionJSON<ChartPatternScanResponse>(sessionScanKey, 15 * 60 * 1000);
      if (!cached?.rows?.length) return undefined;
      return {
        rows: cached.rows,
        symbolCount: cached.symbolCount ?? 0,
        indexLabel: cached.indexLabel ?? CHART_PATTERN_INDEX_TABS[indexTab].label,
        engine: cached.engine,
        fromCache: true,
        cacheLayer: "session",
        cachedAt: cached.cachedAt,
      };
    },
    refetchOnWindowFocus: false,
  });
}
