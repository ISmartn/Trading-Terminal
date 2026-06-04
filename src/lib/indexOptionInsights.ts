/**
 * Nifty 50 & Bank Nifty option-chain price-action insights.
 * Pure functions on live chain data — no mocks.
 */

import type { OptionData } from "./mockData";
import {
  calculatePCR,
  getATMZoneAnalysis,
  getMaxPain,
  type OiSnapshotMetrics,
} from "./oiUtils";

export const INDEX_INSIGHT_SYMBOLS = ["NIFTY", "BANKNIFTY"] as const;
export type IndexInsightSymbol = (typeof INDEX_INSIGHT_SYMBOLS)[number];

export const INDEX_INSIGHT_LABELS: Record<IndexInsightSymbol, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Bank Nifty",
};

export type InsightBias = "bullish" | "bearish" | "neutral" | "mixed";
export type InsightConfidence = "high" | "medium" | "low";
export type PredictedDirection = "up" | "down" | "range";

export interface OiWallStrike {
  strike: number;
  oi: number;
  oiChange: number;
  role: "resistance" | "support";
}

export interface IndexOptionInsight {
  symbol: IndexInsightSymbol;
  generatedAt: number;
  spotPrice: number;
  expiry: string | null;
  maxPain: number;
  maxPainDistancePct: number;
  pcrOI: number;
  pcrVolume: number;
  pcrDelta: number | null;
  totalCEOIChange: number;
  totalPEOIChange: number;
  bias: InsightBias;
  confidence: InsightConfidence;
  predictedDirection: PredictedDirection;
  score: number;
  resistanceWalls: OiWallStrike[];
  supportWalls: OiWallStrike[];
  keyLevels: {
    support: number[];
    resistance: number[];
    magnet: number;
  };
  bullets: string[];
  outlook: string;
  atmPcr: number;
  atmCeOiChgPct: number;
  atmPeOiChgPct: number;
}

export interface BuildIndexInsightInput {
  symbol: IndexInsightSymbol;
  chain: OptionData[];
  spotPrice: number;
  stepSize: number;
  expiry?: string | null;
  oiMetrics?: OiSnapshotMetrics | null;
}

function topOiWalls(
  chain: OptionData[],
  side: "ce" | "pe",
  role: OiWallStrike["role"],
  limit = 3,
): OiWallStrike[] {
  const leg = side === "ce" ? "ce" : "pe";
  return [...chain]
    .filter((o) => o[leg].oi > 0)
    .sort((a, b) => b[leg].oi - a[leg].oi)
    .slice(0, limit)
    .map((o) => ({
      strike: o.strikePrice,
      oi: o[leg].oi,
      oiChange: o[leg].oiChange,
      role,
    }));
}

function interpretOiChange(oiChg: number, ltp: number, isCall: boolean): string {
  if (oiChg > 0) {
    if (ltp > 0) return isCall ? "Call writing (resistance)" : "Put writing (support)";
    return isCall ? "Call long buildup" : "Put long buildup";
  }
  if (oiChg < 0) {
    if (ltp > 0) return isCall ? "Call short covering" : "Put short covering";
    return isCall ? "Call long unwinding" : "Put long unwinding";
  }
  return "Flat OI";
}

