/**
 * Confluence framework — patterns are triggers, not standalone signals.
 * Score HTF context, liquidity, volume, RSI, ADX, and mean-reversion alignment.
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import { adx, atr, bollingerBands, ema, rsi } from "@/lib/taCompute";

export type MultiDayPatternKind =
  | "three_white_soldiers"
  | "three_black_crows"
  | "crt_bullish"
  | "crt_bearish";

export type SetupQuality = "high" | "medium" | "low" | "noise";

export interface ConfluenceResult {
  score: number;
  maxScore: number;
  factors: string[];
  quality: SetupQuality;
  htfContext: string;
}

function latest(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i];
  }
  return null;
}

function avgVolume(candles: OHLCVCandle[], window = 10): number | null {
  const slice = candles.slice(-window);
  if (!slice.length) return null;
  const vols = slice.map((c) => c.volume ?? 0).filter((v) => v > 0);
  if (!vols.length) return null;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

/** 0 = at range low, 1 = at range high (HTF premium/discount). */
export function htfRangePosition(
  price: number,
  daily: OHLCVCandle[],
  window = 20,
): number | null {
  const slice = daily.slice(-window);
  if (slice.length < 5) return null;
  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));
  if (high <= low) return 0.5;
  return (price - low) / (high - low);
}

function qualityFromScore(score: number, max: number): SetupQuality {
  const pct = score / max;
  if (pct >= 0.72) return "high";
  if (pct >= 0.5) return "medium";
  if (pct >= 0.35) return "low";
  return "noise";
}

function htfLabel(pos: number | null, side: "bullish" | "bearish"): string {
  if (pos == null) return "HTF range unknown";
  if (side === "bullish") {
    if (pos <= 0.35) return "HTF discount zone (support)";
    if (pos >= 0.65) return "HTF premium — extended";
    return "HTF mid-range";
  }
  if (pos >= 0.65) return "HTF premium zone (resistance)";
  if (pos <= 0.35) return "HTF discount — extended down";
  return "HTF mid-range";
}

export function scoreMultiDayConfluence(
  side: "bullish" | "bearish",
  pattern: MultiDayPatternKind,
  c1: OHLCVCandle,
  c2: OHLCVCandle,
  c3: OHLCVCandle,
  daily: OHLCVCandle[],
): ConfluenceResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 7;
  const price = c3.close;
  const closes = daily.map((c) => c.close);
  const rsi14 = latest(rsi(closes, 14));
  const adx14 = latest(adx(daily, 14));
  const atr14 = latest(atr(daily, 14));
  const pos = htfRangePosition(price, daily);
  const volAvg = avgVolume(daily.slice(0, -1));

  // 1. HTF premium/discount — pattern at meaningful level, not mid-range noise
  if (side === "bullish" && pos != null && pos <= 0.4) {
    score += 1;
    factors.push("HTF discount / support zone");
  } else if (side === "bearish" && pos != null && pos >= 0.6) {
    score += 1;
    factors.push("HTF premium / resistance zone");
  } else if (pos != null && pos > 0.35 && pos < 0.65) {
    factors.push("Mid-range — lower edge (no HTF level)");
  } else if (pos != null) {
    score += 1;
    factors.push(side === "bullish" ? "HTF not overextended" : "HTF not oversold");
  }

  // 2. Liquidity — near 20d swing extreme (stop cluster zone)
  const lookback = daily.slice(-20);
  if (lookback.length >= 5 && atr14 != null) {
    const swingLow = Math.min(...lookback.map((c) => c.low));
    const swingHigh = Math.max(...lookback.map((c) => c.high));
    const nearLow = price - swingLow <= atr14 * 1.2;
    const nearHigh = swingHigh - price <= atr14 * 1.2;
    if (side === "bullish" && nearLow) {
      score += 1;
      factors.push("Near 20d liquidity low (stops swept)");
    } else if (side === "bearish" && nearHigh) {
      score += 1;
      factors.push("Near 20d liquidity high (stops above)");
    }
  }

  // 3. Trend strength (continuation patterns)
  if (pattern.includes("soldiers") || pattern.includes("crows")) {
    if (adx14 != null && adx14 >= 20) {
      score += 1;
      factors.push(`ADX ${adx14.toFixed(0)} — trend present`);
    }
  }

  // 4. RSI — not chasing exhaustion
  if (rsi14 != null) {
    if (side === "bullish" && rsi14 >= 35 && rsi14 <= 68) {
      score += 1;
      factors.push(`RSI ${rsi14.toFixed(0)} — room to run`);
    } else if (side === "bearish" && rsi14 >= 32 && rsi14 <= 65) {
      score += 1;
      factors.push(`RSI ${rsi14.toFixed(0)} — room to fall`);
    } else if (side === "bullish" && rsi14 > 70) {
      factors.push(`RSI ${rsi14.toFixed(0)} — overbought caution`);
    } else if (side === "bearish" && rsi14 < 30) {
      factors.push(`RSI ${rsi14.toFixed(0)} — oversold caution`);
    }
  }

  // 5. Volume confirmation on trigger candle
  if (volAvg != null && (c3.volume ?? 0) > volAvg * 1.1) {
    score += 1;
    factors.push("C3 volume above 10d avg");
  }

  // 6. CRT / AMD — manipulation phase rules
  if (pattern.startsWith("crt_")) {
    const c1Vol = c1.volume ?? 0;
    const c2Vol = c2.volume ?? 0;
    if (volAvg != null && c2Vol > volAvg * 1.15) {
      score += 1;
      factors.push("C2 sweep volume spike (manipulation)");
    }
    const rsiSeries = rsi(closes, 14);
    const rsiC1 = rsiSeries[daily.length - 3];
    const rsiC2 = rsiSeries[daily.length - 2];
    if (side === "bullish" && c2.low < c1.low && rsiC1 != null && rsiC2 != null && rsiC2 > rsiC1) {
      score += 1;
      factors.push("Bullish RSI divergence on C2 sweep");
    }
    if (side === "bearish" && c2.high > c1.high && rsiC1 != null && rsiC2 != null && rsiC2 < rsiC1) {
      score += 1;
      factors.push("Bearish RSI divergence on C2 sweep");
    }
  }

  // 7. Mean reversion context — Bollinger band touch before pattern (CRT / reversal at extreme)
  const bb = bollingerBands(closes, 20, 2);
  const bbLower = latest(bb.lower);
  const bbUpper = latest(bb.upper);
  if (side === "bullish" && bbLower != null && c2.low <= bbLower * 1.01) {
    score += 1;
    factors.push("C2 touched lower Bollinger (mean reversion setup)");
  } else if (side === "bearish" && bbUpper != null && c2.high >= bbUpper * 0.99) {
    score += 1;
    factors.push("C2 touched upper Bollinger (mean reversion setup)");
  }

  return {
    score: Math.min(score, maxScore),
    maxScore,
    factors,
    quality: qualityFromScore(score, maxScore),
    htfContext: htfLabel(pos, side),
  };
}

