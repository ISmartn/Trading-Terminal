/**
 * Indian market transaction cost model for backtests (MIS / NRML).
 * Approximates brokerage, STT, exchange, SEBI, stamp, GST, and slippage.
 * Rates are simplified — verify against your broker schedule before live trading.
 */

export type ProductType = "MIS" | "NRML";
export type InstrumentClass = "index_futures" | "stock_futures" | "index_options" | "stock_options" | "equity";

export interface TradeLeg {
  /** Notional turnover (price × qty for futures; premium × qty for options). */
  turnover: number;
  side: "buy" | "sell";
  product: ProductType;
  instrument: InstrumentClass;
}

export interface CostBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
  slippage: number;
  total: number;
}

const BROKERAGE_FLAT = 20;
const GST_RATE = 0.18;
const EXCHANGE_RATE = 0.000019; // ~NSE F&O transaction charge order of magnitude
const SEBI_PER_CRORE = 10;

/** STT rates (simplified, on turnover unless noted). */
function sttRate(instrument: InstrumentClass, side: "buy" | "sell", product: ProductType): number {
  if (instrument === "index_futures" || instrument === "stock_futures") {
    return side === "sell" ? 0.000125 : 0;
  }
  if (instrument === "index_options" || instrument === "stock_options") {
    return side === "sell" ? 0.001 : 0;
  }
  if (product === "MIS") return side === "sell" ? 0.00025 : 0;
  return side === "sell" ? 0.001 : 0;
}

export function estimateLegCosts(leg: TradeLeg, slippagePoints = 0, pointValue = 1): CostBreakdown {
  const brokerage = BROKERAGE_FLAT;
  const stt = leg.turnover * sttRate(leg.instrument, leg.side, leg.product);
  const exchange = leg.turnover * EXCHANGE_RATE;
  const sebi = (leg.turnover / 1e7) * SEBI_PER_CRORE;
  const stamp = leg.product === "MIS" ? 0 : leg.turnover * 0.00003;
  const gstBase = brokerage + exchange + sebi;
  const gst = gstBase * GST_RATE;
  const slippage = slippagePoints * pointValue;

  return {
    brokerage,
    stt,
    exchange,
    sebi,
    stamp,
    gst,
    slippage,
    total: brokerage + stt + exchange + sebi + stamp + gst + slippage,
  };
}

/** Round-trip costs for one completed intraday futures trade (entry + exit). */
export function estimateRoundTripFuturesCosts(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  instrument: InstrumentClass = "index_futures",
  slippagePointsPerLeg = 1,
  pointValue = 1,
): CostBreakdown {
  const entryLeg: TradeLeg = {
    turnover: entryPrice * quantity,
    side: "buy",
    product: "MIS",
    instrument,
  };
  const exitLeg: TradeLeg = {
    turnover: exitPrice * quantity,
    side: "sell",
    product: "MIS",
    instrument,
  };

  const e = estimateLegCosts(entryLeg, slippagePointsPerLeg, pointValue);
  const x = estimateLegCosts(exitLeg, slippagePointsPerLeg, pointValue);

  return {
    brokerage: e.brokerage + x.brokerage,
    stt: e.stt + x.stt,
    exchange: e.exchange + x.exchange,
    sebi: e.sebi + x.sebi,
    stamp: e.stamp + x.stamp,
    gst: e.gst + x.gst,
    slippage: e.slippage + x.slippage,
    total: e.total + x.total,
  };
}
