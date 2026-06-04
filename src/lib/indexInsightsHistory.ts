/**
 * Persisted history for index option-chain insights with price follow-up.
 */

import type { IndexInsightSymbol, IndexOptionInsight, InsightBias, PredictedDirection } from "./indexOptionInsights";

const STORAGE_KEY = "index-option-insights-history";
const MAX_ENTRIES = 80;

/** Min % move to count as up/down vs range (index). */
export const TRACK_MOVE_THRESHOLD_PCT = 0.12;

export type TrackOutcome = "pending" | "correct" | "wrong" | "range_hit" | "expired";

export interface InsightHistoryEntry {
  id: string;
  symbol: IndexInsightSymbol;
  savedAt: number;
  expiry: string | null;
  spotAtSave: number;
  bias: InsightBias;
  predictedDirection: PredictedDirection;
  confidence: IndexOptionInsight["confidence"];
  score: number;
  outlook: string;
  bullets: string[];
  pcrOI: number;
  maxPain: number;
  /** Latest tracked price (updated on refresh). */
  lastPrice: number | null;
  lastCheckedAt: number | null;
  changePct: number | null;
  outcome: TrackOutcome;
  insightSnapshot: IndexOptionInsight;
}

function loadRaw(): InsightHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InsightHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries: InsightHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export function loadInsightHistory(): InsightHistoryEntry[] {
  return loadRaw().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveInsightToHistory(insight: IndexOptionInsight): InsightHistoryEntry {
  const entry: InsightHistoryEntry = {
    id: `${insight.symbol}-${insight.generatedAt}`,
    symbol: insight.symbol,
    savedAt: insight.generatedAt,
    expiry: insight.expiry,
    spotAtSave: insight.spotPrice,
    bias: insight.bias,
    predictedDirection: insight.predictedDirection,
    confidence: insight.confidence,
    score: insight.score,
    outlook: insight.outlook,
    bullets: insight.bullets,
    pcrOI: insight.pcrOI,
    maxPain: insight.maxPain,
    lastPrice: null,
    lastCheckedAt: null,
    changePct: null,
    outcome: "pending",
    insightSnapshot: insight,
  };
  const all = loadRaw();
  all.unshift(entry);
  persist(all);
  return entry;
}

export function removeInsightHistoryEntry(id: string) {
  persist(loadRaw().filter((e) => e.id !== id));
}

export function clearInsightHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

export function evaluateTrackOutcome(
  predicted: PredictedDirection,
  changePct: number,
  thresholdPct = TRACK_MOVE_THRESHOLD_PCT,
): TrackOutcome {
  const abs = Math.abs(changePct);
  if (abs < thresholdPct) {
    return predicted === "range" ? "correct" : "range_hit";
  }
  const wentUp = changePct > thresholdPct;
  const wentDown = changePct < -thresholdPct;

  if (predicted === "range") {
    return abs < thresholdPct * 2 ? "correct" : "wrong";
  }
  if (predicted === "up") return wentUp ? "correct" : wentDown ? "wrong" : "range_hit";
  if (predicted === "down") return wentDown ? "correct" : wentUp ? "wrong" : "range_hit";
  return "pending";
}

/** Update all entries with current index LTP map (symbol → price). */
export function refreshHistoryTracking(
  ltpBySymbol: Partial<Record<IndexInsightSymbol, number>>,
): InsightHistoryEntry[] {
  const all = loadRaw();
  const now = Date.now();
  const updated = all.map((entry) => {
    const ltp = ltpBySymbol[entry.symbol];
    if (ltp == null || ltp <= 0 || entry.spotAtSave <= 0) return entry;
    const changePct = Math.round(((ltp - entry.spotAtSave) / entry.spotAtSave) * 10000) / 100;
    const outcome = evaluateTrackOutcome(entry.predictedDirection, changePct);
    return {
      ...entry,
      lastPrice: ltp,
      lastCheckedAt: now,
      changePct,
      outcome,
    };
  });
  persist(updated);
  return updated.sort((a, b) => b.savedAt - a.savedAt);
}

export function formatOutcomeLabel(outcome: TrackOutcome): string {
  switch (outcome) {
    case "correct":
      return "Matched";
    case "wrong":
      return "Opposite";
    case "range_hit":
      return "Sideways";
    case "expired":
      return "Stale";
    default:
      return "Pending";
  }
}
