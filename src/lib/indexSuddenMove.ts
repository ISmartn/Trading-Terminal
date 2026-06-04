/**
 * Sudden-move detection for index benchmarks with OI-backed direction when F&O chain exists.
 */

import type { IndexOptionInsight } from "./indexOptionInsights";
import {
  INDEX_MOVE_ALERT_LABELS,
  MOVE_ALERT_STRIKE_STEP,
  isIndexOnlyMoveSymbol,
  type IndexMoveAlertSymbol,
} from "./indexMoveAlerts";
import { LOT_SIZE_MAP } from "./positionStore";

export type MoveWindow = "15s" | "30s" | "60s" | "3m";

export type MoveDirection = "up" | "down";

export type MoveConfidence = "high" | "medium" | "low";

export interface PriceSample {
  ts: number;
  ltp: number;
}

export interface SuddenMoveThresholds {
  /** Min |%| move in 15s to flag fast spike. */
  pct15s: number;
  pct30s: number;
  pct60s: number;
  pct3m: number;
}

export const DEFAULT_MOVE_THRESHOLDS: SuddenMoveThresholds = {
  pct15s: 0.12,
  pct30s: 0.18,
  pct60s: 0.28,
  pct3m: 0.45,
};

const WINDOW_MS: Record<MoveWindow, number> = {
  "15s": 15_000,
  "30s": 30_000,
  "60s": 60_000,
  "3m": 180_000,
};

export interface DetectedMove {
  window: MoveWindow;
  movePct: number;
  direction: MoveDirection;
  fromPrice: number;
  toPrice: number;
  lookbackMs: number;
}

export interface TradeSuggestion {
  primary: string;
  alternative: string;
  strike: number;
  lotSize: number;
  rationale: string;
  riskNote: string;
}

export interface SuddenMoveAlert {
  id: string;
  symbol: IndexMoveAlertSymbol;
  indexOnly: boolean;
  label: string;
  triggeredAt: number;
  spotAtAlert: number;
  move: DetectedMove;
  oiBias: IndexOptionInsight["bias"] | null;
  oiAgrees: boolean;
  expectedDirection: MoveDirection;
  confidence: MoveConfidence;
  headline: string;
  bullets: string[];
  trade: TradeSuggestion;
}

export function priceAt(samples: PriceSample[], ts: number, lookbackMs: number): number | null {
  const target = ts - lookbackMs;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].ts <= target) return samples[i].ltp;
  }
  return samples.length > 0 ? samples[0].ltp : null;
}

export function detectSuddenMove(
  samples: PriceSample[],
  thresholds: SuddenMoveThresholds = DEFAULT_MOVE_THRESHOLDS,
  now = Date.now(),
): DetectedMove | null {
  if (samples.length < 2) return null;
  const latest = samples[samples.length - 1];
  const ltp = latest.ltp;
  if (ltp <= 0) return null;

  const checks: { window: MoveWindow; pct: number }[] = [
    { window: "15s", pct: thresholds.pct15s },
    { window: "30s", pct: thresholds.pct30s },
    { window: "60s", pct: thresholds.pct60s },
    { window: "3m", pct: thresholds.pct3m },
  ];

  let best: DetectedMove | null = null;
  for (const { window, pct } of checks) {
    const ms = WINDOW_MS[window];
    const from = priceAt(samples, now, ms);
    if (from == null || from <= 0) continue;
    const movePct = Math.round(((ltp - from) / from) * 10000) / 100;
    if (Math.abs(movePct) < pct) continue;
    const candidate: DetectedMove = {
      window,
      movePct,
      direction: movePct >= 0 ? "up" : "down",
      fromPrice: from,
      toPrice: ltp,
      lookbackMs: ms,
    };
    if (!best || Math.abs(movePct) > Math.abs(best.movePct)) best = candidate;
  }
  return best;
}

function atmStrike(spot: number, stepSize: number) {
  return Math.round(spot / stepSize) * stepSize;
}

function oiAgreesWithMove(
  direction: MoveDirection,
  insight: IndexOptionInsight | null,
): { agrees: boolean; bias: IndexOptionInsight["bias"] | null } {
  if (!insight) return { agrees: false, bias: null };
  const bias = insight.bias;
  if (direction === "up") {
    return { agrees: bias === "bullish" || (bias === "mixed" && insight.score > 0), bias };
  }
  return { agrees: bias === "bearish" || (bias === "mixed" && insight.score < 0), bias };
}

function confidenceFrom(move: DetectedMove, oiAgrees: boolean, insight: IndexOptionInsight | null): MoveConfidence {
  const abs = Math.abs(move.movePct);
  if (oiAgrees && insight?.confidence === "high" && abs >= 0.25) return "high";
  if (oiAgrees && abs >= 0.18) return "medium";
  if (abs >= 0.35) return "medium";
  return "low";
}

