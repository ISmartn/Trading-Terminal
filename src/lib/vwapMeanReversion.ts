/**
 * VWAP mean reversion — statistical extremes with regime filter.
 * Fade session VWAP extensions in low-trend (ADX) regimes with volume + rejection confirmation.
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import { adx, atr, vwap } from "@/lib/taCompute";
import { latestSessionCandles } from "@/lib/chartTime";
import {
  ORB_MARKET_OPEN_MIN,
  ORB_WINDOW_END_MIN,
  istMinutesSinceMidnight,
} from "@/lib/fnoStrategies";

export const VWAP_MR_ADX_MAX = 22;
export const VWAP_MR_Z_TRIGGER = 2;
export const VWAP_MR_Z_HIGH = 3;
export const VWAP_MR_ATR_PERIOD = 14;
export const VWAP_MR_ATR_STOP_MULT = 1;
export const VWAP_MR_VOLUME_SPIKE = 1.5;
export const VWAP_MR_DEV_WINDOW = 40;
export const MARKET_CLOSE_MIN = 15 * 60 + 25;

export type VwapMrSignalState = "long" | "short" | "watch_long" | "watch_short" | "none";

export interface VwapMrScanRow {
  symbol: string;
  state: VwapMrSignalState;
  ltp: number;
  vwap: number;
  zScore: number;
  bandUpper2: number;
  bandLower2: number;
  bandUpper3: number;
  bandLower3: number;
  adx14: number | null;
  atr14: number | null;
  volumeRatio: number;
  rejectionConfirmed: boolean;
  entryLevel: number;
  stopLoss: number;
  targetLevel: number;
  riskPoints: number;
  rewardPoints: number;
  riskRewardRatio: number;
  action: string;
  exitRule: string;
  productType: "MIS";
}

export interface VwapBandPoint {
  time: number;
  price: number;
  vwap: number;
  upper2: number;
  lower2: number;
  upper3: number;
  lower3: number;
  zScore: number;
  signal: "long" | "short" | null;
}

/** Session VWAP distance σ from rolling deviations vs VWAP. */
export function sessionVwapZScores(
  session: OHLCVCandle[],
  window = VWAP_MR_DEV_WINDOW,
): { zScores: (number | null)[]; vwapVals: (number | null)[]; std: number | null } {
  const vwapVals = vwap(session);
  const zScores: (number | null)[] = Array(session.length).fill(null);
  let std: number | null = null;

  for (let i = 0; i < session.length; i++) {
    const start = Math.max(0, i - window + 1);
    const deviations: number[] = [];
    for (let j = start; j <= i; j++) {
      const vj = vwapVals[j];
      if (vj != null) deviations.push(session[j].close - vj);
    }
    if (deviations.length < 10) continue;
    const mean = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const variance = deviations.reduce((a, d) => a + (d - mean) ** 2, 0) / deviations.length;
    const s = Math.sqrt(variance) || 1;
    const v = vwapVals[i];
    if (v != null) {
      zScores[i] = (session[i].close - v) / s;
      if (i === session.length - 1) std = s;
    }
  }
  return { zScores, vwapVals, std };
}

/** Pin-bar style rejection at an extreme (fade setup). */
export function isRejectionCandle(c: OHLCVCandle, fadeSide: "long" | "short"): boolean {
  const range = c.high - c.low;
  if (range <= 0) return false;
  const lowerWick = (Math.min(c.open, c.close) - c.low) / range;
  const upperWick = (c.high - Math.max(c.open, c.close)) / range;
  if (fadeSide === "long") {
    return lowerWick >= 0.5 && upperWick <= 0.28 && c.close >= c.open;
  }
  return upperWick >= 0.5 && lowerWick <= 0.28 && c.close <= c.open;
}

