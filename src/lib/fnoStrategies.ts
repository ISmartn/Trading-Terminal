/**
 * F&O algorithmic strategies from docs/Indian F&O Trading Strategy Generation.md
 * 1. BTST/STBT — overnight momentum (next-day directional bias)
 * 2. Three White Soldiers / Black Crows + Candle Range Theory (CRT)
 * 3. ORB + VWAP + Supertrend — intraday precision
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import { adx, atr, istDayKey, supertrend, vwap } from "@/lib/taCompute";
import { latestSessionCandles } from "@/lib/chartTime";
import { POPULAR_FNO_SYMBOLS } from "@/lib/threeCandleRule";
import { fetchAllFnoSymbols } from "@/lib/fnoUniverse";
import {
  scoreBtstConfluence,
  scoreMultiDayConfluence,
  scoreOrbConfluence,
  type ConfluenceResult,
  type SetupQuality,
} from "@/lib/strategyConfluence";

export type { ConfluenceResult, SetupQuality };

export { POPULAR_FNO_SYMBOLS };

export type StrategyUniverse = "popular" | "all";

export async function resolveStrategySymbols(universe: StrategyUniverse): Promise<string[]> {
  if (universe === "popular") return [...POPULAR_FNO_SYMBOLS];
  return fetchAllFnoSymbols();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function candleBody(c: OHLCVCandle): number {
  return Math.abs(c.close - c.open);
}

export function isGreen(c: OHLCVCandle): boolean {
  return c.close > c.open;
}

export function isRed(c: OHLCVCandle): boolean {
  return c.close < c.open;
}

export function istMinutesSinceMidnight(unixSec: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(unixSec * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Aggregate intraday candles into one daily bar. */
export function aggregateSessionCandle(session: OHLCVCandle[]): OHLCVCandle | null {
  if (!session.length) return null;
  return {
    time: session[0].time,
    open: session[0].open,
    high: Math.max(...session.map((c) => c.high)),
    low: Math.min(...session.map((c) => c.low)),
    close: session[session.length - 1].close,
    volume: session.reduce((s, c) => s + (c.volume ?? 0), 0),
  };
}

/** Collapse intraday series to one candle per IST day. */
export function toDailyCandles(candles: OHLCVCandle[]): OHLCVCandle[] {
  if (!candles.length) return [];
  const byDay = new Map<string, OHLCVCandle[]>();
  for (const c of candles) {
    const day = istDayKey(c.time);
    const list = byDay.get(day) ?? [];
    list.push(c);
    byDay.set(day, list);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, session]) => aggregateSessionCandle(session)!)
    .filter(Boolean);
}

function rollingBodyAvg(candles: OHLCVCandle[], window = 10): (number | null)[] {
  const bodies = candles.map(candleBody);
  const out: (number | null)[] = Array(candles.length).fill(null);
  for (let i = window - 1; i < candles.length; i++) {
    const slice = bodies.slice(i - window + 1, i + 1);
    out[i] = slice.reduce((a, b) => a + b, 0) / window;
  }
  return out;
}

function latestIndicator(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i];
  }
  return null;
}

