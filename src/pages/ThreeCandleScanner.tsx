import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Loader2, RefreshCw, CandlestickChart, Flame, TrendingDown, TrendingUp, LayoutGrid } from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { useThreeCandleScanner } from "@/hooks/useThreeCandleScanner";
import type { ThreeCandlePatternFilter, ThreeCandleStatusFilter } from "@/lib/threeCandleRule";
import { describeThreeCandleScan, POPULAR_FNO_SYMBOLS } from "@/lib/threeCandleRule";
import { cn } from "@/lib/utils";

const RULES = [
  {
    side: "🟢 Bullish",
    rows: [
      ["Day 1", "Close ≈ High"],
      ["Day 2", "High < Day 1 High AND Low > Day 1 Midpoint"],
      ["Day 3 entry", "Price > Day 1 High"],
      ["Stop-loss", "Day 2 Low"],
      ["Target / confirm", "Day 3 Close > Day 1 High"],
    ],
  },
  {
    side: "🔴 Bearish",
    rows: [
      ["Day 1", "Close ≈ Low"],
      ["Day 2", "Low > Day 1 Low AND High < Day 1 Midpoint"],
      ["Day 3 entry", "Price < Day 1 Low"],
      ["Stop-loss", "Day 2 High"],
      ["Target / confirm", "Day 3 Close < Day 1 Low"],
    ],
  },
];

const PATTERN_FILTERS: {
  value: ThreeCandlePatternFilter;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    value: "popular",
    label: "Most Popular",
    icon: <Flame className="h-3.5 w-3.5" />,
    description: `${POPULAR_FNO_SYMBOLS.length} liquid names · NIFTY, BANKNIFTY + top F&O stocks · bullish & bearish`,
  },
  {
    value: "all",
    label: "All Stocks",
    icon: <LayoutGrid className="h-3.5 w-3.5" />,
    description: "Full NSE F&O universe from Upstox instrument master · bullish & bearish",
  },
  {
    value: "bullish",
    label: "Bullish Pattern",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    description: "All F&O stocks · 🟢 3-candle bullish breakout setups only",
  },
  {
    value: "bearish",
    label: "Bearish Pattern",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    description: "All F&O stocks · 🔴 3-candle bearish breakdown setups only",
  },
];

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ThreeCandleScanner() {
  const [patternFilter, setPatternFilter] = useState<ThreeCandlePatternFilter>("popular");
  const [statusFilter, setStatusFilter] = useState<ThreeCandleStatusFilter>("all");
  const { data: scanResult, isLoading, refetch, isFetching } = useThreeCandleScanner(patternFilter, statusFilter);
  const rows = scanResult?.rows ?? [];
  const symbolCount = scanResult?.symbolCount ?? 0;
  const navigate = useNavigate();

  const activePattern = PATTERN_FILTERS.find((f) => f.value === patternFilter);
  const scanInfo = describeThreeCandleScan(patternFilter, symbolCount);

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader
        title="3-Candle Rule Scanner"
        subtitle="Daily F&O setups: consolidation after a strong Day 1, then Day 3 breakout"
        icon={<CandlestickChart className="h-4 w-4" />}
        tooltip="Scans the last 3 daily candles. Day 1 shows conviction (close near high/low). Day 2 consolidates inside Day 1. Day 3 triggers on break of Day 1 extreme."
      />

      <Card className="border-primary/15">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Chart pattern filter</CardTitle>
          <CardDescription className="text-xs">{activePattern?.description}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <ToggleGroup
            type="single"
            value={patternFilter}
            onValueChange={(v) => v && setPatternFilter(v as ThreeCandlePatternFilter)}
            className="flex flex-wrap justify-start gap-2"
          >
            {PATTERN_FILTERS.map((f) => (
              <ToggleGroupItem
                key={f.value}
                value={f.value}
                className={cn(
                  "h-9 gap-1.5 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
                  f.value === "bullish" && "data-[state=on]:bg-bullish data-[state=on]:text-white",
                  f.value === "bearish" && "data-[state=on]:bg-bearish data-[state=on]:text-white",
                )}
              >
                {f.icon}
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Stage:</span>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ThreeCandleStatusFilter)}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                <SelectItem value="confirmed">Confirmed (Day 3 close)</SelectItem>
                <SelectItem value="triggered">Entry triggered (Day 3 break)</SelectItem>
                <SelectItem value="setup">Setup forming (Day 1+2)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {RULES.map((block) => (
          <Card key={block.side} className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{block.side} setup rules</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableBody>
                  {block.rows.map(([label, rule]) => (
                    <TableRow key={label} className="border-border/40">
                      <TableCell className="py-1.5 text-xs font-medium text-muted-foreground w-[110px]">
                        {label}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{rule}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Scan results</CardTitle>
          <CardDescription className="text-xs">
            {scanInfo.universe} · {scanInfo.patterns}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scanning {scanInfo.symbolCount} symbols ({scanInfo.patterns})…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No {patternFilter === "popular" ? "popular" : patternFilter} setups match. Try &quot;Setup forming&quot; or
              check proxy + Upstox token.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Pattern</TableHead>
                    <TableHead className="text-right">LTP</TableHead>
                    <TableHead className="text-right">D1 High</TableHead>
                    <TableHead className="text-right">D1 Low</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Stop</TableHead>
                    <TableHead className="text-right">D3 Close</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={`${row.symbol}-${row.side}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/option-chain?symbol=${row.symbol}`)}
                    >
                      <TableCell className="font-medium">
                        {row.symbol}
                        {patternFilter === "popular" && (
                          <Badge variant="secondary" className="ml-1.5 text-2xs h-4 px-1">
                            Popular
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.side === "bullish"
                              ? "text-bullish border-bullish/30"
                              : "text-bearish border-bearish/30"
                          }
                        >
                          {row.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">₹{fmt(row.ltp)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(row.day1High)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(row.day1Low)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(row.entryLevel)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {fmt(row.stopLoss)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(row.day3Close)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 text-2xs">
                          Chain →
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
