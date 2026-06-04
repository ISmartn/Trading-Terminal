import { useMemo } from "react";
import {
  useIndexRealtimeSpot,
  useProxyWebSocketStatus,
  useUpstoxFeedStatus,
  useWebSocketTick,
  type IndexIndicesFallback,
  type IndexRealtimeSpot,
} from "@/hooks/useWebSocket";
import type { IndexInsightSymbol } from "@/lib/indexOptionInsights";

export interface DualIndexSpot extends IndexRealtimeSpot {
  symbol: IndexInsightSymbol;
  label: string;
  high: number;
  low: number;
  open: number;
  lastTickAt: number | null;
}

const LABELS: Record<IndexInsightSymbol, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Bank Nifty",
};

export type IndexRealtimeContext = {
  spots: DualIndexSpot[];
  proxyConnected: boolean;
  upstoxFeedConnected: boolean;
  anyLive: boolean;
  bySymbol: Record<IndexInsightSymbol, DualIndexSpot | undefined>;
};

/** Live Nifty 50 + Bank Nifty with WebSocket → indices poll → chain fallbacks. */
export function useDualIndexRealtime(
  chainSpots: Partial<Record<IndexInsightSymbol, number>> = {},
  indicesBySymbol: Partial<Record<IndexInsightSymbol, IndexIndicesFallback>> = {},
): IndexRealtimeContext {
  const proxyConnected = useProxyWebSocketStatus();
  const upstoxFeedConnected = useUpstoxFeedStatus();
  const niftyTick = useWebSocketTick("NIFTY");
  const bankTick = useWebSocketTick("BANKNIFTY");
  const niftyMerged = useIndexRealtimeSpot("NIFTY", chainSpots.NIFTY ?? 0, indicesBySymbol.NIFTY);
  const bankMerged = useIndexRealtimeSpot("BANKNIFTY", chainSpots.BANKNIFTY ?? 0, indicesBySymbol.BANKNIFTY);

  const spots = useMemo((): DualIndexSpot[] => {
    const pack = (symbol: IndexInsightSymbol, merged: IndexRealtimeSpot, tick: typeof niftyTick): DualIndexSpot => {
      const idx = indicesBySymbol[symbol];
      const ltp = merged.spotPrice;
      return {
        symbol,
        label: LABELS[symbol],
        ...merged,
        high: tick?.high ?? idx?.high ?? ltp,
        low: tick?.low ?? idx?.low ?? ltp,
        open: tick?.open ?? idx?.open ?? ltp,
        lastTickAt: tick?.timestamp ?? null,
      };
    };
    return [
      pack("NIFTY", niftyMerged, niftyTick),
      pack("BANKNIFTY", bankMerged, bankTick),
    ];
  }, [niftyMerged, bankMerged, niftyTick, bankTick, indicesBySymbol]);

  const bySymbol = useMemo(
    () =>
      Object.fromEntries(spots.map((s) => [s.symbol, s])) as Record<IndexInsightSymbol, DualIndexSpot | undefined>,
    [spots],
  );

  return {
    spots,
    proxyConnected,
    upstoxFeedConnected,
    anyLive: spots.some((s) => s.isLive),
    bySymbol,
  };
}
