/**
 * Event-driven candle anomaly detection (ATR range + volume SMA gates).
 * Mirrors proxy_server/alert_pipeline for client-side tests and tooling.
 */

export interface OhlcvCandle {
  timestamp: number;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnomalyConfig {
  bufferMax: number;
  atrPeriod: number;
  volumeSmaPeriod: number;
  priceRangeAtrMult: number;
  volumeSmaMult: number;
  maxStaleMs: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  bufferMax: 30,
  atrPeriod: 14,
  volumeSmaPeriod: 20,
  priceRangeAtrMult: 2,
  volumeSmaMult: 2.5,
  maxStaleMs: 5 * 60 * 1000,
};

export interface OutboundAlertPayload {
  ticker: string;
  action: string;
  strikePrice: number;
  entryPrice: number;
  stopLoss: number;
  direction: "bullish" | "bearish";
  timestamp: number;
  anomalyRange: number;
  atrBaseline: number;
  volumeBaseline: number;
}

export const ALERT_ASSETS = [
  "NIFTY",
  "BANKNIFTY",
  "NIFTYSC50",
  "NIFTYSC100",
  "NIFTYSC250",
] as const;

export type AlertAsset = (typeof ALERT_ASSETS)[number];

export const ALERT_STRIKE_STEP: Record<AlertAsset, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  NIFTYSC50: 25,
  NIFTYSC100: 50,
  NIFTYSC250: 100,
};

export const INDEX_ONLY_ALERT_ASSETS = new Set<AlertAsset>([
  "NIFTYSC50",
  "NIFTYSC100",
  "NIFTYSC250",
]);

const TICKER_ALIASES: Record<string, AlertAsset> = {
  NIFTY: "NIFTY",
  NIFTY50: "NIFTY",
  "NIFTY 50": "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  "NIFTY BANK": "BANKNIFTY",
  "BANK NIFTY": "BANKNIFTY",
  NIFTYSC50: "NIFTYSC50",
  "NIFTY SMALLCAP 50": "NIFTYSC50",
  "NIFTY SMALLCAP50": "NIFTYSC50",
  NIFTYSC100: "NIFTYSC100",
  "NIFTY SMALLCAP 100": "NIFTYSC100",
  "NIFTY SMALLCAP100": "NIFTYSC100",
  NIFTYSC250: "NIFTYSC250",
  "NIFTY SMALLCAP 250": "NIFTYSC250",
  "NIFTY SMALLCAP250": "NIFTYSC250",
};

export function normalizeTicker(raw: string): AlertAsset | null {
  const key = raw.trim().toUpperCase();
  if (TICKER_ALIASES[key]) return TICKER_ALIASES[key];
  const compact = key.replace(/\s+/g, "");
  if (TICKER_ALIASES[compact]) return TICKER_ALIASES[compact];
  if ((ALERT_ASSETS as readonly string[]).includes(key)) return key as AlertAsset;
  return null;
}

export function appendCandle(buffer: OhlcvCandle[], candle: OhlcvCandle, maxLen: number): OhlcvCandle[] {
  const next = [...buffer, candle];
  return next.length > maxLen ? next.slice(-maxLen) : next;
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/** Wilder-style ATR aligned with taCompute.ts */
export function atrSeries(candles: OhlcvCandle[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(candles.length).fill(null);
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

export function latestAtr(candles: OhlcvCandle[], period: number): number | null {
  const series = atrSeries(candles, period);
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] != null) return series[i];
  }
  return null;
}

export function evaluateAnomalyGates(
  buffer: OhlcvCandle[],
  incoming: OhlcvCandle,
  cfg: AnomalyConfig = DEFAULT_ANOMALY_CONFIG,
): { passed: boolean; range: number; atr: number; volumeSma: number } {
  const updated = appendCandle(buffer, incoming, cfg.bufferMax);
  const minLen = Math.max(cfg.atrPeriod, cfg.volumeSmaPeriod);
  if (updated.length < minLen) {
    return { passed: false, range: 0, atr: 0, volumeSma: 0 };
  }
  const atr = latestAtr(updated, cfg.atrPeriod);
  const volumeSma = sma(
    updated.map((c) => c.volume),
    cfg.volumeSmaPeriod,
  );
  if (atr == null || volumeSma == null || atr <= 0 || volumeSma <= 0) {
    return { passed: false, range: 0, atr: atr ?? 0, volumeSma: volumeSma ?? 0 };
  }
  const range = incoming.high - incoming.low;
  const gateA = range > cfg.priceRangeAtrMult * atr;
  const gateB = incoming.volume > cfg.volumeSmaMult * volumeSma;
  return { passed: gateA && gateB, range, atr, volumeSma };
}

export function atmStrike(spot: number, step: number): number {
  return Math.round(spot / step) * step;
}

export function formatOutboundAlert(
  incoming: OhlcvCandle,
  meta: { range: number; atr: number; volumeSma: number },
  step?: number,
): OutboundAlertPayload {
  const asset = normalizeTicker(incoming.ticker) ?? "NIFTY";
  const strikeStep = step ?? ALERT_STRIKE_STEP[asset] ?? 50;
  const bullish = incoming.close > incoming.open;
  const strike = atmStrike(incoming.close, strikeStep);
  return {
    ticker: incoming.ticker,
    action: bullish ? `Buy ${strike} CE` : `Buy ${strike} PE`,
    strikePrice: strike,
    entryPrice: incoming.close,
    stopLoss: bullish ? incoming.low : incoming.high,
    direction: bullish ? "bullish" : "bearish",
    timestamp: incoming.timestamp,
    anomalyRange: meta.range,
    atrBaseline: meta.atr,
    volumeBaseline: meta.volumeSma,
  };
}
