import { useQuery } from "@tanstack/react-query";

import { fetchCandlesWithCache } from "@/lib/candleCache";
import {
  enrichDailyWithLiveToday,
  parseLtpFromUpstoxJson,
} from "@/lib/chartLiveDaily";
import {
  defaultIntervalForRange,
  formatChartDateParams,
  getChartDateBounds,
  staleTimeForInterval,
  type ChartInterval,
  type ChartRange,
} from "@/lib/chartIntervals";
import { PROXY_BASE } from "@/lib/proxyConfig";
import { resetProxyReadyWait, waitForProxyReady } from "@/lib/waitForProxy";
import { getSessionJSON, setSessionJSON } from "@/lib/sessionCache";

export interface OHLCVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// Upstox instrument_key map for indices + top F&O stocks
const INSTRUMENT_MAP: Record<string, { instrumentKey: string; exchangeSegment: string; instrument: string }> = {
  NIFTY:       { instrumentKey: "NSE_INDEX|Nifty 50", exchangeSegment: "IDX_I", instrument: "INDEX" },
  BANKNIFTY:   { instrumentKey: "NSE_INDEX|Nifty Bank", exchangeSegment: "IDX_I", instrument: "INDEX" },
  FINNIFTY:    { instrumentKey: "NSE_INDEX|Nifty Fin Service", exchangeSegment: "IDX_I", instrument: "INDEX" },
  MIDCPNIFTY:  { instrumentKey: "NSE_INDEX|NIFTY MID SELECT", exchangeSegment: "IDX_I", instrument: "INDEX" },
  INDIAVIX:    { instrumentKey: "NSE_INDEX|India VIX", exchangeSegment: "IDX_I", instrument: "INDEX" },
  SENSEX:      { instrumentKey: "BSE_INDEX|SENSEX", exchangeSegment: "BSE_INDEX", instrument: "INDEX" },
  RELIANCE:    { instrumentKey: "NSE_EQ|INE002A01018", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TCS:         { instrumentKey: "NSE_EQ|INE467B01029", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  HDFCBANK:    { instrumentKey: "NSE_EQ|INE040A01034", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  INFY:        { instrumentKey: "NSE_EQ|INE009A01021", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ICICIBANK:   { instrumentKey: "NSE_EQ|INE090A01021", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  HINDUNILVR:  { instrumentKey: "NSE_EQ|INE030A01027", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ITC:         { instrumentKey: "NSE_EQ|INE154A01025", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  SBIN:        { instrumentKey: "NSE_EQ|INE062A01020", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BHARTIARTL:  { instrumentKey: "NSE_EQ|INE397D01024", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  KOTAKBANK:   { instrumentKey: "NSE_EQ|INE237A01036", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  LT:          { instrumentKey: "NSE_EQ|INE018A01030", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  AXISBANK:    { instrumentKey: "NSE_EQ|INE238A01034", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ASIANPAINT:  { instrumentKey: "NSE_EQ|INE021A01026", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  MARUTI:      { instrumentKey: "NSE_EQ|INE585B01010", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TITAN:       { instrumentKey: "NSE_EQ|INE280A01028", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  SUNPHARMA:   { instrumentKey: "NSE_EQ|INE044A01036", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BAJFINANCE:  { instrumentKey: "NSE_EQ|INE296A01032", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BAJFINSV:    { instrumentKey: "NSE_EQ|INE918I01026", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  WIPRO:       { instrumentKey: "NSE_EQ|INE075A01022", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  HCLTECH:     { instrumentKey: "NSE_EQ|INE860A01027", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TATAMOTORS:  { instrumentKey: "NSE_EQ|INE155A01022", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TATASTEEL:   { instrumentKey: "NSE_EQ|INE081A01020", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  NTPC:        { instrumentKey: "NSE_EQ|INE733E01010", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  POWERGRID:   { instrumentKey: "NSE_EQ|INE752E01010", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ONGC:        { instrumentKey: "NSE_EQ|INE213A01029", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  JSWSTEEL:    { instrumentKey: "NSE_EQ|INE019A01038", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  M_M:         { instrumentKey: "NSE_EQ|INE101A01026", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ADANIENT:    { instrumentKey: "NSE_EQ|INE423A01024", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ADANIPORTS:  { instrumentKey: "NSE_EQ|INE742F01042", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  ULTRACEMCO:  { instrumentKey: "NSE_EQ|INE481G01011", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TECHM:       { instrumentKey: "NSE_EQ|INE669C01036", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  INDUSINDBK:  { instrumentKey: "NSE_EQ|INE095A01012", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  DRREDDY:     { instrumentKey: "NSE_EQ|INE089A01031", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  CIPLA:       { instrumentKey: "NSE_EQ|INE059A01026", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  EICHERMOT:   { instrumentKey: "NSE_EQ|INE066A01021", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  DIVISLAB:    { instrumentKey: "NSE_EQ|INE361B01024", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BPCL:        { instrumentKey: "NSE_EQ|INE029A01011", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  COALINDIA:   { instrumentKey: "NSE_EQ|INE522F01014", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  GRASIM:      { instrumentKey: "NSE_EQ|INE047A01021", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  APOLLOHOSP:  { instrumentKey: "NSE_EQ|INE437A01024", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  HEROMOTOCO:  { instrumentKey: "NSE_EQ|INE158A01026", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TATACONSUM:  { instrumentKey: "NSE_EQ|INE192A01025", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  SBILIFE:     { instrumentKey: "NSE_EQ|INE123W01016", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BRITANNIA:   { instrumentKey: "NSE_EQ|INE216A01030", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  NESTLEIND:   { instrumentKey: "NSE_EQ|INE239A01024", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BAJAJ_AUTO:  { instrumentKey: "NSE_EQ|INE917I01010", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  "BAJAJ-AUTO": { instrumentKey: "NSE_EQ|INE917I01010", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  HDFCLIFE:    { instrumentKey: "NSE_EQ|INE795G01014", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  VEDL:        { instrumentKey: "NSE_EQ|INE205A01025", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  HINDALCO:    { instrumentKey: "NSE_EQ|INE038A01020", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  BANKBARODA:  { instrumentKey: "NSE_EQ|INE028A01039", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  PNB:         { instrumentKey: "NSE_EQ|INE160A01022", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  DLF:         { instrumentKey: "NSE_EQ|INE271C01023", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
  TRENT:       { instrumentKey: "NSE_EQ|INE849A01020", exchangeSegment: "NSE_EQ", instrument: "EQUITY" },
};

if (!INSTRUMENT_MAP["M&M"]) INSTRUMENT_MAP["M&M"] = INSTRUMENT_MAP["M_M"];

const resolvedInstruments: Record<string, { instrumentKey: string; exchangeSegment: string; instrument: string }> = {};
let instrumentsPreloaded = false;

type InstrumentEntry = { instrumentKey: string; exchangeSegment: string; instrument: string };

const SYMBOL_ALIASES: Record<string, string[]> = {
  "M&M": ["M_M"],
  "BAJAJ-AUTO": ["BAJAJ_AUTO"],
};

function registerInstrumentSymbol(symbol: string, entry: InstrumentEntry) {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return;
  resolvedInstruments[upper] = entry;
  for (const [canonical, aliases] of Object.entries(SYMBOL_ALIASES)) {
    if (upper === canonical.toUpperCase()) {
      for (const alias of aliases) resolvedInstruments[alias.toUpperCase()] = entry;
    }
    if (aliases.some((a) => a.toUpperCase() === upper)) {
      resolvedInstruments[canonical.toUpperCase()] = entry;
    }
  }
}

/** Register NSE_EQ keys from /api/fno-symbols equityKeys map. */
export function registerEquityInstrumentKeys(keys: Record<string, string>) {
  for (const [sym, key] of Object.entries(keys)) {
    if (!sym || !key.startsWith("NSE_EQ|")) continue;
    registerInstrumentSymbol(sym, {
      instrumentKey: key,
      exchangeSegment: "NSE_EQ",
      instrument: "EQUITY",
    });
  }
}

const INSTRUMENTS_SESSION_KEY = "equity-instrument-keys";
const INSTRUMENTS_SESSION_TTL = 60 * 60 * 1000;

/** Bulk-load NSE_EQ instrument keys from Upstox master (speeds up multi-symbol scans). */
export async function preloadInstrumentCache(): Promise<void> {
  if (instrumentsPreloaded) return;

  const sessionKeys = getSessionJSON<Record<string, string>>(INSTRUMENTS_SESSION_KEY, INSTRUMENTS_SESSION_TTL);
  if (sessionKeys && Object.keys(sessionKeys).length > 0) {
    registerEquityInstrumentKeys(sessionKeys);
    instrumentsPreloaded = true;
    return;
  }

  try {
    const fnoRes = await fetch(`${PROXY_BASE}/api/fno-symbols`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (fnoRes.ok) {
      const fnoJson = await fnoRes.json();
      if (fnoJson?.equityKeys && typeof fnoJson.equityKeys === "object") {
        registerEquityInstrumentKeys(fnoJson.equityKeys);
        setSessionJSON(INSTRUMENTS_SESSION_KEY, fnoJson.equityKeys);
      }
    }
  } catch {
    // continue with instrument master
  }

  try {
    const res = await fetch(`${PROXY_BASE}/api/upstox-proxy?endpoint=instruments`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return;
    const data = await res.json();
    const instruments = data?.instruments || [];

    for (const i of instruments) {
      const key = i.instrumentKey;
      if (!key) continue;

      if (i.exchangeSegment === "NSE_EQ" && (i.instrumentType === "EQ" || i.instrumentType === "EQUITY")) {
        const entry: InstrumentEntry = {
          instrumentKey: key,
          exchangeSegment: "NSE_EQ",
          instrument: "EQUITY",
        };
        const names = new Set<string>();
        if (i.symbol) names.add(String(i.symbol).trim());
        if (i.tradingSymbol) {
          const ts = String(i.tradingSymbol).split("-")[0].split(" ")[0].trim();
          if (ts) names.add(ts);
        }
        for (const name of names) registerInstrumentSymbol(name, entry);
      }

      if (
        (i.exchangeSegment === "NSE_FNO" || i.exchangeSegment === "NSE_FO") &&
        i.underlyingKey?.startsWith("NSE_EQ|") &&
        i.underlyingSymbol
      ) {
        registerInstrumentSymbol(String(i.underlyingSymbol), {
          instrumentKey: i.underlyingKey,
          exchangeSegment: "NSE_EQ",
          instrument: "EQUITY",
        });
      }
    }
    instrumentsPreloaded = true;
  } catch {
    // scans fall back to per-symbol resolve
  }
}

async function resolveInstrumentKey(symbol: string): Promise<{ instrumentKey: string; exchangeSegment: string; instrument: string } | null> {
  const mapped = INSTRUMENT_MAP[symbol];
  if (mapped?.instrument === "INDEX") return mapped;

  if (!instrumentsPreloaded) {
    await preloadInstrumentCache();
  }
  if (resolvedInstruments[symbol]) return resolvedInstruments[symbol];

  if (mapped) return mapped;

  try {
    const res = await fetch(`${PROXY_BASE}/api/upstox-proxy?endpoint=instruments`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const instruments = data?.instruments || [];

    const match = instruments.find(
      (i: any) => i.symbol === symbol && i.exchangeSegment === "NSE_EQ" && (i.instrumentType === "EQ" || i.instrumentType === "EQUITY")
    );
    if (match?.instrumentKey) {
      const resolved = { instrumentKey: match.instrumentKey, exchangeSegment: "NSE_EQ", instrument: "EQUITY" };
      resolvedInstruments[symbol] = resolved;
      return resolved;
    }
  } catch {
    // Instrument master download failed
  }
  return null;
}

async function fetchUpstoxWithRetry(
  url: string,
  init?: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      if (i === 0) await waitForProxyReady(20_000);
      else {
        resetProxyReadyWait();
        await waitForProxyReady(10_000);
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      resetProxyReadyWait();
    }
  }
  throw lastErr;
}

export type FetchHistoricalOptions = {
  /** Append/replace today's bar from 1m intraday (daily charts during session). */
  enrichLiveToday?: boolean;
};

async function fetchSymbolLtp(symbol: string): Promise<number | null> {
  const resolved = await resolveInstrumentKey(symbol);
  if (!resolved) return null;
  try {
    const params = new URLSearchParams({
      endpoint: "ltp",
      symbol,
      instrumentKey: resolved.instrumentKey,
    });
    const res = await fetchUpstoxWithRetry(`${PROXY_BASE}/api/upstox-proxy?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parseLtpFromUpstoxJson(json, resolved.instrumentKey);
  } catch {
    return null;
  }
}

async function fetchHistoricalFromApi(
  symbol: string,
  range: string,
  interval: ChartInterval,
  bypassCache = false,
): Promise<OHLCVCandle[]> {
  const resolved = await resolveInstrumentKey(symbol);
  if (!resolved) return [];

  const chartRange = (range || "3M") as ChartRange;
  const { from, to } = getChartDateBounds(chartRange);
  const { fromDate, toDate } = formatChartDateParams(from, to);

  return fetchCandlesWithCache(
    symbol,
    range,
    interval,
    async () => {
    const params = new URLSearchParams({
      endpoint: "historical",
      symbol,
      instrumentKey: resolved.instrumentKey,
      exchangeSegment: resolved.exchangeSegment,
      instrument: resolved.instrument,
      interval,
      fromDate,
      toDate,
    });

    const res = await fetchUpstoxWithRetry(`${PROXY_BASE}/api/upstox-proxy?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];

    const json = await res.json();
    const rawData = json?.data || json;

    if (rawData && rawData.close && Array.isArray(rawData.close)) {
      const opens = rawData.open || [];
      const highs = rawData.high || [];
      const lows = rawData.low || [];
      const closes = rawData.close || [];
      const volumes = rawData.volume || [];
      const timestamps = rawData.timestamp || rawData.start_Time || [];

      const candles: OHLCVCandle[] = [];
      for (let i = 0; i < closes.length; i++) {
        const ts = timestamps[i];
        const time = typeof ts === "string"
          ? Math.floor(new Date(ts).getTime() / 1000)
          : typeof ts === "number"
            ? (ts > 1e12 ? Math.floor(ts / 1000) : ts)
            : Math.floor(Date.now() / 1000);
        candles.push({
          time,
          open: opens[i] || closes[i],
          high: highs[i] || closes[i],
          low: lows[i] || closes[i],
          close: closes[i],
          volume: volumes[i] || 0,
        });
      }
      return candles.sort((a, b) => a.time - b.time);
    }

    return [];
    },
    { bypassCache },
  );
}

export async function fetchHistorical(
  symbol: string,
  range: string,
  intervalOverride?: ChartInterval,
  options?: FetchHistoricalOptions,
): Promise<OHLCVCandle[]> {
  const chartRange = (range || "3M") as ChartRange;
  const interval = intervalOverride ?? defaultIntervalForRange(chartRange);
  const daily = await fetchHistoricalFromApi(symbol, range, interval);

  if (!options?.enrichLiveToday || interval !== "D" || !daily.length) {
    return daily;
  }

  try {
    const intraday = await fetchHistoricalFromApi(symbol, "1D", "1", true);
    const ltp = await fetchSymbolLtp(symbol);
    return enrichDailyWithLiveToday(daily, intraday, ltp);
  } catch {
    const ltp = await fetchSymbolLtp(symbol).catch(() => null);
    return enrichDailyWithLiveToday(daily, [], ltp);
  }
}

export function useChartData(
  symbol: string,
  range: string = "3M",
  enabled: boolean = true,
  interval?: ChartInterval,
  options?: FetchHistoricalOptions,
) {
  const resolvedInterval = interval ?? defaultIntervalForRange((range || "3M") as ChartRange);
  const liveKey = options?.enrichLiveToday ? "live" : "hist";
  return useQuery({
    queryKey: ["chart-data", symbol, range, resolvedInterval, liveKey],
    queryFn: () => fetchHistorical(symbol, range, resolvedInterval, options),
    enabled: !!symbol && enabled,
    staleTime: options?.enrichLiveToday
      ? 30_000
      : staleTimeForInterval(resolvedInterval, (range || "3M") as ChartRange),
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: options?.enrichLiveToday ?? false,
    refetchOnMount: options?.enrichLiveToday ? "always" : false,
    retry: 1,
  });
}

export function useSparklineData(symbol: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ["sparkline", symbol],
    queryFn: async (): Promise<number[]> => {
      const candles = await fetchHistorical(symbol, "3M");
      if (candles.length > 0) {
        return candles.map(c => c.close);
      }
      return [];
    },
    enabled: !!symbol && enabled,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
