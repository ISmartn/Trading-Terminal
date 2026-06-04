import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useTASnapshot } from "@/hooks/useTechnicalIndicators";
import { formatVolume } from "@/lib/volumeUtils";

interface SpotContextStripProps {
  symbol: string;
  spotPrice?: number;
  spotChange?: number;
}

export function SpotContextStrip({ symbol, spotPrice, spotChange }: SpotContextStripProps) {
  const { summary, isLoading } = useTASnapshot(symbol);

  const trendIcon =
    summary?.trend === "uptrend" ? (
      <TrendingUp className="h-3.5 w-3.5 text-bullish" />
    ) : summary?.trend === "downtrend" ? (
      <TrendingDown className="h-3.5 w-3.5 text-bearish" />
    ) : (
      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
    );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <span className="font-medium text-muted-foreground">Spot context</span>
      {spotPrice != null && spotPrice > 0 && (
        <span className="font-mono font-semibold">
          {symbol} ₹{spotPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          {spotChange != null && (
            <span className={spotChange >= 0 ? " text-bullish ml-1" : " text-bearish ml-1"}>
              {spotChange >= 0 ? "+" : ""}
              {spotChange.toFixed(2)}%
            </span>
          )}
        </span>
      )}
      {trendIcon}
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : summary ? (
        <>
          <Badge variant="outline" className="text-2xs font-mono">
            RSI {summary.rsi?.toFixed(1) ?? "—"} · {summary.rsiLabel}
          </Badge>
          <Badge variant="outline" className="text-2xs font-mono">
            ADX {summary.adx?.toFixed(1) ?? "—"} · {summary.adxLabel}
          </Badge>
          <Badge variant="outline" className="text-2xs font-mono">
            ATR {summary.atr?.toFixed(0) ?? "—"}
          </Badge>
          {summary.vwap != null && (
            <Badge variant="outline" className="text-2xs font-mono text-amber-700 border-amber-500/30">
              VWAP ₹{summary.vwap.toFixed(0)}
              {summary.vwapDeviationPct != null && (
                <span className="ml-0.5">
                  ({summary.vwapDeviationPct >= 0 ? "+" : ""}
                  {summary.vwapDeviationPct.toFixed(2)}%)
                </span>
              )}
              {summary.priceVsVwap === "above" ? " ↑" : summary.priceVsVwap === "below" ? " ↓" : ""}
            </Badge>
          )}
          {summary.volume != null && summary.volume > 0 && (
            <Badge variant="outline" className="text-2xs font-mono">
              Vol {formatVolume(summary.volume)}
            </Badge>
          )}
          {summary.patternToday && (
            <Badge variant="secondary" className="text-2xs">
              {summary.patternToday.replace(/_/g, " ")}
            </Badge>
          )}
        </>
      ) : null}
      <span className="text-2xs text-muted-foreground ml-auto hidden sm:inline">
        Interpret OI with spot trend in mind · powered by{" "}
        <a href="https://ta-lib.org/" target="_blank" rel="noreferrer" className="underline">
          TA-Lib
        </a>
      </span>
    </div>
  );
}
