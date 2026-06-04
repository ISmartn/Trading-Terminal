import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type Time,
  createSeriesMarkers,
} from "lightweight-charts";
import type { PatternFormation } from "@/lib/chartPatternApi";
import { patternLabel, type ChartPatternId } from "@/lib/chartPatternScan";
import { useChartData } from "@/hooks/useChartData";
import { useChartPatternDetect } from "@/hooks/useChartPatternDetect";
import { IndicatorToolbar } from "@/components/IndicatorToolbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BarChart3, Loader2, CandlestickChart, LineChart } from "lucide-react";
import type { IndicatorId } from "@/lib/taCompute";
import { computeIndicators, istDayKey, vwap as computeVwap } from "@/lib/taCompute";
import { formatVolume, volumeStats } from "@/lib/volumeUtils";
import {
  candlesForDisplay,
  prepareChartCandles,
  vwapLineSegments,
  type ChartReadyCandle,
} from "@/lib/chartTime";
import {
  defaultIntervalForRange,
  intervalsForRange,
  isIntervalValidForRange,
  type ChartInterval,
} from "@/lib/chartIntervals";

const TIME_RANGES = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

export interface PatternBarHighlight {
  time: number;
  label: string;
  direction: "bullish" | "bearish" | "neutral";
}

interface StockChartProps {
  symbol: string;
  inline?: boolean;
  height?: number;
  asSheet?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Pin daily pattern review (Chart Pattern Scanner). */
  patternView?: boolean;
  initialRange?: (typeof TIME_RANGES)[number];
  initialInterval?: ChartInterval;
  patternHighlights?: PatternBarHighlight[];
  /** When set, draw formation geometry (H&S, cup & handle) for this pattern. */
  highlightPatternId?: ChartPatternId;
}

function resolveChartTime(
  unixSec: number,
  timeMap: Map<number, Time>,
  chartCandles: ChartReadyCandle[],
): Time | null {
  if (timeMap.has(unixSec)) return timeMap.get(unixSec)!;
  const day = istDayKey(unixSec);
  const match = chartCandles.find((c) => istDayKey(c.time) === day);
  return match?.chartTime ?? null;
}

function indicatorLineData(
  chartCandles: ChartReadyCandle[],
  values: (number | null)[],
): { time: Time; value: number }[] {
  const out: { time: Time; value: number }[] = [];
  const n = Math.min(chartCandles.length, values.length);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) {
      out.push({ time: chartCandles[i].chartTime, value: v });
    }
  }
  return out;
}

