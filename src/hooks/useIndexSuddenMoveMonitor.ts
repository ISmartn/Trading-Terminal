import { useCallback, useEffect, useRef, useState } from "react";
import { notifyUserAlert, requestBrowserNotifyPermission } from "@/lib/alertNotify";
import { buildIndexOptionInsight } from "@/lib/indexOptionInsights";
import {
  INDEX_MOVE_ALERT_SYMBOLS,
  MOVE_ALERT_STRIKE_STEP,
  isFoMoveSymbol,
  type IndexFoMoveSymbol,
  type IndexMoveAlertSymbol,
} from "@/lib/indexMoveAlerts";
import {
  alertCooldownKey,
  buildSuddenMoveAlert,
  detectSuddenMove,
  DEFAULT_MOVE_THRESHOLDS,
  type PriceSample,
  type SuddenMoveAlert,
  type SuddenMoveThresholds,
} from "@/lib/indexSuddenMove";
import type { MoveAlertIndexSpot } from "@/hooks/useMoveAlertIndexRealtime";
import type { LiveOptionChainData } from "@/hooks/useMarketData";

const HISTORY_KEY = "index-sudden-move-alerts";
const MAX_HISTORY = 50;
const COOLDOWN_MS = 90_000;

function loadHistory(): SuddenMoveAlert[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SuddenMoveAlert[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: SuddenMoveAlert[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

export interface IndexChainBundle {
  symbol: IndexFoMoveSymbol;
  chainData: LiveOptionChainData | null | undefined;
}

export function useIndexSuddenMoveMonitor(
  spots: MoveAlertIndexSpot[],
  chains: IndexChainBundle[],
  options: {
    enabled?: boolean;
    thresholds?: SuddenMoveThresholds;
    notifyToast?: boolean;
    cooldownMs?: number;
  } = {},
) {
  const {
    enabled = true,
    thresholds = DEFAULT_MOVE_THRESHOLDS,
    notifyToast = true,
    cooldownMs = COOLDOWN_MS,
  } = options;

  const samplesRef = useRef<Record<IndexMoveAlertSymbol, PriceSample[]>>(
    Object.fromEntries(INDEX_MOVE_ALERT_SYMBOLS.map((s) => [s, []])) as Record<
      IndexMoveAlertSymbol,
      PriceSample[]
    >,
  );
  const cooldownRef = useRef<Record<string, number>>({});
  const [history, setHistory] = useState<SuddenMoveAlert[]>(() => loadHistory());
  const [activeAlerts, setActiveAlerts] = useState<SuddenMoveAlert[]>([]);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);

  const pushSample = useCallback((symbol: IndexMoveAlertSymbol, ltp: number) => {
    if (ltp <= 0) return;
    const now = Date.now();
    const buf = samplesRef.current[symbol];
    buf.push({ ts: now, ltp });
    const cutoff = now - 300_000;
    while (buf.length > 0 && buf[0].ts < cutoff) buf.shift();
    if (buf.length > 400) buf.splice(0, buf.length - 400);
  }, []);

  const fireAlert = useCallback(
    (alert: SuddenMoveAlert) => {
      const key = alertCooldownKey(alert);
      const last = cooldownRef.current[key] ?? 0;
      if (Date.now() - last < cooldownMs) return;

      cooldownRef.current[key] = Date.now();
      setActiveAlerts((prev) => [alert, ...prev].slice(0, 10));
      setHistory((prev) => {
        const next = [alert, ...prev.filter((a) => a.id !== alert.id)];
        saveHistory(next);
        return next;
      });

      notifyUserAlert({
        title: alert.headline,
        body: `${alert.trade.primary} — ${alert.trade.rationale}`,
        tone: alert.expectedDirection === "up" ? "bullish" : "bearish",
        tag: alert.id,
        toast: notifyToast,
      });
    },
    [cooldownMs, notifyToast],
  );

  useEffect(() => {
    if (!enabled) return;

    const now = Date.now();
    setLastCheckAt(now);

    for (const symbol of INDEX_MOVE_ALERT_SYMBOLS) {
      const spot = spots.find((s) => s.symbol === symbol);
      const ltp = spot?.spotPrice ?? 0;
      if (ltp <= 0) continue;

      pushSample(symbol, ltp);
      const move = detectSuddenMove(samplesRef.current[symbol], thresholds, now);
      if (!move) continue;

      const stepSize = MOVE_ALERT_STRIKE_STEP[symbol];
      let insight = null;
      if (isFoMoveSymbol(symbol)) {
        const chainBundle = chains.find((c) => c.symbol === symbol);
        const chain = chainBundle?.chainData?.chain ?? [];
        if (chain.length > 0 && ltp > 0) {
          insight = buildIndexOptionInsight({
            symbol,
            chain,
            spotPrice: ltp,
            stepSize: chainBundle?.chainData?.stepSize ?? stepSize,
            expiry: null,
            oiMetrics: chainBundle?.chainData?.oiMetrics ?? null,
          });
        }
      }

      const alert = buildSuddenMoveAlert(symbol, move, ltp, stepSize, insight, now);
      fireAlert(alert);
    }
  }, [enabled, spots, chains, thresholds, pushSample, fireAlert]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setActiveAlerts([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  return {
    history,
    activeAlerts,
    lastCheckAt,
    clearHistory,
    requestNotificationPermission: requestBrowserNotifyPermission,
    samples: samplesRef.current,
  };
}