function avgDailyRange(candles: OHLCVCandle[], window = 10): number | null {
  if (!candles.length) return null;
  const slice = candles.slice(-window);
  const ranges = slice.map((c) => c.high - c.low).filter((r) => r > 0);
  if (!ranges.length) return null;
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

const ATR_PERIOD = 14;
const ATR_STOP_BUFFER = 0.5;
const MIN_RISK_REWARD = 2;

function buildBtstTradePlan(
  side: "btst" | "stbt",
  daily: OHLCVCandle[],
  prev: OHLCVCandle,
  curr: OHLCVCandle,
): Pick<
  BtstScanRow,
  | "entryLevel"
  | "stopLoss"
  | "targetLevel"
  | "riskPoints"
  | "rewardPoints"
  | "riskRewardRatio"
  | "action"
> {
  const atr14 = latestIndicator(atr(daily, ATR_PERIOD));
  const buffer = (atr14 ?? 0) * ATR_STOP_BUFFER;

  if (side === "btst") {
    const entryLevel = curr.close;
    const stopLoss = prev.low - buffer;
    const measuredMove = curr.close - prev.low;
    const minTarget = entryLevel + measuredMove;
    const atrTarget = atr14 != null ? entryLevel + atr14 * 1.5 : minTarget;
    const targetLevel = Math.max(minTarget, atrTarget);
    const riskPoints = entryLevel - stopLoss;
    const rewardPoints = targetLevel - entryLevel;
    const riskRewardRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;
    return {
      entryLevel,
      stopLoss,
      targetLevel,
      riskPoints,
      rewardPoints,
      riskRewardRatio,
      action: `Buy NRML near close (₹${entryLevel.toFixed(0)}) — stop below T-1 low${atr14 != null ? ` − ${ATR_STOP_BUFFER}×ATR` : ""}, target measured move + 1.5×ATR (R:R 1:${riskRewardRatio.toFixed(1)}), exit next session`,
    };
  }

  const entryLevel = curr.close;
  const stopLoss = prev.high + buffer;
  const measuredMove = prev.high - curr.close;
  const minTarget = entryLevel - measuredMove;
  const atrTarget = atr14 != null ? entryLevel - atr14 * 1.5 : minTarget;
  const targetLevel = Math.min(minTarget, atrTarget);
  const riskPoints = stopLoss - entryLevel;
  const rewardPoints = entryLevel - targetLevel;
  const riskRewardRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  return {
    entryLevel,
    stopLoss,
    targetLevel,
    riskPoints,
    rewardPoints,
    riskRewardRatio,
    action: `Sell NRML near close (₹${entryLevel.toFixed(0)}) — stop above T-1 high${atr14 != null ? ` + ${ATR_STOP_BUFFER}×ATR` : ""}, target measured move + 1.5×ATR (R:R 1:${riskRewardRatio.toFixed(1)}), exit next session`,
  };
}

// ─── Strategy I: BTST / STBT ───────────────────────────────────────────────

export const BTST_BODY_AVG_WINDOW = 10;

export interface BtstScanRow {
  symbol: string;
  side: "btst" | "stbt";
  ltp: number;
  prevDayHigh: number;
  prevDayLow: number;
  prevDayClose: number;
  todayClose: number;
  todayChangePct: number;
  volumeRatio: number;
  entryLevel: number;
  stopLoss: number;
  targetLevel: number;
  riskPoints: number;
  rewardPoints: number;
  riskRewardRatio: number;
  confluenceScore: number;
  confluenceMax: number;
  confluenceFactors: string[];
  setupQuality: SetupQuality;
  htfContext: string;
  action: string;
  productType: "NRML";
  evalWindow: "3:00–3:30 PM IST";
}

/**
 * BTST (bullish): T-1 small red → T strong green, close > high(T-1), vol expansion.
 * STBT (bearish): T-1 small green → T strong red, close < low(T-1), vol expansion.
 */
export function evaluateBtstStbt(
  dailyCandles: OHLCVCandle[],
  bodyAvgWindow = BTST_BODY_AVG_WINDOW,
): Omit<BtstScanRow, "symbol">[] {
  if (dailyCandles.length < bodyAvgWindow + 2) return [];

  const sorted = [...dailyCandles].sort((a, b) => a.time - b.time);
  const avgBodies = rollingBodyAvg(sorted, bodyAvgWindow);
  const i = sorted.length - 1;
  const prev = sorted[i - 1];
  const curr = sorted[i];
  const prevAvg = avgBodies[i - 1];
  const currAvg = avgBodies[i];
  if (prevAvg == null || currAvg == null) return [];

  const prevBody = candleBody(prev);
  const currBody = candleBody(curr);
  const volOk = (curr.volume ?? 0) > (prev.volume ?? 0);
  const results: Omit<BtstScanRow, "symbol">[] = [];

  const prevSmall = prevBody < prevAvg;
  const currStrong = currBody >= currAvg;

  if (isRed(prev) && prevSmall && isGreen(curr) && currStrong && curr.close > prev.high && volOk) {
    const plan = buildBtstTradePlan("btst", sorted, prev, curr);
    const confluence = scoreBtstConfluence("btst", sorted, prev, curr);
    results.push({
      side: "btst",
      ltp: curr.close,
      prevDayHigh: prev.high,
      prevDayLow: prev.low,
      prevDayClose: prev.close,
      todayClose: curr.close,
      todayChangePct: prev.open ? ((curr.close - prev.open) / prev.open) * 100 : 0,
      volumeRatio: prev.volume ? (curr.volume ?? 0) / prev.volume : 0,
      ...plan,
      ...confluenceFields(confluence),
      action: `${plan.action} · Confluence ${confluence.score}/${confluence.maxScore} (${confluence.quality})`,
      productType: "NRML",
      evalWindow: "3:00–3:30 PM IST",
    });
  }

  if (isGreen(prev) && prevSmall && isRed(curr) && currStrong && curr.close < prev.low && volOk) {
    const plan = buildBtstTradePlan("stbt", sorted, prev, curr);
    const confluence = scoreBtstConfluence("stbt", sorted, prev, curr);
    results.push({
      side: "stbt",
      ltp: curr.close,
      prevDayHigh: prev.high,
      prevDayLow: prev.low,
      prevDayClose: prev.close,
      todayClose: curr.close,
      todayChangePct: prev.open ? ((curr.close - prev.open) / prev.open) * 100 : 0,
      volumeRatio: prev.volume ? (curr.volume ?? 0) / prev.volume : 0,
      ...plan,
      ...confluenceFields(confluence),
      action: `${plan.action} · Confluence ${confluence.score}/${confluence.maxScore} (${confluence.quality})`,
      productType: "NRML",
      evalWindow: "3:00–3:30 PM IST",
    });
  }

  return results;
}

/** BTST with live session: history daily + today's intraday aggregated as current bar. */
export function evaluateBtstWithIntraday(
  dailyHistory: OHLCVCandle[],
  todayIntraday: OHLCVCandle[],
): Omit<BtstScanRow, "symbol">[] {
  const today = aggregateSessionCandle(latestSessionCandles(todayIntraday));
  if (!today) return evaluateBtstStbt(dailyHistory);
  const history = dailyHistory.filter((c) => istDayKey(c.time) !== istDayKey(today.time));
  return evaluateBtstStbt([...history, today]);
}

// ─── Strategy II: Soldiers / Crows / CRT ───────────────────────────────────

export type MultiDayPattern =
  | "three_white_soldiers"
  | "three_black_crows"
  | "crt_bullish"
  | "crt_bearish";

export interface MultiDayScanRow {
  symbol: string;
  pattern: MultiDayPattern;
  side: "bullish" | "bearish";
  ltp: number;
  entryLevel: number;
  stopLoss: number;
  targetLevel: number;
  riskPoints: number;
  rewardPoints: number;
  riskRewardRatio: number;
  holdDaysMin: number;
  holdDaysMax: number;
  holdDays: string;
  atr14: number | null;
  adx14: number | null;
  entryRule: string;
  stopRule: string;
  targetRule: string;
  confluenceScore: number;
  confluenceMax: number;
  confluenceFactors: string[];
  setupQuality: SetupQuality;
  htfContext: string;
  action: string;
  label: string;
}

function confluenceFields(c: ConfluenceResult) {
  return {
    confluenceScore: c.score,
    confluenceMax: c.maxScore,
    confluenceFactors: c.factors,
    setupQuality: c.quality,
    htfContext: c.htfContext,
  };
}

const WICK_MAX_RATIO = 0.25;

function openInPrevBody(curr: OHLCVCandle, prev: OHLCVCandle): boolean {
  const bodyTop = Math.max(prev.open, prev.close);
  const bodyBot = Math.min(prev.open, prev.close);
  return curr.open >= bodyBot && curr.open <= bodyTop;
}

function smallUpperWick(c: OHLCVCandle): boolean {
  const range = c.high - c.low;
  if (range <= 0) return true;
  return (c.high - c.close) / range <= WICK_MAX_RATIO;
}

function smallLowerWick(c: OHLCVCandle): boolean {
  const range = c.high - c.low;
  if (range <= 0) return true;
  return (c.close - c.low) / range <= WICK_MAX_RATIO;
}

interface MultiDayPatternContext {
  side: "bullish" | "bearish";
  pattern: MultiDayPattern;
  c1: OHLCVCandle;
  c2: OHLCVCandle;
  c3: OHLCVCandle;
  daily: OHLCVCandle[];
}

type FinalizeMultiDayInput = MultiDayPatternContext & {
  ltp: number;
  label: string;
};

function finalizeMultiDayRow(base: FinalizeMultiDayInput): Omit<MultiDayScanRow, "symbol"> {
  const { pattern, side, c1, c2, c3, daily, label, ltp } = base;
  const plan = buildMultiDayTradePlan({ side, pattern, c1, c2, c3, daily });
  const confluence = scoreMultiDayConfluence(side, pattern, c1, c2, c3, daily);
  const triggerNote =
    confluence.quality === "high"
      ? "High-confluence trigger"
      : confluence.quality === "noise"
        ? "Pattern only — low confluence (mid-range noise?)"
        : "Moderate confluence — verify HTF level";
  return {
    pattern,
    side,
    ltp,
    label,
    ...plan,
    ...confluenceFields(confluence),
    action: `${triggerNote}. ${plan.action} Factors: ${confluence.factors.slice(0, 3).join("; ") || confluence.htfContext}.`,
  };
}

/** ATR-buffered stops, measured-move targets, min 2R, ADX-adjusted hold estimate. */
function buildMultiDayTradePlan(
  ctx: MultiDayPatternContext,
): Omit<
  MultiDayScanRow,
  | "symbol"
  | "pattern"
  | "side"
  | "ltp"
  | "label"
  | "confluenceScore"
  | "confluenceMax"
  | "confluenceFactors"
  | "setupQuality"
  | "htfContext"
> {
  const { side, pattern, c1, c2, c3, daily } = ctx;
  const atr14 = latestIndicator(atr(daily, ATR_PERIOD));
  const adx14 = latestIndicator(adx(daily, ATR_PERIOD));
  const buffer = (atr14 ?? 0) * ATR_STOP_BUFFER;

  let entryLevel: number;
  let entryRule: string;
  let structureStop: number;
  let measuredTarget: number;
  let targetRule: string;

  if (pattern === "three_white_soldiers") {
    entryLevel = c3.high;
    entryRule = "Buy stop above 3rd candle high (pattern breakout trigger)";
    structureStop = Math.min(c1.low, c2.low, c3.low);
    measuredTarget = entryLevel + (c3.close - c1.open);
    targetRule = "Measured move: project C1 open → C3 close height from entry";
  } else if (pattern === "three_black_crows") {
    entryLevel = c3.low;
    entryRule = "Sell stop below 3rd candle low (pattern breakdown trigger)";
    structureStop = Math.max(c1.high, c2.high, c3.high);
    measuredTarget = entryLevel - (c1.open - c3.close);
    targetRule = "Measured move: project C1 open → C3 close height from entry";
  } else if (pattern === "crt_bullish") {
    const range = c1.high - c1.low;
    entryLevel = c3.close;
    entryRule = "Enter on C3 bullish close (AMD distribution); alt. break above C1 high";
    structureStop = c2.low;
    measuredTarget = c1.high + range;
    targetRule = "C1 range high + full C1 range extension (liquidity → distribution target)";
  } else {
    const range = c1.high - c1.low;
    entryLevel = c3.close;
    entryRule = "Enter on C3 bearish close (AMD distribution); alt. break below C1 low";
    structureStop = c2.high;
    measuredTarget = c1.low - range;
    targetRule = "C1 range low − full C1 range extension (liquidity → distribution target)";
  }

  const stopLoss =
    side === "bullish" ? structureStop - buffer : structureStop + buffer;
  const stopRule =
    side === "bullish"
      ? `Below pattern structure low − ${ATR_STOP_BUFFER}× ATR(${atr14 != null ? atr14.toFixed(1) : "14"})`
      : `Above pattern structure high + ${ATR_STOP_BUFFER}× ATR(${atr14 != null ? atr14.toFixed(1) : "14"})`;

  const riskPoints =
    side === "bullish" ? entryLevel - stopLoss : stopLoss - entryLevel;
  const minTarget =
    side === "bullish"
      ? entryLevel + riskPoints * MIN_RISK_REWARD
      : entryLevel - riskPoints * MIN_RISK_REWARD;
  const targetLevel =
    side === "bullish"
      ? Math.max(measuredTarget, minTarget)
      : Math.min(measuredTarget, minTarget);

  const rewardPoints =
    side === "bullish" ? targetLevel - entryLevel : entryLevel - targetLevel;
  const riskRewardRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;

  const dailyPace = atr14 ?? avgDailyRange(daily) ?? Math.max(rewardPoints / 2, 1);
  let sessionsEst = Math.ceil(rewardPoints / dailyPace);
  sessionsEst = Math.max(2, Math.min(5, sessionsEst));
  let holdDaysMin = Math.max(2, sessionsEst - 1);
  let holdDaysMax = Math.min(5, sessionsEst + 1);
  if (adx14 != null && adx14 >= 25) {
    holdDaysMax = Math.min(6, holdDaysMax + 1);
  }
  if (holdDaysMin > holdDaysMax) holdDaysMin = holdDaysMax;

  const holdDays =
    holdDaysMin === holdDaysMax
      ? `${holdDaysMin} session${holdDaysMin > 1 ? "s" : ""} (~${rewardPoints.toFixed(0)} pts)`
      : `${holdDaysMin}–${holdDaysMax} sessions (~${rewardPoints.toFixed(0)} pts)`;

  const trendNote = adx14 != null && adx14 >= 25 ? " Strong trend (ADX≥25)." : "";
  const action =
    side === "bullish"
      ? `Long NRML — R:R 1:${riskRewardRatio.toFixed(1)}, hold ${holdDaysMin}–${holdDaysMax} sessions.${trendNote} Trail stop if ADX weakens.`
      : `Short NRML — R:R 1:${riskRewardRatio.toFixed(1)}, hold ${holdDaysMin}–${holdDaysMax} sessions.${trendNote} Trail stop if ADX weakens.`;

  return {
    entryLevel,
    stopLoss,
    targetLevel,
    riskPoints,
    rewardPoints,
    riskRewardRatio,
    holdDaysMin,
    holdDaysMax,
    holdDays,
    atr14,
    adx14,
    entryRule,
    stopRule,
    targetRule,
    action,
  };
}

/** Three consecutive long green candles — each opens in prev body, closes higher. */
export function evaluateThreeWhiteSoldiers(candles: OHLCVCandle[]): Omit<MultiDayScanRow, "symbol"> | null {
  if (candles.length < 3) return null;
  const [c1, c2, c3] = candles.slice(-3);
  if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) return null;
  if (!(c2.close > c1.close && c3.close > c2.close)) return null;
  if (!openInPrevBody(c2, c1) || !openInPrevBody(c3, c2)) return null;
  if (!smallUpperWick(c1) || !smallUpperWick(c2) || !smallUpperWick(c3)) return null;

  return finalizeMultiDayRow({
    pattern: "three_white_soldiers",
    side: "bullish",
    ltp: c3.close,
    label: "🟢 Three White Soldiers",
    c1,
    c2,
    c3,
    daily: candles,
  });
}

