import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  BellRing,
  Volume2,
  ExternalLink,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  Radio,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { useSmallcapStockAlerts } from "@/hooks/useSmallcapStockAlerts";
import { useAlertNotifyPrefs } from "@/hooks/useAlertNotifyPrefs";
import { getProxyPortLabel } from "@/lib/proxyConfig";
import { DEFAULT_STOCK_POLL_MOVE_PCT, type SmallcapStockAlert } from "@/lib/smallcapStockAlerts";
import {
  SMALLCAP_INDEX_NAMES,
  type SmallcapConstituent,
  type SmallcapIndexKey,
} from "@/lib/smallcapUniverse";
import { cn } from "@/lib/utils";

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function AlertCard({
  alert,
  onOpen,
  compact,
}: {
  alert: SmallcapStockAlert;
  onOpen: () => void;
  compact?: boolean;
}) {
  const up = alert.direction === "up";
  return (
    <Card className={cn("border-l-4", up ? "border-l-bullish" : "border-l-bearish")}>
      <CardHeader className={cn("pb-2", compact && "py-3")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              {up ? (
                <TrendingUp className="h-3.5 w-3.5 shrink-0 text-bullish" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 shrink-0 text-bearish" />
              )}
              <span className="truncate">{alert.symbol}</span>
              <span className={cn("font-mono text-xs", up ? "text-bullish" : "text-bearish")}>
                {alert.movePct >= 0 ? "+" : ""}
                {fmt(alert.movePct)}%
              </span>
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              {new Date(alert.triggeredAt).toLocaleTimeString("en-IN")} · ₹{fmt(alert.ltp)} · day{" "}
              {alert.dayChangePercent >= 0 ? "+" : ""}
              {fmt(alert.dayChangePercent)}%
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      {!compact && (
        <CardContent className="space-y-2 pt-0 text-sm">
          <p className="text-xs text-muted-foreground">
            {fmt(alert.fromPrice)} → {fmt(alert.toPrice)} (~{Math.round(alert.pollMs / 1000)}s)
          </p>
          <p className="text-xs">{alert.tradeHint}</p>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onOpen}>
            <ExternalLink className="h-3 w-3" />
            Option chain
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function StockRow({
  stock,
  selected,
  hasAlert,
  alertDirection,
  flash,
  onSelect,
}: {
  stock: SmallcapConstituent;
  selected: boolean;
  hasAlert: boolean;
  alertDirection?: "up" | "down";
  flash?: "up" | "down" | null;
  onSelect: () => void;
}) {
  const up = stock.changePercent >= 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[minmax(72px,1fr)_88px_72px_56px] items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-xs transition-colors duration-300 hover:bg-muted/40",
        selected && "bg-primary/10 hover:bg-primary/15",
        hasAlert && !selected && "bg-muted/20",
        flash === "up" && "bg-bullish/15",
        flash === "down" && "bg-bearish/15",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-semibold text-foreground">{stock.symbol}</span>
        {hasAlert && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              alertDirection === "up" ? "bg-bullish" : "bg-bearish",
            )}
          />
        )}
      </div>
      <span
        className={cn(
          "font-mono text-right font-medium tabular-nums transition-colors duration-300",
          flash === "up" && "text-bullish",
          flash === "down" && "text-bearish",
        )}
      >
        {fmt(stock.ltp)}
      </span>
      <span className={cn("font-mono text-right tabular-nums", up ? "text-bullish" : "text-bearish")}>
        {up ? "+" : ""}
        {fmt(stock.changePercent)}%
      </span>
      <span className="text-right text-[10px] text-muted-foreground">{stock.indices.join("·")}</span>
    </button>
  );
}

