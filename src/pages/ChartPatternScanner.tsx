import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Loader2, RefreshCw, Shapes, TrendingDown, TrendingUp } from "lucide-react";
import { StockChart } from "@/components/StockChart";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { useChartPatternScanner } from "@/hooks/useChartPatternScanner";
import {
  CHART_PATTERN_OPTIONS,
  CHART_PATTERN_SCAN_INTERVAL,
  CHART_PATTERN_SCAN_RANGE,
  DEFAULT_CHART_PATTERN_IDS,
  patternLabel,
  type ChartPatternId,
  type ChartPatternScanRow,
} from "@/lib/chartPatternScan";
import {
  CHART_PATTERN_INDEX_TABS,
  type ChartPatternIndexKey,
} from "@/lib/indexConstituents";
import { cn } from "@/lib/utils";

const INDEX_KEYS = Object.keys(CHART_PATTERN_INDEX_TABS) as ChartPatternIndexKey[];

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ChartPatternScanner() {
  const [indexTab, setIndexTab] = useState<ChartPatternIndexKey>("N50");
  const [selectedPatterns, setSelectedPatterns] = useState<ChartPatternId[]>(DEFAULT_CHART_PATTERN_IDS);
  const { data: scanResult, isLoading, refetch, isFetching, isError, error } = useChartPatternScanner(
    indexTab,
    selectedPatterns,
  );
  const [chartRow, setChartRow] = useState<ChartPatternScanRow | null>(null);

  const rows = scanResult?.rows ?? [];
  const symbolCount = scanResult?.symbolCount ?? 0;
  const indexLabel = scanResult?.indexLabel ?? CHART_PATTERN_INDEX_TABS[indexTab].label;

  const togglePattern = (id: ChartPatternId) => {
    setSelectedPatterns((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const selectAllPatterns = () => setSelectedPatterns(DEFAULT_CHART_PATTERN_IDS);
  const clearPatterns = () => setSelectedPatterns([]);

  const patternSummary = useMemo(() => {
    const counts = new Map<ChartPatternId, number>();
    for (const row of rows) {
      counts.set(row.pattern, (counts.get(row.pattern) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader
        title="Chart Pattern Scanner"
        subtitle="Daily candlestick patterns across Nifty index constituents"
        icon={<Shapes className="h-4 w-4" />}
        tooltip="5Y daily scan: TA-Lib candlesticks on the latest bar; H&S and cup & handle when formation completes in the last ~5 sessions. Cached on proxy."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-2xs font-mono">
          Timeframe: 1 day ({CHART_PATTERN_SCAN_INTERVAL})
        </Badge>
        <Badge variant="secondary" className="text-2xs">
          History: {CHART_PATTERN_SCAN_RANGE}
        </Badge>
        {scanResult?.engine && (
          <Badge variant="outline" className="text-2xs font-mono">
            Engine: {scanResult.engine}
          </Badge>
        )}
        {scanResult?.fromCache && (
          <Badge variant="outline" className="text-2xs text-muted-foreground">
            Cached{scanResult.cacheLayer ? ` (${scanResult.cacheLayer})` : ""}
          </Badge>
        )}
      </div>

      <Tabs value={indexTab} onValueChange={(v) => setIndexTab(v as ChartPatternIndexKey)}>
        <TabsList className="flex h-auto flex-wrap gap-1 bg-muted/50 p-1">
          {INDEX_KEYS.map((key) => (
            <TabsTrigger key={key} value={key} className="text-xs px-3 py-1.5">
              {CHART_PATTERN_INDEX_TABS[key].label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="border-primary/15">
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-medium">Chart patterns</CardTitle>
            <CardDescription className="text-xs">
              Multi-select patterns to scan on the latest daily candle · {indexLabel}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                  <Shapes className="h-3.5 w-3.5" />
                  Patterns ({selectedPatterns.length})
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="end">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium">Select patterns</p>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-2xs px-2" onClick={selectAllPatterns}>
                      All
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-2xs px-2" onClick={clearPatterns}>
                      None
                    </Button>
                  </div>
                </div>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {(["candle", "structural"] as const).map((group) => {
                    const opts = CHART_PATTERN_OPTIONS.filter((o) => o.group === group);
                    return (
                      <div key={group}>
                        <p className="text-2xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                          {group === "candle" ? "Candlestick (TA-Lib)" : "Chart formations"}
                        </p>
                        <div className="space-y-2">
                          {opts.map((opt) => (
                            <div key={opt.id} className="flex items-start gap-2">
                              <Checkbox
                                id={`pat-${opt.id}`}
                                checked={selectedPatterns.includes(opt.id)}
                                onCheckedChange={() => togglePattern(opt.id)}
                              />
                              <Label htmlFor={`pat-${opt.id}`} className="text-xs leading-tight cursor-pointer">
                                {opt.label}
                                <span className="block text-2xs text-muted-foreground font-normal">
                                  {opt.description}
                                </span>
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {selectedPatterns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Select at least one chart pattern to run the scan.
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scanning {indexLabel} ({symbolCount || "…"} symbols) on daily candles…
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive py-8 text-center">
              {(error as Error)?.message ?? "Scan failed. Ensure the proxy is running and NSE session is warm."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No {selectedPatterns.map(patternLabel).join(", ")} patterns on the latest daily bar in {indexLabel}.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {CHART_PATTERN_OPTIONS.filter((o) => patternSummary.has(o.id)).map((o) => (
                  <Badge key={o.id} variant="secondary" className="text-2xs">
                    {o.label}: {patternSummary.get(o.id)}
                  </Badge>
                ))}
                <Badge variant="outline" className="text-2xs">
                  {rows.length} hits · {symbolCount} scanned
                </Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Pattern</TableHead>
                    <TableHead>Signal date</TableHead>
                    <TableHead className="text-right">LTP</TableHead>
                    <TableHead className="text-right">Day %</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.symbol}-${row.pattern}`} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{row.symbol}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-2xs gap-1",
                            row.direction === "bullish" && "text-bullish border-bullish/30",
                            row.direction === "bearish" && "text-bearish border-bearish/30",
                          )}
                        >
                          {row.direction === "bullish" ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : row.direction === "bearish" ? (
                            <TrendingDown className="h-3 w-3" />
                          ) : null}
                          {patternLabel(row.pattern)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.signalDate}</TableCell>
                      <TableCell className="text-right font-mono text-xs">₹{fmt(row.ltp)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs",
                          row.changePercent >= 0 ? "text-bullish" : "text-bearish",
                        )}
                      >
                        {row.changePercent >= 0 ? "+" : ""}
                        {fmt(row.changePercent)}%
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-2xs gap-1"
                          onClick={() => setChartRow(row)}
                        >
                          <BarChart3 className="h-3 w-3" />
                          View chart
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs text-muted-foreground text-center">
        5Y daily · TA-Lib CDL* + H&amp;S / cup &amp; handle formations · cached on proxy
      </p>

      {chartRow && (
        <StockChart
          symbol={chartRow.symbol}
          asSheet
          open={!!chartRow}
          onOpenChange={(open) => {
            if (!open) setChartRow(null);
          }}
          patternView
          initialRange={CHART_PATTERN_SCAN_RANGE}
          initialInterval={CHART_PATTERN_SCAN_INTERVAL}
          height={420}
          highlightPatternId={chartRow.pattern}
          patternHighlights={[
            {
              time: chartRow.signalTime,
              label: patternLabel(chartRow.pattern),
              direction: chartRow.direction,
            },
          ]}
        />
      )}
    </div>
  );
}
