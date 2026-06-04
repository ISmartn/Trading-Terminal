/**
 * Phase 3 — Intraday backtest engine (bar-by-bar, no look-ahead).
 * Validates ORB + VWAP + Supertrend with Indian cost model + slippage.
 */

import type { OHLCVCandle } from "@/hooks/useChartData";
import { istDayKey, supertrend } from "@/lib/taCompute";
import {
  ORB_MARKET_OPEN_MIN,
  ORB_WINDOW_END_MIN,
  SUPERTREND_MULT,
  SUPERTREND_PERIOD,
  evaluateOrbVwapSupertrend,
  istMinutesSinceMidnight,
} from "@/lib/fnoStrategies";
import { estimateRoundTripFuturesCosts } from "@/lib/indiaTradingCosts";

export interface BacktestTrade {
  sessionDate: string;
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  exitReason: string;
}

export interface BacktestResult {
  alpha: "momentum_breakout";
  trades: BacktestTrade[];
  sessions: number;
  tradeCount: number;
  winRate: number;
  grossPnl: number;
  totalCosts: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  avgNetPerTrade: number;
  params: {
    slippagePointsPerLeg: number;
    quantity: number;
    instrument: "index_futures" | "stock_futures";
  };
}

const MARKET_CLOSE_MIN = 15 * 60 + 25;

function groupSessions(candles: OHLCVCandle[]): OHLCVCandle[][] {
  const byDay = new Map<string, OHLCVCandle[]>();
  for (const c of candles) {
    const d = istDayKey(c.time);
    const list = byDay.get(d) ?? [];
    list.push(c);
    byDay.set(d, list);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bars]) => bars.sort((a, b) => a.time - b.time));
}

export interface BacktestOptions {
  slippagePointsPerLeg?: number;
  quantity?: number;
  instrument?: "index_futures" | "stock_futures";
  minBars?: number;
}

/**
 * Walk session-by-session, bar-by-bar. Each decision uses only data up to bar i.
 */
export function backtestOrbMomentum(
  candles: OHLCVCandle[],
  options: BacktestOptions = {},
): BacktestResult {
  const slippagePointsPerLeg = options.slippagePointsPerLeg ?? 1;
  const quantity = options.quantity ?? 25;
  const instrument = options.instrument ?? "index_futures";
  const minBars = options.minBars ?? SUPERTREND_PERIOD + 10;

  const sessions = groupSessions(candles);
  const trades: BacktestTrade[] = [];

  for (const session of sessions) {
    if (session.length < minBars) continue;
    const sessionDate = istDayKey(session[0].time);

    type Position = {
      side: "long" | "short";
      entryPrice: number;
      entryTime: number;
    };
    let pos: Position | null = null;

    for (let i = minBars; i < session.length; i++) {
      const bar = session[i];
      const mins = istMinutesSinceMidnight(bar.time);
      const slice = session.slice(0, i + 1);

      if (mins >= MARKET_CLOSE_MIN) {
        if (pos) {
          const exitPrice = bar.close;
          const gross =
            pos.side === "long"
              ? (exitPrice - pos.entryPrice) * quantity
              : (pos.entryPrice - exitPrice) * quantity;
          const costs = estimateRoundTripFuturesCosts(
            pos.entryPrice,
            exitPrice,
            quantity,
            instrument,
            slippagePointsPerLeg,
            1,
          ).total;
          trades.push({
            sessionDate,
            side: pos.side,
            entryTime: pos.entryTime,
            exitTime: bar.time,
            entryPrice: pos.entryPrice,
            exitPrice,
            grossPnl: gross,
            costs,
            netPnl: gross - costs,
            exitReason: "session_close",
          });
          pos = null;
        }
        break;
      }

      if (mins <= ORB_WINDOW_END_MIN) continue;

      const signal = evaluateOrbVwapSupertrend(slice);
      const st = supertrend(slice, SUPERTREND_PERIOD, SUPERTREND_MULT);
      const stDir = st.direction[i];

      if (!pos) {
        if (signal?.state === "long") {
          pos = { side: "long", entryPrice: bar.close, entryTime: bar.time };
        } else if (signal?.state === "short") {
          pos = { side: "short", entryPrice: bar.close, entryTime: bar.time };
        }
        continue;
      }

      const exitLong = pos.side === "long" && stDir === -1;
      const exitShort = pos.side === "short" && stDir === 1;
      if (exitLong || exitShort) {
        const exitPrice = bar.close;
        const gross =
          pos.side === "long"
            ? (exitPrice - pos.entryPrice) * quantity
            : (pos.entryPrice - exitPrice) * quantity;
        const costs = estimateRoundTripFuturesCosts(
          pos.entryPrice,
          exitPrice,
          quantity,
          instrument,
          slippagePointsPerLeg,
          1,
        ).total;
        trades.push({
          sessionDate,
          side: pos.side,
          entryTime: pos.entryTime,
          exitTime: bar.time,
          entryPrice: pos.entryPrice,
          exitPrice,
          grossPnl: gross,
          costs,
          netPnl: gross - costs,
          exitReason: "supertrend_flip",
        });
        pos = null;
      }
    }
  }

  const grossPnl = trades.reduce((s, t) => s + t.grossPnl, 0);
  const totalCosts = trades.reduce((s, t) => s + t.costs, 0);
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    alpha: "momentum_breakout",
    trades,
    sessions: sessions.length,
    tradeCount: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    grossPnl,
    totalCosts,
    netPnl,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdown,
    avgNetPerTrade: trades.length ? netPnl / trades.length : 0,
    params: { slippagePointsPerLeg, quantity, instrument },
  };
}

/** Walk-forward split: train on first `trainRatio` of sessions, test on remainder. */
export function walkForwardOrbBacktest(
  candles: OHLCVCandle[],
  trainRatio = 0.7,
  options: BacktestOptions = {},
): { train: BacktestResult; test: BacktestResult } {
  const sessions = groupSessions(candles);
  const split = Math.max(1, Math.floor(sessions.length * trainRatio));
  const trainCandles = sessions.slice(0, split).flat();
  const testCandles = sessions.slice(split).flat();
  return {
    train: backtestOrbMomentum(trainCandles, options),
    test: backtestOrbMomentum(testCandles, options),
  };
}
