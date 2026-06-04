/**
 * Debug spot price source: Upstox ticks via local WS vs NSE indices vs option chain.
 *
 * Enable in browser console:
 *   localStorage.setItem('debugSpotSource', '1'); location.reload();
 * Or open any page with ?debugSpot=1
 *
 * Proxy server (terminal every 30s):
 *   SPOT_FEED_DEBUG=1 npm run dev:python
 * Or: PROXY_DEBUG=1 npm run dev:python
 */

import { PROXY_BASE } from "@/lib/proxyConfig";

export type DebugSpotSource = "websocket" | "indices" | "chain";

export function isSpotSourceDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem("debugSpotSource") === "1") return true;
    return new URLSearchParams(window.location.search).has("debugSpot");
  } catch {
    return false;
  }
}

const sourceCounts: Record<string, Record<DebugSpotSource, number>> = {};
const lastLoggedSource: Record<string, DebugSpotSource | ""> = {};
let lastSummaryAt = 0;
let lastProxyLogAt = 0;

function ensureSymbol(symbol: string) {
  if (!sourceCounts[symbol]) {
    sourceCounts[symbol] = { websocket: 0, indices: 0, chain: 0 };
  }
}

export function recordSpotSource(symbol: string, source: DebugSpotSource, spotPrice: number) {
  if (!isSpotSourceDebugEnabled()) return;
  ensureSymbol(symbol);
  sourceCounts[symbol][source] += 1;

  if (lastLoggedSource[symbol] !== source) {
    lastLoggedSource[symbol] = source;
    console.info(
      `[SPOT-DEBUG] ${symbol} → ${source.toUpperCase()} @ ₹${spotPrice.toLocaleString("en-IN")}`,
    );
  }

  const now = Date.now();
  if (now - lastSummaryAt >= 30_000) {
    lastSummaryAt = now;
    console.info("[SPOT-DEBUG] 30s source counts (higher = dominant path):", { ...sourceCounts });
  }
}

export function recordIndicesFetch(hit: boolean) {
  if (!isSpotSourceDebugEnabled()) return;
  console.debug(`[SPOT-DEBUG] NSE indices REST ${hit ? "ok" : "miss"}`);
}

/** Poll proxy /health spotMetrics when debugging. */
export function startProxySpotMetricsPolling() {
  if (!isSpotSourceDebugEnabled()) return () => {};

  const poll = async () => {
    try {
      const res = await fetch(`${PROXY_BASE}/health`);
      if (!res.ok) return;
      const health = await res.json();
      const m = health?.websocket?.spotMetrics;
      if (!m) return;
      const now = Date.now();
      if (now - lastProxyLogAt < 30_000) return;
      lastProxyLogAt = now;
      console.info("[SPOT-DEBUG] proxy /health spotMetrics:", m);
      console.info(`[SPOT-DEBUG] proxy says: ${m.interpretation ?? ""}`);
    } catch {
      /* proxy offline */
    }
  };

  void poll();
  const id = setInterval(poll, 30_000);
  return () => clearInterval(id);
}
