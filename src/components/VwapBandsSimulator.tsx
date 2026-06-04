import { useMemo, useState } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  syntheticVwapBandDemo,
  VWAP_MR_Z_HIGH,
  VWAP_MR_Z_TRIGGER,
} from "@/lib/vwapMeanReversion";

export function VwapBandsSimulator() {
  const [volatility, setVolatility] = useState([1]);

  const data = useMemo(() => {
    const mult = volatility[0];
    return syntheticVwapBandDemo(52, mult).map((p, i) => ({
      idx: i,
      price: p.price,
      vwap: p.vwap,
      upper2: p.upper2,
      lower2: p.lower2,
      upper3: p.upper3,
      lower3: p.lower3,
      z: p.zScore,
      signal: p.signal,
    }));
  }, [volatility]);

  const signals = data.filter((d) => d.signal != null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">VWAP σ-Band Simulator</CardTitle>
        <CardDescription className="text-2xs">
          Drag volatility to see how session σ expands ±{VWAP_MR_Z_TRIGGER}σ / ±{VWAP_MR_Z_HIGH}σ bands and theoretical fade triggers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <div className="space-y-2">
          <div className="flex justify-between text-2xs text-muted-foreground">
            <span>Session volatility multiplier</span>
            <span className="font-mono">{volatility[0].toFixed(2)}×</span>
          </div>
          <Slider
            value={volatility}
            onValueChange={setVolatility}
            min={0.5}
            max={2.5}
            step={0.05}
            className="w-full"
          />
        </div>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={48} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number, name: string) => [v.toFixed(2), name]}
              />
              <ReferenceLine y={0} stroke="transparent" />
              <Line type="monotone" dataKey="upper3" stroke="hsl(var(--destructive))" strokeWidth={1} dot={false} name={`+${VWAP_MR_Z_HIGH}σ`} />
              <Line type="monotone" dataKey="upper2" stroke="hsl(var(--destructive) / 0.5)" strokeWidth={1} dot={false} strokeDasharray="4 2" name={`+${VWAP_MR_Z_TRIGGER}σ`} />
              <Line type="monotone" dataKey="vwap" stroke="hsl(45 90% 45%)" strokeWidth={2} dot={false} name="VWAP" />
              <Line type="monotone" dataKey="lower2" stroke="hsl(var(--primary) / 0.5)" strokeWidth={1} dot={false} strokeDasharray="4 2" name={`−${VWAP_MR_Z_TRIGGER}σ`} />
              <Line type="monotone" dataKey="lower3" stroke="hsl(var(--primary))" strokeWidth={1} dot={false} name={`−${VWAP_MR_Z_HIGH}σ`} />
              <Line type="monotone" dataKey="price" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} name="Price" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-2xs text-muted-foreground">
          {signals.length > 0
            ? `${signals.length} bar(s) at or beyond ±${VWAP_MR_Z_TRIGGER}σ — fade entries target VWAP when ADX is low and rejection confirms.`
            : `No ±${VWAP_MR_Z_TRIGGER}σ touches at this volatility — widen σ or wait for extension.`}
        </p>
      </CardContent>
    </Card>
  );
}
