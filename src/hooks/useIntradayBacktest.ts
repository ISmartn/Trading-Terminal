import { useQuery } from "@tanstack/react-query";
import { fetchHistorical } from "@/hooks/useChartData";
import { backtestOrbMomentum, walkForwardOrbBacktest, type BacktestResult } from "@/lib/intradayBacktest";

export interface IntradayBacktestSummary {
  full: BacktestResult;
  walkForward: {
    train: BacktestResult;
    test: BacktestResult;
  };
}

export function useOrbBacktest(symbol = "NIFTY", enabled = true) {
  return useQuery({
    queryKey: ["intraday-backtest", "orb", symbol],
    queryFn: async (): Promise<IntradayBacktestSummary> => {
      const candles = await fetchHistorical(symbol, "1M", "5");
      const full = backtestOrbMomentum(candles, {
        quantity: symbol === "BANKNIFTY" ? 15 : 25,
        slippagePointsPerLeg: 2,
        instrument: "index_futures",
      });
      const walkForward = walkForwardOrbBacktest(candles, 0.7, full.params);
      return { full, walkForward };
    },
    enabled: enabled && !!symbol,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
