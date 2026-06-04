/**
 * Chart pattern scan/detect via proxy TA-Lib (server-side CDL*).
 */

import { PROXY_BASE } from "@/lib/proxyConfig";
import {
  CHART_PATTERN_SCAN_RANGE,
  type ChartPatternId,
  type ChartPatternScanRow,
} from "@/lib/chartPatternScan";
import type { ChartPatternIndexKey } from "@/lib/indexConstituents";
import { getSessionJSON, setSessionJSON } from "@/lib/sessionCache";

export interface ChartPatternScanResponse {
  rows: ChartPatternScanRow[];
  symbolCount: number;
  indexLabel: string;
  tab: string;
  patterns: ChartPatternId[];
  range: string;
  interval: string;
  engine: string;
  cachedAt?: number;
  fromCache?: boolean;
  cacheLayer?: string;
  error?: string;
}

export interface PatternOverlayPoint {
  time: number;
  price: number;
  label: string;
}

export interface PatternOverlayLine {
  timeStart: number;
  timeEnd: number;
  price: number;
  color?: string;
  title?: string;
}

export interface PatternFormation {
  time: number;
  name: ChartPatternId;
  direction: "bullish" | "bearish" | "neutral";
  strength?: number;
  overlay?: {
    points: PatternOverlayPoint[];
    lines: PatternOverlayLine[];
  };
}

export interface TalibPatternHit {
  time: number;
  name: ChartPatternId;
  direction: "bullish" | "bearish" | "neutral";
  strength?: number;
  overlay?: PatternFormation["overlay"];
}

export interface ChartPatternDetectResponse {
  symbol: string;
  patterns: TalibPatternHit[];
  formations?: PatternFormation[];
  range: string;
  interval: string;
  engine: string;
}

const SCAN_SESSION_TTL = 15 * 60 * 1000;

function scanSessionKey(tab: string, patterns: ChartPatternId[], range: string): string {
  return `chart-pattern-scan:${tab}:${range}:${[...patterns].sort().join(",")}`;
}

export async function fetchChartPatternScan(
  tab: ChartPatternIndexKey,
  patterns: ChartPatternId[],
  range: string = CHART_PATTERN_SCAN_RANGE,
): Promise<ChartPatternScanResponse> {
  const sessionKey = scanSessionKey(tab, patterns, range);
  const cached = getSessionJSON<ChartPatternScanResponse>(sessionKey, SCAN_SESSION_TTL);
  if (cached?.rows) {
    return { ...cached, fromCache: true, cacheLayer: "session" };
  }

  const params = new URLSearchParams({
    tab,
    patterns: patterns.join(","),
    range,
  });
  const res = await fetch(`${PROXY_BASE}/api/chart-pattern/scan?${params}`, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Chart pattern scan failed (${res.status})`);
  }
  const data = (await res.json()) as ChartPatternScanResponse;
  if (data.rows?.length) {
    setSessionJSON(sessionKey, data);
  }
  return data;
}

export async function fetchChartPatternDetect(
  symbol: string,
  patterns?: ChartPatternId[],
  range: string = CHART_PATTERN_SCAN_RANGE,
): Promise<ChartPatternDetectResponse> {
  const params = new URLSearchParams({ symbol, range });
  if (patterns?.length) params.set("patterns", patterns.join(","));
  const res = await fetch(`${PROXY_BASE}/api/chart-pattern/detect?${params}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Pattern detect failed (${res.status})`);
  }
  return res.json();
}
