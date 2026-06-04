import { useMemo } from "react";
import {
  useIndexRealtimeSpot,
  useProxyWebSocketStatus,
  useUpstoxFeedStatus,
  useWebSocketTick,
  type IndexIndicesFallback,
  type IndexRealtimeSpot,
} from "@/hooks/useWebSocket";
import {
  INDEX_MOVE_ALERT_LABELS,
  INDEX_MOVE_ALERT_SYMBOLS,
  type IndexMoveAlertSymbol,
} from "@/lib/indexMoveAlerts";

export interface MoveAlertIndexSpot extends IndexRealtimeSpot {
  symbol: IndexMoveAlertSymbol;
  label: string;
  high: number;
  low: number;
  open: number;
  lastTickAt: number | null;
}

export type MoveAlertRealtimeContext = {
  spots: MoveAlertIndexSpot[];
  proxyConnected: boolean;
  upstoxFeedConnected: boolean;
  anyLive: boolean;
  bySymbol: Record<IndexMoveAlertSymbol, MoveAlertIndexSpot | undefined>;
};

function useSpotForSymbol(
  symbol: IndexMoveAlertSymbol,
  chainSpots: Partial<Record<IndexMoveAlertSymbol, number>>,
  indicesBySymbol: Partial<Record<IndexMoveAlertSymbol, IndexIndicesFallback>>,
) {
  const tick = useWebSocketTick(symbol);
  const merged = useIndexRealtimeSpot(symbol, chainSpots[symbol] ?? 0, indicesBySymbol[symbol]);
  return { tick, merged };
}

/** Live spots for Index Move Alerts: F&O indices + Nifty Smallcap (NSE indices poll). */
export function useMoveAlertIndexRealtime(
  chainSpots: Partial<Record<IndexMoveAlertSymbol, number>> = {},
  indicesBySymbol: Partial<Record<IndexMoveAlertSymbol, IndexIndicesFallback>> = {},
): MoveAlertRealtimeContext {
  const proxyConnected = useProxyWebSocketStatus();
  const upstoxFeedConnected = useUpstoxFeedStatus();

  const nifty = useSpotForSymbol("NIFTY", chainSpots, indicesBySymbol);
  const bank = useSpotForSymbol("BANKNIFTY", chainSpots, indicesBySymbol);
  const sc50 = useSpotForSymbol("NIFTYSC50", chainSpots, indicesBySymbol);
  const sc100 = useSpotForSymbol("NIFTYSC100", chainSpots, indicesBySymbol);
  const sc250 = useSpotForSymbol("NIFTYSC250", chainSpots, indicesBySymbol);

  const packed = useMemo(
    () =>
      [
        ["NIFTY", nifty] as const,
        ["BANKNIFTY", bank] as const,
        ["NIFTYSC50", sc50] as const,
        ["NIFTYSC100", sc100] as const,
        ["NIFTYSC250", sc250] as const,
      ],
    [nifty, bank, sc50, sc100, sc250],
  );

  const spots = useMemo((): MoveAlertIndexSpot[] => {
    return packed.map(([symbol, { tick, merged }]) => {
      const idx = indicesBySymbol[symbol];
      const ltp = merged.spotPrice;
      return {
        symbol,
        label: INDEX_MOVE_ALERT_LABELS[symbol],
        ...merged,
        high: tick?.high ?? idx?.high ?? ltp,
        low: tick?.low ?? idx?.low ?? ltp,
        open: tick?.open ?? idx?.open ?? ltp,
        lastTickAt: tick?.timestamp ?? null,
      };
    });
  }, [packed, indicesBySymbol]);

  const bySymbol = useMemo(
    () =>
      Object.fromEntries(spots.map((s) => [s.symbol, s])) as Record<
        IndexMoveAlertSymbol,
        MoveAlertIndexSpot | undefined
      >,
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