/** Three consecutive long red candles — each opens in prev body, closes lower. */
export function evaluateThreeBlackCrows(candles: OHLCVCandle[]): Omit<MultiDayScanRow, "symbol"> | null {
  if (candles.length < 3) return null;
  const [c1, c2, c3] = candles.slice(-3);
  if (!isRed(c1) || !isRed(c2) || !isRed(c3)) return null;
  if (!(c2.close < c1.close && c3.close < c2.close)) return null;
  if (!openInPrevBody(c2, c1) || !openInPrevBody(c3, c2)) return null;
  if (!smallLowerWick(c1) || !smallLowerWick(c2) || !smallLowerWick(c3)) return null;

  return finalizeMultiDayRow({
    pattern: "three_black_crows",
    side: "bearish",
    ltp: c3.close,
    label: "🔴 Three Black Crows",
    c1,
    c2,
    c3,
    daily: candles,
  });
}

/** CRT bullish: C1 range → C2 sweeps low → C3 closes inside C1 range (green). */
export function evaluateCrtBullish(candles: OHLCVCandle[]): Omit<MultiDayScanRow, "symbol"> | null {
  if (candles.length < 3) return null;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  if (!(c2.low < c1.low)) return null;
  if (!(c3.close > c1.low && c3.close < c1.high)) return null;
  if (!isGreen(c3)) return null;

  return finalizeMultiDayRow({
    pattern: "crt_bullish",
    side: "bullish",
    ltp: c3.close,
    label: "🟢 CRT Bullish (AMD)",
    c1,
    c2,
    c3,
    daily: candles,
  });
}

