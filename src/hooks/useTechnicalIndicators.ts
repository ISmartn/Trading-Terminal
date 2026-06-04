import { useMemo } from "react";
import { useChartData } from "@/hooks/useChartData";
import {
  defaultIntervalForRange,
  type ChartInterval,
  type ChartRange,
} from "@/lib/chartIntervals";
import { candlesForDisplay } from "@/lib/chartTime";
import {
  computeIndicators,
  type IndicatorId,
  type IndicatorConfig,
  type TAIndicatorResult,
} from "@/lib/taCompute";

export function useTechnicalIndicators(
  symbol: string,
  range: string,
  selected: IndicatorId[],
  config?: IndicatorConfig,
  enabled = true,
  interval?: ChartInterval,
) {
  const chartRange = (range || "3M") as ChartRange;
  const resolvedInterval = interval ?? defaultIntervalForRange(chartRange);
  const { data: candles, isLoading: candlesLoading, error: candlesError } = useChartData(
    symbol,
    range,
    enabled && !!symbol,
    resolvedInterval,
  );

  const displayCandles = useMemo(() => {
    if (!candles?.length) return [];
    return candlesForDisplay(candles, chartRange, resolvedInterval);
  }, [candles, chartRange, resolvedInterval]);

  const result = useMemo((): TAIndicatorResult | null => {
    if (!displayCandles.length || selected.length === 0) return null;
    return computeIndicators(displayCandles, selected, config);
  }, [displayCandles, selected, config]);

  return {
    data: result,
    candles: displayCandles,
    isLoading: candlesLoading,
    error: candlesError,
    taAvailable: true,
    engine: "client" as const,
  };
}

export function useTASnapshot(
  symbol: string,
  range: ChartRange = "1D",
  enabled = true,
  interval: ChartInterval = "1",
) {
  const { data, isLoading } = useTechnicalIndicators(
    symbol,
    range,
    ["rsi", "macd", "bbands", "atr", "adx", "ema", "vwap"],
    undefined,
    enabled,
    interval,
  );

  return {
    summary: data?.summary ?? null,
    patterns: data?.patterns ?? [],
    isLoading,
  };
}
