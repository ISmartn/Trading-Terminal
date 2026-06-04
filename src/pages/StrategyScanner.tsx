import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2,
  RefreshCw,
  Moon,
  CandlestickChart,
  Zap,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowUpDown,
  Waves,
} from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import {
  useBtstScanner,
  useMultiDayScanner,
  useOrbScanner,
  useOrderFlowScanner,
  useVwapMrScanner,
} from "@/hooks/useFnoStrategyScanner";
import { useOrbBacktest } from "@/hooks/useIntradayBacktest";
import { INTRADAY_ALPHA_CATALOG, ORDER_FLOW_RULES } from "@/lib/intradayAlpha";
import type {
  AbsorptionKind,
  CvdDivergenceKind,
  OrderFlowBias,
} from "@/lib/orderFlowSignals";
import { VwapBandsSimulator } from "@/components/VwapBandsSimulator";
import {
  sortVwapMrRows,
  VWAP_MR_ADX_MAX,
  VWAP_MR_Z_HIGH,
  VWAP_MR_Z_TRIGGER,
} from "@/lib/vwapMeanReversion";
import type { StrategyUniverse } from "@/lib/fnoStrategies";
import {
  ORB_MARKET_OPEN_MIN,
  ORB_WINDOW_END_MIN,
  SUPERTREND_MULT,
  SUPERTREND_PERIOD,
  BTST_BODY_AVG_WINDOW,
  sortBtstRows,
  sortMultiDayRows,
  sortOrbRows,
  type SetupQuality,
  type StrategySortDir,
  type StrategySortField,
} from "@/lib/fnoStrategies";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function orbTimeLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type SortOption = `${StrategySortField}-${StrategySortDir}`;

type TabId = "btst" | "multiday" | "orb" | "vwapmr";

type VwapMrSortOption = `${"signal" | "symbol" | "ltp" | "zscore"}-${StrategySortDir}`;

const TAB_DEFAULT_SORT: Record<TabId, SortOption> = {
  btst: "confluence-desc",
  multiday: "confluence-desc",
  orb: "confluence-desc",
  vwapmr: "signal-asc",
};

const VWAP_MR_SORT_OPTIONS: { value: VwapMrSortOption; label: string }[] = [
  { value: "signal-asc", label: "Signal (long → short)" },
  { value: "zscore-desc", label: "|Z| (extreme → mild)" },
  { value: "symbol-asc", label: "Symbol (A → Z)" },
  { value: "ltp-desc", label: "LTP (high → low)" },
];

const SORT_OPTIONS: Record<TabId, { value: SortOption; label: string }[]> = {
  btst: [
    { value: "confluence-desc", label: "Confluence (high → low)" },
    { value: "signal-asc", label: "Signal (BTST → STBT)" },
    { value: "signal-desc", label: "Signal (STBT → BTST)" },
    { value: "symbol-asc", label: "Symbol (A → Z)" },
    { value: "symbol-desc", label: "Symbol (Z → A)" },
    { value: "ltp-desc", label: "LTP (high → low)" },
    { value: "ltp-asc", label: "LTP (low → high)" },
    { value: "volume-desc", label: "Volume× (high → low)" },
    { value: "volume-asc", label: "Volume× (low → high)" },
  ],
  multiday: [
    { value: "confluence-desc", label: "Confluence (high → low)" },
    { value: "signal-asc", label: "Signal (bullish → bearish)" },
    { value: "signal-desc", label: "Signal (bearish → bullish)" },
    { value: "symbol-asc", label: "Symbol (A → Z)" },
    { value: "symbol-desc", label: "Symbol (Z → A)" },
    { value: "ltp-desc", label: "LTP (high → low)" },
    { value: "ltp-asc", label: "LTP (low → high)" },
  ],
  orb: [
    { value: "confluence-desc", label: "Confluence (high → low)" },
    { value: "signal-asc", label: "Signal (long → short)" },
    { value: "signal-desc", label: "Signal (short → long)" },
    { value: "symbol-asc", label: "Symbol (A → Z)" },
    { value: "symbol-desc", label: "Symbol (Z → A)" },
    { value: "ltp-desc", label: "LTP (high → low)" },
    { value: "ltp-asc", label: "LTP (low → high)" },
  ],
};