/** CRT bearish: C1 range → C2 sweeps high → C3 closes inside C1 range (red). */
export function evaluateCrtBearish(candles: OHLCVCandle[]): Omit<MultiDayScanRow, "symbol"> | null {
  if (candles.length < 3) return null;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  if (!(c2.high > c1.high)) return null;
  if (!(c3.close > c1.low && c3.close < c1.high)) return null;
  if (!isRed(c3)) return null;

  return finalizeMultiDayRow({
    pattern: "crt_bearish",
    side: "bearish",
    ltp: c3.close,
    label: "🔴 CRT Bearish (AMD)",
    c1,
    c2,
    c3,
    daily: candles,
  });
}

export function evaluateMultiDayPatterns(candles: OHLCVCandle[]): Omit<MultiDayScanRow, "symbol">[] {
  const daily = toDailyCandles(candles);
  if (daily.length < 3) return [];
  const results: Omit<MultiDayScanRow, "symbol">[] = [];
  for (const fn of [
    evaluateThreeWhiteSoldiers,
    evaluateThreeBlackCrows,
    evaluateCrtBullish,
    evaluateCrtBearish,
  ]) {
    const row = fn(daily);
    if (row) results.push(row);
  }
  return results;
}

// ─── Strategy III: ORB + VWAP + Supertrend ─────────────────────────────────

