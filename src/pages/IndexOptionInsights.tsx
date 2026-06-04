import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  History,
  Loader2,
  Minus,
  RefreshCw,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { IndexLiveTickerStrip } from "@/components/IndexLiveTickerStrip";
import { SpotContextStrip } from "@/components/SpotContextStrip";
import {
  INDEX_OI_INSIGHTS_CHAIN_POLL_MS,
  INDEX_OI_INSIGHTS_CHAIN_STALE_MS,
} from "@/lib/dataRefreshPolicy";
import { useLiveIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { useDualIndexRealtime } from "@/hooks/useDualIndexRealtime";
import type { IndexIndicesFallback } from "@/hooks/useWebSocket";
import { useUpstoxFeedStatus } from "@/hooks/useWebSocket";
import { marketWS } from "@/lib/websocketClient";
import {
  buildIndexOptionInsight,
  INDEX_INSIGHT_LABELS,
  INDEX_INSIGHT_SYMBOLS,
  type IndexInsightSymbol,
  type IndexOptionInsight,
} from "@/lib/indexOptionInsights";
import { getATMZoneAnalysis } from "@/lib/oiUtils";
import {
  clearInsightHistory,
  formatOutcomeLabel,
  loadInsightHistory,
  refreshHistoryTracking,
  removeInsightHistoryEntry,
  saveInsightToHistory,
  type InsightHistoryEntry,
  type TrackOutcome,
} from "@/lib/indexInsightsHistory";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function biasBadge(bias: IndexOptionInsight["bias"]) {
  const map = {
    bullish: "border-bullish/40 text-bullish bg-bullish/10",
    bearish: "border-bearish/40 text-bearish bg-bearish/10",
    neutral: "border-muted-foreground/30 text-muted-foreground",
    mixed: "border-warning/40 text-warning bg-warning/10",
  };
  return (
    <Badge variant="outline" className={cn("capitalize", map[bias])}>
      {bias}
    </Badge>
  );
}

function directionIcon(dir: IndexOptionInsight["predictedDirection"]) {
  if (dir === "up") return <ArrowUp className="h-3.5 w-3.5 text-bullish" />;
  if (dir === "down") return <ArrowDown className="h-3.5 w-3.5 text-bearish" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function outcomeBadge(outcome: TrackOutcome) {
  const styles: Record<TrackOutcome, string> = {
    correct: "border-bullish/50 text-bullish",
    wrong: "border-bearish/50 text-bearish",
    range_hit: "border-warning/50 text-warning",
    pending: "border-muted-foreground/40 text-muted-foreground",
    expired: "border-muted-foreground/30 text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", styles[outcome])}>
      {formatOutcomeLabel(outcome)}
    </Badge>
  );
}

function formatAge(ts: number | null | undefined): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}

function strikeDistPct(spot: number, strike: number) {
  if (spot <= 0) return 0;
  return Math.round(((strike - spot) / spot) * 10000) / 100;
}

