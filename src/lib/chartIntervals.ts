/** Upstox V3 minimum candle size (minutes). Sub-minute not available via historical API. */
export const UPSTOX_MIN_INTERVAL_MINUTES = 1;

export type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y";
export type ChartInterval = "1" | "3" | "5" | "15" | "30" | "60" | "D";

export const CHART_RANGES: { label: string; value: ChartRange }[] = [
  { label: "1D", value: "1D" },
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "6M", value: "6M" },
  { label: "1Y", value: "1Y" },
  { label: "5Y", value: "5Y" },
];

export const CHART_INTERVALS: {
  label: string;
  value: ChartInterval;
  minRange: ChartRange;
  title?: string;
}[] = [
  { label: "1m", value: "1", minRange: "1D", title: "1 minute (Upstox minimum)" },
  { label: "3m", value: "3", minRange: "1D" },
  { label: "5m", value: "5", minRange: "1D" },
  { label: "15m", value: "15", minRange: "1W" },
  { label: "30m", value: "30", minRange: "1W" },
  { label: "1h", value: "60", minRange: "1M" },
  { label: "D", value: "D", minRange: "1M" },
];

const RANGE_ORDER: ChartRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"];

function rangeIndex(r: ChartRange): number {
  return RANGE_ORDER.indexOf(r);
}

/** Default candle interval when user picks a range (VWAP-friendly for intraday). */
export function defaultIntervalForRange(range: ChartRange): ChartInterval {
  switch (range) {
    case "1D":
      return "1";
    case "1W":
      return "15";
    case "1M":
      return "60";
    default:
      return "D";
  }
}

export function intervalsForRange(range: ChartRange): typeof CHART_INTERVALS {
  const idx = rangeIndex(range);
  return CHART_INTERVALS.filter((i) => rangeIndex(i.minRange) <= idx);
}

export function isIntervalValidForRange(range: ChartRange, interval: ChartInterval): boolean {
  return intervalsForRange(range).some((i) => i.value === interval);
}

export function getChartDateBounds(range: ChartRange): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  switch (range) {
    case "1D":
      // Wider fetch so Mon/holidays still get the last trading session
      from.setDate(from.getDate() - 7);
      break;
    case "1W":
      from.setDate(from.getDate() - 10);
      break;
    case "1M":
      from.setMonth(from.getMonth() - 1);
      break;
    case "3M":
      from.setMonth(from.getMonth() - 3);
      break;
    case "6M":
      from.setMonth(from.getMonth() - 6);
      break;
    case "1Y":
      from.setFullYear(from.getFullYear() - 1);
      break;
    case "5Y":
      from.setFullYear(from.getFullYear() - 5);
      break;
    default:
      from.setMonth(from.getMonth() - 3);
  }
  return { from, to };
}

/** YYYY-MM-DD in Asia/Kolkata (Upstox/NSE session dates). */
export function formatIstDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatChartDateParams(from: Date, to: Date): { fromDate: string; toDate: string } {
  return {
    fromDate: `${formatIstDate(from)} 09:15`,
    toDate: `${formatIstDate(to)} 15:30`,
  };
}

/** React Query staleTime — shorter for finer intervals so VWAP stays current. */
export function staleTimeForInterval(interval: ChartInterval, range?: ChartRange): number {
  if (interval === "1") return 30_000;
  if (interval === "3" || interval === "5") return 60_000;
  if (interval === "D") {
    if (range === "5Y") return 30 * 60_000;
    return 5 * 60_000;
  }
  return 2 * 60_000;
}

/** Session VWAP needs intraday candles (not daily). */
export function isIntradayInterval(interval: ChartInterval): boolean {
  return interval !== "D";
}
