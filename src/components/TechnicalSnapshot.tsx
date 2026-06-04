import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Activity, Gauge, Sparkles, BarChart3 } from "lucide-react";
import { useTASnapshot } from "@/hooks/useTechnicalIndicators";
import { formatVolume } from "@/lib/volumeUtils";

interface TechnicalSnapshotProps {
  symbol?: string;
}

function SnapshotCard({
  title,
  icon,
  value,
  label,
  href,
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  label: string;
  href: string;
}) {
  return (
    <Link to={href}>
      <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            {icon}
            <span className="text-2xs font-medium uppercase tracking-wide">{title}</span>
          </div>
          <p className="text-lg font-semibold font-mono">{value}</p>
          <p className="text-2xs text-muted-foreground mt-0.5">{label}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function TechnicalSnapshot({ symbol = "NIFTY" }: TechnicalSnapshotProps) {
  const { summary, isLoading } = useTASnapshot(symbol);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading technical snapshot…
      </div>
    );
  }

  if (!summary) return null;

  const chartLink = `/option-chain?symbol=${symbol}`;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
      <SnapshotCard
        title={`${symbol} Trend`}
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        value={summary.adx != null ? summary.adx.toFixed(1) : "—"}
        label={`${summary.adxLabel} · ${summary.trend}`}
        href={chartLink}
      />
      <SnapshotCard
        title="Momentum"
        icon={<Gauge className="h-3.5 w-3.5" />}
        value={summary.rsi != null ? summary.rsi.toFixed(1) : "—"}
        label={summary.rsiLabel}
        href={chartLink}
      />
      <SnapshotCard
        title="VWAP"
        icon={<Activity className="h-3.5 w-3.5" />}
        value={summary.vwap != null ? `₹${summary.vwap.toFixed(0)}` : "—"}
        label={
          summary.vwapDeviationPct != null
            ? `${summary.vwapDeviationPct >= 0 ? "+" : ""}${summary.vwapDeviationPct.toFixed(2)}% vs session VWAP (1m)`
            : summary.priceVsVwap === "above"
              ? "Price above VWAP"
              : summary.priceVsVwap === "below"
                ? "Price below VWAP"
                : "At VWAP"
        }
        href={chartLink}
      />
      <SnapshotCard
        title="Volume"
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        value={formatVolume(summary.volume)}
        label={
          summary.volumeAvg20
            ? `Avg 20d ${formatVolume(summary.volumeAvg20)}`
            : "Upstox historical vol"
        }
        href={chartLink}
      />
      <SnapshotCard
        title="Pattern"
        icon={<Sparkles className="h-3.5 w-3.5" />}
        value={summary.patternToday?.replace(/_/g, " ") ?? "None"}
        label={`MACD: ${summary.macdSignal}`}
        href={chartLink}
      />
    </div>
  );
}

export function TechnicalSnapshotRow() {
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium">NIFTY</span>
          <Badge variant="outline" className="text-2xs">TA-Lib</Badge>
        </div>
        <TechnicalSnapshot symbol="NIFTY" />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium">BANKNIFTY</span>
          <Badge variant="outline" className="text-2xs">TA-Lib</Badge>
        </div>
        <TechnicalSnapshot symbol="BANKNIFTY" />
      </div>
    </div>
  );
}
