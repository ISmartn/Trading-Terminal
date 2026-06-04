import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchHistorical, preloadInstrumentCache } from "@/hooks/useChartData";
import { OI_CHAIN_POLL_MS, STRATEGY_SCANNER_POLL_MS } from "@/lib/dataRefreshPolicy";
import { resetProxyReadyWait, waitForProxyReady } from "@/lib/waitForProxy";
import {
  evaluateBtstWithIntraday,
  evaluateMultiDayPatterns,
  evaluateOrbVwapSupertrend,
  resolveStrategySymbols,
  type BtstScanRow,
  type MultiDayScanRow,
  type OrbScanRow,
  type StrategyKind,
  type StrategyUniverse,
} from "@/lib/fnoStrategies";
import { evaluateOrderFlow, type OrderFlowScanRow } from "@/lib/orderFlowSignals";
import { evaluateVwapMeanReversion, type VwapMrScanRow } from "@/lib/vwapMeanReversion";

const SCAN_CONCURRENCY = 3;
const SCAN_BATCH_DELAY_MS = 120;

export interface BtstScanResult {
  rows: BtstScanRow[];
  symbolCount: number;
}

export interface MultiDayScanResult {
  rows: MultiDayScanRow[];
  symbolCount: number;
}

export interface OrbScanResult {
  rows: OrbScanRow[];
  symbolCount: number;
}

export interface VwapMrScanResult {
  rows: VwapMrScanRow[];
  symbolCount: number;
}

export interface OrderFlowScanResult {
  rows: OrderFlowScanRow[];
  symbolCount: number;
}

async function scanBtstSymbol(symbol: string): Promise<BtstScanRow[]> {
  try {
    const [daily, intraday] = await Promise.all([
      fetchHistorical(symbol, "3M", "D"),
      fetchHistorical(symbol, "1D", "5"),
    ]);
    const matches = evaluateBtstWithIntraday(daily, intraday);
    return matches.map((m) => ({ ...m, symbol }));
  } catch {
    return [];
  }
}

async function scanMultiDaySymbol(symbol: string): Promise<MultiDayScanRow[]> {
  try {
    const candles = await fetchHistorical(symbol, "3M", "D");
    const matches = evaluateMultiDayPatterns(candles);
    return matches.map((m) => ({ ...m, symbol }));
  } catch {
    return [];
  }
}

async function scanOrbSymbol(symbol: string): Promise<OrbScanRow[]> {
  try {
    const intraday = await fetchHistorical(symbol, "1D", "5");
    const match = evaluateOrbVwapSupertrend(intraday);
    return match ? [{ ...match, symbol }] : [];
  } catch {
    return [];
  }
}

async function scanVwapMrSymbol(symbol: string): Promise<VwapMrScanRow[]> {
  try {
    const intraday = await fetchHistorical(symbol, "1D", "5");
    const match = evaluateVwapMeanReversion(intraday);
    return match ? [{ ...match, symbol }] : [];
  } catch {
    return [];
  }
}

async function scanOrderFlowSymbol(symbol: string): Promise<OrderFlowScanRow[]> {
  try {
    const intraday = await fetchHistorical(symbol, "1D", "5");
    const match = evaluateOrderFlow(intraday);
    return match ? [{ ...match, symbol }] : [];
  } catch {
    return [];
  }
}

async function scanBatch<T>(
  symbols: string[],
  scanFn: (symbol: string) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < symbols.length; i += SCAN_CONCURRENCY) {
    const chunk = symbols.slice(i, i + SCAN_CONCURRENCY);
    const batch = await Promise.all(chunk.map(scanFn));
    for (const matches of batch) rows.push(...matches);
    if (i + SCAN_CONCURRENCY < symbols.length) {
      await new Promise((r) => setTimeout(r, SCAN_BATCH_DELAY_MS));
    }
  }
  return rows;
}

type ScannerKind = StrategyKind | "vwapmr" | "orderflow";

function useStrategyScan<T>(
  kind: ScannerKind,
  universe: StrategyUniverse,
  scanFn: (symbols: string[]) => Promise<T[]>,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ["fno-strategy-scanner", kind, universe],
    queryFn: async () => {
      const proxyUp = await waitForProxyReady();
      if (!proxyUp) {
        resetProxyReadyWait();
        return { rows: [], symbolCount: 0 };
      }
      await preloadInstrumentCache();
      const symbols = await resolveStrategySymbols(universe);
      const rows = await scanFn(symbols);
      return { rows, symbolCount: symbols.length };
    },
    staleTime: kind === "orb" || kind === "vwapmr" || kind === "orderflow" ? STRATEGY_SCANNER_POLL_MS : 5 * 60_000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval,
    refetchOnWindowFocus: kind === "orb" || kind === "vwapmr" || kind === "orderflow",
  });
}

export function useBtstScanner(universe: StrategyUniverse = "popular", live = false) {
  return useStrategyScan<BtstScanRow>(
    "btst",
    universe,
    (symbols) => scanBatch(symbols, scanBtstSymbol),
    live ? 120_000 : undefined,
  );
}

export function useMultiDayScanner(universe: StrategyUniverse = "popular") {
  return useStrategyScan<MultiDayScanRow>(
    "multiday",
    universe,
    (symbols) => scanBatch(symbols, scanMultiDaySymbol),
  );
}

export function useOrbScanner(universe: StrategyUniverse = "popular", live = false) {
  return useStrategyScan<OrbScanRow>(
    "orb",
    universe,
    (symbols) => scanBatch(symbols, scanOrbSymbol),
    live ? STRATEGY_SCANNER_POLL_MS : undefined,
  );
}

export function useVwapMrScanner(universe: StrategyUniverse = "popular", live = false) {
  return useStrategyScan<VwapMrScanRow>(
    "vwapmr",
    universe,
    (symbols) => scanBatch(symbols, scanVwapMrSymbol),
    live ? STRATEGY_SCANNER_POLL_MS : undefined,
  );
}

export function useOrderFlowScanner(universe: StrategyUniverse = "popular", live = false) {
  return useStrategyScan<OrderFlowScanRow>(
    "orderflow",
    universe,
    (symbols) => scanBatch(symbols, scanOrderFlowSymbol),
    live ? OI_CHAIN_POLL_MS : undefined,
  );
}