export const ORB_MARKET_OPEN_MIN = 9 * 60 + 15;
export const ORB_WINDOW_END_MIN = 9 * 60 + 45;
export const SUPERTREND_PERIOD = 10;
export const SUPERTREND_MULT = 3;

export type OrbSignalState = "long" | "short" | "watch_long" | "watch_short" | "none";

export interface OrbScanRow {
  symbol: string;
  state: OrbSignalState;
  ltp: number;
  orbHigh: number;
  orbLow: number;
  vwap: number | null;
  supertrend: number | null;
  supertrendDir: 1 | -1 | null;
  entryLevel: number;
  stopLoss: number;
  targetLevel: number;
  riskPoints: number;
  rewardPoints: number;
  riskRewardRatio: number;
  confluenceScore: number;
  confluenceMax: number;
  confluenceFactors: string[];
  setupQuality: SetupQuality;
  htfContext: string;
  action: string;
  exitRule: string;
  productType: "MIS";
}

export interface OrbOptions {
  orbWindowEndMin?: number;
  supertrendPeriod?: number;
  supertrendMult?: number;
}

/**
 * ORB + VWAP + Supertrend on intraday candles (1m or 5m).
 * Long: post-ORB, close > ORB high, close > VWAP, Supertrend bullish.
 * Short: post-ORB, close < ORB low, close < VWAP, Supertrend bearish.
 */
