import { useQuery } from "@tanstack/react-query";
import { fetchLiveIndices } from "@/lib/marketApi";
import { INDEX_MOVE_SMALLCAP_POLL_MS } from "@/lib/dataRefreshPolicy";
import {
  INDEX_ONLY_MOVE_SYMBOLS,
  type IndexMoveAlertSymbol,
} from "@/lib/indexMoveAlerts";
import type { IndexIndicesFallback } from "@/hooks/useWebSocket";
/**
 * NSE fallback poll for Nifty Smallcap 50/100/250 when Upstox WS ticks are stale.
 * Primary spot is Upstox Market WS (NSE_INDEX|NIFTY SMLCAP *).
 */
export function useMoveAlertSmallcapIndices() {
  return useQuery({
    queryKey: ["nse-indices", "move-alert-smallcap"],
    queryFn: async () => {
      try {
        const data = await fetchLiveIndices();
        const bySymbol: Partial<Record<IndexMoveAlertSymbol, IndexIndicesFallback>> = {};
        for (const idx of data) {
          if (!INDEX_ONLY_MOVE_SYMBOLS.has(idx.symbol as IndexMoveAlertSymbol)) continue;
          bySymbol[idx.symbol as IndexMoveAlertSymbol] = {
            ltp: idx.ltp,
            change: idx.change,
            changePercent: idx.changePercent,
            high: idx.high,
            low: idx.low,
            open: idx.open,
            isLive: true,
          };
        }
        return { bySymbol, fetchedAt: Date.now() };
      } catch (e) {
        console.warn("Smallcap indices fetch failed:", e);
        return { bySymbol: {}, fetchedAt: 0 };
      }
    },
    refetchInterval: INDEX_MOVE_SMALLCAP_POLL_MS,
    staleTime: 2_000,
    retry: 1,
  });
}