function ChartCore({
  symbol,
  height = 340,
  patternView = false,
  initialRange = "1D",
  initialInterval,
  patternHighlights,
  highlightPatternId,
}: {
  symbol: string;
  height?: number;
  patternView?: boolean;
  initialRange?: TimeRange;
  initialInterval?: ChartInterval;
  patternHighlights?: PatternBarHighlight[];
  highlightPatternId?: ChartPatternId;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const oscContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const oscChartRef = useRef<IChartApi | null>(null);
  const lockedRange = patternView ? (initialRange as TimeRange) : undefined;
  const lockedInterval = patternView ? (initialInterval ?? "D") : undefined;
  const [range, setRange] = useState<TimeRange>(lockedRange ?? initialRange);
  const [interval, setInterval] = useState<ChartInterval>(
    () => lockedInterval ?? initialInterval ?? defaultIntervalForRange(initialRange),
  );
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorId[]>(
    patternView ? ["ema"] : ["ema", "vwap", "bbands", "rsi"],
  );
  const [showVolume, setShowVolume] = useState(!patternView);
  const [oscillatorPane, setOscillatorPane] = useState<"rsi" | "macd" | "stoch" | "none">(
    patternView ? "none" : "rsi",
  );

  const { data: candles, isLoading, error } = useChartData(symbol, range, true, interval, {
    enrichLiveToday: patternView && interval === "D",
  });

  const { data: talibPatterns } = useChartPatternDetect(
    symbol,
    range,
    patternView && interval === "D",
    highlightPatternId
      ? [highlightPatternId, "DOJI", "HAMMER", "SHOOTING_STAR", "BULLISH_ENGULFING", "BEARISH_ENGULFING"]
      : undefined,
  );

  const activeFormation = useMemo((): PatternFormation | null => {
    const formations = talibPatterns?.formations ?? [];
    if (!formations.length) return null;
    if (highlightPatternId) {
      return formations.find((f) => f.name === highlightPatternId) ?? formations[0];
    }
    return formations[0] ?? null;
  }, [talibPatterns?.formations, highlightPatternId]);

  const displayOhlcv = useMemo(() => {
    if (!candles?.length) return [];
    return candlesForDisplay(candles, range, interval);
  }, [candles, range, interval]);

  const chartCandles = useMemo(
    () => prepareChartCandles(displayOhlcv, interval),
    [displayOhlcv, interval],
  );

  const ta = useMemo(() => {
    if (!displayOhlcv.length) return null;
    const ids =
      selectedIndicators.length > 0
        ? selectedIndicators
        : patternHighlights?.length
          ? (["ema"] as IndicatorId[])
          : [];
    if (!ids.length && !patternHighlights?.length) return null;
    return computeIndicators(displayOhlcv, ids.length ? ids : ["ema"]);
  }, [displayOhlcv, selectedIndicators, patternHighlights]);

  const handleRangeChange = (next: TimeRange) => {
    setRange(next);
    setInterval((prev) =>
      isIntervalValidForRange(next, prev) ? prev : defaultIntervalForRange(next),
    );
  };

  const availableIntervals = useMemo(() => intervalsForRange(range), [range]);

  const showOsc = useMemo(
    () =>
      oscillatorPane !== "none" &&
      (selectedIndicators.includes(oscillatorPane as IndicatorId) ||
        (oscillatorPane === "rsi" && selectedIndicators.includes("rsi")) ||
        (oscillatorPane === "macd" && selectedIndicators.includes("macd"))),
    [oscillatorPane, selectedIndicators],
  );

  const mainHeight = showOsc ? Math.round(height * 0.72) : height;
  const oscHeight = showOsc ? Math.round(height * 0.28) : 0;

  const buildCharts = useCallback(() => {
    if (!chartContainerRef.current || !chartCandles.length) return;

    chartRef.current?.remove();
    oscChartRef.current?.remove();
    chartRef.current = null;
    oscChartRef.current = null;

    const isDark = document.documentElement.classList.contains("dark");
    const layout = {
      background: { type: ColorType.Solid, color: "transparent" as const },
      textColor: isDark ? "#a1a1aa" : "#71717a",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 11,
    };

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: mainHeight,
      layout,
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderVisible: false, timeVisible: range === "1D" || range === "1W" },
    });
    chartRef.current = chart;

    const priceScaleId = "right";
    const formattedCandles = chartCandles.map((c) => ({
      time: c.chartTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    let mainSeries;
    if (chartType === "candle") {
      mainSeries = chart.addSeries(CandlestickSeries, {
        priceScaleId,
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
      mainSeries.setData(formattedCandles);
    } else {
      mainSeries = chart.addSeries(LineSeries, {
        priceScaleId,
        color: chartCandles[chartCandles.length - 1].close >= chartCandles[0].close ? "#22c55e" : "#ef4444",
        lineWidth: 2,
      });
      mainSeries.setData(chartCandles.map((c) => ({ time: c.chartTime, value: c.close })));
    }

    if (ta?.indicators.ema?.values) {
      const emaLine = chart.addSeries(LineSeries, { priceScaleId, color: "#3b82f6", lineWidth: 1, title: "EMA20" });
      emaLine.setData(indicatorLineData(chartCandles, ta.indicators.ema.values));
    }
    if (ta?.indicators.sma?.values) {
      const smaLine = chart.addSeries(LineSeries, { priceScaleId, color: "#a855f7", lineWidth: 1, title: "SMA50" });
      smaLine.setData(indicatorLineData(chartCandles, ta.indicators.sma.values));
    }
    if (ta?.indicators.bbands) {
      const bb = ta.indicators.bbands;
      const upper = chart.addSeries(LineSeries, { priceScaleId, color: "rgba(234,179,8,0.5)", lineWidth: 1, title: "BB U" });
      const lower = chart.addSeries(LineSeries, { priceScaleId, color: "rgba(234,179,8,0.5)", lineWidth: 1, title: "BB L" });
      upper.setData(indicatorLineData(chartCandles, bb.upper));
      lower.setData(indicatorLineData(chartCandles, bb.lower));
    }
    if (selectedIndicators.includes("vwap") && chartCandles.length) {
      const vwapValues = ta?.indicators.vwap?.values ?? computeVwap(displayOhlcv);
      const segments = vwapLineSegments(chartCandles, vwapValues);
      segments.forEach((segment, idx) => {
        if (!segment.length) return;
        const vwapLine = chart.addSeries(LineSeries, {
          priceScaleId,
          color: "#f59e0b",
          lineWidth: 2,
          lineStyle: 0,
          title: idx === 0 ? "VWAP" : "",
          lastValueVisible: idx === segments.length - 1,
          crosshairMarkerVisible: true,
          priceLineVisible: false,
        });
        vwapLine.setData(segment);
      });
    }

    if (mainSeries) {
      const timeMap = new Map(chartCandles.map((c) => [c.time, c.chartTime]));
      const highlightTimes = new Set(patternHighlights?.map((h) => h.time) ?? []);

      const markers: {
        time: Time;
        position: "aboveBar" | "belowBar" | "inBar";
        color: string;
        shape: "arrowUp" | "arrowDown" | "circle";
        text: string;
        size?: number;
      }[] = [];

      if (activeFormation?.overlay) {
        const { points, lines } = activeFormation.overlay;
        for (const line of lines) {
          const t0 = resolveChartTime(line.timeStart, timeMap, chartCandles);
          const t1 = resolveChartTime(line.timeEnd, timeMap, chartCandles);
          if (t0 == null || t1 == null) continue;
          const guide = chart.addSeries(LineSeries, {
            priceScaleId,
            color: line.color ?? "#94a3b8",
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            title: line.title ?? "",
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          });
          guide.setData([
            { time: t0, value: line.price },
            { time: t1, value: line.price },
          ]);
        }
        for (const pt of points) {
          const chartTime = resolveChartTime(pt.time, timeMap, chartCandles);
          if (chartTime == null) continue;
          const isLow = /low|cup|L shoulder/i.test(pt.label);
          markers.push({
            time: chartTime,
            position: isLow ? "belowBar" : "aboveBar",
            color: "#a855f7",
            shape: "circle",
            text: pt.label,
            size: 2,
          });
        }
      }

      if (patternHighlights?.length) {
        for (const h of patternHighlights) {
          const chartTime = resolveChartTime(h.time, timeMap, chartCandles) ?? (h.time as Time);
          const bullish = h.direction === "bullish";
          const bearish = h.direction === "bearish";
          markers.push({
            time: chartTime,
            position: bullish ? "belowBar" : bearish ? "aboveBar" : "belowBar",
            color: bullish ? "#16a34a" : bearish ? "#dc2626" : "#64748b",
            shape: bullish ? "arrowUp" : bearish ? "arrowDown" : "circle",
            text: h.label,
            size: 2,
          });
        }
      }

      const historyPatterns = patternView
        ? (talibPatterns?.patterns ?? [])
        : (ta?.patterns ?? []);
      if (historyPatterns.length) {
        const extra = historyPatterns
          .filter((p) => !highlightTimes.has(p.time))
          .slice(patternView ? -40 : -8);
        for (const p of extra) {
          const isStructural = p.name.includes("SHOULDER") || p.name.includes("CUP");
          if (isStructural && activeFormation?.name === p.name) continue;
          const chartTime = resolveChartTime(p.time, timeMap, chartCandles) ?? (p.time as Time);
          markers.push({
            time: chartTime,
            position: p.direction === "bullish" ? "belowBar" : "aboveBar",
            color: p.direction === "bullish" ? "#22c55e88" : p.direction === "bearish" ? "#ef444488" : "#94a3b888",
            shape: "circle",
            text: isStructural ? patternLabel(p.name as ChartPatternId) : String(p.name).replace(/_/g, " ").slice(0, 10),
            size: 1,
          });
        }
      }

      if (markers.length) {
        createSeriesMarkers(mainSeries, markers);
      }

      const zoomTimes: number[] = [];
      if (activeFormation?.overlay?.points.length) {
        zoomTimes.push(...activeFormation.overlay.points.map((p) => p.time));
      }
      if (patternHighlights?.length) {
        zoomTimes.push(patternHighlights[0].time);
      }
      if (zoomTimes.length) {
        const indices = zoomTimes
          .map((t) => chartCandles.findIndex((c) => c.time === t || istDayKey(c.time) === istDayKey(t)))
          .filter((i) => i >= 0);
        if (indices.length) {
          const minIdx = Math.max(0, Math.min(...indices) - 35);
          const maxIdx = Math.min(chartCandles.length - 1, Math.max(...indices) + 15);
          chart.timeScale().setVisibleLogicalRange({ from: minIdx, to: maxIdx });
        } else {
          chart.timeScale().fitContent();
        }
      } else {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
    }

    const volumeData = chartCandles
      .map((c, i, arr) => ({
        time: c.chartTime,
        value: c.volume ?? 0,
        color:
          i > 0 && c.close >= arr[i - 1].close
            ? "rgba(34,197,94,0.35)"
            : "rgba(239,68,68,0.3)",
      }))
      .filter((c) => showVolume && (c.value > 0 || chartCandles.length <= 30));
    if (volumeData.length) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(volumeData);
    }

    if (showOsc && oscContainerRef.current && ta) {
      const osc = createChart(oscContainerRef.current, {
        width: oscContainerRef.current.clientWidth,
        height: oscHeight,
        layout,
        grid: { vertLines: { visible: false }, horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, visible: false },
      });
      oscChartRef.current = osc;

      if (oscillatorPane === "rsi" && ta.indicators.rsi) {
        const rsiS = osc.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1, title: "RSI" });
        rsiS.setData(indicatorLineData(chartCandles, ta.indicators.rsi.values));
      } else if (oscillatorPane === "macd" && ta.indicators.macd) {
        const macdS = osc.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1, title: "MACD" });
        const sigS = osc.addSeries(LineSeries, { color: "#f97316", lineWidth: 1, title: "Signal" });
        macdS.setData(indicatorLineData(chartCandles, ta.indicators.macd.macd));
        sigS.setData(indicatorLineData(chartCandles, ta.indicators.macd.signal));
      } else if (oscillatorPane === "stoch" && ta.indicators.stoch) {
        const kS = osc.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 1, title: "%K" });
        kS.setData(indicatorLineData(chartCandles, ta.indicators.stoch.k));
      }
      osc.timeScale().fitContent();
    }

    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      chart.applyOptions({ width: w });
      oscChartRef.current?.applyOptions({ width: w });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      oscChartRef.current?.remove();
      chartRef.current = null;
      oscChartRef.current = null;
    };
  }, [
    chartCandles,
    displayOhlcv,
    ta,
    mainHeight,
    oscHeight,
    chartType,
    range,
    interval,
    showOsc,
    oscillatorPane,
    showVolume,
    selectedIndicators,
    patternHighlights,
    patternView,
    talibPatterns,
    activeFormation,
    highlightPatternId,
  ]);

  useEffect(() => {
    const cleanup = buildCharts();
    return () => cleanup?.();
  }, [buildCharts]);

  const lastCandle = displayOhlcv[displayOhlcv.length - 1];
  const firstCandle = displayOhlcv[0];
  const volStats = displayOhlcv.length ? volumeStats(displayOhlcv) : null;
  const priceChange =
    lastCandle && firstCandle ? ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100 : 0;

  const primaryHighlight = patternHighlights?.[0];

  return (
    <div className="space-y-2">
      {patternView && primaryHighlight && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
          <CandlestickChart className="h-4 w-4 text-primary shrink-0" />
          <span>
            {activeFormation?.overlay ? (
              <>
                <strong>{primaryHighlight.label}</strong>
                <span className="text-muted-foreground">
                  {" "}
                  — purple dots = pivots (shoulders / cup), dashed line = neckline or rim
                </span>
              </>
            ) : (
              <>
                Pattern on <strong>{primaryHighlight.label}</strong>
                <span className="text-muted-foreground">
                  {" "}
                  — arrow marks the signal candle (daily {interval} · {range})
                </span>
              </>
            )}
          </span>
        </div>
      )}
      {!patternView && (
        <IndicatorToolbar
          selected={selectedIndicators}
          onChange={setSelectedIndicators}
          oscillatorPane={oscillatorPane}
          onOscillatorChange={setOscillatorPane}
          showVolume={showVolume}
          onShowVolumeChange={setShowVolume}
        />
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {patternView ? (
            <Badge variant="secondary" className="text-2xs font-mono">
              Daily · {range}
            </Badge>
          ) : (
          <ToggleGroup type="single" value={range} onValueChange={(v) => v && handleRangeChange(v as TimeRange)} className="bg-muted rounded-md p-0.5">
            {TIME_RANGES.map((r) => (
              <ToggleGroupItem key={r} value={r} className="text-xs h-6 px-2.5 data-[state=on]:bg-background rounded">
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          )}
          {patternView ? (
            <Badge variant="outline" className="text-2xs font-mono">
              1D candles
            </Badge>
          ) : (
          <ToggleGroup type="single" value={interval} onValueChange={(v) => v && setInterval(v as ChartInterval)} className="bg-muted rounded-md p-0.5">
            {availableIntervals.map((i) => (
              <ToggleGroupItem
                key={i.value}
                value={i.value}
                title={i.title}
                className="text-xs h-6 px-2 data-[state=on]:bg-background rounded font-mono"
              >
                {i.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          )}
          <ToggleGroup type="single" value={chartType} onValueChange={(v) => v && setChartType(v as "candle" | "line")} className="bg-muted rounded-md p-0.5">
            <ToggleGroupItem value="candle" className="h-6 w-7 p-0 data-[state=on]:bg-background rounded">
              <CandlestickChart className="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="line" className="h-6 w-7 p-0 data-[state=on]:bg-background rounded">
              <LineChart className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          {ta?.summary?.vwap != null && (
            <Badge variant="outline" className="text-2xs font-mono text-amber-600 border-amber-500/30">
              VWAP ₹{ta.summary.vwap.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              {ta.summary.vwapDeviationPct != null && (
                <span className="ml-1 opacity-80">
                  ({ta.summary.vwapDeviationPct >= 0 ? "+" : ""}
                  {ta.summary.vwapDeviationPct.toFixed(2)}%)
                </span>
              )}
            </Badge>
          )}
          {volStats && volStats.lastVolume > 0 && (
            <Badge variant="outline" className="text-2xs font-mono" title="Last bar volume (Upstox historical)">
              Vol {formatVolume(volStats.lastVolume)}
            </Badge>
          )}
          {ta?.summary?.rsi != null && (
            <Badge variant="outline" className="text-2xs font-mono">
              RSI {ta.summary.rsi.toFixed(1)}
            </Badge>
          )}
          {lastCandle && (
            <>
              <span className="text-xs font-mono font-semibold">
                ₹{lastCandle.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              <Badge variant="outline" className={`text-[11px] font-mono ${priceChange >= 0 ? "text-bullish border-bullish/30" : "text-bearish border-bearish/30"}`}>
                {priceChange >= 0 ? "+" : ""}
                {priceChange.toFixed(2)}%
              </Badge>
            </>
          )}
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {error && !displayOhlcv.length && (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            Chart data unavailable. Start the proxy server for live data.
          </div>
        )}
        <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden" />
        {showOsc && <div ref={oscContainerRef} className="w-full rounded-lg overflow-hidden mt-1 border-t border-border/50" />}
      </div>
    </div>
  );
}

export function StockChart({
  symbol,
  inline = false,
  height = 340,
  asSheet = false,
  open = false,
  onOpenChange,
  patternView = false,
  initialRange = "1D",
  initialInterval,
  patternHighlights,
  highlightPatternId,
}: StockChartProps) {
  const sheetTitle = patternView && patternHighlights?.[0]
    ? `${symbol} — ${patternHighlights[0].label}`
    : `${symbol} — TA Chart`;

  const core = (
    <ChartCore
      symbol={symbol}
      height={height}
      patternView={patternView}
      initialRange={initialRange}
      initialInterval={initialInterval}
      patternHighlights={patternHighlights}
      highlightPatternId={highlightPatternId}
    />
  );

  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[min(88vh,640px)]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              {sheetTitle}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-3">{core}</div>
        </SheetContent>
      </Sheet>
    );
  }
  if (inline) return core;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {sheetTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>{core}</CardContent>
    </Card>
  );
}
