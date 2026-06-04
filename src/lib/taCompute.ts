/**
 * Technical analysis computations (TA-Lib compatible algorithms).
 * Used client-side from OHLCV candles; mirrored server-side in proxy_server/ta_indicators.py.
 * Reference: https://ta-lib.org/
 */

import type { OHLCVCandle } from "@/hooks/useChartData";

export type IndicatorId =
  | "rsi"
  | "macd"
  | "bbands"
  | "atr"
  | "adx"
  | "ema"
  | "sma"
  | "stoch"
  | "obv"
  | "vwap";

export interface IndicatorConfig {
  rsi_period?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  bb_period?: number;
  bb_std?: number;
  atr_period?: number;
  adx_period?: number;
  ema_period?: number;
  sma_period?: number;
  stoch_k?: number;
  stoch_d?: number;
}

export const DEFAULT_TA_CONFIG: Required<IndicatorConfig> = {
  rsi_period: 14,
  macd_fast: 12,
  macd_slow: 26,
  macd_signal: 9,
  bb_period: 20,
  bb_std: 2,
  atr_period: 14,
  adx_period: 14,
  ema_period: 20,
  sma_period: 50,
  stoch_k: 14,
  stoch_d: 3,
};

export interface TASeriesPoint {
  time: number;
  value: number | null;
}

export interface MACDSeries {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export interface BBandsSeries {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

export interface StochSeries {
  k: (number | null)[];
  d: (number | null)[];
}

export interface CandlePattern {
  time: number;
  name: string;
  direction: "bullish" | "bearish" | "neutral";
}

export interface TAIndicatorResult {
  timestamps: number[];
  indicators: {
    rsi?: { values: (number | null)[] };
    macd?: MACDSeries;
    bbands?: BBandsSeries;
    atr?: { values: (number | null)[] };
    adx?: { values: (number | null)[] };
    ema?: { values: (number | null)[]; period: number };
    sma?: { values: (number | null)[]; period: number };
    stoch?: StochSeries;
    obv?: { values: (number | null)[] };
    vwap?: { values: (number | null)[] };
  };
  patterns: CandlePattern[];
  summary?: TASnapshotSummary;
}

export interface TASnapshotSummary {
  rsi: number | null;
  rsiLabel: string;
  adx: number | null;
  adxLabel: string;
  atr: number | null;
  bbWidth: number | null;
  bbWidthLabel: string;
  macdSignal: "bullish" | "bearish" | "neutral";
  trend: "uptrend" | "downtrend" | "sideways";
  patternToday: string | null;
  /** Last bar volume from Upstox historical candles */
  volume?: number | null;
  volumeAvg20?: number | null;
  vwap?: number | null;
  priceVsVwap?: "above" | "below" | "at";
  /** Signed % distance of last close from session VWAP */
  vwapDeviationPct?: number | null;
}

export interface TAScannerRow {
  symbol: string;
  ltp: number;
  changePercent: number;
  rsi: number | null;
  adx: number | null;
  macdSignal: string;
  signal: string;
  signalType: "bullish" | "bearish" | "neutral";
}

function closes(candles: OHLCVCandle[]): number[] {
  return candles.map((c) => c.close);
}

function highs(candles: OHLCVCandle[]): number[] {
  return candles.map((c) => c.high);
}

function lows(candles: OHLCVCandle[]): number[] {
  return candles.map((c) => c.low);
}

function volumes(candles: OHLCVCandle[]): number[] {
  return candles.map((c) => c.volume ?? 0);
}

function padNull(n: number): (number | null)[] {
  return Array(n).fill(null);
}

export function ema(values: number[], period: number): (number | null)[] {
  const out = padNull(values.length);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): (number | null)[] {
  const out = padNull(values.length);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    out[i] = slice.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out = padNull(values.length);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDSeries {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i]! - emaSlow[i]! : null,
  );
  const macdNums = macdLine.map((v) => (v == null ? 0 : v));
  const signalLine = ema(
    macdNums.map((v, i) => (macdLine[i] == null ? macdNums[i - 1] ?? 0 : v)),
    signal,
  );
  const hist = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i]! : null,
  );
  return { macd: macdLine, signal: signalLine, hist };
}