export function buildIndexOptionInsight(input: BuildIndexInsightInput): IndexOptionInsight | null {
  const { symbol, chain, spotPrice, stepSize, expiry, oiMetrics } = input;
  if (chain.length === 0 || spotPrice <= 0) return null;

  const maxPain = getMaxPain(chain);
  const pcr = calculatePCR(chain);
  const atm = getATMZoneAnalysis(chain, spotPrice, stepSize, 7);
  const maxPainDistancePct =
    maxPain > 0 ? Math.round(((spotPrice - maxPain) / spotPrice) * 10000) / 100 : 0;

  const resistanceWalls = topOiWalls(chain, "ce", "resistance");
  const supportWalls = topOiWalls(chain, "pe", "support");

  const totalCEOIChange = chain.reduce((s, o) => s + o.ce.oiChange, 0);
  const totalPEOIChange = chain.reduce((s, o) => s + o.pe.oiChange, 0);
  const pcrDelta = oiMetrics?.pcrDelta ?? null;

  let score = 0;
  if (pcr.pcrOI > 1.15) score += 1.2;
  else if (pcr.pcrOI > 1.0) score += 0.6;
  else if (pcr.pcrOI < 0.75) score -= 1.2;
  else if (pcr.pcrOI < 0.9) score -= 0.6;

  if (pcrDelta != null) {
    if (pcrDelta > 0.08) score += 0.5;
    else if (pcrDelta > 0.03) score += 0.25;
    else if (pcrDelta < -0.08) score -= 0.5;
    else if (pcrDelta < -0.03) score -= 0.25;
  }

  if (maxPainDistancePct > 0.35) score -= 0.45;
  else if (maxPainDistancePct < -0.35) score += 0.45;
  else if (Math.abs(maxPainDistancePct) <= 0.15) score += 0.1;

  if (totalPEOIChange > totalCEOIChange * 1.15 && totalPEOIChange > 0) score += 0.55;
  if (totalCEOIChange > totalPEOIChange * 1.15 && totalCEOIChange > 0) score -= 0.55;

  if (atm.pcr > 1.08) score += 0.35;
  else if (atm.pcr < 0.92) score -= 0.35;

  const nearestRes = resistanceWalls[0]?.strike ?? spotPrice;
  const nearestSup = supportWalls[0]?.strike ?? spotPrice;
  if (spotPrice > nearestRes * 0.998) score -= 0.25;
  if (spotPrice < nearestSup * 1.002) score += 0.25;

  score = Math.round(score * 100) / 100;

  let bias: InsightBias = "neutral";
  if (score >= 1.0) bias = "bullish";
  else if (score <= -1.0) bias = "bearish";
  else if (Math.abs(score) >= 0.45) bias = score > 0 ? "bullish" : "bearish";
  else if (Math.abs(score) >= 0.2) bias = "mixed";

  let confidence: InsightConfidence = "low";
  const absScore = Math.abs(score);
  if (absScore >= 1.4) confidence = "high";
  else if (absScore >= 0.75) confidence = "medium";

  let predictedDirection: PredictedDirection = "range";
  if (bias === "bullish" && score >= 0.5) predictedDirection = "up";
  else if (bias === "bearish" && score <= -0.5) predictedDirection = "down";

  const bullets: string[] = [
    `PCR (OI) ${pcr.pcrOI.toFixed(2)} — ${pcr.signal}`,
    `Max pain ${maxPain.toLocaleString("en-IN")} (${maxPainDistancePct >= 0 ? "+" : ""}${maxPainDistancePct}% vs spot)`,
    `ATM zone (${atm.strikes} strikes): PCR ${atm.pcr.toFixed(2)}, CE ΔOI ${(atm.totalCEOIChg / 1e5).toFixed(1)}L, PE ΔOI ${(atm.totalPEOIChg / 1e5).toFixed(1)}L`,
  ];

  if (pcrDelta != null) {
    bullets.push(
      `PCR velocity ${pcrDelta >= 0 ? "+" : ""}${pcrDelta.toFixed(3)} since last chain poll`,
    );
  }

  if (resistanceWalls[0]) {
    bullets.push(
      `Largest call OI wall ${resistanceWalls[0].strike.toLocaleString("en-IN")} (${(resistanceWalls[0].oi / 1e5).toFixed(1)}L) — ${interpretOiChange(resistanceWalls[0].oiChange, 1, true)}`,
    );
  }
  if (supportWalls[0]) {
    bullets.push(
      `Largest put OI wall ${supportWalls[0].strike.toLocaleString("en-IN")} (${(supportWalls[0].oi / 1e5).toFixed(1)}L) — ${interpretOiChange(supportWalls[0].oiChange, 1, false)}`,
    );
  }

  const outlookParts: string[] = [];
  if (predictedDirection === "up") {
    outlookParts.push(
      `Option structure skews bullish: put-side support / rising PCR with spot ${maxPainDistancePct > 0 ? "above" : "near"} max pain.`,
    );
  } else if (predictedDirection === "down") {
    outlookParts.push(
      `Chain favours bearish pressure: call OI walls or falling PCR with spot ${maxPainDistancePct < 0 ? "below" : "capped near"} max pain.`,
    );
  } else {
    outlookParts.push(
      "Mixed OI signals — expect range or two-sided action until a clear PCR + OI buildup skew emerges.",
    );
  }
  if (Math.abs(maxPainDistancePct) >= 0.4) {
    outlookParts.push(
      `Mean-reversion watch: spot is ${Math.abs(maxPainDistancePct).toFixed(2)}% ${maxPainDistancePct > 0 ? "above" : "below"} max pain magnet.`,
    );
  }

  return {
    symbol,
    generatedAt: Date.now(),
    spotPrice,
    expiry: expiry ?? null,
    maxPain,
    maxPainDistancePct,
    pcrOI: pcr.pcrOI,
    pcrVolume: pcr.pcrVolume,
    pcrDelta,
    totalCEOIChange,
    totalPEOIChange,
    bias,
    confidence,
    predictedDirection,
    score,
    resistanceWalls,
    supportWalls,
    keyLevels: {
      support: supportWalls.map((w) => w.strike),
      resistance: resistanceWalls.map((w) => w.strike),
      magnet: maxPain,
    },
    bullets,
    outlook: outlookParts.join(" "),
    atmPcr: atm.pcr,
    atmCeOiChgPct: atm.ceOIChgPercent,
    atmPeOiChgPct: atm.peOIChgPercent,
  };
}