function avgVolume(session: OHLCVCandle[], endIdx: number, window = 20): number | null {
  const start = Math.max(0, endIdx - window + 1);
  const vols = session.slice(start, endIdx + 1).map((c) => c.volume ?? 0).filter((v) => v > 0);
  if (!vols.length) return null;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

function orbBreakoutActive(session: OHLCVCandle[], close: number): boolean {
  const orbBars = session.filter((c) => {
    const m = istMinutesSinceMidnight(c.time);
    return m >= ORB_MARKET_OPEN_MIN && m <= ORB_WINDOW_END_MIN;
  });
  if (orbBars.length < 2) return false;
  const orbHigh = Math.max(...orbBars.map((c) => c.high));
  const orbLow = Math.min(...orbBars.map((c) => c.low));
  return close > orbHigh || close < orbLow;
}

/**
 * VWAP mean reversion scanner: ADX regime filter, 2–3σ trigger, volume spike + rejection, 1×ATR stop, VWAP target.
 */
export function evaluateVwapMeanReversion(
  intradayCandles: OHLCVCandle[],
): Omit<VwapMrScanRow, "symbol"> | null {
  const session = latestSessionCandles(intradayCandles);
  if (session.length < VWAP_MR_ATR_PERIOD + 15) return null;

  const lastIdx = session.length - 1;
  const last = session[lastIdx];
  const m = istMinutesSinceMidnight(last.time);
  if (m <= ORB_WINDOW_END_MIN || m >= MARKET_CLOSE_MIN) return null;

  const { zScores, vwapVals, std } = sessionVwapZScores(session);
  const v = vwapVals[lastIdx];
  const z = zScores[lastIdx];
  if (v == null || z == null || std == null) return null;

  const adxVals = adx(session, VWAP_MR_ATR_PERIOD);
  const atrVals = atr(session, VWAP_MR_ATR_PERIOD);
  const adx14 = adxVals[lastIdx] ?? null;
  const atr14 = atrVals[lastIdx] ?? null;

  if (adx14 != null && adx14 > VWAP_MR_ADX_MAX) return null;
  if (orbBreakoutActive(session, last.close)) return null;

  const volAvg = avgVolume(session, lastIdx);
  const volRatio = volAvg && volAvg > 0 ? (last.volume ?? 0) / volAvg : 0;
  const volumeSpike = volRatio >= VWAP_MR_VOLUME_SPIKE;

  const bandUpper2 = v + std * VWAP_MR_Z_TRIGGER;
  const bandLower2 = v - std * VWAP_MR_Z_TRIGGER;
  const bandUpper3 = v + std * VWAP_MR_Z_HIGH;
  const bandLower3 = v - std * VWAP_MR_Z_HIGH;

  let state: VwapMrSignalState = "none";
  let fadeSide: "long" | "short" | null = null;

  if (z <= -VWAP_MR_Z_TRIGGER) fadeSide = "long";
  else if (z >= VWAP_MR_Z_TRIGGER) fadeSide = "short";
  else return null;

  const rejection = isRejectionCandle(last, fadeSide);
  const atExtreme = Math.abs(z) >= VWAP_MR_Z_HIGH;

  if (fadeSide === "long") {
    if (rejection && volumeSpike && atExtreme) state = "long";
    else if (Math.abs(z) >= VWAP_MR_Z_TRIGGER) state = "watch_long";
  } else {
    if (rejection && volumeSpike && atExtreme) state = "short";
    else if (Math.abs(z) >= VWAP_MR_Z_TRIGGER) state = "watch_short";
  }

  if (state === "none") return null;

  const isLong = state === "long" || state === "watch_long";
  const entryLevel = last.close;
  const targetLevel = v;
  const wickExtreme = isLong ? last.low : last.high;
  const atrBuf = (atr14 ?? 0) * VWAP_MR_ATR_STOP_MULT;
  const stopLoss = isLong ? wickExtreme - atrBuf : wickExtreme + atrBuf;
  const riskPoints = isLong ? entryLevel - stopLoss : stopLoss - entryLevel;
  const rewardPoints = isLong ? targetLevel - entryLevel : entryLevel - targetLevel;
  const riskRewardRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;

  const zLabel = Math.abs(z).toFixed(1);
  const adxNote = adx14 != null ? `ADX ${adx14.toFixed(0)}` : "ADX n/a";
  const confirmNote = rejection && volumeSpike ? "rejection + vol spike" : rejection ? "rejection only" : volumeSpike ? "vol spike only" : "await confirmation";

  const action =
    state === "long"
      ? `Long MIS fade — ${zLabel}σ below VWAP (${adxNote}) · ${confirmNote} · target VWAP`
      : state === "short"
        ? `Short MIS fade — ${zLabel}σ above VWAP (${adxNote}) · ${confirmNote} · target VWAP`
        : isLong
          ? `Watch long fade — ${zLabel}σ below VWAP · ${confirmNote}`
          : `Watch short fade — ${zLabel}σ above VWAP · ${confirmNote}`;

  const exitRule = `Stop ${VWAP_MR_ATR_STOP_MULT}×ATR beyond rejection wick; target session VWAP; system off if ADX>${VWAP_MR_ADX_MAX}`;

  return {
    state,
    ltp: last.close,
    vwap: v,
    zScore: z,
    bandUpper2,
    bandLower2,
    bandUpper3,
    bandLower3,
    adx14,
    atr14,
    volumeRatio: volRatio,
    rejectionConfirmed: rejection,
    entryLevel,
    stopLoss,
    targetLevel,
    riskPoints,
    rewardPoints,
    riskRewardRatio,
    action,
    exitRule,
    productType: "MIS",
  };
}

/** Build band series for chart / simulator from session candles. */
export function buildVwapBandSeries(session: OHLCVCandle[]): VwapBandPoint[] {
  const { zScores, vwapVals, std } = sessionVwapZScores(session);
  const s = std ?? 1;
  const out: VwapBandPoint[] = [];

  for (let i = 0; i < session.length; i++) {
    const v = vwapVals[i];
    if (v == null) continue;
    const z = zScores[i] ?? 0;
    let signal: "long" | "short" | null = null;
    if (z <= -VWAP_MR_Z_TRIGGER) signal = "long";
    else if (z >= VWAP_MR_Z_TRIGGER) signal = "short";

    out.push({
      time: session[i].time,
      price: session[i].close,
      vwap: v,
      upper2: v + s * VWAP_MR_Z_TRIGGER,
      lower2: v - s * VWAP_MR_Z_TRIGGER,
      upper3: v + s * VWAP_MR_Z_HIGH,
      lower3: v - s * VWAP_MR_Z_HIGH,
      zScore: z,
      signal,
    });
  }
  return out;
}

/** Synthetic session for interactive VWAP band demo (volatility slider scales σ). */
export function syntheticVwapBandDemo(
  barCount = 48,
  volatilityMult = 1,
  seed = 42,
): VwapBandPoint[] {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const session: OHLCVCandle[] = [];
  let price = 100;
  const base = Math.floor(Date.now() / 1000) - barCount * 300;

  for (let i = 0; i < barCount; i++) {
    const shock = (rnd() - 0.5) * 1.2 * volatilityMult;
    const open = price;
    price += shock;
    const high = Math.max(open, price) + rnd() * 0.3 * volatilityMult;
    const low = Math.min(open, price) - rnd() * 0.3 * volatilityMult;
    const close = price;
    session.push({
      time: base + i * 300,
      open,
      high,
      low,
      close,
      volume: Math.round(5000 + rnd() * 8000),
    });
  }

  const points = buildVwapBandSeries(session);
  if (volatilityMult !== 1) {
    return points.map((p) => {
      const mid = p.vwap;
      const scale = volatilityMult;
      return {
        ...p,
        upper2: mid + (p.upper2 - mid) * scale,
        lower2: mid - (mid - p.lower2) * scale,
        upper3: mid + (p.upper3 - mid) * scale,
        lower3: mid - (mid - p.lower3) * scale,
        zScore: p.zScore * scale,
      };
    });
  }
  return points;
}

export type VwapMrSortField = "signal" | "symbol" | "ltp" | "zscore";
export type VwapMrSortDir = "asc" | "desc";

const VWAP_MR_SIGNAL_RANK: Record<VwapMrSignalState, number> = {
  long: 0,
  watch_long: 1,
  watch_short: 2,
  short: 3,
  none: 99,
};

export function sortVwapMrRows(
  rows: VwapMrScanRow[],
  field: VwapMrSortField,
  dir: VwapMrSortDir,
): VwapMrScanRow[] {
  return [...rows].sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    switch (field) {
      case "signal":
        return (VWAP_MR_SIGNAL_RANK[a.state] - VWAP_MR_SIGNAL_RANK[b.state]) * mul || a.symbol.localeCompare(b.symbol);
      case "symbol":
        return a.symbol.localeCompare(b.symbol) * mul;
      case "ltp":
        return (a.ltp - b.ltp) * mul;
      case "zscore":
        return (Math.abs(b.zScore) - Math.abs(a.zScore)) * (dir === "asc" ? -1 : 1);
      default:
        return 0;
    }
  });
}