export function evaluateOrbVwapSupertrend(
  intradayCandles: OHLCVCandle[],
  options: OrbOptions = {},
): Omit<OrbScanRow, "symbol"> | null {
  const orbEnd = options.orbWindowEndMin ?? ORB_WINDOW_END_MIN;
  const stPeriod = options.supertrendPeriod ?? SUPERTREND_PERIOD;
  const stMult = options.supertrendMult ?? SUPERTREND_MULT;

  const session = latestSessionCandles(intradayCandles);
  if (session.length < stPeriod + 5) return null;

  const orbBars = session.filter((c) => {
    const m = istMinutesSinceMidnight(c.time);
    return m >= ORB_MARKET_OPEN_MIN && m <= orbEnd;
  });
  if (orbBars.length < 2) return null;

  const orbHigh = Math.max(...orbBars.map((c) => c.high));
  const orbLow = Math.min(...orbBars.map((c) => c.low));

  const vwapVals = vwap(session);
  const st = supertrend(session, stPeriod, stMult);

  const lastIdx = session.length - 1;
  const last = session[lastIdx];
  const vwapLast = vwapVals[lastIdx];
  const stDir = st.direction[lastIdx];
  const stVal = st.values[lastIdx];

  const close = last.close;
  let state: OrbSignalState = "none";
  let action = "No aligned ORB setup";

  const aboveVwap = vwapLast != null && close > vwapLast;
  const belowVwap = vwapLast != null && close < vwapLast;
  const stBull = stDir === 1;
  const stBear = stDir === -1;

  if (close > orbHigh && aboveVwap && stBull) {
    state = "long";
    action = "Long MIS — ORB breakout above range high with VWAP & Supertrend confirmation";
  } else if (close < orbLow && belowVwap && stBear) {
    state = "short";
    action = "Short MIS — ORB breakdown below range low with VWAP & Supertrend confirmation";
  } else if (close > orbHigh && (aboveVwap || stBull)) {
    state = "watch_long";
    action = "Watch long — ORB break; waiting for full VWAP + Supertrend alignment";
  } else if (close < orbLow && (belowVwap || stBear)) {
    state = "watch_short";
    action = "Watch short — ORB break; waiting for full VWAP + Supertrend alignment";
  }

  if (state === "none") return null;

  const orbRange = orbHigh - orbLow;
  const isLong = state === "long" || state === "watch_long";
  const entryLevel = close;
  const stopLoss = isLong ? orbLow : orbHigh;
  const measuredTarget = isLong ? entryLevel + orbRange : entryLevel - orbRange;
  const riskPoints = isLong ? entryLevel - stopLoss : stopLoss - entryLevel;
  const minTarget = isLong
    ? entryLevel + riskPoints * MIN_RISK_REWARD
    : entryLevel - riskPoints * MIN_RISK_REWARD;
  const targetLevel = isLong
    ? Math.max(measuredTarget, minTarget)
    : Math.min(measuredTarget, minTarget);
  const rewardPoints = isLong ? targetLevel - entryLevel : entryLevel - targetLevel;
  const riskRewardRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;

  const exitRule = `Hard stop at ORB ${isLong ? "low" : "high"}; trail with Supertrend flip; target ORB range projection (1:${riskRewardRatio.toFixed(1)} R:R)`;
  const confluence = scoreOrbConfluence(state, close, vwapLast, stDir, orbHigh, orbLow);

  return {
    state,
    ltp: close,
    orbHigh,
    orbLow,
    vwap: vwapLast,
    supertrend: stVal,
    supertrendDir: stDir,
    entryLevel,
    stopLoss,
    targetLevel,
    riskPoints,
    rewardPoints,
    riskRewardRatio,
    ...confluenceFields(confluence),
    action: `${action} · Confluence ${confluence.score}/${confluence.maxScore}`,
    exitRule,
    productType: "MIS",
  };
}