export function buildTradeSuggestion(
  symbol: IndexMoveAlertSymbol,
  direction: MoveDirection,
  spot: number,
  stepSize: number,
  oiAgrees: boolean,
  insight: IndexOptionInsight | null,
): TradeSuggestion {
  const label = INDEX_MOVE_ALERT_LABELS[symbol];
  const strike = atmStrike(spot, stepSize);

  if (isIndexOnlyMoveSymbol(symbol)) {
    const level = strike.toLocaleString("en-IN");
    if (direction === "up") {
      return {
        primary: `${label} bullish spike — index level ~${level} (no NSE index options)`,
        alternative: "Express view via smallcap ETFs / liquid smallcap leaders; confirm trend on 5m chart.",
        strike,
        lotSize: 0,
        rationale: "Sudden up-move on benchmark index; no listed F&O for OI confirmation.",
        riskNote: "Smallcap indices are volatile — use ETFs or cash with tight stops; no ATM CE/PE on this index.",
      };
    }
    return {
      primary: `${label} bearish spike — index level ~${level} (no NSE index options)`,
      alternative: "Hedge via ETF reduction or defensive smallcap names; avoid shorting illiquid names.",
      strike,
      lotSize: 0,
      rationale: "Sudden down-move on benchmark index; direction from spot only.",
      riskNote: "Rebounds are sharp in smallcaps — keep risk defined without index derivatives.",
    };
  }

  const lot = LOT_SIZE_MAP[symbol] ?? 25;
  const resist = insight?.resistanceWalls[0]?.strike;
  const support = insight?.supportWalls[0]?.strike;

  if (direction === "up") {
    const primary = `Buy ${strike} CE (1 lot = ${lot} qty)`;
    const alt = resist
      ? `Bull call spread: buy ${strike} CE / sell ${resist} CE (cap near OI wall)`
      : `Buy ${strike} CE; trail SL below session low`;
    return {
      primary,
      alternative: alt,
      strike,
      lotSize: lot,
      rationale: oiAgrees
        ? "Price spike + OI structure supportive — momentum long via calls."
        : "Price spike up but OI not fully bullish — smaller size or spread preferred.",
      riskNote: resist
        ? `Resistance near ${resist.toLocaleString("en-IN")}; book partial profits into wall.`
        : "Sudden moves can reverse fast — use defined risk (spread) if unsure.",
    };
  }

  const primary = `Buy ${strike} PE (1 lot = ${lot} qty)`;
  const alt = support
    ? `Bear put spread: buy ${strike} PE / sell ${support} PE`
    : `Buy ${strike} PE; SL above recent swing high`;
  return {
    primary,
    alternative: alt,
    strike,
    lotSize: lot,
    rationale: oiAgrees
      ? "Sharp drop + bearish OI alignment — momentum short via puts."
      : "Drop in price but OI mixed — hedge or use spreads, avoid full size.",
    riskNote: support
      ? `Support near ${support.toLocaleString("en-IN")}; cover shorts into support zone.`
      : "V-shaped recoveries common on indices — keep stop tight.",
  };
}

export function buildSuddenMoveAlert(
  symbol: IndexMoveAlertSymbol,
  move: DetectedMove,
  spot: number,
  stepSize: number,
  insight: IndexOptionInsight | null,
  now = Date.now(),
): SuddenMoveAlert {
  const indexOnly = isIndexOnlyMoveSymbol(symbol);
  const { agrees, bias } = indexOnly
    ? { agrees: false, bias: null as IndexOptionInsight["bias"] | null }
    : oiAgreesWithMove(move.direction, insight);
  const confidence = confidenceFrom(move, agrees, insight);
  const trade = buildTradeSuggestion(symbol, move.direction, spot, stepSize, agrees, insight);
  const label = INDEX_MOVE_ALERT_LABELS[symbol];
  const dirWord = move.direction === "up" ? "UP" : "DOWN";
  const headline = `${label} sudden ${dirWord} ${move.movePct >= 0 ? "+" : ""}${move.movePct}% (${move.window})`;

  const bullets: string[] = [
    `Move: ${move.fromPrice.toLocaleString("en-IN")} → ${move.toPrice.toLocaleString("en-IN")} in ${move.window}`,
    indexOnly
      ? "Index-only benchmark — no NSE F&O chain; spot move drives the alert."
      : insight
        ? `OI read: ${insight.bias} (PCR ${insight.pcrOI.toFixed(2)}, max pain ${insight.maxPain.toLocaleString("en-IN")})`
        : "OI read: unavailable — direction from price only",
    indexOnly
      ? "Use ETFs / cash market; listed index options are not available on this symbol."
      : agrees
        ? "Price direction aligns with option-chain bias."
        : "Price move disagrees with OI — lower conviction.",
    `Expected near-term bias: ${move.direction === "up" ? "higher" : "lower"} unless reversed at key level.`,
  ];

  return {
    id: `${symbol}-${now}-${move.direction}`,
    symbol,
    indexOnly,
    label,
    triggeredAt: now,
    spotAtAlert: spot,
    move,
    oiBias: bias,
    oiAgrees: agrees,
    expectedDirection: move.direction,
    confidence,
    headline,
    bullets,
    trade,
  };
}

export function alertCooldownKey(alert: SuddenMoveAlert): string {
  return `${alert.symbol}:${alert.expectedDirection}:${alert.move.window}`;
}
