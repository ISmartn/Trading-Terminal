import { PROXY_BASE } from "@/lib/proxyConfig";

export interface LiveSignalRow {
  symbol: string;
  direction: "long" | "short";
  strength: "signal" | "watch";
  score: number;
  ltp: number;
  move15sPct?: number | null;
  move1mPct?: number | null;
  volume1m?: number;
  avgVolume20m?: number;
  volumeRatio?: number | null;
  vwap?: number | null;
  aboveVwap?: boolean;
  belowVwap?: boolean;
  checks?: Record<string, boolean>;
  timestamp: number;
}

export interface LiveIntelligenceResult {
  mode: "live" | "afterHours";
  marketOpen: boolean;
  universe: string;
  universeSize: number;
  thresholds: { move15sPct: number; move1mPct: number; volumeMult: number };
  bullish: LiveSignalRow[];
  bearish: LiveSignalRow[];
  watchLong: LiveSignalRow[];
  watchShort: LiveSignalRow[];
  counts: { bullish: number; bearish: number; watchLong: number; watchShort: number };
  status: { running: boolean; symbolsTracked: number; pollCount: number };
  timestamp: number;
}

export interface PlaybookRow {
  symbol: string;
  bias: "LONG" | "SHORT" | "RANGE";
  confidence: "high" | "medium" | "low";
  action: string;
  close: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  vwap: number | null;
  stopLoss: number | null;
  triggerUp: number;
  triggerDown: number;
  rsi: number | null;
  trend: string;
  macdSignal: string;
  scoreLong: number;
  scoreShort: number;
  reasons: string[];
}

export interface PlaybookResult {
  sessionDate: string;
  generatedAt: number | null;
  universe?: string;
  message?: string;
  longPlays: PlaybookRow[];
  shortPlays: PlaybookRow[];
  rangePlays: PlaybookRow[];
  topLong: PlaybookRow[];
  topShort: PlaybookRow[];
  symbolCount?: number;
  analyzed?: number;
}

export async function fetchLiveIntelligence(universe = "all"): Promise<LiveIntelligenceResult> {
  const res = await fetch(`${PROXY_BASE}/api/fno-intelligence/live?universe=${universe}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Live intelligence failed (${res.status})`);
  return res.json();
}

export async function fetchPlaybook(generate = false, universe = "popular"): Promise<PlaybookResult> {
  const params = new URLSearchParams({ universe });
  if (generate) params.set("generate", "1");
  const res = await fetch(`${PROXY_BASE}/api/fno-intelligence/playbook?${params}`, {
    signal: AbortSignal.timeout(generate ? 120000 : 15000),
  });
  if (!res.ok) throw new Error(`Playbook failed (${res.status})`);
  return res.json();
}
