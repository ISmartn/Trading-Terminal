/**
 * Nifty index constituents via proxy /api/index-universe (NSE archive CSV).
 * Avoids broken NSE equity-stockIndices URL on nseindia.com.
 */

import { PROXY_BASE } from "@/lib/proxyConfig";

export const CHART_PATTERN_INDEX_TABS = {
  N50: { label: "Nifty 50", nseIndex: "NIFTY 50" },
  N100: { label: "Nifty 100", nseIndex: "NIFTY 100" },
  N200: { label: "Nifty 200", nseIndex: "NIFTY 200" },
  BANK: { label: "Nifty Bank", nseIndex: "NIFTY BANK" },
  IT: { label: "Nifty IT", nseIndex: "NIFTY IT" },
  MID50: { label: "Nifty Midcap 50", nseIndex: "NIFTY MIDCAP 50" },
  MID150: { label: "Nifty Midcap 150", nseIndex: "NIFTY MIDCAP 150" },
} as const;

export type ChartPatternIndexKey = keyof typeof CHART_PATTERN_INDEX_TABS;

export interface IndexUniverseResponse {
  symbols: string[];
  symbolCount?: number;
  tab?: string;
  label?: string;
  source?: string;
}

export function parseIndexUniverseResponse(raw: unknown): string[] {
  const body = ((raw as { data?: unknown })?.data ?? raw) as IndexUniverseResponse | null;
  if (body?.symbols?.length) {
    return body.symbols.map((s) => s.toUpperCase());
  }
  return parseLegacyIndexSymbols(raw);
}

/** Legacy equity-stockIndices / empty nse-proxy body */
function parseLegacyIndexSymbols(raw: unknown): string[] {
  const envelope = (raw as { data?: unknown })?.data ?? raw;
  const body = envelope as { data?: unknown[]; stocks?: unknown[]; symbols?: string[] };
  if (Array.isArray(body?.symbols)) {
    return body.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  }
  const rows = Array.isArray(body?.stocks)
    ? body.stocks
    : Array.isArray(body?.data)
      ? body.data
      : [];
  const symbols = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = String(r.symbol ?? r.symbolName ?? "").trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }
  return [...symbols].sort((a, b) => a.localeCompare(b));
}

export async function fetchIndexTabSymbols(tab: ChartPatternIndexKey): Promise<string[]> {
  const params = new URLSearchParams({ tab });
  const res = await fetch(`${PROXY_BASE}/api/index-universe?${params}`);
  if (!res.ok) {
    throw new Error(`Index universe failed: ${res.status}`);
  }
  const raw = await res.json();
  const symbols = parseIndexUniverseResponse(raw);
  if (!symbols.length) {
    throw new Error(`No symbols for ${CHART_PATTERN_INDEX_TABS[tab].label}`);
  }
  return symbols;
}