export type StrategyKind = "btst" | "multiday" | "orb";

export type StrategySortField = "signal" | "symbol" | "ltp" | "volume" | "confluence";

export type StrategySortDir = "asc" | "desc";

const ORB_SIGNAL_RANK: Record<OrbSignalState, number> = {
  long: 0,
  watch_long: 1,
  watch_short: 2,
  short: 3,
  none: 99,
};

function cmpStrings(a: string, b: string, dir: StrategySortDir): number {
  const v = a.localeCompare(b);
  return dir === "asc" ? v : -v;
}

function cmpNumbers(a: number, b: number, dir: StrategySortDir): number {
  const v = a - b;
  return dir === "asc" ? v : -v;
}

export function sortBtstRows(
  rows: BtstScanRow[],
  field: StrategySortField,
  dir: StrategySortDir,
): BtstScanRow[] {
  return [...rows].sort((a, b) => {
    switch (field) {
      case "signal": {
        const rank = (s: BtstScanRow["side"]) => (s === "btst" ? 0 : 1);
        const v = rank(a.side) - rank(b.side);
        return (dir === "asc" ? v : -v) || a.symbol.localeCompare(b.symbol);
      }
      case "symbol":
        return cmpStrings(a.symbol, b.symbol, dir);
      case "ltp":
        return cmpNumbers(a.ltp, b.ltp, dir);
      case "volume":
        return cmpNumbers(a.volumeRatio, b.volumeRatio, dir);
      case "confluence":
        return cmpNumbers(a.confluenceScore, b.confluenceScore, dir);
      default:
        return 0;
    }
  });
}