function ConfluenceBadge({
  score,
  max,
  quality,
  title,
}: {
  score: number;
  max: number;
  quality: SetupQuality;
  title?: string;
}) {
  const variant =
    quality === "high" ? "default" : quality === "medium" ? "secondary" : quality === "low" ? "outline" : "destructive";
  return (
    <Badge variant={variant} className="text-2xs font-mono" title={title}>
      {score}/{max} {quality}
    </Badge>
  );
}

function parseSortOption(option: SortOption): { field: StrategySortField; dir: StrategySortDir } {
  const [field, dir] = option.split("-") as [StrategySortField, StrategySortDir];
  return { field, dir };
}

function SortableHead({
  label,
  field,
  activeField,
  dir,
  onSort,
  className,
}: {
  label: string;
  field: StrategySortField;
  activeField: StrategySortField;
  dir: StrategySortDir;
  onSort: (field: StrategySortField) => void;
  className?: string;
}) {
  const active = activeField === field;
  return (
    <TableHead
      className={cn("text-2xs cursor-pointer select-none hover:text-foreground", className)}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", active ? "text-foreground" : "text-muted-foreground/50")} />
        {active && <span className="sr-only">{dir === "asc" ? "ascending" : "descending"}</span>}
      </span>
    </TableHead>
  );
}

