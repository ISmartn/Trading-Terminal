/**
 * React Hooks for Upstox live market data
 * 
 * These hooks consume the MarketWebSocket singleton and provide
 * real-time ticking data to dashboard components.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { marketWS, SYMBOL_TO_SECURITY_ID, type TickData } from "@/lib/websocketClient";
import { isSpotTrackedIndexSymbol } from "@/lib/indexMoveAlerts";
import { isSpotSourceDebugEnabled, recordSpotSource } from "@/lib/spotSourceDebug";
import { UPSTOX_WS_INDEX_SYMBOLS } from "@/lib/upstoxLiveFeed";

const DEFAULT_FRESH_INDEX_SYMBOLS = UPSTOX_WS_INDEX_SYMBOLS;

/** Re-check tick freshness on an interval so UI falls back to REST when Upstox stalls. */
export function useAnyFreshIndexTick(
  symbols: readonly string[] = DEFAULT_FRESH_INDEX_SYMBOLS,
): boolean {
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setClock((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () =>
      symbols.some((symbol) => {
        const secId = SYMBOL_TO_SECURITY_ID[symbol];
        return secId != null && marketWS.isTickFresh(secId);
      }),
    [symbols, clock],
  );
}

// ── Hook: WebSocket / feed status ──

/** Browser ↔ proxy WebSocket pipe open. */
export function useProxyWebSocketStatus() {
  const [isConnected, setIsConnected] = useState(marketWS.isConnected);

  useEffect(() => marketWS.onProxyStatus(setIsConnected), []);

  return isConnected;
}

/** Upstox LTP poll active on proxy (needs token in .env or Broker Settings). */
export function useUpstoxFeedStatus() {
  const [isConnected, setIsConnected] = useState(marketWS.isUpstoxConnected);

  useEffect(() => marketWS.onFeedStatus(setIsConnected), []);

  return isConnected;
}

/** @deprecated Prefer useUpstoxFeedStatus — kept for dashboard “LIVE” badges. */
export function useWebSocketStatus() {
  return useUpstoxFeedStatus();
}

// ── Hook: Single Instrument Tick ──

export function useWebSocketTick(symbol: string): TickData | null {
  const securityId = SYMBOL_TO_SECURITY_ID[symbol];
  const [tick, setTick] = useState<TickData | null>(() => {
    return securityId ? marketWS.getLatest(securityId) || null : null;
  });

  useEffect(() => {
    if (!securityId) return;
    return marketWS.subscribe(securityId, setTick);
  }, [securityId]);

  return tick;
}

export type IndexSpotSource = "websocket" | "indices" | "chain";

export interface IndexIndicesFallback {
  ltp: number;
  change: number;
  changePercent: number;
  high?: number;
  low?: number;
  open?: number;
  isLive?: boolean;
}

export interface IndexRealtimeSpot {
  spotPrice: number;
  change: number;
  changePercent: number;
  isLive: boolean;
  source: IndexSpotSource;
}

/** Real-time Nifty / Bank Nifty LTP: WebSocket tick → indices poll → OI chain spot. */
export function useIndexRealtimeSpot(
  symbol: string,
  chainSpot = 0,
  indicesFallback?: IndexIndicesFallback | null,
): IndexRealtimeSpot {
  const tick = useWebSocketTick(symbol);
  const isIndex = isSpotTrackedIndexSymbol(symbol);
  const secId = SYMBOL_TO_SECURITY_ID[symbol];

  const spot = useMemo(() => {
    const tickFresh =
      isIndex &&
      secId != null &&
      tick?.ltp != null &&
      tick.ltp > 0 &&
      marketWS.isTickFresh(secId);

    if (tickFresh && tick?.ltp) {
      return {
        spotPrice: tick.ltp,
        change: tick.change ?? 0,
        changePercent: tick.changePercent ?? 0,
        isLive: true,
        source: "websocket" as const,
      };
    }

    if (isIndex && indicesFallback && indicesFallback.ltp > 0) {
      return {
        spotPrice: indicesFallback.ltp,
        change: indicesFallback.change,
        changePercent: indicesFallback.changePercent,
        isLive: !!indicesFallback.isLive,
        source: "indices" as const,
      };
    }

    if (chainSpot > 0) {
      return {
        spotPrice: chainSpot,
        change: 0,
        changePercent: 0,
        isLive: false,
        source: "chain" as const,
      };
    }
    return {
      spotPrice: 0,
      change: 0,
      changePercent: 0,
      isLive: false,
      source: "chain" as const,
    };
  }, [isIndex, tick, chainSpot, indicesFallback, secId]);

  useEffect(() => {
    if (!isSpotSourceDebugEnabled() || spot.spotPrice <= 0) return;
    recordSpotSource(symbol, spot.source, spot.spotPrice);
  }, [symbol, spot.source, spot.spotPrice]);

  return spot;
}

// ── Hook: All Index Ticks (NIFTY, BANKNIFTY, etc.) ──

export interface WebSocketIndexData {
  symbol: string;
  name: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
}

const INDEX_NAMES: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  NIFTYSC50: "NIFTY SMALLCAP 50",
  NIFTYSC100: "NIFTY SMALLCAP 100",
  NIFTYSC250: "NIFTY SMALLCAP 250",
  INDIAVIX: "INDIA VIX",
  SENSEX: "SENSEX",
};

