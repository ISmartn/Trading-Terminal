import { useQuery } from "@tanstack/react-query";
import { fetchChartPatternDetect } from "@/lib/chartPatternApi";
import type { ChartPatternId } from "@/lib/chartPatternScan";

export function useChartPatternDetect(
  symbol: string,
  range: string,
  enabled: boolean,
  patterns?: ChartPatternId[],
) {
  return useQuery({
    queryKey: ["chart-pattern-detect", symbol, range, patterns?.join(",") ?? "all"],
    queryFn: () => fetchChartPatternDetect(symbol, patterns, range),
    enabled: enabled && !!symbol,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
