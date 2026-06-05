import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Bell,
  ExternalLink,
  Loader2,
  Radar,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { IndexLiveTickerStrip } from "@/components/IndexLiveTickerStrip";
import { useLiveIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { useMoveAlertSmallcapIndices } from "@/hooks/useMoveAlertSmallcapIndices";
import { useMoveAlertIndexRealtime } from "@/hooks/useMoveAlertIndexRealtime";
import { useIndexSuddenMoveMonitor } from "@/hooks/useIndexSuddenMoveMonitor";
import { AlertNotifySettings } from "@/components/AlertNotifySettings";
import { marketWS } from "@/lib/websocketClient";
import {
  INDEX_ONLY_MOVE_SYMBOLS,
  isFoMoveSymbol,
  type IndexMoveAlertSymbol,
} from "@/lib/indexMoveAlerts";
import {
  DEFAULT_MOVE_THRESHOLDS,
  type SuddenMoveAlert,
  type SuddenMoveThresholds,
} from "@/lib/indexSuddenMove";
import type { IndexIndicesFallback } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

function confidenceBadge(c: SuddenMoveAlert["confidence"]) {
  const styles = {
    high: "border-bullish/50 text-bullish",
    medium: "border-warning/50 text-warning",
    low: "border-muted-foreground/40",
  };
  return (
    <Badge variant="outline" className={cn("capitalize", styles[c])}>
      {c}
    </Badge>
  );
}

function AlertCard({
  alert,
  onOpenChain,
}: {
  alert: SuddenMoveAlert;
  onOpenChain?: () => void;
}) {
  const up = alert.expectedDirection === "up";
  return (
    <Card className={cn("border-l-4", up ? "border-l-bullish" : "border-l-bearish")}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {up ? <TrendingUp className="h-4 w-4 text-bullish" /> : <TrendingDown className="h-4 w-4 text-bearish" />}
              {alert.headline}
            </CardTitle>
            <CardDescription className="mt-1">
              {new Date(alert.triggeredAt).toLocaleString("en-IN")} · spot {alert.spotAtAlert.toLocaleString("en-IN")}
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {confidenceBadge(alert.confidence)}
            {alert.volumeSummary && (
              <Badge variant={alert.volumeConfirmed ? "default" : "outline"} className="text-2xs max-w-[200px] truncate">
                {alert.volumeConfirmed ? "Vol ✓" : "Vol weak"}
              </Badge>
            )}
            {alert.indexOnly ? (
              <Badge variant="secondary">Index only</Badge>
            ) : (
              <Badge variant={alert.oiAgrees ? "default" : "secondary"}>
                OI {alert.oiAgrees ? "aligned" : "mixed"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Suggested buy</p>
          <p className="mt-1 font-semibold text-foreground">{alert.trade.primary}</p>
          <p className="mt-1 text-xs text-muted-foreground">{alert.trade.alternative}</p>
        </div>
        <p className="text-foreground/90">{alert.trade.rationale}</p>
        <p className="text-xs text-warning">{alert.trade.riskNote}</p>
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {alert.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        {onOpenChain && (
          <Button size="sm" variant="outline" className="gap-1" onClick={onOpenChain}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open option chain
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function IndexMoveAlerts() {
  const navigate = useNavigate();
  const [monitorOn, setMonitorOn] = useState(true);
  const [sensitivity, setSensitivity] = useState(100);

  useEffect(() => {
    marketWS.connect();
    marketWS.sendCredentials();
  }, []);

  const niftyQuery = useLiveOptionChain("NIFTY");
  const bankQuery = useLiveOptionChain("BANKNIFTY");
  const { data: indicesResult, isLoading: indicesLoading } = useLiveIndices();
  const { data: smallcapPoll, isLoading: smallcapLoading } = useMoveAlertSmallcapIndices();

  const indicesBySymbol = useMemo((): Partial<Record<IndexMoveAlertSymbol, IndexIndicesFallback>> => {
    const map: Partial<Record<IndexMoveAlertSymbol, IndexIndicesFallback>> = {};

    for (const idx of indicesResult?.data ?? []) {
      if (!isFoMoveSymbol(idx.symbol as IndexMoveAlertSymbol)) continue;
      map[idx.symbol as IndexMoveAlertSymbol] = {
        ltp: idx.ltp,
        change: idx.change,
        changePercent: idx.changePercent,
        high: idx.high,
        low: idx.low,
        open: idx.open,
        isLive: indicesResult?.isLive,
      };
    }

    for (const sym of INDEX_ONLY_MOVE_SYMBOLS) {
      const sc = smallcapPoll?.bySymbol[sym];
      if (sc && sc.ltp > 0) map[sym] = sc;
    }

    return map;
  }, [indicesResult, smallcapPoll]);

  const { spots, proxyConnected, upstoxFeedConnected } = useMoveAlertIndexRealtime(
    {
      NIFTY: niftyQuery.data?.spotPrice,
      BANKNIFTY: bankQuery.data?.spotPrice,
    },
    indicesBySymbol,
  );

  const thresholds = useMemo((): SuddenMoveThresholds => {
    const scale = sensitivity / 100;
    return {
      pct15s: DEFAULT_MOVE_THRESHOLDS.pct15s * scale,
      pct30s: DEFAULT_MOVE_THRESHOLDS.pct30s * scale,
      pct60s: DEFAULT_MOVE_THRESHOLDS.pct60s * scale,
      pct3m: DEFAULT_MOVE_THRESHOLDS.pct3m * scale,
    };
  }, [sensitivity]);

  const chains = useMemo(
    () => [
      { symbol: "NIFTY" as const, chainData: niftyQuery.data },
      { symbol: "BANKNIFTY" as const, chainData: bankQuery.data },
    ],
    [niftyQuery.data, bankQuery.data],
  );

  const { activeAlerts, history, lastCheckAt, clearHistory } = useIndexSuddenMoveMonitor(spots, chains, {
    enabled: monitorOn,
    thresholds,
    notifyToast: true,
  });

  const hasAnySpot = spots.some((s) => s.spotPrice > 0);
  const loading = !hasAnySpot && (indicesLoading || smallcapLoading);
  const smallcapFetchedAt = smallcapPoll?.fetchedAt;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Index Sudden Move Alerts"
        subtitle="Nifty 50, Bank Nifty & Nifty Smallcap 50/100/250 — spike detection and trade ideas"
        tooltip="Sensitivity scales how big a % move must be before an alert fires. All five indices use Upstox live feed when token is set (NSE ~5s fallback)."
      />

      <IndexLiveTickerStrip
        spots={spots}
        proxyConnected={proxyConnected}
        upstoxFeedConnected={upstoxFeedConnected}
        activeSymbol="NIFTY"
        onSelectSymbol={() => undefined}
      />

      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4 text-primary" />
            Monitor settings
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id="mon" checked={monitorOn} onCheckedChange={setMonitorOn} />
            <Label htmlFor="mon">Active monitoring</Label>
          </div>
          <AlertNotifySettings />
          <div className="min-w-[220px] flex-1 space-y-1">
            <Label className="text-xs">
              Alert sensitivity ({sensitivity}% — lower % threshold = more alerts)
            </Label>
            <Slider value={[sensitivity]} min={70} max={130} step={5} onValueChange={([v]) => setSensitivity(v)} />
          </div>
          {lastCheckAt && (
            <span className="text-xs text-muted-foreground">
              Last scan {new Date(lastCheckAt).toLocaleTimeString("en-IN")}
            </span>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Bell className="h-4 w-4" />
        <AlertTitle>How it works</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Alerts need a <strong>price spike</strong> (shown as % and <strong>points</strong>) plus, for Nifty/Bank Nifty,
          <strong>F&O volume</strong> vs the prior chain snapshot (PCR-V in the headline). Smallcap index benchmarks are
          spot-only. <strong>Mobile push</strong> / <strong>Tab background</strong> need one-time setup. Not financial advice.
        </AlertDescription>
      </Alert>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Live alerts
            </h2>
            {activeAlerts.length === 0 ? (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                No sudden move detected right now. Keep monitoring on during market hours.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {activeAlerts.map((a) => (
                  <AlertCard
                    key={a.id}
                    alert={a}
                    onOpenChain={
                      isFoMoveSymbol(a.symbol)
                        ? () => navigate(`/option-chain?symbol=${a.symbol}`)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Alert history
              </h2>
              {history.length > 0 && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={clearHistory}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Past alerts appear here (saved in browser).</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {history.slice(0, 20).map((a) => (
                  <AlertCard
                    key={a.id}
                    alert={a}
                    onOpenChain={
                      isFoMoveSymbol(a.symbol)
                        ? () => navigate(`/option-chain?symbol=${a.symbol}`)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-2">
        <div>
          <p className="font-medium text-foreground">Sensitivity</p>
          <p className="mt-1">
            Scales the minimum % move required in 15s / 30s / 60s / 3m windows. At {sensitivity}% your effective
            thresholds are {(DEFAULT_MOVE_THRESHOLDS.pct15s * (sensitivity / 100)).toFixed(2)}% (15s),{" "}
            {(DEFAULT_MOVE_THRESHOLDS.pct30s * (sensitivity / 100)).toFixed(2)}% (30s), etc. Slide down (70%) for
            more alerts; up (130%) for fewer.
          </p>
        </div>
        <div>
          <p className="font-medium text-foreground">Live feed</p>
          <p className="mt-1">
            Nifty 50, Bank Nifty, and Nifty Smallcap 50/100/250 subscribe on Upstox Market WS V3. NSE poll
            (~5s) is fallback only. Fin Nifty / Midcap Nifty are not on the WS feed.{" "}
            {smallcapFetchedAt
              ? `NSE fallback last ${new Date(smallcapFetchedAt).toLocaleTimeString("en-IN")}.`
              : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