export default function IndexOptionInsights() {
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState<IndexInsightSymbol>("NIFTY");
  const [expiryBySymbol, setExpiryBySymbol] = useState<Partial<Record<IndexInsightSymbol, string>>>({});
  const [history, setHistory] = useState<InsightHistoryEntry[]>(() => loadInsightHistory());
  const [autoTrack, setAutoTrack] = useState(true);

  useEffect(() => {
    marketWS.connect();
    marketWS.sendCredentials();
  }, []);

  const expiry = expiryBySymbol[symbol];
  const chainPollOpts = {
    pollIntervalMs: INDEX_OI_INSIGHTS_CHAIN_POLL_MS,
    staleTimeMs: INDEX_OI_INSIGHTS_CHAIN_STALE_MS,
  };
  const niftyQuery = useLiveOptionChain("NIFTY", expiryBySymbol.NIFTY, chainPollOpts);
  const bankQuery = useLiveOptionChain("BANKNIFTY", expiryBySymbol.BANKNIFTY, chainPollOpts);
  const activeQuery = symbol === "NIFTY" ? niftyQuery : bankQuery;
  const liveData = activeQuery.data;
  const isLoading = activeQuery.isLoading;
  const isFetching = activeQuery.isFetching;
  const { data: indicesResult } = useLiveIndices();
  const upstoxFeedConnected = useUpstoxFeedStatus();

  const indicesBySymbol = useMemo((): Partial<Record<IndexInsightSymbol, IndexIndicesFallback>> => {
    const map: Partial<Record<IndexInsightSymbol, IndexIndicesFallback>> = {};
    const list = indicesResult?.data ?? [];
    const isLive = indicesResult?.isLive ?? false;
    for (const idx of list) {
      if (idx.symbol === "NIFTY" || idx.symbol === "BANKNIFTY") {
        map[idx.symbol] = {
          ltp: idx.ltp,
          change: idx.change,
          changePercent: idx.changePercent,
          high: idx.high,
          low: idx.low,
          open: idx.open,
          isLive,
        };
      }
    }
    return map;
  }, [indicesResult]);

  const { spots, proxyConnected: proxyOk, upstoxFeedConnected: upstoxOk, bySymbol } = useDualIndexRealtime(
    {
      NIFTY: niftyQuery.data?.chainSpotPrice ?? niftyQuery.data?.spotPrice,
      BANKNIFTY: bankQuery.data?.chainSpotPrice ?? bankQuery.data?.spotPrice,
    },
    indicesBySymbol,
  );

  const activeSpot = bySymbol[symbol];
  const chain = liveData?.chain ?? [];
  const spotPrice = activeSpot?.spotPrice ?? liveData?.spotPrice ?? 0;
  const spotChange = activeSpot?.change ?? liveData?.spotChange ?? 0;
  const spotChangePercent = activeSpot?.changePercent ?? liveData?.spotChangePercent ?? 0;
  const spotIsLive = activeSpot?.isLive ?? liveData?.spotIsLive ?? false;
  const stepSize = liveData?.stepSize ?? (symbol === "BANKNIFTY" ? 100 : 50);
  const isLive = liveData?.isLive ?? false;
  const afterHours = liveData?.afterHours ?? false;

  const expiries = liveData?.expiries ?? [];
  useEffect(() => {
    if (!expiry && expiries.length > 0) {
      setExpiryBySymbol((prev) => ({ ...prev, [symbol]: expiries[0].value }));
    }
  }, [expiries, expiry, symbol]);

  const insight = useMemo(() => {
    if (!chain.length || spotPrice <= 0) return null;
    return buildIndexOptionInsight({
      symbol,
      chain,
      spotPrice,
      stepSize,
      expiry: expiry ?? null,
      oiMetrics: liveData?.oiMetrics ?? null,
    });
  }, [symbol, chain, spotPrice, stepSize, expiry, liveData?.oiMetrics]);

  const atmStrike = useMemo(
    () => (spotPrice > 0 ? Math.round(spotPrice / stepSize) * stepSize : 0),
    [spotPrice, stepSize],
  );

  const atmZone = useMemo(() => {
    if (!chain.length || spotPrice <= 0) return null;
    return getATMZoneAnalysis(chain, spotPrice, stepSize, 7);
  }, [chain, spotPrice, stepSize]);

  const ltpMap = useMemo(() => {
    const map: Partial<Record<IndexInsightSymbol, number>> = {};
    for (const s of INDEX_INSIGHT_SYMBOLS) {
      const p = bySymbol[s]?.spotPrice;
      if (p && p > 0) map[s] = p;
    }
    return map;
  }, [bySymbol]);

  const runTracking = useCallback(() => {
    setHistory(refreshHistoryTracking(ltpMap));
  }, [ltpMap]);

  const ltpTrackKey = `${ltpMap.NIFTY ?? 0}|${ltpMap.BANKNIFTY ?? 0}`;
  useEffect(() => {
    if (!autoTrack || history.length === 0) return;
    runTracking();
  }, [autoTrack, ltpTrackKey, runTracking, history.length]);

  const handleSave = () => {
    if (!insight) {
      toast.error("No insight to save — wait for option chain data");
      return;
    }
    const entry = saveInsightToHistory(insight);
    setHistory(loadInsightHistory());
    toast.success(`Saved ${INDEX_INSIGHT_LABELS[symbol]} insight @ ${fmt(entry.spotAtSave)}`);
  };

  const refetchBoth = () => {
    void niftyQuery.refetch({ meta: { refresh: true } });
    void bankQuery.refetch({ meta: { refresh: true } });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Index OI Insights"
        subtitle="Nifty 50 & Bank Nifty — live spot via Upstox Market WS V3 (else NSE ~5s) · OI ~90s"
        tooltip="Spot: Upstox Market Data Feed V3 WebSocket via proxy when token is set; otherwise NSE indices ~5s. OI/PCR from option-chain ~90s."
      />

      <IndexLiveTickerStrip
        spots={spots}
        proxyConnected={proxyOk}
        upstoxFeedConnected={upstoxOk}
        activeSymbol={symbol}
        onSelectSymbol={(s) => setSymbol(s)}
      />

      {!upstoxOk && proxyOk && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Live ticks need an Upstox access token — add it in Broker Settings or <code className="text-[10px]">.env</code>{" "}
          (<code className="text-[10px]">UPSTOX_ACCESS_TOKEN</code>), then restart the proxy. Until then, spot uses the
          index poll or OI chain (not tick-by-tick).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-card/90 px-4 py-3">
        {expiries.length > 0 && (
          <Select
            value={expiry}
            onValueChange={(v) => setExpiryBySymbol((prev) => ({ ...prev, [symbol]: v }))}
          >
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Expiry" />
            </SelectTrigger>
            <SelectContent>
              {expiries.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label} ({e.daysToExpiry}d)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Badge
          variant="outline"
          className={cn("gap-1", spotIsLive ? "border-primary text-primary" : "border-muted-foreground/40")}
        >
          {spotIsLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {spotIsLive ? "LIVE SPOT" : !proxyOk ? "WS OFF" : !upstoxOk ? "NO TOKEN" : "SPOT WAIT"}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "gap-1",
            isLive ? "border-bullish text-bullish" : afterHours ? "border-amber-500/50 text-amber-400" : "border-red-500/50",
          )}
        >
          {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {isLive ? "LIVE OI" : afterHours ? "OI CLOSED" : "OI OFFLINE"}
        </Badge>

        {liveData?.cachedAt && (
          <span className="text-xs text-muted-foreground">OI data {formatAge(liveData.cachedAt)}</span>
        )}

        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={refetchBoth} disabled={niftyQuery.isFetching || bankQuery.isFetching}>
          {(isFetching || niftyQuery.isFetching || bankQuery.isFetching) ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh OI
        </Button>

        <Button size="sm" className="h-9 gap-1.5" onClick={handleSave} disabled={!insight}>
          <BookmarkPlus className="h-3.5 w-3.5" />
          Save to history
        </Button>

        <Button variant="ghost" size="sm" className="h-9" onClick={() => navigate(`/option-chain?symbol=${symbol}`)}>
          Open chain
        </Button>
      </div>

      {spotPrice > 0 && (
        <SpotContextStrip symbol={symbol} spotPrice={spotPrice} spotChange={spotChangePercent} />
      )}

      {spotPrice > 0 && insight && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[
            { label: "ATM strike", value: atmStrike.toLocaleString("en-IN"), live: true },
            { label: "Max pain Δ", value: `${insight.maxPainDistancePct >= 0 ? "+" : ""}${insight.maxPainDistancePct}%`, live: true },
            { label: "PCR (OI)", value: insight.pcrOI.toFixed(2), live: false },
            { label: "PCR Δ", value: insight.pcrDelta != null ? insight.pcrDelta.toFixed(3) : "—", live: false },
            { label: "ATM PCR", value: atmZone?.pcr.toFixed(2) ?? "—", live: true },
            { label: "Bias score", value: insight.score.toFixed(2), live: true },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {m.label}
                {m.live && spotIsLive && (
                  <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
                )}
              </p>
              <p className="font-mono text-sm font-semibold">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading && !insight ? (
        <Card className="border-border/80">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading option chain…
          </CardContent>
        </Card>
      ) : !insight ? (
        <Card className="border-border/80">
          <CardContent className="py-12 text-center text-muted-foreground">
            No chain data for {INDEX_INSIGHT_LABELS[symbol]}. Check proxy / Upstox token / market hours.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-border/80 lg:col-span-2">
            <CardHeader className="border-b border-border/60 bg-muted/20 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">
                  Price action read
                  {spotIsLive && (
                    <span className="ml-2 text-xs font-normal text-primary">· updates with live spot</span>
                  )}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {biasBadge(insight.bias)}
                  <Badge variant="secondary" className="capitalize">
                    {insight.confidence} confidence
                  </Badge>
                  <Badge variant="outline" className="gap-1 capitalize">
                    {directionIcon(insight.predictedDirection)}
                    {insight.predictedDirection === "range" ? "Range" : insight.predictedDirection}
                  </Badge>
                </div>
              </div>
              <CardDescription className="mt-1">{insight.outlook}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Spot (live)", value: fmt(insight.spotPrice) },
                  { label: "Max pain", value: fmt(insight.maxPain, 0) },
                  { label: "PCR (OI)", value: insight.pcrOI.toFixed(2) },
                  { label: "Score", value: insight.score.toFixed(2) },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</p>
                    <p className="font-mono text-sm font-semibold">{m.value}</p>
                  </div>
                ))}
              </div>
              <ul className="space-y-1.5 text-sm text-foreground/90">
                {insight.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Key levels (live distance)</CardTitle>
              <CardDescription className="text-xs">Distances refresh as spot ticks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Resistance (call OI)</p>
                {insight.resistanceWalls.map((w) => (
                  <div key={w.strike} className="flex justify-between font-mono text-bearish/90">
                    <span>
                      {w.strike.toLocaleString("en-IN")}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({strikeDistPct(spotPrice, w.strike) >= 0 ? "+" : ""}
                        {strikeDistPct(spotPrice, w.strike)}%)
                      </span>
                    </span>
                    <span>{(w.oi / 1e5).toFixed(1)}L</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Support (put OI)</p>
                {insight.supportWalls.map((w) => (
                  <div key={w.strike} className="flex justify-between font-mono text-bullish/90">
                    <span>
                      {w.strike.toLocaleString("en-IN")}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({strikeDistPct(spotPrice, w.strike) >= 0 ? "+" : ""}
                        {strikeDistPct(spotPrice, w.strike)}%)
                      </span>
                    </span>
                    <span>{(w.oi / 1e5).toFixed(1)}L</span>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 font-mono text-warning">
                Magnet: {insight.maxPain.toLocaleString("en-IN")} ({insight.maxPainDistancePct >= 0 ? "+" : ""}
                {insight.maxPainDistancePct}%)
              </div>
              {atmZone && (
                <div className="rounded-md border border-border/60 bg-muted/10 px-2 py-1.5 text-xs text-muted-foreground">
                  ATM zone CE Δ {(atmZone.totalCEOIChg / 1e5).toFixed(1)}L · PE Δ {(atmZone.totalPEOIChg / 1e5).toFixed(1)}L
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border/80">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/15 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Insight history & tracking</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="auto-track" checked={autoTrack} onCheckedChange={setAutoTrack} />
              <Label htmlFor="auto-track" className="text-xs text-muted-foreground">
                Auto-track vs live spot
              </Label>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={runTracking}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Refresh tracking
            </Button>
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive"
                onClick={() => {
                  clearInsightHistory();
                  setHistory([]);
                  toast.message("History cleared");
                }}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Clear all
              </Button>
            )}
          </div>
        </CardHeader>
        <CardDescription className="px-6 pb-2 text-xs">
          Tracking uses live WebSocket LTP for Nifty & Bank Nifty (±0.12% threshold).
        </CardDescription>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No saved insights yet. Run analysis and click &quot;Save to history&quot;.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Spot @ save</TableHead>
                  <TableHead>Bias / Call</TableHead>
                  <TableHead>Now (live)</TableHead>
                  <TableHead>Δ%</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.savedAt).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="font-medium">{INDEX_INSIGHT_LABELS[row.symbol]}</TableCell>
                    <TableCell className="font-mono text-xs">{fmt(row.spotAtSave)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {biasBadge(row.bias)}
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground capitalize">
                          {directionIcon(row.predictedDirection)}
                          {row.predictedDirection}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.lastPrice != null ? fmt(row.lastPrice) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.changePct != null ? (
                        <span
                          className={cn(
                            row.changePct > 0 ? "text-bullish" : row.changePct < 0 ? "text-bearish" : "",
                          )}
                        >
                          {row.changePct >= 0 ? "+" : ""}
                          {row.changePct}%
                          {row.changePct > 0 ? (
                            <TrendingUp className="ml-0.5 inline h-3 w-3" />
                          ) : row.changePct < 0 ? (
                            <TrendingDown className="ml-0.5 inline h-3 w-3" />
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{outcomeBadge(row.outcome)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          removeInsightHistoryEntry(row.id);
                          setHistory(loadInsightHistory());
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