export function scoreBtstConfluence(
  side: "btst" | "stbt",
  daily: OHLCVCandle[],
  prev: OHLCVCandle,
  curr: OHLCVCandle,
): ConfluenceResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 5;
  const closes = daily.map((c) => c.close);
  const rsi14 = latest(rsi(closes, 14));
  const ema20 = latest(ema(closes, 20));
  const pos = htfRangePosition(curr.close, daily);

  if (side === "btst" && ema20 != null && curr.close > ema20) {
    score += 1;
    factors.push("Above 20 EMA (HTF trend)");
  } else if (side === "stbt" && ema20 != null && curr.close < ema20) {
    score += 1;
    factors.push("Below 20 EMA (HTF trend)");
  }

  const dayRange = curr.high - curr.low;
  if (dayRange > 0) {
    const closePos = (curr.close - curr.low) / dayRange;
    if (side === "btst" && closePos >= 0.7) {
      score += 1;
      factors.push("Close in upper 30% of day (strength)");
    } else if (side === "stbt" && closePos <= 0.3) {
      score += 1;
      factors.push("Close in lower 30% of day (weakness)");
    }
  }

  if (rsi14 != null) {
    if (side === "btst" && rsi14 > 45 && rsi14 < 72) {
      score += 1;
      factors.push(`RSI ${rsi14.toFixed(0)} — momentum not exhausted`);
    } else if (side === "stbt" && rsi14 > 28 && rsi14 < 55) {
      score += 1;
      factors.push(`RSI ${rsi14.toFixed(0)} — weakness not exhausted`);
    }
  }

  const volRatio = prev.volume ? (curr.volume ?? 0) / prev.volume : 0;
  if (volRatio >= 1.3) {
    score += 1;
    factors.push(`Volume ${volRatio.toFixed(1)}× vs prior day`);
  }

  if (side === "btst" && pos != null && pos <= 0.55) {
    score += 1;
    factors.push("Not at HTF premium extreme");
  } else if (side === "stbt" && pos != null && pos >= 0.45) {
    score += 1;
    factors.push("Not at HTF discount extreme");
  }

  return {
    score,
    maxScore,
    factors,
    quality: qualityFromScore(score, maxScore),
    htfContext: htfLabel(pos, side === "btst" ? "bullish" : "bearish"),
  };
}

export function scoreOrbConfluence(
  state: "long" | "short" | "watch_long" | "watch_short",
  close: number,
  vwapLast: number | null,
  stDir: 1 | -1 | null,
  orbHigh: number,
  orbLow: number,
): ConfluenceResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 4;
  const isLong = state.includes("long");

  if (state === "long" || state === "short") {
    score += 1;
    factors.push("Full ORB + VWAP + Supertrend alignment");
  } else {
    factors.push("Partial alignment — watch only");
  }

  if (vwapLast != null) {
    if (isLong && close > vwapLast) {
      score += 1;
      factors.push("Above session VWAP (mean anchor)");
    } else if (!isLong && close < vwapLast) {
      score += 1;
      factors.push("Below session VWAP (mean anchor)");
    }
  }

  if ((isLong && stDir === 1) || (!isLong && stDir === -1)) {
    score += 1;
    factors.push("Supertrend confirms direction");
  }

  const orbRange = orbHigh - orbLow;
  if (orbRange > 0) {
    const extension = isLong ? close - orbHigh : orbLow - close;
    if (extension >= orbRange * 0.1) {
      score += 1;
      factors.push("ORB break with follow-through");
    }
  }

  return {
    score,
    maxScore,
    factors,
    quality: qualityFromScore(score, maxScore),
    htfContext: isLong ? "Intraday bullish confluence" : "Intraday bearish confluence",
  };
}
