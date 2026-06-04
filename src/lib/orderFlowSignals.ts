/**
 * Order-flow proxies from OHLCV (no tick/footprint feed).
 * Effort vs. result absorption, approximate CVD, and divergence scans.
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import { latestSessionCandles } from "@/lib/chartTime";

export type AbsorptionKind = "selling_absorption" | "buying_absorption" | "none";
export type CvdDivergenceKind = "bullish" | "bearish" | "none";
export type OrderFlowBias = "long" | "short" | "mixed";

export interface FootprintProxy {
  /** Signed volume proxy: positive = ask-side aggression, negative = bid-side */
  delta: number;
  bidVolumeProxy: number;
  askVolumeProxy: number;
}

export interface AbsorptionEvent {
  kind: AbsorptionKind;
  candleTime: number;
  effortRatio: number;
  resultRatio: number;
  delta: number;
  reason: string;
}

export interface OrderFlowScanRow {
  symbol: string;
  absorption: AbsorptionKind;
  cvdDivergence: CvdDivergenceKind;
  bias: OrderFlowBias;
  ltp: number;
  action: string;
  confidence: "high" | "medium" | "low";
}

/** Resolve trade bias when absorption and CVD may disagree. */
export function resolveOrderFlowBias(
  absorption: AbsorptionKind,
  cvdDivergence: CvdDivergenceKind,
): OrderFlowBias {
  const longSignals =
    (absorption === "selling_absorption" ? 1 : 0) + (cvdDivergence === "bullish" ? 1 : 0);
  const shortSignals =
    (absorption === "buying_absorption" ? 1 : 0) + (cvdDivergence === "bearish" ? 1 : 0);
  if (longSignals > 0 && shortSignals > 0) return "mixed";
  if (longSignals > 0) return "long";
  if (shortSignals > 0) return "short";
  return "mixed";
}

function buildOrderFlowAction(
  absorption: AbsorptionKind,
  cvdDivergence: CvdDivergenceKind,
  bias: OrderFlowBias,
  absorptionDetail?: string,
): string {
  const head =
    bias === "long"
      ? "Long bias"
      : bias === "short"
        ? "Short bias"
        : "Mixed bias";
  const parts: string[] = [head];
  if (absorption === "selling_absorption") parts.push("selling absorbed at lows");
  if (absorption === "buying_absorption") parts.push("buying absorbed at highs");
  if (cvdDivergence === "bullish") parts.push("CVD bullish divergence");
  if (cvdDivergence === "bearish") parts.push("CVD bearish divergence");
  if (bias === "mixed") parts.push("signals conflict — confirm on chart");
  let action = parts.join(" · ");
  if (absorptionDetail) action += ` · ${absorptionDetail}`;
  return action;
}

const EFFORT_VOL_MULT = 1.8;
const MIN_RESULT_RANGE_RATIO = 0.35;

/** Split bar volume into bid/ask proxies from close location in range. */
export function footprintProxy(c: OHLCVCandle): FootprintProxy {
  const vol = c.volume ?? 0;
  const range = c.high - c.low;
  if (range <= 0 || vol <= 0) {
    return { delta: 0, bidVolumeProxy: vol / 2, askVolumeProxy: vol / 2 };
  }
  const buyPct = (c.close - c.low) / range;
  const askVolumeProxy = vol * buyPct;
  const bidVolumeProxy = vol * (1 - buyPct);
  return { delta: askVolumeProxy - bidVolumeProxy, bidVolumeProxy, askVolumeProxy };
}

/**
 * Effort vs. result: heavy volume in one direction but candle fails to extend (absorption).
 */
