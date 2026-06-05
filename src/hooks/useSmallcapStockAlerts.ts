import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { notifyUserAlert } from "@/lib/alertNotify";
import { INDEX_MOVE_SMALLCAP_POLL_MS } from "@/lib/dataRefreshPolicy";
import {
  alertCooldownKey,
  DEFAULT_STOCK_POLL_MOVE_PCT,
  detectPollMoves,
  snapshotFromConstituents,
  type SmallcapStockAlert,
  type StockPollSnapshot,
} from "@/lib/smallcapStockAlerts";
import {
  fetchSmallcapUniverse,
  type SmallcapConstituent,
  type SmallcapIndexKey,
} from "@/lib/smallcapUniverse";

const HISTORY_KEY = "smallcap-stock-move-alerts";
const MAX_HISTORY = 80;
const COOLDOWN_MS = 90_000;

function loadHistory(): SmallcapStockAlert[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SmallcapStockAlert[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: SmallcapStockAlert[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

async function fetchUniverseForFilter(filter: "all" | SmallcapIndexKey): Promise<SmallcapConstituent[]> {
  return fetchSmallcapUniverse(filter);
}

export function useSmallcapStockAlerts(options: {
  enabled?: boolean;
  minMovePct?: number;
  pollMs?: number;
  notifyToast?: boolean;
  indexFilter?: "all" | SmallcapIndexKey;
} = {}) {
  const {
    enabled = true,
    minMovePct = DEFAULT_STOCK_POLL_MOVE_PCT,
    pollMs = INDEX_MOVE_SMALLCAP_POLL_MS,
    notifyToast = true,
    indexFilter = "all",
  } = options;

  const prevRef = useRef<StockPollSnapshot | null>(null);
  const cooldownRef = useRef<Record<string, number>>({});
  const [activeAlerts, setActiveAlerts] = useState<SmallcapStockAlert[]>([]);
  const [history, setHistory] = useState<SmallcapStockAlert[]>(() => loadHistory());
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);

  const universeQuery = useQuery({
    queryKey: ["smallcap-universe", indexFilter],
    queryFn: () => fetchUniverseForFilter(indexFilter),
    enabled,
    refetchInterval: enabled ? pollMs : false,
    staleTime: 2_000,
    retry: 2,
  });

  const fireAlerts = useCallback(
    (alerts: SmallcapStockAlert[]) => {
      for (const alert of alerts) {
        const key = alertCooldownKey(alert);
        const last = cooldownRef.current[key] ?? 0;
        if (Date.now() - last < COOLDOWN_MS) continue;
        cooldownRef.current[key] = Date.now();

        setActiveAlerts((prev) => [alert, ...prev.filter((a) => a.symbol !== alert.symbol)].slice(0, 25));
        setHistory((prev) => {
          const next = [alert, ...prev.filter((a) => a.id !== alert.id)];
          saveHistory(next);
          return next;
        });

        notifyUserAlert({
          title: alert.headline,
          body: alert.notifyBody,
          tone: alert.direction === "up" ? "bullish" : "bearish",
          tag: alert.id,
          toast: notifyToast,
        });
      }
    },
    [notifyToast],
  );

  useEffect(() => {
    if (!enabled) return;
    const rows = universeQuery.data;
    if (!rows?.length) return;

    const now = Date.now();
    const moves = detectPollMoves(prevRef.current, rows, now, minMovePct);
    prevRef.current = snapshotFromConstituents(rows, now);
    setLastPollAt(now);

    if (moves.length > 0) fireAlerts(moves);
  }, [universeQuery.data, enabled, minMovePct, fireAlerts]);

  useEffect(() => {
    prevRef.current = null;
  }, [indexFilter]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setActiveAlerts([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  return {
    universeQuery,
    activeAlerts,
    history,
    lastPollAt,
    stockCount: universeQuery.data?.length ?? 0,
    clearHistory,
    refetchUniverse: universeQuery.refetch,
  };
}
