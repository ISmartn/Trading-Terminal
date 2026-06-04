/**
 * Phase 1 — Intraday alpha definitions (systematic entry/exit rules).
 * Patterns are triggers; each alpha declares its market inefficiency and confluence requirements.
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import {
  SUPERTREND_MULT,
  SUPERTREND_PERIOD,
  evaluateOrbVwapSupertrend,
} from "@/lib/fnoStrategies";
import {
  evaluateVwapMeanReversion as scanVwapMeanReversion,
  VWAP_MR_ADX_MAX,
  VWAP_MR_Z_HIGH,
  VWAP_MR_Z_TRIGGER,
} from "@/lib/vwapMeanReversion";

export type IntradayAlphaKind = "momentum_breakout" | "mean_reversion_vwap" | "oi_momentum";

export interface AlphaRuleSet {
  kind: IntradayAlphaKind;
  name: string;
  horizon: "intraday";
  product: "MIS";
  inefficiency: string;
  entryRules: string[];
  exitRules: string[];
  confluence: string[];
}

export const INTRADAY_ALPHA_CATALOG: AlphaRuleSet[] = [
  {
    kind: "momentum_breakout",
    name: "ORB + VWAP + Supertrend",
    horizon: "intraday",
    product: "MIS",
    inefficiency: "Opening-range imbalance + institutional VWAP anchor + volatility trend",
    entryRules: [
      "After 09:45 IST: close > ORB high (long) or < ORB low (short)",
      "Price above session VWAP (long) or below VWAP (short)",
      "Supertrend(10,3) direction aligned",
    ],
    exitRules: [
      "Hard stop at opposite ORB boundary",
      "Trail exit on Supertrend flip",
      "Square off before session close",
    ],
    confluence: ["ORB break", "VWAP", "Supertrend", "Volume follow-through"],
  },
  {
    kind: "mean_reversion_vwap",
    name: "VWAP Mean Reversion Fade",
    horizon: "intraday",
    product: "MIS",
    inefficiency: "Short-term overextension from session VWAP during low-trend periods",
    entryRules: [
      `Price ≥ ${VWAP_MR_Z_TRIGGER}σ from session VWAP (fade toward mean)`,
      `High-confidence at ≥ ${VWAP_MR_Z_HIGH}σ with volume spike + rejection wick`,
      `ADX ≤ ${VWAP_MR_ADX_MAX} (rotational regime; system off on trend days)`,
      "No active ORB breakout",
    ],
    exitRules: [
      "Target: session VWAP touch",
      "Stop: 1× ATR beyond rejection wick extreme",
    ],
    confluence: ["VWAP Z-score", "Low ADX", "Volume spike", "Rejection candle", "No ORB break"],
  },
  {
    kind: "oi_momentum",
    name: "OI Shift + Price Confirmation",
    horizon: "intraday",
    product: "MIS",
    inefficiency: "Derivatives positioning shift with spot confirmation",
    entryRules: [
      "Spot above 5m VWAP AND aggregate Call OI falling AND Put OI rising → long bias",
      "Spot below 5m VWAP AND Call OI rising AND Put OI falling → short bias",
      "PCR move confirms direction (not counter-trend)",
    ],
    exitRules: ["Stop: ORB mid or 1× ATR", "Target: 1.5× risk or VWAP revert"],
    confluence: ["OI delta", "VWAP", "PCR trend"],
  },
];

/** Order-flow framework (tick data not required — OHLCV footprint proxy). */
export const ORDER_FLOW_RULES: AlphaRuleSet = {
  kind: "mean_reversion_vwap",
  name: "Order Flow — Absorption & CVD",
  horizon: "intraday",
  product: "MIS",
  inefficiency: "Liquidity imbalance: aggressive orders absorbed by passive limits (effort vs. result)",
  entryRules: [
    "Selling absorption at lows: heavy sell delta, price holds/closes higher",
    "Buying absorption at highs: heavy buy delta, price fails to extend",
    "CVD divergence vs price swing confirms institutional footprint",
    "Retest imbalance zone before entry (not on first print)",
  ],
  exitRules: ["Fade trapped side after close", "Stop beyond absorption cluster"],
  confluence: ["Footprint proxy", "CVD", "HVN", "Exhaustion print"],
};

export interface OiMomentumInput {
  spot: number;
  aboveVwap: boolean;
  totalCallOiChange: number;
  totalPutOiChange: number;
  pcr: number;
  priorPcr?: number;
}

export type IntradaySignalSide = "long" | "short" | "none";

export interface IntradayAlphaSignal {
  kind: IntradayAlphaKind;
  side: IntradaySignalSide;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/** Phase 1 example: OI + VWAP systematic rule from blueprint. */
export function evaluateOiMomentum(input: OiMomentumInput): IntradayAlphaSignal {
  const callUnwind = input.totalCallOiChange < 0;
  const putBuild = input.totalPutOiChange > 0;
  const callBuild = input.totalCallOiChange > 0;
  const putUnwind = input.totalPutOiChange < 0;
  const pcrRising = input.priorPcr != null ? input.pcr > input.priorPcr : input.pcr > 1;

  if (input.aboveVwap && callUnwind && putBuild && pcrRising) {
    return {
      kind: "oi_momentum",
      side: "long",
      confidence: "high",
      reason: "Spot > VWAP, Call OI ↓, Put OI ↑, PCR supportive",
    };
  }
  if (!input.aboveVwap && callBuild && putUnwind && !pcrRising) {
    return {
      kind: "oi_momentum",
      side: "short",
      confidence: "high",
      reason: "Spot < VWAP, Call OI ↑, Put OI ↓, PCR weakening",
    };
  }
  if (input.aboveVwap && (callUnwind || putBuild)) {
    return { kind: "oi_momentum", side: "long", confidence: "medium", reason: "Partial OI alignment — long watch" };
  }
  if (!input.aboveVwap && (callBuild || putUnwind)) {
    return { kind: "oi_momentum", side: "short", confidence: "medium", reason: "Partial OI alignment — short watch" };
  }
  return { kind: "oi_momentum", side: "none", confidence: "low", reason: "No OI + VWAP confluence" };
}

/** Mean reversion alpha signal (wraps quantitative VWAP MR scanner). */
export function evaluateVwapMeanReversion(session: OHLCVCandle[]): IntradayAlphaSignal | null {
  const row = scanVwapMeanReversion(session);
  if (!row) return null;
  const side: IntradaySignalSide =
    row.state === "long" || row.state === "watch_long"
      ? "long"
      : row.state === "short" || row.state === "watch_short"
        ? "short"
        : "none";
  if (side === "none") return null;
  return {
    kind: "mean_reversion_vwap",
    side,
    confidence: row.state === "long" || row.state === "short" ? "high" : "medium",
    reason: row.action,
  };
}

/** Momentum breakout via existing ORB engine. */
export function evaluateMomentumBreakout(intraday: OHLCVCandle[]): IntradayAlphaSignal | null {
  const row = evaluateOrbVwapSupertrend(intraday);
  if (!row) return null;
  const side: IntradaySignalSide =
    row.state === "long" || row.state === "watch_long"
      ? "long"
      : row.state === "short" || row.state === "watch_short"
        ? "short"
        : "none";
  if (side === "none") return null;
  return {
    kind: "momentum_breakout",
    side,
    confidence: row.state === "long" || row.state === "short" ? "high" : "medium",
    reason: row.action,
  };
}