export function detectAbsorption(c: OHLCVCandle, avgVol: number): AbsorptionEvent | null {
  const vol = c.volume ?? 0;
  if (avgVol <= 0 || vol < avgVol * EFFORT_VOL_MULT) return null;

  const range = c.high - c.low;
  if (range <= 0) return null;

  const fp = footprintProxy(c);
  const effortRatio = vol / avgVol;
  const body = Math.abs(c.close - c.open);
  const resultRatio = body / range;

  if (resultRatio > MIN_RESULT_RANGE_RATIO) return null;

  const heavySell = fp.delta < 0 && Math.abs(fp.delta) > vol * 0.15;
  const heavyBuy = fp.delta > 0 && fp.delta > vol * 0.15;

  if (heavySell && c.close >= c.open && (c.high - c.close) / range >= 0.2) {
    return {
      kind: "selling_absorption",
      candleTime: c.time,
      effortRatio,
      resultRatio,
      delta: fp.delta,
      reason: "Heavy sell effort, flat/higher close — passive bid absorption (floor)",
    };
  }

  if (heavyBuy && c.close <= c.open && (c.close - c.low) / range >= 0.2) {
    return {
      kind: "buying_absorption",
      candleTime: c.time,
      effortRatio,
      resultRatio,
      delta: fp.delta,
      reason: "Heavy buy effort, flat/lower close — passive ask absorption (ceiling)",
    };
  }

  return null;
}

/** Approximate cumulative volume delta from signed bar deltas. */
export function approximateCvd(session: OHLCVCandle[]): number[] {
  let cum = 0;
  return session.map((c) => {
    cum += footprintProxy(c).delta;
    return cum;
  });
}

/** Price lower low + CVD higher low → bullish absorption divergence. */
export function cvdDivergence(
  session: OHLCVCandle[],
  lookback = 12,
): "bullish" | "bearish" | "none" {
  if (session.length < lookback + 2) return "none";
  const cvd = approximateCvd(session);
  const slice = session.slice(-lookback);
  const cvdSlice = cvd.slice(-lookback);

  const priceLows = slice.map((c) => c.low);
  const priceHighs = slice.map((c) => c.high);
  const mid = Math.floor(lookback / 2);

  const earlyLow = Math.min(...priceLows.slice(0, mid));
  const lateLow = Math.min(...priceLows.slice(mid));
  const earlyCvdAtLow = cvdSlice[priceLows.slice(0, mid).indexOf(earlyLow)] ?? cvdSlice[0];
  const lateCvdAtLow = cvdSlice[mid + priceLows.slice(mid).indexOf(lateLow)] ?? cvdSlice[cvdSlice.length - 1];

  if (lateLow < earlyLow && lateCvdAtLow > earlyCvdAtLow) return "bullish";

  const earlyHigh = Math.max(...priceHighs.slice(0, mid));
  const lateHigh = Math.max(...priceHighs.slice(mid));
  const earlyCvdAtHigh = cvdSlice[priceHighs.slice(0, mid).indexOf(earlyHigh)] ?? cvdSlice[0];
  const lateCvdAtHigh = cvdSlice[mid + priceHighs.slice(mid).indexOf(lateHigh)] ?? cvdSlice[cvdSlice.length - 1];

  if (lateHigh > earlyHigh && lateCvdAtHigh < earlyCvdAtHigh) return "bearish";

  return "none";
}

export const ORDER_FLOW_CATALOG = {
  name: "Order Flow — Absorption & CVD",
  product: "MIS" as const,
  note: "Footprint columns are approximated from OHLCV until tick data is available.",
};

export function evaluateOrderFlow(
  intradayCandles: OHLCVCandle[],
): Omit<OrderFlowScanRow, "symbol"> | null {
  const session = latestSessionCandles(intradayCandles);
  if (session.length < 25) return null;

  const vols = session.slice(-20).map((c) => c.volume ?? 0).filter((v) => v > 0);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
  if (!avgVol) return null;

  const last = session[session.length - 1];
  const absorption = detectAbsorption(last, avgVol);
  const div = cvdDivergence(session);

  if (!absorption && div === "none") return null;

  const kind = absorption?.kind ?? "none";
  const bias = resolveOrderFlowBias(kind, div);
  const aligned =
    (kind === "selling_absorption" && div === "bullish") ||
    (kind === "buying_absorption" && div === "bearish");
  const confidence: OrderFlowScanRow["confidence"] =
    kind !== "none" && div !== "none"
      ? aligned
        ? "high"
        : "medium"
      : kind !== "none" || div !== "none"
        ? "medium"
        : "low";

  const action = buildOrderFlowAction(
    kind,
    div,
    bias,
    absorption?.reason,
  );

  return {
    absorption: kind,
    cvdDivergence: div,
    bias,
    ltp: last.close,
    action,
    confidence,
  };
}
