import { staleTimeForInterval, type ChartInterval, type ChartRange } from "@/lib/chartIntervals";

export interface CachedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CacheEntry {
  candles: CachedCandle[];
  expiry: number;
}

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CachedCandle[]>>();

const MAX_ENTRIES = 400;

function cacheKey(symbol: string, range: string, interval: ChartInterval): string {
  return `${symbol.toUpperCase()}:${range}:${interval}`;
}

function ttlMs(range: string, interval: ChartInterval): number {
  if (range === "1D") {
    if (interval === "1") return 30_000;
    if (interval === "5") return 45_000;
    return 60_000;
  }
  return staleTimeForInterval(interval, range as ChartRange);
}

function evictIfNeeded(): void {
  if (memory.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiry <= now) memory.delete(key);
    if (memory.size <= MAX_ENTRIES * 0.85) break;
  }
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
    else break;
  }
}

export function getCachedCandles(
  symbol: string,
  range: string,
  interval: ChartInterval,
): CachedCandle[] | null {
  const key = cacheKey(symbol, range, interval);
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiry) {
    memory.delete(key);
    return null;
  }
  return entry.candles;
}

export function setCachedCandles(
  symbol: string,
  range: string,
  interval: ChartInterval,
  candles: CachedCandle[],
): void {
  if (!candles.length) return;
  const key = cacheKey(symbol, range, interval);
  memory.set(key, { candles, expiry: Date.now() + ttlMs(range, interval) });
  evictIfNeeded();
}

/** Deduplicate concurrent fetches for the same symbol/range/interval. */
export async function fetchCandlesWithCache(
  symbol: string,
  range: string,
  interval: ChartInterval,
  fetcher: () => Promise<CachedCandle[]>,
  options?: { bypassCache?: boolean },
): Promise<CachedCandle[]> {
  if (!options?.bypassCache) {
    const cached = getCachedCandles(symbol, range, interval);
    if (cached) return cached;
  }

  const key = cacheKey(symbol, range, interval);
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher()
    .then((candles) => {
      if (!options?.bypassCache) {
        setCachedCandles(symbol, range, interval, candles);
      }
      return candles;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function clearCandleCache(): void {
  memory.clear();
  inflight.clear();
}
