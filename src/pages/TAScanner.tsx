import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, ScanLine } from "lucide-react";
import { useTAScanner } from "@/hooks/useTAScanner";
import { SectionHeader } from "@/components/dashboard/SectionHeader";

type ScanFilter = "all" | "overbought" | "oversold" | "macd_bull" | "macd_bear" | "trending";

export default function TAScanner() {
  const [filter, setFilter] = useState<ScanFilter>("all");
  const { data: rows = [], isLoading, refetch, isFetching } = useTAScanner(filter);
  const navigate = useNavigate();

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader
        title="TA Scanner"
        subtitle="F&O symbols screened with TA-Lib indicators (RSI, MACD, ADX)"
        icon={<ScanLine className="h-4 w-4" />}
        tooltip="Scans NSE F&O universe for RSI extremes, MACD crosses, and trending ADX setups. Click a row to open option chain."
      />

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Filter setups</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as ScanFilter)}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All signals</SelectItem>
                <SelectItem value="overbought">RSI overbought (&gt;70)</SelectItem>
                <SelectItem value="oversold">RSI oversold (&lt;30)</SelectItem>
                <SelectItem value="macd_bull">MACD bullish</SelectItem>
                <SelectItem value="macd_bear">MACD bearish</SelectItem>
                <SelectItem value="trending">ADX trending (&gt;25)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scanning F&O universe…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No matches for this filter. Ensure the proxy server is running.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Chg %</TableHead>
                  <TableHead className="text-right">RSI</TableHead>
                  <TableHead className="text-right">ADX</TableHead>
                  <TableHead>MACD</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.symbol}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/option-chain?symbol=${row.symbol}`)}
                  >
                    <TableCell className="font-medium">{row.symbol}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ₹{row.ltp.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs ${row.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}
                    >
                      {row.changePercent >= 0 ? "+" : ""}
                      {row.changePercent.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.rsi?.toFixed(1) ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.adx?.toFixed(1) ?? "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{row.macdSignal}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.signalType === "bullish"
                            ? "text-bullish border-bullish/30"
                            : row.signalType === "bearish"
                              ? "text-bearish border-bearish/30"
                              : ""
                        }
                      >
                        {row.signal}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 text-2xs">
                        Chain →
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-2xs text-muted-foreground text-center">
        Indicators computed via{" "}
        <a href="https://ta-lib.org/" target="_blank" rel="noreferrer" className="underline">
          TA-Lib
        </a>{" "}
        (RSI, MACD, Bollinger Bands, ATR, ADX, EMA, Stochastic, OBV, candlestick patterns)
      </p>
    </div>
  );
}
