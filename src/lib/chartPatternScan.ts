/**
 * Chart pattern scanner types and labels (detection runs on proxy via TA-Lib).
 */

import type { CandlePattern } from "@/lib/taCompute";

export type ChartPatternId =
  | "DOJI"
  | "HAMMER"
  | "SHOOTING_STAR"
  | "BULLISH_ENGULFING"
  | "BEARISH_ENGULFING"
  | "HEAD_AND_SHOULDERS"
  | "INVERSE_HEAD_AND_SHOULDERS"
  | "CUP_AND_HANDLE";

/** TA-Lib CDL* — signal on latest daily bar only. */
export const CANDLE_PATTERN_OPTIONS: ChartPatternId[] = [
  "DOJI",
  "HAMMER",
  "SHOOTING_STAR",
  "BULLISH_ENGULFING",
  "BEARISH_ENGULFING",
];

/** Multi-bar formations — completion within last ~5 sessions (proxy geometry). */
export const STRUCTURAL_PATTERN_OPTIONS: ChartPatternId[] = [
  "HEAD_AND_SHOULDERS",
  "INVERSE_HEAD_AND_SHOULDERS",
  "CUP_AND_HANDLE",
];

export const CHART_PATTERN_OPTIONS: {
  id: ChartPatternId;
  label: string;
  direction: CandlePattern["direction"];
  description: string;
  group: "candle" | "structural";
}[] = [
  { id: "DOJI", label: "Doji", direction: "neutral", group: "candle", description: "Small body vs range — indecision" },
  { id: "HAMMER", label: "Hammer", direction: "bullish", group: "candle", description: "Long lower wick at support" },
  { id: "SHOOTING_STAR", label: "Shooting star", direction: "bearish", group: "candle", description: "Long upper wick at resistance" },
  { id: "BULLISH_ENGULFING", label: "Bullish engulfing", direction: "bullish", group: "candle", description: "Green body wraps prior red candle" },
  { id: "BEARISH_ENGULFING", label: "Bearish engulfing", direction: "bearish", group: "candle", description: "Red body wraps prior green candle" },
  {
    id: "HEAD_AND_SHOULDERS",
    label: "Head & shoulders",
    direction: "bearish",
    group: "structural",
    description: "Three peaks — middle highest; neckline break (5Y daily)",
  },
  {
    id: "INVERSE_HEAD_AND_SHOULDERS",
    label: "Inverse H&S",
    direction: "bullish",
    group: "structural",
    description: "Three troughs — middle lowest; neckline reclaim (5Y daily)",
  },
  {
    id: "CUP_AND_HANDLE",
    label: "Cup & handle",
    direction: "bullish",
    group: "structural",
    description: "U-shaped base + shallow handle near rim (5Y daily)",
  },
];

export const DEFAULT_CHART_PATTERN_IDS: ChartPatternId[] = [...CANDLE_PATTERN_OPTIONS];

export const CHART_PATTERN_SCAN_RANGE = "5Y" as const;
export const CHART_PATTERN_SCAN_INTERVAL = "D" as const;

export interface ChartPatternScanRow {
  symbol: string;
  pattern: ChartPatternId;
  direction: CandlePattern["direction"];
  signalTime: number;
  signalDate: string;
  ltp: number;
  changePercent: number;
  hitsInLookback: number;
  strength?: number;
}

export function patternLabel(id: ChartPatternId): string {
  return CHART_PATTERN_OPTIONS.find((p) => p.id === id)?.label ?? id.replace(/_/g, " ");
}

export function isStructuralPattern(id: ChartPatternId): boolean {
  return (STRUCTURAL_PATTERN_OPTIONS as readonly string[]).includes(id);
}
