import { useEffect, useRef, useState } from "react";
import { TrendingDown, TrendingUp, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
/** Minimal spot shape for Nifty / Bank / Smallcap ticker cards. */
export interface TickerStripSpot {
  symbol: string;
  label: string;
  spotPrice: number;
  change: number;
  changePercent: number;
  isLive: boolean;
  source: string;
  high: number;
  low: number;
  lastTickAt: number | null;
}

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function LivePrice({ value, flash }: { value: number; flash: "up" | "down" | null }) {
  return (
    <span
      className={cn(
        "font-mono text-2xl font-bold tabular-nums tracking-tight transition-colors duration-300",
        flash === "up" && "text-bullish",
        flash === "down" && "text-bearish",
        !flash && "text-foreground",
      )}
    >
      {fmt(value)}
    </span>
  );
}

function TickerCard({
  spot,
  active,
  onSelect,
}: {
  spot: TickerStripSpot;
  active: boolean;
  onSelect: () => void;
}) {
  const prevRef = useRef(spot.spotPrice);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (spot.spotPrice > 0 && prev > 0 && spot.spotPrice !== prev) {
      setFlash(spot.spotPrice > prev ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 600);
      prevRef.current = spot.spotPrice;
      return () => clearTimeout(t);
    }
    if (spot.spotPrice > 0) prevRef.current = spot.spotPrice;
  }, [spot.spotPrice]);

  const up = spot.change >= 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-w-[200px] flex-1 flex-col rounded-lg border px-4 py-3 text-left transition-all",
        active
          ? "border-primary/50 bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.2)]"
          : "border-border/70 bg-card/80 hover:border-border hover:bg-muted/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {spot.label}
        </span>
        {spot.isLive ? (
          <span className="flex items-center gap-0.5 text-[10px] font-medium text-primary">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            LIVE
          </span>
        ) : spot.source === "indices" ? (
          <span className="text-[10px] text-warning">NSE ~5s</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">OI chain spot</span>
        )}
      </div>
      <LivePrice value={spot.spotPrice} flash={flash} />
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className={cn("font-mono font-semibold", up ? "text-bullish" : "text-bearish")}>
          {up ? <TrendingUp className="mr-0.5 inline h-3 w-3" /> : <TrendingDown className="mr-0.5 inline h-3 w-3" />}
          {up ? "+" : ""}
          {fmt(spot.change)} ({up ? "+" : ""}
          {spot.changePercent.toFixed(2)}%)
        </span>
        <span className="text-muted-foreground">
          H {fmt(spot.high, 0)} · L {fmt(spot.low, 0)}
        </span>
      </div>
    </button>
  );
}

export function IndexLiveTickerStrip({
  spots,
  proxyConnected,
  upstoxFeedConnected,
  activeSymbol,
  onSelectSymbol,
}: {
  spots: TickerStripSpot[];
  proxyConnected: boolean;
  upstoxFeedConnected: boolean;
  activeSymbol: string;
  onSelectSymbol: (s: string) => void;
}) {
  const anyLive = spots.some((s) => s.isLive);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeConnection
          proxyConnected={proxyConnected}
          upstoxFeedConnected={upstoxFeedConnected}
          anyLive={anyLive}
        />
        {spots[0]?.lastTickAt && (
          <span className="text-[10px] text-muted-foreground">
            Spot ticks ~2s via Upstox · last {formatTickAge(spots.find((s) => s.symbol === activeSymbol)?.lastTickAt)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {spots.map((spot) => (
          <TickerCard
            key={spot.symbol}
            spot={spot}
            active={spot.symbol === activeSymbol}
            onSelect={() => onSelectSymbol(spot.symbol)}
          />
        ))}
      </div>
    </div>
  );
}

function BadgeConnection({
  proxyConnected,
  upstoxFeedConnected,
  anyLive,
}: {
  proxyConnected: boolean;
  upstoxFeedConnected: boolean;
  anyLive: boolean;
}) {
  let label = "WebSocket offline";
  if (anyLive) label = "Live spot";
  else if (!proxyConnected) label = "WebSocket offline";
  else if (!upstoxFeedConnected) label = "Add Upstox token";
  else label = "Awaiting ticks";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium",
        anyLive
          ? "border-primary/40 text-primary"
          : proxyConnected && upstoxFeedConnected
            ? "border-warning/40 text-warning"
            : "border-muted text-muted-foreground",
      )}
    >
      {anyLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {label}
    </span>
  );
}

function formatTickAge(ts: number | null | undefined): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}
