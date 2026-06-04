import { PROXY_BASE } from "@/lib/proxyConfig";
import type { TAScannerRow, TASnapshotSummary } from "@/lib/taCompute";
import { FALLBACK_FNO_STOCKS, FNO_INDEX_SYMBOLS } from "@/lib/fnoUniverse";

/** Static fallback list when live F&O universe API is unavailable */
export const ALL_FNO_SCAN_SYMBOLS = [...FNO_INDEX_SYMBOLS, ...FALLBACK_FNO_STOCKS];

/** @deprecated use fetchAllFnoSymbols() from @/lib/fnoUniverse */
export const FNO_SCAN_SYMBOLS = ALL_FNO_SCAN_SYMBOLS;

export async function fetchTASnapshot(
  symbol: string,
  range = "1D",
  interval = "1",
): Promise<TASnapshotSummary | null> {
  try {
    const params = new URLSearchParams({ symbol, range, interval });
    const res = await fetch(`${PROXY_BASE}/api/ta/snapshot?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.summary ?? null;
  } catch {
    return null;
  }
}

export async function fetchTAScanner(
  symbols?: string[],
  filter?: "all" | "overbought" | "oversold" | "macd_bull" | "macd_bear" | "trending",
): Promise<TAScannerRow[]> {
  try {
    const params = new URLSearchParams({
      range: "3M",
      filter: filter ?? "all",
    });
    if (symbols?.length) params.set("symbols", symbols.join(","));
    const res = await fetch(`${PROXY_BASE}/api/ta/scanner?${params}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.rows ?? [];
  } catch {
    return [];
  }
}

export async function fetchTAIndicatorsFromServer(
  symbol: string,
  range: string,
  indicators: string,
): Promise<unknown | null> {
  try {
    const params = new URLSearchParams({ symbol, range, indicators });
    const res = await fetch(`${PROXY_BASE}/api/ta/indicators?${params}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
