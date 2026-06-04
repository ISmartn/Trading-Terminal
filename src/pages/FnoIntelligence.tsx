import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Radio, TrendingUp, TrendingDown, Eye, Sun, Zap } from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { useFnoLiveIntelligence, useFnoPlaybook } from "@/hooks/useFnoIntelligence";
import type { LiveSignalRow, PlaybookRow } from "@/lib/fnoIntelligence";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function LiveTable({
  rows,
  direction,
  onRowClick,
}: {
  rows: LiveSignalRow[];
  direction: "long" | "short";
  onRowClick: (s: string) => void;
}) {
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No {direction === "long" ? "bullish" : "bearish"} setups right now — scanner runs automatically.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-2xs">Symbol</TableHead>
          <TableHead className="text-2xs">Type</TableHead>
          <TableHead className="text-2xs text-right">LTP</TableHead>
          <TableHead className="text-2xs text-right">15s</TableHead>
          <TableHead className="text-2xs text-right">1m</TableHead>
          <TableHead className="text-2xs text-right">Vol×</TableHead>
          <TableHead className="text-2xs text-right">VWAP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.symbol}-${row.strength}`} className="cursor-pointer hover:bg-muted/50" onClick={() => onRowClick(row.symbol)}>
            <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
            <TableCell>
              <Badge variant={row.strength === "signal" ? "default" : "secondary"} className="text-2xs">
                {row.strength === "signal" ? "SIGNAL" : `WATCH ${row.score}/4`}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
            <TableCell className={cn("text-right font-mono text-xs", direction === "long" ? "text-bullish" : "text-bearish")}>
              {row.move15sPct != null ? `${row.move15sPct > 0 ? "+" : ""}${fmt(row.move15sPct)}%` : "—"}
            </TableCell>
            <TableCell className={cn("text-right font-mono text-xs", direction === "long" ? "text-bullish" : "text-bearish")}>
              {row.move1mPct != null ? `${row.move1mPct > 0 ? "+" : ""}${fmt(row.move1mPct)}%` : "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">{row.volumeRatio != null ? `${fmt(row.volumeRatio, 1)}×` : "—"}</TableCell>
            <TableCell className="text-right font-mono text-xs text-amber-700">{fmt(row.vwap, 0)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PlaybookTable({ rows, onRowClick }: { rows: PlaybookRow[]; onRowClick: (s: string) => void }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No plays in this category.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-2xs">Symbol</TableHead>
          <TableHead className="text-2xs">Bias</TableHead>
          <TableHead className="text-2xs">Confidence</TableHead>
          <TableHead className="text-2xs">Close</TableHead>
          <TableHead className="text-2xs text-right">Trigger ↑</TableHead>
          <TableHead className="text-2xs text-right">Trigger ↓</TableHead>
          <TableHead className="text-2xs">Plan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.symbol} className="cursor-pointer hover:bg-muted/50" onClick={() => onRowClick(row.symbol)}>
            <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={cn(
                  "text-2xs",
                  row.bias === "LONG" && "text-bullish border-bullish/40",
                  row.bias === "SHORT" && "text-bearish border-bearish/40",
                )}
              >
                {row.bias}
              </Badge>
            </TableCell>
            <TableCell className="text-2xs capitalize">{row.confidence}</TableCell>
            <TableCell className="font-mono text-xs">
              ₹{fmt(row.close)} <span className={row.changePct >= 0 ? "text-bullish" : "text-bearish"}>({row.changePct > 0 ? "+" : ""}{fmt(row.changePct)}%)</span>
            </TableCell>
            <TableCell className="text-right font-mono text-xs">{fmt(row.triggerUp, 0)}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmt(row.triggerDown, 0)}</TableCell>
            <TableCell className="text-2xs text-muted-foreground max-w-[280px]">{row.action}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function FnoIntelligence() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"live" | "playbook">("live");
  const { data: live, isLoading: liveLoading, isFetching, refetch } = useFnoLiveIntelligence("all");
  const { data: playbook, isLoading: pbLoading, generatePlaybook } = useFnoPlaybook("popular");

  const goSymbol = (s: string) => navigate(`/option-chain?symbol=${s}`);

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-7xl mx-auto">
      <SectionHeader
        title="F&O Intelligence"
        subtitle="Automated live movers + next-day playbook — no manual scanning"
        tooltip="Live tab polls all F&O stocks every ~2s. Playbook tab uses end-of-day analysis for tomorrow's bias."
      />

      <div className="flex flex-wrap items-center gap-2">
        {live?.marketOpen ? (
          <Badge variant="outline" className="text-2xs gap-1 text-bullish border-bullish/30">
            <Radio className="h-3 w-3 animate-pulse" />
            Market live · {live.status.symbolsTracked} symbols tracked
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-2xs">After hours — showing last session + playbook</Badge>
        )}
        {tab === "live" && (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "live" | "playbook")}>
        <TabsList>
          <TabsTrigger value="live" className="gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" />
            Live movers
            {live && (
              <Badge variant="secondary" className="text-2xs ml-1 h-4 px-1">
                {live.counts.bullish + live.counts.bearish}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="playbook" className="gap-1.5 text-xs">
            <Sun className="h-3.5 w-3.5" />
            Next-day playbook
          </TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-4 mt-4">
          {liveLoading ? (
            <div className="flex justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting scanner…
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-bullish">
                      <TrendingUp className="h-4 w-4" />
                      Bullish signals
                      <Badge variant="secondary" className="text-2xs">{live?.counts.bullish ?? 0}</Badge>
                    </CardTitle>
                    <CardDescription className="text-2xs">
                      15s ≥0.4%, 1m ≥0.8%, vol &gt;3× avg, above VWAP
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.bullish ?? []} direction="long" onRowClick={goSymbol} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-bearish">
                      <TrendingDown className="h-4 w-4" />
                      Bearish signals
                      <Badge variant="secondary" className="text-2xs">{live?.counts.bearish ?? 0}</Badge>
                    </CardTitle>
                    <CardDescription className="text-2xs">
                      15s ≤−0.4%, 1m ≤−0.8%, vol spike, below VWAP
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.bearish ?? []} direction="short" onRowClick={goSymbol} />
                  </CardContent>
                </Card>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Watch — building momentum (long)
                      <Badge variant="outline" className="text-2xs">{live?.counts.watchLong ?? 0}</Badge>
                    </CardTitle>
                    <CardDescription className="text-2xs">2–3 of 4 criteria met — potential upside</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.watchLong ?? []} direction="long" onRowClick={goSymbol} />
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Watch — building momentum (short)
                      <Badge variant="outline" className="text-2xs">{live?.counts.watchShort ?? 0}</Badge>
                    </CardTitle>
                    <CardDescription className="text-2xs">2–3 of 4 criteria met — potential downside</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.watchShort ?? []} direction="short" onRowClick={goSymbol} />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="playbook" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={generatePlaybook.isPending}
              onClick={() => generatePlaybook.mutate()}
            >
              {generatePlaybook.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Generate / refresh playbook
            </Button>
            {playbook?.sessionDate && (
              <span className="text-2xs text-muted-foreground">
                Session {playbook.sessionDate}
                {playbook.generatedAt ? ` · updated ${new Date(playbook.generatedAt).toLocaleString("en-IN")}` : ""}
              </span>
            )}
          </div>
          {playbook?.message && !playbook.topLong?.length && (
            <Card><CardContent className="p-4 text-sm text-muted-foreground">{playbook.message}</CardContent></Card>
          )}
          {pbLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-bullish flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> Long plays for next session
                  </CardTitle>
                  <CardDescription className="text-2xs">Bias from close vs VWAP, trend, MACD, range position</CardDescription>
                </CardHeader>
                <CardContent className="p-0 px-2 pb-2 overflow-x-auto">
                  <PlaybookTable rows={playbook?.topLong ?? playbook?.longPlays ?? []} onRowClick={goSymbol} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-bearish flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" /> Short plays for next session
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 px-2 pb-2 overflow-x-auto">
                  <PlaybookTable rows={playbook?.topShort ?? playbook?.shortPlays ?? []} onRowClick={goSymbol} />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