export function bollingerBands(
  values: number[],
  period = 20,
  stdDev = 2,
): BBandsSeries {
  const middle = sma(values, period);
  const upper = padNull(values.length);
  const lower = padNull(values.length);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i]!;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdDev * sd;
    lower[i] = mean - stdDev * sd;
  }
  return { upper, middle, lower };
}

export function atr(candles: OHLCVCandle[], period = 14): (number | null)[] {
  const out = padNull(candles.length);
  if (candles.length < 2) return out;
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let sum = tr.slice(0, period).reduce((a, b) => a + b, 0);
  if (tr.length >= period) out[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    sum = (out[i - 1]! * (period - 1) + tr[i]) / period;
    out[i] = sum;
  }
  return out;
}

export function adx(candles: OHLCVCandle[], period = 14): (number | null)[] {
  const len = candles.length;
  const out = padNull(len);
  if (len < period * 2) return out;

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trArr: number[] = [];

  for (let i = 1; i < len; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trArr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  let smTr = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dx: (number | null)[] = padNull(len);

  for (let i = period; i < trArr.length; i++) {
    smTr = smTr - smTr / period + trArr[i];
    smPlus = smPlus - smPlus / period + plusDM[i];
    smMinus = smMinus - smMinus / period + minusDM[i];
    const pdi = smTr === 0 ? 0 : (100 * smPlus) / smTr;
    const mdi = smTr === 0 ? 0 : (100 * smMinus) / smTr;
    const sum = pdi + mdi;
    dx[i + 1] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
  }

  const adxStart = period * 2 - 1;
  let adxVal = 0;
  let count = 0;
  for (let i = period; i <= adxStart && i < dx.length; i++) {
    if (dx[i] != null) {
      adxVal += dx[i]!;
      count++;
    }
  }
  if (count > 0) {
    adxVal /= count;
    out[adxStart] = adxVal;
  }
  for (let i = adxStart + 1; i < len; i++) {
    if (dx[i] != null && out[i - 1] != null) {
      adxVal = (out[i - 1]! * (period - 1) + dx[i]!) / period;
      out[i] = adxVal;
    }
  }
  return out;
}

export function stochastic(
  candles: OHLCVCandle[],
  kPeriod = 14,
  dPeriod = 3,
): StochSeries {
  const k = padNull(candles.length);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...slice.map((c) => c.high));
    const ll = Math.min(...slice.map((c) => c.low));
    k[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const kNums = k.map((v) => v ?? 0);
  const d = sma(kNums, dPeriod);
  return { k, d };
}

export function istDayKey(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** True when multiple candles share the same session day (intraday data). */
export function isIntradaySeries(candles: OHLCVCandle[]): boolean {
  if (candles.length < 3) return false;
  const days = new Set(candles.map((c) => istDayKey(c.time)));
  return days.size < candles.length * 0.85;
}

/**
 * VWAP from Upstox OHLCV + volume.
 * Intraday: resets each IST session day (standard session VWAP).
 * Daily: cumulative from period start (anchored VWAP).
 */
export function vwap(candles: OHLCVCandle[]): (number | null)[] {
  const out: (number | null)[] = [];
  const sessionReset = isIntradaySeries(candles);
  const hasVolume = candles.some((c) => (c.volume ?? 0) > 0);
  let cumVolPrice = 0;
  let cumVol = 0;
  let sessionDay: string | null = null;

  for (const c of candles) {
    const day = istDayKey(c.time);
    if (sessionReset && sessionDay !== day) {
      cumVolPrice = 0;
      cumVol = 0;
      sessionDay = day;
    }

    const rawVol = c.volume ?? 0;
    // Indices often have zero volume from Upstox — fall back to equal-weight typical price
    const vol = hasVolume ? rawVol : 1;
    const tp = (c.high + c.low + c.close) / 3;

    if (vol > 0) {
      cumVolPrice += tp * vol;
      cumVol += vol;
      out.push(cumVolPrice / cumVol);
    } else if (cumVol > 0) {
      out.push(cumVolPrice / cumVol);
    } else {
      out.push(null);
    }
  }
  return out;
}

export interface SupertrendSeries {
  /** Supertrend line value per bar */
  values: (number | null)[];
  /** 1 = bullish (green), -1 = bearish (red) */
  direction: (1 | -1 | null)[];
}

/** Supertrend — ATR-based trailing stop (default: period 10, multiplier 3). */
export function supertrend(
  candles: OHLCVCandle[],
  period = 10,
  multiplier = 3,
): SupertrendSeries {
  const values = padNull(candles.length) as (number | null)[];
  const direction = padNull(candles.length) as (1 | -1 | null)[];
  const atrVals = atr(candles, period);
  if (candles.length <= period) return { values, direction };

  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let prevDir: 1 | -1 = 1;

  for (let i = period; i < candles.length; i++) {
    const atrVal = atrVals[i];
    if (atrVal == null) continue;

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + multiplier * atrVal;
    const basicLower = hl2 - multiplier * atrVal;

    const finalUpper =
      i === period || basicUpper < prevFinalUpper || candles[i - 1].close > prevFinalUpper
        ? basicUpper
        : prevFinalUpper;
    const finalLower =
      i === period || basicLower > prevFinalLower || candles[i - 1].close < prevFinalLower
        ? basicLower
        : prevFinalLower;

    let st: number;
    let dir: 1 | -1;

    if (i === period) {
      dir = candles[i].close >= hl2 ? 1 : -1;
      st = dir === 1 ? finalLower : finalUpper;
    } else if (prevDir === 1) {
      if (candles[i].close <= finalLower) {
        dir = -1;
        st = finalUpper;
      } else {
        dir = 1;
        st = finalLower;
      }
    } else if (candles[i].close >= finalUpper) {
      dir = 1;
      st = finalLower;
    } else {
      dir = -1;
      st = finalUpper;
    }

    values[i] = st;
    direction[i] = dir;
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevDir = dir;
  }

  return { values, direction };
}

export function obv(candles: OHLCVCandle[]): (number | null)[] {
  const out: (number | null)[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].volume ?? 0;
    const prev = out[i - 1] ?? 0;
    if (candles[i].close > candles[i - 1].close) out.push(prev + vol);
    else if (candles[i].close < candles[i - 1].close) out.push(prev - vol);
    else out.push(prev);
  }
  return out;
}

/**
 * Candlestick pattern detection (TypeScript fallback).
 * Chart Pattern Scanner uses proxy TA-Lib via /api/chart-pattern/* — prefer that for scans.
 */
export function detectPatterns(candles: OHLCVCandle[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 0.0001;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    // Doji
    if (body / range < 0.1) {
      patterns.push({ time: c.time, name: "DOJI", direction: "neutral" });
    }
    // Hammer
    if (lowerWick > body * 2 && upperWick < body * 0.5 && c.close >= c.open) {
      patterns.push({ time: c.time, name: "HAMMER", direction: "bullish" });
    }
    // Shooting star
    if (upperWick > body * 2 && lowerWick < body * 0.5 && c.close <= c.open) {
      patterns.push({ time: c.time, name: "SHOOTING_STAR", direction: "bearish" });
    }
    // Bullish engulfing
    if (
      p.close < p.open &&
      c.close > c.open &&
      c.open <= p.close &&
      c.close >= p.open
    ) {
      patterns.push({ time: c.time, name: "BULLISH_ENGULFING", direction: "bullish" });
    }
    // Bearish engulfing
    if (
      p.close > p.open &&
      c.close < c.open &&
      c.open >= p.close &&
      c.close <= p.open
    ) {
      patterns.push({ time: c.time, name: "BEARISH_ENGULFING", direction: "bearish" });
    }
  }
  return patterns;
}

function lastValid(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

export function buildSummary(
  candles: OHLCVCandle[],
  indicators: TAIndicatorResult["indicators"],
  patterns: CandlePattern[],
): TASnapshotSummary {
  const rsiVal = lastValid(indicators.rsi?.values ?? []);
  const adxVal = lastValid(indicators.adx?.values ?? []);
  const atrVal = lastValid(indicators.atr?.values ?? []);
  const bb = indicators.bbands;
  const lastIdx = candles.length - 1;
  let bbWidth: number | null = null;
  if (bb && bb.upper[lastIdx] != null && bb.lower[lastIdx] != null && bb.middle[lastIdx]) {
    bbWidth = ((bb.upper[lastIdx]! - bb.lower[lastIdx]!) / bb.middle[lastIdx]!) * 100;
  }

  const macdHist = indicators.macd?.hist ?? [];
  const macdSig = indicators.macd?.signal ?? [];
  let macdSignal: TASnapshotSummary["macdSignal"] = "neutral";
  const h = lastValid(macdHist);
  const prevH = macdHist.length > 1 ? macdHist[macdHist.length - 2] : null;
  if (h != null && prevH != null) {
    if (h > 0 && prevH <= 0) macdSignal = "bullish";
    else if (h < 0 && prevH >= 0) macdSignal = "bearish";
    else if (h > 0) macdSignal = "bullish";
    else if (h < 0) macdSignal = "bearish";
  }

  const ema20 = lastValid(indicators.ema?.values ?? []);
  const close = candles[lastIdx]?.close ?? 0;
  let trend: TASnapshotSummary["trend"] = "sideways";
  if (ema20 != null) {
    if (close > ema20 * 1.005) trend = "uptrend";
    else if (close < ema20 * 0.995) trend = "downtrend";
  }

  const recentPattern = patterns.filter((p) => p.time === candles[lastIdx]?.time).pop();

  const lastVol = candles[lastIdx]?.volume ?? null;
  const volWindow = candles.slice(-20).map((c) => c.volume ?? 0).filter((v) => v > 0);
  const volAvg20 = volWindow.length ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : null;

  const vwapVal = lastValid(indicators.vwap?.values ?? []);
  let priceVsVwap: TASnapshotSummary["priceVsVwap"] = "at";
  let vwapDeviationPct: number | null = null;
  if (vwapVal != null && close) {
    const diffPct = ((close - vwapVal) / vwapVal) * 100;
    vwapDeviationPct = diffPct;
    if (diffPct > 0.15) priceVsVwap = "above";
    else if (diffPct < -0.15) priceVsVwap = "below";
  }

  return {
    rsi: rsiVal,
    rsiLabel:
      rsiVal == null ? "N/A" : rsiVal > 70 ? "Overbought" : rsiVal < 30 ? "Oversold" : "Neutral",
    adx: adxVal,
    adxLabel: adxVal == null ? "N/A" : adxVal > 25 ? "Strong trend" : adxVal > 20 ? "Trending" : "Weak/range",
    atr: atrVal,
    bbWidth,
    bbWidthLabel:
      bbWidth == null ? "N/A" : bbWidth < 4 ? "Squeeze (low vol)" : bbWidth > 8 ? "Expanded (high vol)" : "Normal",
    macdSignal,
    trend,
    patternToday: recentPattern?.name ?? null,
    volume: lastVol,
    volumeAvg20: volAvg20,
    vwap: vwapVal,
    priceVsVwap,
    vwapDeviationPct,
  };
}

export function computeIndicators(
  candles: OHLCVCandle[],
  selected: IndicatorId[],
  config: IndicatorConfig = {},
): TAIndicatorResult {
  const cfg = { ...DEFAULT_TA_CONFIG, ...config };
  const c = closes(candles);
  const timestamps = candles.map((x) => x.time);
  const indicators: TAIndicatorResult["indicators"] = {};

  if (selected.includes("rsi")) {
    indicators.rsi = { values: rsi(c, cfg.rsi_period) };
  }
  if (selected.includes("macd")) {
    indicators.macd = macd(c, cfg.macd_fast, cfg.macd_slow, cfg.macd_signal);
  }
  if (selected.includes("bbands")) {
    indicators.bbands = bollingerBands(c, cfg.bb_period, cfg.bb_std);
  }
  if (selected.includes("atr")) {
    indicators.atr = { values: atr(candles, cfg.atr_period) };
  }
  if (selected.includes("adx")) {
    indicators.adx = { values: adx(candles, cfg.adx_period) };
  }
  if (selected.includes("ema")) {
    indicators.ema = { values: ema(c, cfg.ema_period), period: cfg.ema_period };
  }
  if (selected.includes("sma")) {
    indicators.sma = { values: sma(c, cfg.sma_period), period: cfg.sma_period };
  }
  if (selected.includes("stoch")) {
    indicators.stoch = stochastic(candles, cfg.stoch_k, cfg.stoch_d);
  }
  if (selected.includes("obv")) {
    indicators.obv = { values: obv(candles) };
  }
  if (selected.includes("vwap")) {
    indicators.vwap = { values: vwap(candles) };
  }

  const patterns = detectPatterns(candles);
  const summary = buildSummary(
    candles,
    {
      ...indicators,
      rsi: indicators.rsi ?? { values: rsi(c, cfg.rsi_period) },
      adx: indicators.adx ?? { values: adx(candles, cfg.adx_period) },
      atr: indicators.atr ?? { values: atr(candles, cfg.atr_period) },
      bbands: indicators.bbands ?? bollingerBands(c, cfg.bb_period, cfg.bb_std),
      macd: indicators.macd ?? macd(c, cfg.macd_fast, cfg.macd_slow, cfg.macd_signal),
      ema: indicators.ema ?? { values: ema(c, cfg.ema_period), period: cfg.ema_period },
      vwap: indicators.vwap ?? { values: vwap(candles) },
    },
    patterns,
  );

  return { timestamps, indicators, patterns, summary };
}

export function buildScannerSignal(
  rsiVal: number | null,
  adxVal: number | null,
  macdSignal: string,
): { signal: string; signalType: "bullish" | "bearish" | "neutral" } {
  if (rsiVal != null && rsiVal > 70) return { signal: "Overbought", signalType: "bearish" };
  if (rsiVal != null && rsiVal < 30) return { signal: "Oversold", signalType: "bullish" };
  if (macdSignal === "bullish" && adxVal != null && adxVal > 25)
    return { signal: "Bullish + trend", signalType: "bullish" };
  if (macdSignal === "bearish" && adxVal != null && adxVal > 25)
    return { signal: "Bearish + trend", signalType: "bearish" };
  if (macdSignal === "bullish") return { signal: "MACD bull cross", signalType: "bullish" };
  if (macdSignal === "bearish") return { signal: "MACD bear cross", signalType: "bearish" };
  return { signal: "Neutral", signalType: "neutral" };
}

export const INDICATOR_META: Record<
  IndicatorId,
  { label: string; description: string; overlay: boolean; pane?: "rsi" | "macd" | "stoch" | "obv" }
> = {
  rsi: { label: "RSI", description: "Relative Strength Index (14)", overlay: false, pane: "rsi" },
  macd: { label: "MACD", description: "MACD (12,26,9)", overlay: false, pane: "macd" },
  bbands: { label: "Bollinger", description: "Bollinger Bands (20,2)", overlay: true },
  atr: { label: "ATR", description: "Average True Range (14)", overlay: false },
  adx: { label: "ADX", description: "Average Directional Index (14)", overlay: false },
  ema: { label: "EMA", description: "Exponential MA (20)", overlay: true },
  sma: { label: "SMA", description: "Simple MA (50)", overlay: true },
  stoch: { label: "Stochastic", description: "Stochastic (14,3)", overlay: false, pane: "stoch" },
  obv: { label: "OBV", description: "On Balance Volume", overlay: false, pane: "obv" },
  vwap: { label: "VWAP", description: "Volume Weighted Avg Price", overlay: true },
};
