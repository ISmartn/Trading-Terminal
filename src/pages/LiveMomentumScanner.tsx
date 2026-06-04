import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Zap, Radio, TrendingUp, Volume2, Activity } from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { useLiveMomentumScanner } from "@/hooks/useLiveMomentumScanner";
import { LIVE_MOMENTUM_RULES, type LiveMomentumUniverse } from "@/lib/liveMomentumScanner";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export default function LiveMomentumScanner() {
  const navigate = useNavigate();
  const [universe, setUniverse] = useState<LiveMomentumUniverse>("popular");
  const { data, isLoading, isFetching, refetch, error } = useLiveMomentumScanner(universe);

  const rows = data?.rows ?? [];
  const status = data?.status;
  const thresholds = data?.thresholds;
  const warmingUp = (status?.pollCount ?? 0) < 8;

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-7xl mx-auto">
      <SectionHeader
        title="Live Momentum Scanner"
        subtitle="F&O stocks matching intraday momentum + volume + VWAP filters"
        tooltip="Polls Upstox LTP every ~2s. Needs ~15s of history for 15s moves and seeded 1-min volume baselines."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={universe} onValueChange={(v) => setUniverse(v as LiveMomentumUniverse)}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Popular ({data?.universeSize ?? 45} stocks)</SelectItem>
            <SelectItem value="all">All F&O universe</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
        {status?.running && (
          <Badge variant="outline" className="text-2xs gap-1 text-bullish border-bullish/30">
            <Radio className="h-3 w-3 animate-pulse" />
            Live · {status.symbolsTracked} tracked
          </Badge>
        )}
        {warmingUp && (
          <Badge variant="secondary" className="text-2xs">
            Warming up (~15s for 15s moves)
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LIVE_MOMENTUM_RULES.map((rule) => (
          <Card key={rule.id} className="border-dashed">
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                {rule.id === "move15s" && <Zap className="h-3.5 w-3.5 text-amber-500" />}
                {rule.id === "move1m" && <TrendingUp className="h-3.5 w-3.5 text-bullish" />}
                {rule.id === "volume" && <Volume2 className="h-3.5 w-3.5 text-blue-500" />}
                {rule.id === "vwap" && <Activity className="h-3.5 w-3.5 text-amber-600" />}
                {rule.label}
                {rule.id === "move15s" && thresholds && (
                  <span className="font-mono text-muted-foreground">≥ {thresholds.move15sPct}%</span>
                )}
                {rule.id === "move1m" && thresholds && (
                  <span className="font-mono text-muted-foreground">≥ {thresholds.move1mPct}%</span>
                )}
                {rule.id === "volume" && thresholds && (
                  <span className="font-mono text-muted-foreground">&gt; {thresholds.volumeMult}× avg</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <CardDescription className="text-2xs">{rule.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {(error as Error).message}. Ensure the proxy server is running with a valid Upstox token.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Matches
            <Badge variant="secondary" className="text-2xs font-mono">
              {rows.length}
            </Badge>
          </CardTitle>
          <CardDescription className="text-2xs">
            Bullish momentum only (positive 15s & 1m moves). Updates every ~2.5s during market hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting live scanner…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground px-4">
              No stocks match all four rules right now.
              {warmingUp && " Scanner is still collecting price history — check back in ~1 minute."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-2xs">Symbol</TableHead>
                    <TableHead className="text-2xs text-right">LTP</TableHead>
                    <TableHead className="text-2xs text-right">15s %</TableHead>
                    <TableHead className="text-2xs text-right">1m %</TableHead>
                    <TableHead className="text-2xs text-right">Vol 1m</TableHead>
                    <TableHead className="text-2xs text-right">Avg 20m</TableHead>
                    <TableHead className="text-2xs text-right">Vol ×</TableHead>
                    <TableHead className="text-2xs text-right">VWAP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.symbol}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/option-chain?symbol=${row.symbol}`)}
                    >
                      <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
                      <TableCell className={cn("text-right font-mono text-xs text-bullish")}>
                        +{fmt(row.move15sPct, 2)}%
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-xs text-bullish")}>
                        +{fmt(row.move1mPct, 2)}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{row.volume1m.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {row.avgVolume20m.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-blue-600">
                        {fmt(row.volumeRatio, 1)}×
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-amber-700">
                        {fmt(row.vwap, 0)}
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