export default function StrategyScanner() {
  const navigate = useNavigate();
  const [universe, setUniverse] = useState<StrategyUniverse>("popular");
  const [tab, setTab] = useState<TabId>("btst");
  const [sortOption, setSortOption] = useState<SortOption>(TAB_DEFAULT_SORT.btst);
  const [confluenceFilter, setConfluenceFilter] = useState<"all" | "medium+" | "high">("all");

  const btst = useBtstScanner(universe, tab === "btst");
  const multiday = useMultiDayScanner(universe);
  const orb = useOrbScanner(universe, tab === "orb");
  const vwapMr = useVwapMrScanner(universe, tab === "vwapmr");
  const orderFlow = useOrderFlowScanner(universe, tab === "vwapmr");
  const orbBacktest = useOrbBacktest("NIFTY", tab === "orb");
  const [vwapMrSort, setVwapMrSort] = useState<VwapMrSortOption>("signal-asc");
  const [absorptionFilter, setAbsorptionFilter] = useState<"all" | AbsorptionKind>("all");
  const [cvdFilter, setCvdFilter] = useState<"all" | CvdDivergenceKind>("all");
  const [biasFilter, setBiasFilter] = useState<"all" | OrderFlowBias>("all");

  const goSymbol = (s: string) => navigate(`/option-chain?symbol=${s}`);

  const activeQuery =
    tab === "btst" ? btst : tab === "multiday" ? multiday : tab === "vwapmr" ? vwapMr : orb;

  useEffect(() => {
    setSortOption(TAB_DEFAULT_SORT[tab]);
    setConfluenceFilter("all");
    setAbsorptionFilter("all");
    setCvdFilter("all");
    setBiasFilter("all");
  }, [tab]);

  const { field: sortField, dir: sortDir } = parseSortOption(sortOption);

  const toggleSortField = (field: StrategySortField) => {
    if (sortField === field) {
      setSortOption(`${field}-${sortDir === "asc" ? "desc" : "asc"}` as SortOption);
    } else {
      const defaultDir: StrategySortDir =
        field === "signal" || field === "symbol" ? "asc" : "desc";
      setSortOption(`${field}-${defaultDir}` as SortOption);
    }
  };

  const btstRows = useMemo(
    () => sortBtstRows(btst.data?.rows ?? [], sortField, sortDir),
    [btst.data?.rows, sortField, sortDir],
  );
  const multidayRows = useMemo(() => {
    let rows = sortMultiDayRows(multiday.data?.rows ?? [], sortField, sortDir);
    if (confluenceFilter === "high") {
      rows = rows.filter((r) => r.setupQuality === "high");
    } else if (confluenceFilter === "medium+") {
      rows = rows.filter((r) => r.setupQuality === "high" || r.setupQuality === "medium");
    }
    return rows;
  }, [multiday.data?.rows, sortField, sortDir, confluenceFilter]);
  const orbRows = useMemo(
    () => sortOrbRows(orb.data?.rows ?? [], sortField, sortDir),
    [orb.data?.rows, sortField, sortDir],
  );

  const [vwapMrSortField, vwapMrSortDir] = vwapMrSort.split("-") as [
    "signal" | "symbol" | "ltp" | "zscore",
    StrategySortDir,
  ];
  const vwapMrRows = useMemo(
    () => sortVwapMrRows(vwapMr.data?.rows ?? [], vwapMrSortField, vwapMrSortDir),
    [vwapMr.data?.rows, vwapMrSortField, vwapMrSortDir],
  );
  const orderFlowRowsAll = orderFlow.data?.rows ?? [];
  const orderFlowRows = useMemo(() => {
    return orderFlowRowsAll.filter((row) => {
      if (absorptionFilter !== "all" && row.absorption !== absorptionFilter) return false;
      if (cvdFilter !== "all" && row.cvdDivergence !== cvdFilter) return false;
      if (biasFilter !== "all" && row.bias !== biasFilter) return false;
      return true;
    });
  }, [orderFlowRowsAll, absorptionFilter, cvdFilter, biasFilter]);

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-7xl mx-auto">
      <SectionHeader
        title="Algo Strategy Scanner"
        subtitle="BTST/STBT · Multi-Day · ORB breakout · VWAP mean reversion · Order-flow proxy"
        tooltip="Patterns are triggers only — each setup is scored for HTF context, liquidity, volume, RSI, ADX, and mean-reversion alignment. Analytics only."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={universe} onValueChange={(v) => setUniverse(v as StrategyUniverse)}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Popular F&O</SelectItem>
            <SelectItem value="all">All F&O</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={() => activeQuery.refetch()}
          disabled={activeQuery.isFetching}
        >
          {activeQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
        {activeQuery.data?.symbolCount != null && (
          <span className="text-2xs text-muted-foreground">
            Scanned {activeQuery.data.symbolCount} symbols
          </span>
        )}
        {tab === "vwapmr" ? (
          <Select value={vwapMrSort} onValueChange={(v) => setVwapMrSort(v as VwapMrSortOption)}>
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VWAP_MR_SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Sort by signal" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS[tab === "vwapmr" ? "orb" : tab].map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tab === "multiday" && (
          <ToggleGroup
            type="single"
            value={confluenceFilter}
            onValueChange={(v) => v && setConfluenceFilter(v as typeof confluenceFilter)}
            className="h-8"
          >
            <ToggleGroupItem value="all" className="text-2xs h-8 px-2">All patterns</ToggleGroupItem>
            <ToggleGroupItem value="medium+" className="text-2xs h-8 px-2">Medium+</ToggleGroupItem>
            <ToggleGroupItem value="high" className="text-2xs h-8 px-2">High only</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="btst" className="gap-1.5 text-xs">
            <Moon className="h-3.5 w-3.5" />
            BTST / STBT
            {btst.data?.rows.length ? (
              <Badge variant="secondary" className="text-2xs h-4 px-1">{btst.data.rows.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="multiday" className="gap-1.5 text-xs">
            <CandlestickChart className="h-3.5 w-3.5" />
            Multi-Day
            {multiday.data?.rows.length ? (
              <Badge variant="secondary" className="text-2xs h-4 px-1">{multiday.data.rows.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="orb" className="gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" />
            ORB + VWAP + ST
            {orb.data?.rows.length ? (
              <Badge variant="secondary" className="text-2xs h-4 px-1">{orb.data.rows.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="vwapmr" className="gap-1.5 text-xs">
            <Waves className="h-3.5 w-3.5" />
            VWAP MR + Flow
            {vwapMr.data?.rows.length ? (
              <Badge variant="secondary" className="text-2xs h-4 px-1">{vwapMr.data.rows.length}</Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ── BTST / STBT ── */}
        <TabsContent value="btst" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Strategy I — Next-Day Directional Bias
              </CardTitle>
              <CardDescription className="text-2xs">
                Evaluated at 3:00–3:30 PM IST · Product: NRML (overnight carry)
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xs text-muted-foreground space-y-1 pb-4">
              <p><strong className="text-foreground">BTST:</strong> T-1 small red → T strong green, close &gt; high(T-1), volume expansion.</p>
              <p><strong className="text-foreground">STBT:</strong> T-1 small green → T strong red, close &lt; low(T-1), volume expansion.</p>
              <p>Body size normalized vs {BTST_BODY_AVG_WINDOW}-day rolling average.</p>
              <p>Stop: T-1 extreme ± 0.5× ATR(14) · Target: measured move + 1.5× ATR · Exit next session.</p>
              <p>Confluence: 20 EMA trend, close location, RSI, volume, HTF range position.</p>
            </CardContent>
          </Card>

          {btst.isLoading ? (
            <div className="flex justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning BTST/STBT setups…
            </div>
          ) : !btst.data?.rows.length ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No BTST/STBT setups right now.</CardContent></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Symbol" field="symbol" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <SortableHead label="Signal" field="signal" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <SortableHead label="LTP" field="ltp" activeField={sortField} dir={sortDir} onSort={toggleSortField} className="text-right justify-end" />
                  <TableHead className="text-2xs text-right">Vol×</TableHead>
                  <TableHead className="text-2xs text-right">Entry</TableHead>
                  <TableHead className="text-2xs text-right">Stop</TableHead>
                  <TableHead className="text-2xs text-right">Target</TableHead>
                  <TableHead className="text-2xs text-right">R:R</TableHead>
                  <TableHead className="text-2xs">Confluence</TableHead>
                  <TableHead className="text-2xs">Plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {btstRows.map((row) => (
                  <TableRow key={`${row.symbol}-${row.side}`} className="cursor-pointer hover:bg-muted/50" onClick={() => goSymbol(row.symbol)}>
                    <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={row.side === "btst" ? "default" : "destructive"} className="text-2xs">
                        {row.side.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.volumeRatio, 1)}×</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.entryLevel, 0)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", row.side === "btst" ? "text-bearish" : "text-bullish")}>{fmt(row.stopLoss, 0)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", row.side === "btst" ? "text-bullish" : "text-bearish")}>{fmt(row.targetLevel, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">1:{fmt(row.riskRewardRatio, 1)}</TableCell>
                    <TableCell>
                      <ConfluenceBadge
                        score={row.confluenceScore}
                        max={row.confluenceMax}
                        quality={row.setupQuality}
                        title={[row.htfContext, ...row.confluenceFactors].join(" · ")}
                      />
                    </TableCell>
                    <TableCell className="text-2xs text-muted-foreground max-w-[220px]">{row.action}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── Multi-Day ── */}
        <TabsContent value="multiday" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Strategy II — Multi-Day Momentum</CardTitle>
              <CardDescription className="text-2xs">
                Three White Soldiers · Three Black Crows · Candle Range Theory (AMD cycle)
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xs text-muted-foreground space-y-1 pb-4">
              <p><strong className="text-foreground">Soldiers/Crows:</strong> 3 consecutive aligned candles with opens inside prior body.</p>
              <p><strong className="text-foreground">Framework:</strong> Pattern = trigger only. Confluence scores HTF discount/premium, 20d liquidity, ADX, RSI, volume, Bollinger (CRT), RSI divergence (AMD).</p>
              <p>Entry/stop/target: pattern geometry + ATR buffer · min 1:2 R:R · hold from ATR pace &amp; ADX.</p>
            </CardContent>
          </Card>

          {multiday.isLoading ? (
            <div className="flex justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning multi-day patterns…
            </div>
          ) : !multiday.data?.rows.length ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No multi-day patterns detected.</CardContent></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Symbol" field="symbol" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <SortableHead label="Signal" field="signal" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <TableHead className="text-2xs">Pattern</TableHead>
                  <TableHead className="text-2xs">HTF</TableHead>
                  <SortableHead label="LTP" field="ltp" activeField={sortField} dir={sortDir} onSort={toggleSortField} className="text-right" />
                  <TableHead className="text-2xs text-right">Entry</TableHead>
                  <TableHead className="text-2xs text-right">Stop</TableHead>
                  <TableHead className="text-2xs text-right">Target</TableHead>
                  <TableHead className="text-2xs text-right">R:R</TableHead>
                  <SortableHead label="Confluence" field="confluence" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <TableHead className="text-2xs">Hold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {multidayRows.map((row) => (
                  <TableRow key={`${row.symbol}-${row.pattern}`} className="cursor-pointer hover:bg-muted/50" onClick={() => goSymbol(row.symbol)}>
                    <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={row.side === "bullish" ? "default" : "destructive"} className="text-2xs gap-0.5">
                        {row.side === "bullish" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {row.side.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-2xs">{row.label}</TableCell>
                    <TableCell className="text-2xs text-muted-foreground max-w-[100px]" title={row.confluenceFactors.join(" · ")}>{row.htfContext}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
                    <TableCell className="text-right font-mono text-xs" title={row.entryRule}>{fmt(row.entryLevel, 0)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", row.side === "bullish" ? "text-bearish" : "text-bullish")} title={row.stopRule}>{fmt(row.stopLoss, 0)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", row.side === "bullish" ? "text-bullish" : "text-bearish")} title={row.targetRule}>{fmt(row.targetLevel, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">1:{fmt(row.riskRewardRatio, 1)}</TableCell>
                    <TableCell>
                      <ConfluenceBadge
                        score={row.confluenceScore}
                        max={row.confluenceMax}
                        quality={row.setupQuality}
                        title={row.confluenceFactors.join(" · ")}
                      />
                    </TableCell>
                    <TableCell className="text-2xs" title={row.action}>{row.holdDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── ORB ── */}
        <TabsContent value="orb" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Strategy III — Intraday ORB + VWAP + Supertrend</CardTitle>
              <CardDescription className="text-2xs">
                Opening range {orbTimeLabel(ORB_MARKET_OPEN_MIN)}–{orbTimeLabel(ORB_WINDOW_END_MIN)} IST · Supertrend {SUPERTREND_PERIOD}/{SUPERTREND_MULT} · Product: MIS
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xs text-muted-foreground space-y-1 pb-4">
              <p><strong className="text-foreground">Alpha:</strong> Momentum / breakout — captures opening-range imbalance with VWAP + volatility trend filter.</p>
              <p><strong className="text-foreground">Long:</strong> Post-ORB close &gt; range high, above VWAP, Supertrend green.</p>
              <p><strong className="text-foreground">Short:</strong> Post-ORB close &lt; range low, below VWAP, Supertrend red.</p>
              <p><strong className="text-foreground">Exit:</strong> Supertrend flip · hard ORB stop · session close.</p>
              <p>Backtest includes STT, brokerage, exchange, GST, and slippage (see panel below).</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Intraday Alpha Catalog (Phase 1)</CardTitle>
              <CardDescription className="text-2xs">Systematic rules — write the edge before coding</CardDescription>
            </CardHeader>
            <CardContent className="text-2xs space-y-3 pb-4">
              {INTRADAY_ALPHA_CATALOG.map((alpha) => (
                <div key={alpha.kind} className="rounded-md border p-2 space-y-1">
                  <p className="font-medium text-foreground">{alpha.name} · {alpha.product}</p>
                  <p className="text-muted-foreground">{alpha.inefficiency}</p>
                  <p><span className="text-foreground">Entry:</span> {alpha.entryRules.join(" · ")}</p>
                  <p><span className="text-foreground">Exit:</span> {alpha.exitRules.join(" · ")}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Phase 3 — ORB Backtest (NIFTY, 1M 5m)</CardTitle>
              <CardDescription className="text-2xs">Bar-by-bar simulation · costs + 2pt slippage/leg · 70/30 walk-forward</CardDescription>
            </CardHeader>
            <CardContent className="text-2xs pb-4">
              {orbBacktest.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running backtest…
                </div>
              ) : orbBacktest.data ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
                  <div>
                    <p className="text-muted-foreground">Net P&amp;L (full)</p>
                    <p className={cn("text-sm", orbBacktest.data.full.netPnl >= 0 ? "text-bullish" : "text-bearish")}>
                      ₹{fmt(orbBacktest.data.full.netPnl, 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Win rate</p>
                    <p className="text-sm">{(orbBacktest.data.full.winRate * 100).toFixed(0)}% ({orbBacktest.data.full.tradeCount} trades)</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Costs drag</p>
                    <p className="text-sm">₹{fmt(orbBacktest.data.full.totalCosts, 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Walk-forward test</p>
                    <p className={cn("text-sm", orbBacktest.data.walkForward.test.netPnl >= 0 ? "text-bullish" : "text-bearish")}>
                      ₹{fmt(orbBacktest.data.walkForward.test.netPnl, 0)} net
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Profit factor</p>
                    <p className="text-sm">{Number.isFinite(orbBacktest.data.full.profitFactor) ? orbBacktest.data.full.profitFactor.toFixed(2) : "∞"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Max drawdown</p>
                    <p className="text-sm">₹{fmt(orbBacktest.data.full.maxDrawdown, 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Train (70%)</p>
                    <p className="text-sm">₹{fmt(orbBacktest.data.walkForward.train.netPnl, 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Sessions</p>
                    <p className="text-sm">{orbBacktest.data.full.sessions}</p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">Backtest unavailable — check Upstox token and historical data.</p>
              )}
            </CardContent>
          </Card>

          {orb.isLoading ? (
            <div className="flex justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning intraday ORB setups…
            </div>
          ) : !orb.data?.rows.length ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No ORB + VWAP + Supertrend signals (market may be pre-ORB or no alignment).</CardContent></Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Symbol" field="symbol" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <SortableHead label="Signal" field="signal" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <SortableHead label="Confluence" field="confluence" activeField={sortField} dir={sortDir} onSort={toggleSortField} />
                  <SortableHead label="LTP" field="ltp" activeField={sortField} dir={sortDir} onSort={toggleSortField} className="text-right" />
                  <TableHead className="text-2xs text-right">ORB High</TableHead>
                  <TableHead className="text-2xs text-right">ORB Low</TableHead>
                  <TableHead className="text-2xs text-right">Stop</TableHead>
                  <TableHead className="text-2xs text-right">Target</TableHead>
                  <TableHead className="text-2xs text-right">R:R</TableHead>
                  <TableHead className="text-2xs text-right">VWAP</TableHead>
                  <TableHead className="text-2xs text-right">ST</TableHead>
                  <TableHead className="text-2xs">Exit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orbRows.map((row) => (
                  <TableRow key={row.symbol} className="cursor-pointer hover:bg-muted/50" onClick={() => goSymbol(row.symbol)}>
                    <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant={row.state === "long" || row.state === "watch_long" ? "default" : "destructive"}
                        className={cn(
                          "text-2xs gap-0.5",
                          row.state.startsWith("watch") && "opacity-80",
                        )}
                      >
                        {row.state === "long" || row.state === "watch_long" ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {row.state.replace("_", " ").toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ConfluenceBadge
                        score={row.confluenceScore}
                        max={row.confluenceMax}
                        quality={row.setupQuality}
                        title={row.confluenceFactors.join(" · ")}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.orbHigh, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.orbLow, 0)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", row.state.includes("long") ? "text-bearish" : "text-bullish")}>{fmt(row.stopLoss, 0)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", row.state.includes("long") ? "text-bullish" : "text-bearish")}>{fmt(row.targetLevel, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">1:{fmt(row.riskRewardRatio, 1)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-amber-700">{fmt(row.vwap, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(row.supertrend, 0)}</TableCell>
                    <TableCell className="text-2xs text-muted-foreground max-w-[200px]" title={row.action}>{row.exitRule}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── VWAP Mean Reversion + Order Flow ── */}
        <TabsContent value="vwapmr" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">VWAP Mean Reversion (Statistical Extremes)</CardTitle>
              <CardDescription className="text-2xs">
                Fade ±{VWAP_MR_Z_TRIGGER}σ–{VWAP_MR_Z_HIGH}σ from session VWAP when ADX ≤ {VWAP_MR_ADX_MAX} · Product: MIS
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xs text-muted-foreground space-y-1 pb-4">
              <p><strong className="text-foreground">Regime:</strong> Mean reversion disabled on trend days (ADX filter) and during ORB breakouts.</p>
              <p><strong className="text-foreground">Trigger:</strong> Price at 2σ+ from VWAP; high-confidence at 3σ with volume spike + rejection wick.</p>
              <p><strong className="text-foreground">Risk:</strong> Stop 1× ATR beyond rejection wick · Target session VWAP.</p>
            </CardContent>
          </Card>

          <VwapBandsSimulator />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{ORDER_FLOW_RULES.name}</CardTitle>
              <CardDescription className="text-2xs">OHLCV footprint proxy — effort vs. result absorption</CardDescription>
            </CardHeader>
            <CardContent className="text-2xs space-y-1 pb-4 text-muted-foreground">
              <p>{ORDER_FLOW_RULES.inefficiency}</p>
              <p><span className="text-foreground">Entry:</span> {ORDER_FLOW_RULES.entryRules.join(" · ")}</p>
              <p><span className="text-foreground">Exit:</span> {ORDER_FLOW_RULES.exitRules.join(" · ")}</p>
            </CardContent>
          </Card>

          {vwapMr.isLoading || orderFlow.isLoading ? (
            <div className="flex justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning VWAP MR &amp; order-flow setups…
            </div>
          ) : (
            <>
              {!vwapMrRows.length ? (
                <Card>
                  <CardContent className="py-6 text-center text-sm text-muted-foreground">
                    No VWAP mean-reversion stretches (market may be trending, pre-ORB, or inside ±{VWAP_MR_Z_TRIGGER}σ).
                  </CardContent>
                </Card>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-2xs">Symbol</TableHead>
                      <TableHead className="text-2xs">Signal</TableHead>
                      <TableHead className="text-2xs text-right">Z</TableHead>
                      <TableHead className="text-2xs text-right">ADX</TableHead>
                      <TableHead className="text-2xs text-right">Vol×</TableHead>
                      <TableHead className="text-2xs text-right">Entry</TableHead>
                      <TableHead className="text-2xs text-right">VWAP</TableHead>
                      <TableHead className="text-2xs text-right">Stop</TableHead>
                      <TableHead className="text-2xs text-right">R:R</TableHead>
                      <TableHead className="text-2xs">Plan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vwapMrRows.map((row) => (
                      <TableRow key={row.symbol} className="cursor-pointer hover:bg-muted/50" onClick={() => goSymbol(row.symbol)}>
                        <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
                        <TableCell>
                          <Badge
                            variant={row.state.includes("long") ? "default" : "destructive"}
                            className={cn("text-2xs", row.state.startsWith("watch") && "opacity-80")}
                          >
                            {row.state.replace("_", " ").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{row.zScore.toFixed(2)}σ</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(row.adx14, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(row.volumeRatio, 1)}×</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(row.entryLevel, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-amber-700">{fmt(row.vwap, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{fmt(row.stopLoss, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">1:{fmt(row.riskRewardRatio, 1)}</TableCell>
                        <TableCell className="text-2xs text-muted-foreground max-w-[240px]" title={row.exitRule}>{row.action}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {orderFlowRowsAll.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs text-muted-foreground mr-1">Order flow filters:</span>
                    <Select
                      value={absorptionFilter}
                      onValueChange={(v) => setAbsorptionFilter(v as typeof absorptionFilter)}
                    >
                      <SelectTrigger className="w-[168px] h-8 text-xs">
                        <SelectValue placeholder="Absorption" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">Absorption: All</SelectItem>
                        <SelectItem value="selling_absorption" className="text-xs">Selling (floor)</SelectItem>
                        <SelectItem value="buying_absorption" className="text-xs">Buying (ceiling)</SelectItem>
                        <SelectItem value="none" className="text-xs">None (CVD only)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={cvdFilter} onValueChange={(v) => setCvdFilter(v as typeof cvdFilter)}>
                      <SelectTrigger className="w-[148px] h-8 text-xs">
                        <SelectValue placeholder="CVD" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">CVD: All</SelectItem>
                        <SelectItem value="bullish" className="text-xs">Bullish</SelectItem>
                        <SelectItem value="bearish" className="text-xs">Bearish</SelectItem>
                        <SelectItem value="none" className="text-xs">None</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={biasFilter} onValueChange={(v) => setBiasFilter(v as typeof biasFilter)}>
                      <SelectTrigger className="w-[132px] h-8 text-xs">
                        <SelectValue placeholder="Bias" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">Bias: All</SelectItem>
                        <SelectItem value="long" className="text-xs">Long</SelectItem>
                        <SelectItem value="short" className="text-xs">Short</SelectItem>
                        <SelectItem value="mixed" className="text-xs">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-2xs text-muted-foreground">
                      {orderFlowRows.length}/{orderFlowRowsAll.length} rows
                    </span>
                  </div>

                  {orderFlowRows.length === 0 ? (
                    <Card>
                      <CardContent className="py-6 text-center text-sm text-muted-foreground">
                        No rows match the current order-flow filters.
                      </CardContent>
                    </Card>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-2xs">Symbol</TableHead>
                          <TableHead className="text-2xs">Absorption</TableHead>
                          <TableHead className="text-2xs">CVD div.</TableHead>
                          <TableHead className="text-2xs text-right">LTP</TableHead>
                          <TableHead className="text-2xs">Bias</TableHead>
                          <TableHead className="text-2xs">Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderFlowRows.map((row) => (
                          <TableRow
                            key={`of-${row.symbol}`}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => goSymbol(row.symbol)}
                          >
                            <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
                            <TableCell className="text-2xs">
                              {row.absorption === "none" ? "—" : row.absorption.replace("_", " ")}
                            </TableCell>
                            <TableCell className="text-2xs">
                              {row.cvdDivergence === "none" ? "—" : row.cvdDivergence}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.bias === "long"
                                    ? "default"
                                    : row.bias === "short"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="text-2xs capitalize"
                              >
                                {row.bias}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-2xs text-muted-foreground max-w-[280px]" title={row.action}>
                              <Badge variant="outline" className="text-2xs mr-1">
                                {row.confidence}
                              </Badge>
                              {row.action}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
