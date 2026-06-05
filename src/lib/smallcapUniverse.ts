/**
 * Nifty Smallcap index constituents — proxy /api/smallcap-universe (CSV + TV/Upstox/NSE).
 */

import { PROXY_BASE } from "@/lib/proxyConfig";

export const SMALLCAP_INDEX_NAMES = {
  SC50: "NIFTY SMALLCAP 50",
  SC100: "NIFTY SMALLCAP 100",
  SC250: "NIFTY SMALLCAP 250",
} as const;

export type SmallcapIndexKey = keyof typeof SMALLCAP_INDEX_NAMES;

export interface SmallcapConstituent {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  /** Session volume (shares) when available from quote feed. */
  volume: number;
  indices: SmallcapIndexKey[];
}

export interface SmallcapUniverseResponse {
  stocks: SmallcapConstituent[];
  symbolCount?: number;
  quotedCount?: number;
  source?: string;
  fetchedAt?: number;
  filter?: string;
}

export function parseIndexConstituents(raw: unknown, indexKey: SmallcapIndexKey): SmallcapConstituent[] {
  const fromUniverse = parseSmallcapUniverseResponse(raw);
  if (fromUniverse.length > 0) return fromUniverse;

  const envelope = (raw as { data?: unknown })?.data ?? raw;
  const body = envelope as { data?: unknown[]; stocks?: unknown[] };
  const rows = Array.isArray(body?.stocks)
    ? body.stocks
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(envelope)
        ? (envelope as unknown[])
        : [];

  if (!rows.length) return [];

  return rows
    .map((row: Record<string, unknown>) => {
      const symbol = String(row.symbol ?? row.symbolName ?? "").trim().toUpperCase();
      if (!symbol) return null;
      const ltp = Number(row.ltp ?? row.lastPrice ?? row.last ?? 0);
      const indicesRaw = row.indices as string[] | undefined;
      const indices = Array.isArray(indicesRaw)
        ? (indicesRaw.filter((k) => k in SMALLCAP_INDEX_NAMES) as SmallcapIndexKey[])
        : [indexKey];
      return {
        symbol,
        ltp,
        change: Number(row.change ?? row.variation ?? 0),
        changePercent: Number(row.changePercent ?? row.pChange ?? row.percentChange ?? 0),
        open: Number(row.open ?? ltp),
        high: Number(row.high ?? row.dayHigh ?? ltp),
        low: Number(row.low ?? row.dayLow ?? ltp),
        prevClose: Number(row.prevClose ?? row.previousClose ?? ltp),
        volume: Number(row.volume ?? row.totalTradedVolume ?? 0),
        indices: indices.length ? indices : [indexKey],
      } satisfies SmallcapConstituent;
    })
    .filter((r): r is SmallcapConstituent => r != null && r.ltp > 0);
}

export function parseSmallcapUniverseResponse(raw: unknown): SmallcapConstituent[] {
  const body = ((raw as { data?: unknown })?.data ?? raw) as SmallcapUniverseResponse | null;
  if (!body?.stocks?.length) return [];
  return body.stocks
    .map((row) => ({
      ...row,
      symbol: row.symbol.toUpperCase(),
      volume: Number(row.volume ?? 0),
      indices: (row.indices ?? []).filter((k): k is SmallcapIndexKey => k in SMALLCAP_INDEX_NAMES),
    }))
    .filter((r) => r.ltp > 0);
}

export function mergeConstituentUniverse(
  lists: { key: SmallcapIndexKey; rows: SmallcapConstituent[] }[],
): SmallcapConstituent[] {
  const bySymbol = new Map<string, SmallcapConstituent>();
  for (const { key, rows } of lists) {
    for (const row of rows) {
      const existing = bySymbol.get(row.symbol);
      if (existing) {
        if (!existing.indices.includes(key)) existing.indices.push(key);
        existing.ltp = row.ltp;
        existing.change = row.change;
        existing.changePercent = row.changePercent;
        existing.high = Math.max(existing.high, row.high);
        existing.low = Math.min(existing.low, row.low);
        if (row.volume > 0) existing.volume = row.volume;
      } else {
        bySymbol.set(row.symbol, { ...row, indices: [...row.indices] });
      }
    }
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** @deprecated Prefer fetchSmallcapUniverse — kept for direct NSE index-constituents */
export async function fetchIndexConstituents(indexName: string): Promise<unknown> {
  const params = new URLSearchParams({
    endpoint: "index-constituents",
    symbol: indexName,
  });
  const res = await fetch(`${PROXY_BASE}/api/nse-proxy?${params}`);
  if (!res.ok) {
    throw new Error(`NSE index constituents failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSmallcapUniverse(
  filter: "all" | SmallcapIndexKey = "all",
): Promise<SmallcapConstituent[]> {
  const params = new URLSearchParams({ filter });
  const res = await fetch(`${PROXY_BASE}/api/smallcap-universe?${params}`);
  if (!res.ok) {
    throw new Error(`Smallcap universe failed: ${res.status}`);
  }
  const raw = await res.json();
  const stocks = parseSmallcapUniverseResponse(raw);
  if (stocks.length > 0) return stocks;

  if (filter !== "all") {
    return parseIndexConstituents(raw, filter);
  }

  const keys = Object.keys(SMALLCAP_INDEX_NAMES) as SmallcapIndexKey[];
  const results = await Promise.all(
    keys.map(async (key) => {
      const legacy = await fetchIndexConstituents(SMALLCAP_INDEX_NAMES[key]);
      return { key, rows: parseIndexConstituents(legacy, key) };
    }),
  );
  return mergeConstituentUniverse(results);
}