export function useWebSocketIndices(): { indices: WebSocketIndexData[]; isConnected: boolean } {
  const isConnected = useProxyWebSocketStatus();
  const [tickMap, setTickMap] = useState<Map<number, TickData>>(new Map());

  useEffect(() => {
    // Subscribe to all index ticks
    const indexSymbols = [...UPSTOX_WS_INDEX_SYMBOLS];
    const unsubscribers: (() => void)[] = [];

    for (const symbol of indexSymbols) {
      const secId = SYMBOL_TO_SECURITY_ID[symbol];
      if (!secId) continue;

      const unsub = marketWS.subscribe(secId, (data) => {
        setTickMap((prev) => {
          const next = new Map(prev);
          next.set(secId, data);
          return next;
        });
      });
      unsubscribers.push(unsub);
    }

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  const indices = useMemo(() => {
    const result: WebSocketIndexData[] = [];
    for (const [symbol, name] of Object.entries(INDEX_NAMES)) {
      const secId = SYMBOL_TO_SECURITY_ID[symbol];
      const tick = tickMap.get(secId);
      if (tick?.ltp && secId != null && marketWS.isTickFresh(secId)) {
        result.push({
          symbol,
          name,
          ltp: tick.ltp,
          change: tick.change || 0,
          changePercent: tick.changePercent || 0,
          open: tick.open || tick.ltp,
          high: tick.high || tick.ltp,
          low: tick.low || tick.ltp,
          prevClose: tick.prevClose || tick.close || tick.ltp,
        });
      }
    }
    return result;
  }, [tickMap]);

  return { indices, isConnected };
}

// ── Hook: VIX Real-time ──

export interface WebSocketVixData {
  value: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
}

export function useWebSocketVix(): { vix: WebSocketVixData | null; isConnected: boolean } {
  const isConnected = useUpstoxFeedStatus();
  const tick = useWebSocketTick("INDIAVIX");

  const vix = useMemo(() => {
    if (!tick?.ltp) return null;
    return {
      value: tick.ltp,
      change: tick.change || 0,
      changePercent: tick.changePercent || 0,
      high: tick.high || tick.ltp,
      low: tick.low || tick.ltp,
    };
  }, [tick]);

  return { vix, isConnected };
}

// ── Hook: Force reconnect ──

export function useWebSocketReconnect() {
  return useCallback(() => {
    marketWS.disconnect();
    setTimeout(() => marketWS.connect(), 200);
  }, []);
}
