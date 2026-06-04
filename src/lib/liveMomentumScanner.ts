import { PROXY_BASE } from "@/lib/proxyConfig";

export interface LiveMomentumRow {
  symbol: string;
  ltp: number;
  move15sPct: number;
  move1mPct: number;
  volume1m: number;
  avgVolume20m: number;
  volumeRatio: number | null;
  vwap: number | null;
  aboveVwap: boolean;
  timestamp: number;
}

export interface LiveMomentumScanResult {
  rows: LiveMomentumRow[];
  count: number;
  universe: string;
  universeSize: number;
  thresholds: {
    move15sPct: number;
    move1mPct: number;
    volumeMult: number;
    volumeAvgBars: number;
  };
  status: {
    running: boolean;
    lastPollMs: number;
    pollCount: number;
    symbolsTracked: number;
    symbolsPolledLast: number;
  };
  timestamp: number;
}

export type LiveMomentumUniverse = "popular" | "all";

export const LIVE_MOMENTUM_RULES = [
  { id: "move15s", label: "15s move", description: "Price up ≥ 0.4% in last 15 seconds (2s LTP polls)" },
  { id: "move1m", label: "1m move", description: "Price up ≥ 0.8% in last 1 minute" },
  { id: "volume", label: "Volume spike", description: "Current 1-min volume > 3× 20-min average" },
  { id: "vwap", label: "Above VWAP", description: "Last price above session VWAP (tick-weighted)" },
] as const;

export async function fetchLiveMomentumScan(
  universe: LiveMomentumUniverse = "popular",
): Promise<LiveMomentumScanResult> {
  const params = new URLSearchParams({ universe });
  const res = await fetch(`${PROXY_BASE}/api/live-scanner?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Live scanner failed (${res.status})`);
  }
  return res.json();
}
