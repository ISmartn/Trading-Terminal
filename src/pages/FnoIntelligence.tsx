import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, RefreshCw, Radio, TrendingUp, TrendingDown, Eye, Sun, Zap, SlidersHorizontal, Bell, BellOff, History } from "lucide-react";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { useFnoLiveIntelligence, useFnoPlaybook } from "@/hooks/useFnoIntelligence";
import { DEFAULT_SCAN_SETTINGS, type LiveSignalRow, type PlaybookRow, type ScanSettings } from "@/lib/fnoIntelligence";
import { notifyUserAlert, unlockAlertAudio } from "@/lib/alertNotify";
import { cn } from "@/lib/utils";

const SETTINGS_KEY = "fno-intelligence-scan-settings";
const ALERTS_KEY = "fno-intelligence-alerts-on";

type Preset = "scalp" | "balanced" | "swing";

const PRESETS: Record<Preset, { label: string; settings: ScanSettings }> = {
  scalp: {
    label: "Scalp",
    settings: { fastSecs: 10, slowSecs: 30, moveFast: 0.25, moveSlow: 0.45, volumeMult: 1.8, requireVolume: false, requireVwap: false },
  },
  balanced: {
    label: "Balanced",
    settings: { ...DEFAULT_SCAN_SETTINGS },
  },
  swing: {
    label: "Swing",
    settings: { fastSecs: 30, slowSecs: 180, moveFast: 0.5, moveSlow: 1.2, volumeMult: 2.5, requireVolume: true, requireVwap: true },
  },
};

function loadSettings(): ScanSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SCAN_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SCAN_SETTINGS };
}

function fmtWindow(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = secs / 60;
  return Number.isInteger(m) ? `${m}m` : `${(secs / 60).toFixed(1)}m`;
}