export function sortMultiDayRows(
  rows: MultiDayScanRow[],
  field: StrategySortField,
  dir: StrategySortDir,
): MultiDayScanRow[] {
  return [...rows].sort((a, b) => {
    switch (field) {
      case "signal": {
        const rank = (s: MultiDayScanRow["side"]) => (s === "bullish" ? 0 : 1);
        const v = rank(a.side) - rank(b.side);
        return (dir === "asc" ? v : -v) || a.label.localeCompare(b.label) || a.symbol.localeCompare(b.symbol);
      }
      case "symbol":
        return cmpStrings(a.symbol, b.symbol, dir);
      case "ltp":
        return cmpNumbers(a.ltp, b.ltp, dir);
      case "confluence":
        return cmpNumbers(a.confluenceScore, b.confluenceScore, dir);
      default:
        return 0;
    }
  });
}

export function sortOrbRows(
  rows: OrbScanRow[],
  field: StrategySortField,
  dir: StrategySortDir,
): OrbScanRow[] {
  return [...rows].sort((a, b) => {
    switch (field) {
      case "signal": {
        const v = ORB_SIGNAL_RANK[a.state] - ORB_SIGNAL_RANK[b.state];
        return (dir === "asc" ? v : -v) || a.symbol.localeCompare(b.symbol);
      }
      case "symbol":
        return cmpStrings(a.symbol, b.symbol, dir);
      case "ltp":
        return cmpNumbers(a.ltp, b.ltp, dir);
      case "confluence":
        return cmpNumbers(a.confluenceScore, b.confluenceScore, dir);
      default:
        return 0;
    }
  });
}

export function strategyKindLabel(kind: StrategyKind): string {
  switch (kind) {
    case "btst":
      return "BTST / STBT";
    case "multiday":
      return "Multi-Day (Soldiers / CRT)";
    case "orb":
      return "ORB + VWAP + Supertrend";
  }
}