export default function SmallcapStockAlerts() {
  const navigate = useNavigate();
  const [monitorOn, setMonitorOn] = useState(true);
  const [sensitivity, setSensitivity] = useState(100);
  const [indexFilter, setIndexFilter] = useState<"all" | SmallcapIndexKey>("all");
  const [search, setSearch] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [alertTab, setAlertTab] = useState<"live" | "history">("live");
  const { prefs, setSound, setBrowser, requestPermission } = useAlertNotifyPrefs();

  const minMovePct = DEFAULT_STOCK_POLL_MOVE_PCT * (sensitivity / 100);

  const {
    universeQuery,
    activeAlerts,
    history,
    lastPollAt,
    stockCount,
    clearHistory,
    refetchUniverse,
  } = useSmallcapStockAlerts({
    enabled: monitorOn,
    minMovePct,
    indexFilter,
    notifyToast: true,
  });

  const stocks = universeQuery.data ?? [];

  const alertBySymbol = useMemo(() => {
    const map = new Map<string, SmallcapStockAlert>();
    for (const a of activeAlerts) map.set(a.symbol, a);
    return map;
  }, [activeAlerts]);

  const filteredStocks = useMemo(() => {
    const q = search.trim().toUpperCase();
    let list = stocks;
    if (q) list = list.filter((s) => s.symbol.includes(q));
    return [...list].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [stocks, search]);

  const displayAlerts = useMemo(() => {
    const live = selectedSymbol
      ? activeAlerts.filter((a) => a.symbol === selectedSymbol)
      : activeAlerts;
    const hist = selectedSymbol
      ? history.filter((a) => a.symbol === selectedSymbol)
      : history;
    return { live, hist };
  }, [activeAlerts, history, selectedSymbol]);

  const prevLtpRef = useRef<Map<string, number>>(new Map());
  const [flashMap, setFlashMap] = useState<Record<string, "up" | "down">>({});

  useEffect(() => {
    if (!stocks.length || !lastPollAt) return;
    const flashes: Record<string, "up" | "down"> = {};
    for (const s of stocks) {
      const prev = prevLtpRef.current.get(s.symbol);
      if (prev != null && prev > 0 && s.ltp !== prev) {
        flashes[s.symbol] = s.ltp > prev ? "up" : "down";
      }
      prevLtpRef.current.set(s.symbol, s.ltp);
    }
    if (Object.keys(flashes).length > 0) {
      setFlashMap(flashes);
      const t = setTimeout(() => setFlashMap({}), 700);
      return () => clearTimeout(t);
    }
  }, [stocks, lastPollAt]);

  const loading = universeQuery.isLoading && !stocks.length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[520px] flex-col gap-3 overflow-hidden p-1 md:p-0">
      <div className="shrink-0 space-y-3">
        <SectionHeader
          title="Nifty Smallcap Stock Alerts"
          subtitle="Alerts on the left · full smallcap universe with live NSE updates on the right"
          tooltip="Right panel refreshes all constituent LTPs every ~5s from NSE. Left panel shows spike alerts."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-2xs">
            {stockCount} stocks
          </Badge>
          {lastPollAt && (
            <span className="text-xs text-muted-foreground">
              Last poll {new Date(lastPollAt).toLocaleTimeString("en-IN")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => refetchUniverse()}
            disabled={universeQuery.isFetching}
          >
            {universeQuery.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <Tabs
            value={indexFilter}
            onValueChange={(v) => {
              setIndexFilter(v as "all" | SmallcapIndexKey);
              setSelectedSymbol(null);
            }}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="SC50">SC 50</TabsTrigger>
              <TabsTrigger value="SC100">SC 100</TabsTrigger>
              <TabsTrigger value="SC250">SC 250</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex min-w-[200px] flex-1 flex-wrap items-center gap-4 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <Switch id="sc-mon" checked={monitorOn} onCheckedChange={setMonitorOn} />
              <Label htmlFor="sc-mon" className="text-xs">
                Monitor
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="sc-sound" checked={prefs.sound} onCheckedChange={setSound} />
              <Label htmlFor="sc-sound" className="flex items-center gap-1 text-xs">
                <Volume2 className="h-3 w-3" />
                Sound
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="sc-bg"
                checked={prefs.browser}
                onCheckedChange={async (v) => {
                  await setBrowser(v);
                  if (v) await requestPermission();
                }}
              />
              <Label htmlFor="sc-bg" className="flex items-center gap-1 text-xs">
                <BellRing className="h-3 w-3" />
                Background
              </Label>
            </div>
            <div className="min-w-[160px] flex-1 space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Sensitivity {sensitivity}% (~{minMovePct.toFixed(2)}%/poll)
              </Label>
              <Slider
                value={[sensitivity]}
                min={70}
                max={130}
                step={5}
                onValueChange={([v]) => setSensitivity(v)}
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : universeQuery.isError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load smallcap constituents. Ensure the proxy is running (port {getProxyPortLabel()}).
        </p>
      ) : stockCount === 0 ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          No smallcap stocks loaded yet. Restart the proxy and click Refresh — the server pulls symbols from NSE
          archives and live prices from TradingView (or Upstox if configured).
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(280px,36%)_1fr]">
          {/* Left: alerts */}
          <Card className="flex min-h-0 flex-col overflow-hidden border-border/80 order-2 lg:order-1">
            <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 border-b border-border/60 py-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Radar className="h-4 w-4 text-primary" />
                  Alerts
                  {selectedSymbol && (
                    <Badge variant="secondary" className="text-2xs font-mono">
                      {selectedSymbol}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  {displayAlerts.live.length} live · {displayAlerts.hist.length} in history
                </CardDescription>
              </div>
              <Tabs value={alertTab} onValueChange={(v) => setAlertTab(v as "live" | "history")}>
                <TabsList className="h-8">
                  <TabsTrigger value="live" className="text-xs px-3">
                    Live
                  </TabsTrigger>
                  <TabsTrigger value="history" className="text-xs px-3">
                    History
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 p-3">
                {alertTab === "live" ? (
                  displayAlerts.live.length === 0 ? (
                    <div className="rounded-lg border border-dashed py-12 text-center">
                      <p className="text-sm text-muted-foreground">
                        {monitorOn
                          ? "No sudden moves right now. Watching all smallcap names…"
                          : "Turn on monitoring to detect spikes."}
                      </p>
                    </div>
                  ) : (
                    displayAlerts.live.map((a) => (
                      <AlertCard
                        key={a.id}
                        alert={a}
                        onOpen={() => navigate(`/option-chain?symbol=${a.symbol}`)}
                      />
                    ))
                  )
                ) : displayAlerts.hist.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Past alerts appear here (saved in browser).
                  </p>
                ) : (
                  displayAlerts.hist.map((a) => (
                    <AlertCard
                      key={a.id}
                      alert={a}
                      compact
                      onOpen={() => navigate(`/option-chain?symbol=${a.symbol}`)}
                    />
                  ))
                )}
              </div>
            </ScrollArea>

            {alertTab === "history" && displayAlerts.hist.length > 0 && (
              <div className="shrink-0 border-t border-border/60 p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs text-destructive"
                  onClick={clearHistory}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Clear history
                </Button>
              </div>
            )}
          </Card>

          {/* Right: all stocks (live updates) */}
          <Card className="flex min-h-0 flex-col overflow-hidden border-border/80 order-1 lg:order-2">
            <CardHeader className="shrink-0 space-y-2 border-b border-border/60 py-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Smallcap universe</CardTitle>
                <div className="flex items-center gap-1.5">
                  {monitorOn && universeQuery.isFetching && (
                    <Badge variant="outline" className="gap-1 text-[10px] text-primary border-primary/40">
                      <Radio className="h-2.5 w-2.5 animate-pulse" />
                      Updating
                    </Badge>
                  )}
                  {lastPollAt && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(lastPollAt).toLocaleTimeString("en-IN")}
                    </span>
                  )}
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search symbol…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              {selectedSymbol && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => setSelectedSymbol(null)}
                >
                  Show all stocks (clear {selectedSymbol})
                </Button>
              )}
              <div className="grid grid-cols-[minmax(72px,1fr)_88px_72px_56px] gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Symbol</span>
                <span className="text-right">LTP</span>
                <span className="text-right">Day %</span>
                <span className="text-right">Idx</span>
              </div>
            </CardHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="pb-2">
                {filteredStocks.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">No symbols match.</p>
                ) : (
                  filteredStocks.map((stock) => {
                    const alert = alertBySymbol.get(stock.symbol);
                    return (
                      <StockRow
                        key={stock.symbol}
                        stock={stock}
                        selected={selectedSymbol === stock.symbol}
                        hasAlert={!!alert}
                        alertDirection={alert?.direction}
                        flash={flashMap[stock.symbol] ?? null}
                        onSelect={() =>
                          setSelectedSymbol((prev) => (prev === stock.symbol ? null : stock.symbol))
                        }
                      />
                    );
                  })
                )}
              </div>
            </ScrollArea>
            <div className="shrink-0 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
              {filteredStocks.length} stocks · NSE refresh ~5s · tap row to filter alerts on the left
            </div>
          </Card>
        </div>
      )}

      <Alert className="shrink-0">
        <Bell className="h-4 w-4" />
        <AlertTitle className="text-sm">How it works</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Right: every stock in {SMALLCAP_INDEX_NAMES.SC50}, {SMALLCAP_INDEX_NAMES.SC100}, and{" "}
          {SMALLCAP_INDEX_NAMES.SC250} with LTP updated each NSE poll (~5s). Left: spike alerts when price
          moves vs the previous poll. Flash green/red on LTP = just updated.
        </AlertDescription>
      </Alert>
    </div>
  );
}