function fmtTime(ms?: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function endReasonLabel(reason?: LiveSignalRow["endReason"]) {
  if (reason === "promoted") return "→ Signal";
  if (reason === "reversed") return "Reversed";
  if (reason === "expired") return "Faded";
  return "—";
}

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function LiveTable({
  rows,
  direction,
  onRowClick,
  fastLabel,
  slowLabel,
}: {
  rows: LiveSignalRow[];
  direction: "long" | "short";
  onRowClick: (s: string) => void;
  fastLabel: string;
  slowLabel: string;
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
          <TableHead className="text-2xs text-right">{fastLabel}</TableHead>
          <TableHead className="text-2xs text-right">{slowLabel}</TableHead>
          <TableHead className="text-2xs text-right">Vol×</TableHead>
          <TableHead className="text-2xs text-right">VWAP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={`${row.symbol}-${row.strength}-${row.lastSeenMs ?? row.timestamp}`}
            className={cn(
              "cursor-pointer hover:bg-muted/50",
              row.strength === "watch" && row.sticky && "opacity-80",
            )}
            onClick={() => onRowClick(row.symbol)}
          >
            <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
            <TableCell>
              <Badge variant={row.strength === "signal" ? "default" : "secondary"} className="text-2xs">
                {row.strength === "signal"
                  ? "SIGNAL"
                  : `WATCH ${row.peakScore ?? row.score}${row.watchAgeSecs != null ? ` · ${row.watchAgeSecs}s` : ""}`}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-xs">{fmt(row.ltp)}</TableCell>
            <TableCell className={cn("text-right font-mono text-xs", direction === "long" ? "text-bullish" : "text-bearish")}>
              {row.move15sPct != null ? `${row.move15sPct > 0 ? "+" : ""}${fmt(row.move15sPct)}%` : "—"}
            </TableCell>
            <TableCell className={cn("text-right font-mono text-xs", direction === "long" ? "text-bullish" : "text-bearish")}>
              {row.move1mPct != null ? `${row.move1mPct > 0 ? "+" : ""}${fmt(row.move1mPct)}%` : "—"}
            </TableCell>
            <TableCell className={cn("text-right font-mono text-xs", row.volSpike && "text-amber-600 font-semibold")}>
              {row.volumeRatio != null ? `${fmt(row.volumeRatio, 1)}×` : "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-amber-700">{fmt(row.vwap, 0)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WatchHistoryTable({
  rows,
  direction,
  onRowClick,
  fastLabel,
  slowLabel,
}: {
  rows: LiveSignalRow[];
  direction: "long" | "short";
  onRowClick: (s: string) => void;
  fastLabel: string;
  slowLabel: string;
}) {
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No {direction === "long" ? "long" : "short"} watch history yet this session.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-2xs">Symbol</TableHead>
          <TableHead className="text-2xs text-right">Peak {fastLabel}</TableHead>
          <TableHead className="text-2xs text-right">Peak {slowLabel}</TableHead>
          <TableHead className="text-2xs text-right">Score</TableHead>
          <TableHead className="text-2xs text-right">Held</TableHead>
          <TableHead className="text-2xs">Ended</TableHead>
          <TableHead className="text-2xs text-right">Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={`${row.symbol}-${row.lastSeenMs ?? row.timestamp}`}
            className="cursor-pointer hover:bg-muted/50 opacity-90"
            onClick={() => onRowClick(row.symbol)}
          >
            <TableCell className="font-medium text-xs">{row.symbol}</TableCell>
            <TableCell className={cn("text-right font-mono text-xs", direction === "long" ? "text-bullish" : "text-bearish")}>
              {row.peakMoveFastPct != null ? `${row.peakMoveFastPct > 0 ? "+" : ""}${fmt(row.peakMoveFastPct)}%` : "—"}
            </TableCell>
            <TableCell className={cn("text-right font-mono text-xs", direction === "long" ? "text-bullish" : "text-bearish")}>
              {row.peakMoveSlowPct != null ? `${row.peakMoveSlowPct > 0 ? "+" : ""}${fmt(row.peakMoveSlowPct)}%` : "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">{row.peakScore ?? row.score}</TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {row.durationSecs != null ? fmtWindow(row.durationSecs) : "—"}
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={cn(
                  "text-2xs",
                  row.endReason === "promoted" && "text-bullish border-bullish/40",
                  row.endReason === "reversed" && "text-bearish border-bearish/40",
                )}
              >
                {endReasonLabel(row.endReason)}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-2xs text-muted-foreground">{fmtTime(row.lastSeenMs)}</TableCell>
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

function NumberField({
  label,
  value,
  step,
  min,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-2xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-xs pr-7"
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function ScanSettingsPanel({
  settings,
  onChange,
}: {
  settings: ScanSettings;
  onChange: (next: ScanSettings) => void;
}) {
  const set = (patch: Partial<ScanSettings>) => onChange({ ...settings, ...patch });
  const activePreset = (Object.keys(PRESETS) as Preset[]).find(
    (p) => JSON.stringify(PRESETS[p].settings) === JSON.stringify(settings),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Tune
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold mb-1.5">Sensitivity preset</p>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(PRESETS) as Preset[]).map((p) => (
                <Button
                  key={p}
                  variant={activePreset === p ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-2xs"
                  onClick={() => onChange({ ...PRESETS[p].settings })}
                >
                  {PRESETS[p].label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Fast window"
              value={settings.fastSecs}
              step={5}
              min={3}
              suffix="sec"
              onChange={(v) => set({ fastSecs: Math.max(3, v) })}
            />
            <NumberField
              label="Slow window"
              value={settings.slowSecs}
              step={15}
              min={15}
              suffix="sec"
              onChange={(v) => set({ slowSecs: Math.max(15, v) })}
            />
            <NumberField
              label={`Move (${fmtWindow(settings.fastSecs)})`}
              value={settings.moveFast}
              step={0.05}
              min={0}
              suffix="%"
              onChange={(v) => set({ moveFast: v })}
            />
            <NumberField
              label={`Move (${fmtWindow(settings.slowSecs)})`}
              value={settings.moveSlow}
              step={0.1}
              min={0}
              suffix="%"
              onChange={(v) => set({ moveSlow: v })}
            />
          </div>

          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Require volume spike</Label>
                <p className="text-2xs text-muted-foreground">Confirm with traded volume</p>
              </div>
              <Switch
                checked={settings.requireVolume}
                onCheckedChange={(v) => set({ requireVolume: v })}
              />
            </div>
            {settings.requireVolume && (
              <NumberField
                label="Volume multiple vs 20-min avg"
                value={settings.volumeMult}
                step={0.1}
                min={1}
                suffix="×"
                onChange={(v) => set({ volumeMult: Math.max(1, v) })}
              />
            )}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Require VWAP alignment</Label>
                <p className="text-2xs text-muted-foreground">Long above / short below VWAP</p>
              </div>
              <Switch
                checked={settings.requireVwap}
                onCheckedChange={(v) => set({ requireVwap: v })}
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-2xs w-full"
            onClick={() => onChange({ ...DEFAULT_SCAN_SETTINGS })}
          >
            Reset to defaults
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function FnoIntelligence() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"live" | "playbook">("live");
  const [settings, setSettings] = useState<ScanSettings>(loadSettings);
  const [alertsOn, setAlertsOn] = useState<boolean>(() => localStorage.getItem(ALERTS_KEY) !== "0");

  const { data: live, isLoading: liveLoading, isFetching, refetch } = useFnoLiveIntelligence("all", settings);
  const { data: playbook, isLoading: pbLoading, generatePlaybook } = useFnoPlaybook("all");

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(ALERTS_KEY, alertsOn ? "1" : "0");
  }, [alertsOn]);

  const fastLabel = useMemo(() => fmtWindow(settings.fastSecs), [settings.fastSecs]);
  const slowLabel = useMemo(() => fmtWindow(settings.slowSecs), [settings.slowSecs]);

  // Fire sound + notification when a brand-new SIGNAL appears.
  const seenSignalsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!live) return;
    const signals = [...(live.bullish ?? []), ...(live.bearish ?? [])];
    const currentKeys = new Set(signals.map((r) => `${r.symbol}-${r.direction}`));
    if (alertsOn && live.marketOpen) {
      const fresh = signals.filter((r) => !seenSignalsRef.current.has(`${r.symbol}-${r.direction}`));
      for (const r of fresh.slice(0, 4)) {
        const dirUp = r.direction === "long";
        const move = r.move1mPct ?? r.move15sPct;
        notifyUserAlert({
          title: `${r.symbol} ${dirUp ? "▲ bullish" : "▼ bearish"} signal`,
          body: `${move != null ? `${move > 0 ? "+" : ""}${move.toFixed(2)}% (${slowLabel})` : ""}${
            r.volumeRatio != null ? ` · ${r.volumeRatio.toFixed(1)}× vol` : ""
          } · LTP ${r.ltp}`,
          tone: dirUp ? "bullish" : "bearish",
          tag: `fno-${r.symbol}-${r.direction}`,
        });
      }
    }
    seenSignalsRef.current = currentKeys;
  }, [live, alertsOn, slowLabel]);

  const goSymbol = (s: string) => navigate(`/option-chain?symbol=${s}`);
  const gateLabel = `${fastLabel} ≥${settings.moveFast}%, ${slowLabel} ≥${settings.moveSlow}%${
    settings.requireVolume ? `, vol >${settings.volumeMult}×` : ""
  }${settings.requireVwap ? ", VWAP-aligned" : ""}`;

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-7xl mx-auto">
      <SectionHeader
        title="F&O Intelligence"
        subtitle="Automated live movers across all F&O stocks + next-day playbook"
        tooltip="Live tab polls every F&O stock from Upstox every 2s. Tune the seconds/minutes windows, move thresholds, and volume confirmation. Playbook analyzes the full universe at EOD."
      />

      <div className="flex flex-wrap items-center gap-2">
        {live?.marketOpen ? (
          <Badge variant="outline" className="text-2xs gap-1 text-bullish border-bullish/30">
            <Radio className="h-3 w-3 animate-pulse" />
            Market live · {live.universeSize ?? live.status.symbolsTracked} F&O stocks · {live.status.symbolsTracked} tracked
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-2xs">After hours — showing last session + playbook</Badge>
        )}
        {tab === "live" && (
          <>
            <ScanSettingsPanel settings={settings} onChange={setSettings} />
            <Button
              variant={alertsOn ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                unlockAlertAudio();
                setAlertsOn((v) => !v);
              }}
              title="Toggle sound + notifications for new signals"
            >
              {alertsOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              {alertsOn ? "Alerts on" : "Alerts off"}
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </>
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
                    <CardDescription className="text-2xs">{gateLabel}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.bullish ?? []} direction="long" onRowClick={goSymbol} fastLabel={fastLabel} slowLabel={slowLabel} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-bearish">
                      <TrendingDown className="h-4 w-4" />
                      Bearish signals
                      <Badge variant="secondary" className="text-2xs">{live?.counts.bearish ?? 0}</Badge>
                    </CardTitle>
                    <CardDescription className="text-2xs">{gateLabel}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.bearish ?? []} direction="short" onRowClick={goSymbol} fastLabel={fastLabel} slowLabel={slowLabel} />
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
                    <CardDescription className="text-2xs">Active movers — archived to session history when they fade</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.watchLong ?? []} direction="long" onRowClick={goSymbol} fastLabel={fastLabel} slowLabel={slowLabel} />
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Watch — building momentum (short)
                      <Badge variant="outline" className="text-2xs">{live?.counts.watchShort ?? 0}</Badge>
                    </CardTitle>
                    <CardDescription className="text-2xs">Active movers — archived to session history when they fade</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 px-2 pb-2">
                    <LiveTable rows={live?.watchShort ?? []} direction="short" onRowClick={goSymbol} fastLabel={fastLabel} slowLabel={slowLabel} />
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Watch session history
                    <Badge variant="secondary" className="text-2xs">
                      {(live?.counts.watchHistoryLong ?? 0) + (live?.counts.watchHistoryShort ?? 0)}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-2xs">
                    Every stock that hit Watch today is kept here — peak moves, duration, and how it ended
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 px-2 pb-2">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="text-2xs font-medium text-bullish px-2 py-1.5">
                        Long history ({live?.counts.watchHistoryLong ?? 0})
                      </p>
                      <WatchHistoryTable
                        rows={live?.watchHistoryLong ?? []}
                        direction="long"
                        onRowClick={goSymbol}
                        fastLabel={fastLabel}
                        slowLabel={slowLabel}
                      />
                    </div>
                    <div>
                      <p className="text-2xs font-medium text-bearish px-2 py-1.5">
                        Short history ({live?.counts.watchHistoryShort ?? 0})
                      </p>
                      <WatchHistoryTable
                        rows={live?.watchHistoryShort ?? []}
                        direction="short"
                        onRowClick={goSymbol}
                        fastLabel={fastLabel}
                        slowLabel={slowLabel}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
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
