import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Zap, ChevronRight, Loader2 } from "lucide-react";
import { useFnoLiveIntelligence } from "@/hooks/useFnoIntelligence";

export function FnoIntelligenceWidget() {
  const { data, isLoading } = useFnoLiveIntelligence("all");

  const topLong = data?.bullish?.[0];
  const topShort = data?.bearish?.[0];

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          F&O Intelligence
          {data?.marketOpen && (
            <Badge variant="outline" className="text-2xs text-bullish border-bullish/30 animate-pulse">
              LIVE
            </Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="sm" className="h-7 text-2xs gap-1" asChild>
          <Link to="/fno-intelligence">
            Open hub <ChevronRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning F&O universe…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-2xs">
              <Badge variant="secondary">{data?.counts.bullish ?? 0} bullish</Badge>
              <Badge variant="secondary">{data?.counts.bearish ?? 0} bearish</Badge>
              <Badge variant="outline">{(data?.counts.watchLong ?? 0) + (data?.counts.watchShort ?? 0)} on watch</Badge>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs">
              {topLong ? (
                <div className="rounded-md border p-2 bg-bullish/5 border-bullish/20">
                  <div className="flex items-center gap-1 text-bullish font-medium">
                    <TrendingUp className="h-3 w-3" /> {topLong.symbol}
                  </div>
                  <div className="font-mono text-2xs mt-0.5">
                    +{topLong.move1mPct?.toFixed(2)}% 1m · {topLong.volumeRatio?.toFixed(1)}× vol
                  </div>
                </div>
              ) : (
                <div className="rounded-md border p-2 text-muted-foreground text-2xs">No bullish signal now</div>
              )}
              {topShort ? (
                <div className="rounded-md border p-2 bg-bearish/5 border-bearish/20">
                  <div className="flex items-center gap-1 text-bearish font-medium">
                    <TrendingDown className="h-3 w-3" /> {topShort.symbol}
                  </div>
                  <div className="font-mono text-2xs mt-0.5">
                    {topShort.move1mPct?.toFixed(2)}% 1m · {topShort.volumeRatio?.toFixed(1)}× vol
                  </div>
                </div>
              ) : (
                <div className="rounded-md border p-2 text-muted-foreground text-2xs">No bearish signal now</div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
