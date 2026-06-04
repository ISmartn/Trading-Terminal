/**
 * Local CORS Proxy Server for Mr. Chartist Options Terminal
 *
 * Features:
 *   1. HTTP Proxy — forwards to Upstox API v2/v3 and NSE India (CORS handled)
 *   2. Live Feed Relay — polls Upstox LTP quotes and broadcasts JSON ticks
 *      to browser clients via ws://localhost:4002/ws
 *
 * Usage:
 *   npm run proxy          # standalone
 *   npm run dev:live       # combined with Vite dev server
 *
 * @port 4002 (configurable via PROXY_PORT env var)
 */

import http from "node:http";
import { URL } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { WebSocketServer, WebSocket } from "ws";

// ── Load .env manually (no external deps needed) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(resolve(__dirname, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env file is optional */ }

const PORT = parseInt(process.env.PROXY_PORT || "4002", 10);
const UPSTOX_BASE = "https://api.upstox.com";
const NSE_BASE = "https://www.nseindia.com";

// ══════════════════════════════════════════════
// ── SECTION 1: In-Memory Cache ──
// ══════════════════════════════════════════════

const cache = new Map();

// Last-known-good cache — persists valid data for 18h (across market close)
// This ensures after-hours users still see the last available option chain, PCR, max pain etc.
const lastGoodCache = new Map();
const LAST_GOOD_TTL = 18 * 60 * 60 * 1000; // 18 hours

// ── Disk-backed persistent cache directory ──
const CACHE_DIR = resolve(__dirname, ".cache");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

function diskCacheKeyToFilename(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

function setLastGoodToDisk(key, data) {
  try {
    const filepath = join(CACHE_DIR, diskCacheKeyToFilename(key));
    writeFileSync(filepath, JSON.stringify({ data, timestamp: Date.now() }), "utf-8");
  } catch (e) {
    console.warn(`  ⚠️ Failed to write cache to disk for ${key}:`, e.message);
  }
}

function getLastGoodFromDisk(key) {
  try {
    const filepath = join(CACHE_DIR, diskCacheKeyToFilename(key));
    if (!existsSync(filepath)) return null;
    const raw = JSON.parse(readFileSync(filepath, "utf-8"));
    if (raw && raw.data && raw.timestamp && Date.now() - raw.timestamp < LAST_GOOD_TTL) {
      return raw;
    }
  } catch { /* ignore corrupt files */ }
  return null;
}

// Rehydrate lastGoodCache from disk on startup
try {
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(CACHE_DIR, file), "utf-8"));
      if (raw?.data && raw?.timestamp && Date.now() - raw.timestamp < LAST_GOOD_TTL) {
        // Reconstruct the key from the filename (reverse of the sanitization)
        lastGoodCache.set(file.replace(/\.json$/, ""), raw);
      }
    } catch { /* skip corrupt entries */ }
  }
  if (lastGoodCache.size > 0) {
    console.log(`  📦 Rehydrated ${lastGoodCache.size} last-good cache entries from disk`);
  }
} catch { /* .cache dir doesn't exist yet, will be created on first write */ }

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function setLastGood(key, data) {
  lastGoodCache.set(diskCacheKeyToFilename(key), { data, timestamp: Date.now() });
  setLastGoodToDisk(key, data); // Persist to disk
}

function getLastGood(key) {
  // Try in-memory first
  const diskKey = diskCacheKeyToFilename(key);
  const entry = lastGoodCache.get(diskKey);
  if (entry && Date.now() - entry.timestamp < LAST_GOOD_TTL) return entry;
  if (entry) lastGoodCache.delete(diskKey);
  
  // Fallback to disk
  const diskEntry = getLastGoodFromDisk(key);
  if (diskEntry) {
    lastGoodCache.set(diskKey, diskEntry); // Rehydrate in-memory
    return diskEntry;
  }
  return null;
}

// ══════════════════════════════════════════════
// ── SECTION 2: Upstox REST API ──
// ══════════════════════════════════════════════

// Symbol → Upstox instrument_key (see https://upstox.com/developer/api-documentation/instruments)
const UNDERLYING_MAP = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
  SENSEX: "BSE_INDEX|SENSEX",
};

const INDEX_INSTRUMENT_KEYS = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
  NIFTYSC50: "NSE_INDEX|NIFTY SMLCAP 50",
  NIFTYSC100: "NSE_INDEX|NIFTY SMLCAP 100",
  NIFTYSC250: "NSE_INDEX|NIFTY SMLCAP 250",
  INDIAVIX: "NSE_INDEX|India VIX",
  SENSEX: "BSE_INDEX|SENSEX",
};

// Upstox Market WS V3 subscriptions (ltpc). Fin/Midcap Nifty use NSE poll only.
const INSTRUMENT_KEY_TO_TICK = {
  "NSE_INDEX|Nifty 50": { securityId: 1, symbol: "NIFTY", exchangeSegment: "NSE_INDEX" },
  "NSE_INDEX|Nifty Bank": { securityId: 2, symbol: "BANKNIFTY", exchangeSegment: "NSE_INDEX" },
  "NSE_INDEX|India VIX": { securityId: 5, symbol: "INDIAVIX", exchangeSegment: "NSE_INDEX" },
  "BSE_INDEX|SENSEX": { securityId: 6, symbol: "SENSEX", exchangeSegment: "BSE_INDEX" },
  "NSE_INDEX|NIFTY SMLCAP 50": { securityId: 7, symbol: "NIFTYSC50", exchangeSegment: "NSE_INDEX" },
  "NSE_INDEX|NIFTY SMLCAP 100": { securityId: 8, symbol: "NIFTYSC100", exchangeSegment: "NSE_INDEX" },
  "NSE_INDEX|NIFTY SMLCAP 250": { securityId: 9, symbol: "NIFTYSC250", exchangeSegment: "NSE_INDEX" },
};

const TICK_INSTRUMENT_KEYS = Object.keys(INSTRUMENT_KEY_TO_TICK);

function getAccessToken(customAccessToken) {
  return customAccessToken || process.env.UPSTOX_ACCESS_TOKEN;
}

async function upstoxFetch(path, { method = "GET", query, accessToken } = {}) {
  const token = getAccessToken(accessToken);
  if (!token) {
    throw new Error("UPSTOX_ACCESS_TOKEN not configured. Add it to .env or pass via headers.");
  }

  const url = new URL(`${UPSTOX_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upstox API error [${res.status}]: ${errText}`);
  }
  return res.json();
}

function transformUpstoxCandles(upstoxResponse) {
  const candles = upstoxResponse?.data?.candles || [];
  const timestamp = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  const oi = [];

  for (const candle of candles) {
    timestamp.push(Math.floor(new Date(candle[0]).getTime() / 1000));
    open.push(candle[1]);
    high.push(candle[2]);
    low.push(candle[3]);
    close.push(candle[4]);
    volume.push(candle[5] || 0);
    oi.push(candle[6] || 0);
  }

  return {
    status: "success",
    data: { timestamp, open, high, low, close, volume, oi },
  };
}

/** Extract YYYY-MM-DD expiry strings from Upstox contracts or a cached date list */
function extractExpiryDates(payload) {
  const arr = payload?.data || [];
  if (!arr.length) return [];
  if (typeof arr[0] === "string") {
    return [...new Set(arr.filter(Boolean))].sort();
  }
  return [...new Set(arr.map((c) => c?.expiry).filter(Boolean))].sort();
}

/** Pick nearest upcoming expiry (today or later) */
function pickNearestExpiry(dates, preferred) {
  if (preferred) return preferred;
  const today = new Date().toISOString().split("T")[0];
  const upcoming = dates.filter((d) => d >= today);
  return (upcoming.length ? upcoming : dates)[0];
}

async function fetchOptionContracts(instrumentKey, symbol, userAccessToken, userPrefix) {
  const contractsCacheKey = `upstox:${userPrefix}contracts:${symbol}`;
  let contracts = getCached(contractsCacheKey);
  if (!contracts) {
    contracts = await upstoxFetch("/v2/option/contract", {
      query: { instrument_key: instrumentKey },
      accessToken: userAccessToken,
    });
    setCache(contractsCacheKey, contracts, 300000);
  }
  return contracts;
}

async function handleUpstoxProxy(params, userAccessToken) {
  const endpoint = params.get("endpoint");
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry");
  const userPrefix = userAccessToken ? `user:${userAccessToken.slice(0, 8)}:` : "";
  const cacheKey = `upstox:${userPrefix}${endpoint}:${symbol}:${expiry || ""}`;
  const forceRefresh = ["1", "true", "yes"].includes((params.get("refresh") || "").toLowerCase());

  if (!forceRefresh) {
    const cached = getCached(cacheKey);
    if (cached) {
      if (endpoint === "expiry-list") {
        const dates = extractExpiryDates(cached);
        return { data: { status: "success", data: dates }, cacheHit: true };
      }
      return { data: cached, cacheHit: true };
    }
  }

  switch (endpoint) {
    case "option-chain": {
      const instrumentKey = UNDERLYING_MAP[symbol];
      if (!instrumentKey) {
        throw new Error(`Unknown symbol: ${symbol}. Supported: ${Object.keys(UNDERLYING_MAP).join(", ")}`);
      }
      const lastGoodKey = `lastgood:oc:${symbol}:${expiry || "nearest"}`;

      try {
        let expiryDate = expiry;
        if (!expiryDate) {
          try {
            const contracts = await fetchOptionContracts(instrumentKey, symbol, userAccessToken, userPrefix);
            const dates = extractExpiryDates(contracts);
            expiryDate = pickNearestExpiry(dates);
          } catch (expiryErr) {
            console.log(`  ⚠️ Expiry list fetch failed for ${symbol}: ${expiryErr.message}`);
          }
        }

        if (!expiryDate) {
          throw new Error(`No expiry dates available for ${symbol}`);
        }

        const result = await upstoxFetch("/v2/option/chain", {
          query: { instrument_key: instrumentKey, expiry_date: expiryDate },
          accessToken: userAccessToken,
        });

        const hasData = Array.isArray(result?.data) && result.data.length > 0;
        if (hasData) {
          setLastGood(lastGoodKey, result);
          const ocTtl = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(symbol)
            ? 120_000
            : OI_CHAIN_CACHE_MS;
          setCache(cacheKey, result, ocTtl);
          return { data: result, cacheHit: false };
        }

        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Serving last-good OC for ${symbol} (cached ${Math.round((Date.now() - lastGood.timestamp) / 60000)}min ago)`);
          const afterHoursResult = { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
          setCache(cacheKey, afterHoursResult, 30000);
          return { data: afterHoursResult, cacheHit: false };
        }

        setCache(cacheKey, result, 30000);
        return { data: result, cacheHit: false };
      } catch (e) {
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Upstox error, serving last-good OC for ${symbol}: ${e.message}`);
          const afterHoursResult = { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
          return { data: afterHoursResult, cacheHit: false };
        }
        const is429 = e.message.includes("429") || e.message.includes("Too many");
        const cacheTTL = is429 ? 120000 : 60000;
        console.log(`  ⚠️ OC unavailable for ${symbol} (no cache): ${e.message}${is429 ? " [rate-limited, backing off 2min]" : ""}`);
        const emptyResult = { status: "success", data: [], afterHours: true };
        setCache(cacheKey, emptyResult, cacheTTL);
        return { data: emptyResult, cacheHit: false };
      }
    }

    case "expiry-list": {
      const instrumentKey = UNDERLYING_MAP[symbol];
      if (!instrumentKey) throw new Error(`Unknown symbol: ${symbol}`);
      const lastGoodKey = `lastgood:expiry:${symbol}`;

      try {
        const contracts = await fetchOptionContracts(instrumentKey, symbol, userAccessToken, userPrefix);
        const dates = extractExpiryDates(contracts);
        const result = { status: "success", data: dates };
        if (dates.length > 0) setLastGood(lastGoodKey, result);
        setCache(cacheKey, result, 300000);
        return { data: result, cacheHit: false };
      } catch (e) {
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Serving last-good expiry list for ${symbol}: ${e.message}`);
          return { data: lastGood.data, cacheHit: false };
        }
        throw e;
      }
    }

    case "ltp": {
      const instrumentKey = INDEX_INSTRUMENT_KEYS[symbol] || params.get("instrumentKey");
      if (!instrumentKey) throw new Error(`Unknown index: ${symbol}`);

      const result = await upstoxFetch("/v3/market-quote/ltp", {
        query: { instrument_key: instrumentKey },
        accessToken: userAccessToken,
      });
      setCache(cacheKey, result, 2000);
      return { data: result, cacheHit: false };
    }

    case "instruments": {
      const instrumentCacheKey = "upstox:instruments-master";
      const cachedInstruments = getCached(instrumentCacheKey);
      if (cachedInstruments) return { data: cachedInstruments, cacheHit: true };

      console.log("  📥 Downloading Upstox instrument master JSON...");
      const jsonUrl = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz";
      const jsonRes = await fetch(jsonUrl);
      if (!jsonRes.ok) throw new Error(`Failed to download instrument master: ${jsonRes.status}`);
      const buffer = Buffer.from(await jsonRes.arrayBuffer());
      const jsonText = gunzipSync(buffer).toString("utf-8");
      const rawInstruments = JSON.parse(jsonText);

      const ALLOWED_SEGMENTS = new Set(["NSE_EQ", "NSE_FO", "NSE_INDEX"]);
      const instruments = [];

      for (const item of rawInstruments) {
        const segment = item.segment || item.exchange;
        if (!ALLOWED_SEGMENTS.has(segment)) continue;

        const exchangeSegment = segment === "NSE_FO" ? "NSE_FNO" : segment === "NSE_INDEX" ? "IDX_I" : segment;
        const baseSymbol = item.underlying_symbol || item.name || item.trading_symbol?.split(" ")[0] || item.tradingsymbol?.split(" ")[0];

        instruments.push({
          securityId: item.exchange_token || item.instrument_key,
          instrumentKey: item.instrument_key,
          symbol: baseSymbol,
          tradingSymbol: item.trading_symbol || item.tradingsymbol,
          exchangeSegment,
          instrumentType: item.instrument_type || item.instrumentType,
          lotSize: item.lot_size || item.lotSize || 1,
          expiryDate: item.expiry || undefined,
          strikePrice: item.strike_price || item.strike || undefined,
          optionType: item.instrument_type === "CE" || item.instrument_type === "PE" ? item.instrument_type : item.option_type || undefined,
        });
      }

      console.log(`  ✅ Parsed ${instruments.length} instruments from Upstox JSON`);
      const payload = { instruments, count: instruments.length };
      setCache(instrumentCacheKey, payload, 3600000);
      return { data: payload, cacheHit: false };
    }

    case "historical": {
      let instrumentKey = params.get("instrumentKey")
        || INDEX_INSTRUMENT_KEYS[(params.get("symbol") || "").toUpperCase()]
        || params.get("securityId");
      if (instrumentKey && !String(instrumentKey).includes("|")) {
        instrumentKey = INDEX_INSTRUMENT_KEYS[String(instrumentKey).toUpperCase()] || instrumentKey;
      }
      const interval = params.get("interval") || "5";
      const fromDate = params.get("fromDate");
      const toDate = params.get("toDate");

      if (!instrumentKey) throw new Error("Missing instrumentKey (or symbol/securityId) parameter");

      const isDailyCandle = interval === "D";
      const now = new Date();
      const defaultDaysBack = isDailyCandle ? 365 : 3;
      const defaultFrom = new Date(now);
      defaultFrom.setDate(defaultFrom.getDate() - defaultDaysBack);

      let from = fromDate ? fromDate.split(" ")[0] : defaultFrom.toISOString().split("T")[0];
      const to = toDate ? toDate.split(" ")[0] : now.toISOString().split("T")[0];

      if (!isDailyCandle) {
        const fromDateObj = new Date(from);
        const toDateObj = new Date(to);
        const daysDiff = Math.ceil((toDateObj - fromDateObj) / (1000 * 60 * 60 * 24));
        if (daysDiff > 90) {
          const clampedFrom = new Date(toDateObj);
          clampedFrom.setDate(clampedFrom.getDate() - 89);
          from = clampedFrom.toISOString().split("T")[0];
          console.log(`  📐 Clamped intraday date range to 90 days (was ${daysDiff}d)`);
        }
      }

      const historicalCacheKey = `upstox:hist:${instrumentKey}:${interval}:${from}:${to}`;
      const cachedHist = getCached(historicalCacheKey);
      if (cachedHist) return { data: cachedHist, cacheHit: true };

      let unit;
      let upstoxInterval;
      if (isDailyCandle) {
        unit = "days";
        upstoxInterval = "1";
      } else if (interval === "60") {
        unit = "hours";
        upstoxInterval = "1";
      } else {
        unit = "minutes";
        upstoxInterval = interval;
      }

      const encodedKey = encodeURIComponent(instrumentKey);
      const path = `/v3/historical-candle/${encodedKey}/${unit}/${upstoxInterval}/${to}/${from}`;

      console.log(`  📊 Fetching ${isDailyCandle ? "daily" : "intraday"} chart: ${instrumentKey} (${from} → ${to}), interval=${interval}`);
      const raw = await upstoxFetch(path, { accessToken: userAccessToken });
      const result = transformUpstoxCandles(raw);
      setCache(historicalCacheKey, result, isDailyCandle ? 300000 : 60000);
      return { data: result, cacheHit: false };
    }

    default:
      throw new Error(`Unknown endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical`);
  }
}

// ══════════════════════════════════════════════
// ── SECTION 3: NSE API ──
// ══════════════════════════════════════════════

let nseSessionCookies = "";
let nseSessionExpiry = 0;
/** Single-flight: parallel /api/nse-proxy calls must not race the homepage handshake. */
let nseSessionPromise = null;

async function establishNSESessionOnce() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(NSE_BASE, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
        redirect: "follow",
        signal: AbortSignal.timeout(45000),
      });

      const rawHeaders = res.headers.raw ? res.headers.raw() : {};
      const setCookieHeaders = rawHeaders["set-cookie"] || [];
      let cookies = [];
      if (setCookieHeaders.length > 0) {
        cookies = setCookieHeaders.map((c) => c.split(";")[0].trim()).filter(Boolean);
      } else if (typeof res.headers.getSetCookie === "function") {
        cookies = res.headers.getSetCookie().map((c) => c.split(";")[0].trim()).filter(Boolean);
      } else {
        const setCookie = res.headers.get("set-cookie") || "";
        cookies = setCookie
          .split(/,(?=[^;]+=)/)
          .map((c) => c.split(";")[0].trim())
          .filter((c) => c.includes("="));
      }

      await res.text();

      if (cookies.length > 0) {
        nseSessionCookies = cookies.join("; ");
        nseSessionExpiry = Date.now() + 120_000;
        console.log(`  🍪 NSE session established (${cookies.length} cookies)`);
        return nseSessionCookies;
      }
      console.warn(`  ⚠️ NSE session: no cookies received (attempt ${attempt + 1}/3)`);
    } catch (e) {
      console.warn(`  ⚠️ NSE session error (attempt ${attempt + 1}/3): ${e.message}`);
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  nseSessionCookies = "";
  nseSessionExpiry = 0;
  return "";
}

async function getNSESession() {
  if (nseSessionCookies && Date.now() < nseSessionExpiry) return nseSessionCookies;
  if (nseSessionPromise) return nseSessionPromise;
  nseSessionPromise = establishNSESessionOnce().finally(() => {
    nseSessionPromise = null;
  });
  return nseSessionPromise;
}

async function warmNSESession() {
  const cookies = await getNSESession();
  if (cookies) console.log("  ✅ NSE session warmed on startup");
  else console.warn("  ⚠️ NSE session warm-up failed — will retry on first /api/nse-proxy request");
}

async function handleNSEProxy(params) {
  const endpoint = params.get("endpoint");
  const symbol = params.get("symbol");
  const cacheKey = `nse:${endpoint}:${symbol || ""}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  let apiPath;
  switch (endpoint) {
    case "option-chain":
      if (symbol && ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTY NEXT 50"].includes(symbol.toUpperCase())) {
        apiPath = `/api/option-chain-indices?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
      } else if (symbol) {
        apiPath = `/api/option-chain-equities?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
      } else {
        apiPath = `/api/option-chain-indices?symbol=NIFTY`;
      }
      break;
    case "indices":
      apiPath = "/api/allIndices";
      break;
    case "market-status":
      apiPath = "/api/marketStatus";
      break;
    case "equity-derivatives":
      apiPath = `/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O`;
      break;
    case "market-data-pre-open":
      apiPath = "/api/market-data-pre-open?key=FO";
      break;
    case "fii-dii":
      apiPath = "/api/fiidiiTradeReact";
      break;
    case "index-constituents": {
      const indexName = params.get("symbol") || params.get("index") || symbol || "NIFTY SMALLCAP 250";
      apiPath = `/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`;
      break;
    }
    default:
      throw new Error(`Unknown NSE endpoint: ${endpoint}`);
  }

  const lastGoodKey = `lastgood:nse:${endpoint}:${symbol || ""}`;
  
  // Try NSE with session retry
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const cookies = await getNSESession();
      if (!cookies) {
        if (attempt < 2) {
          nseSessionCookies = "";
          nseSessionExpiry = 0;
          console.log(`  ⚠️ NSE fetch skipped for ${endpoint}: no session cookies (attempt ${attempt + 1})`);
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw new Error("NSE session unavailable (no cookies)");
      }
      const indexName = params.get("symbol") || params.get("index") || symbol || "";
      const referer =
        endpoint === "index-constituents" && indexName
          ? `https://www.nseindia.com/market-data/constituents?index=${encodeURIComponent(indexName.toUpperCase())}`
          : "https://www.nseindia.com/option-chain";
      const nseRes = await fetch(`${NSE_BASE}${apiPath}`, {
        signal: AbortSignal.timeout(45000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          Referer: referer,
          Cookie: cookies,
        },
      });

      if (!nseRes.ok) {
        throw new Error(`NSE HTTP ${nseRes.status}`);
      }

      const contentType = nseRes.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        // NSE returned HTML (likely a captcha or redirect) — invalidate session
        nseSessionCookies = "";
        nseSessionExpiry = 0;
        if (attempt === 0) {
          console.log(`  🔄 NSE returned non-JSON for ${endpoint}, retrying with fresh session...`);
          continue; // retry
        }
        throw new Error("NSE returned non-JSON response (possible captcha)");
      }

      const data = await nseRes.json();
      
      // Validate the data is not empty/malformed
      const isValidOC = endpoint === "option-chain" ? (data?.records?.data?.length > 0) : true;
      const isValidIC =
        endpoint !== "index-constituents" || (Array.isArray(data?.data) && data.data.length > 0);
      const isValidData = data && Object.keys(data).length > 0 && isValidOC && isValidIC;
      
      if (isValidData) {
        setLastGood(lastGoodKey, data);
      }
      
      const ttl = endpoint === "fii-dii" ? 300000 : 30000;
      setCache(cacheKey, data, ttl);
      return { data, cacheHit: false };
    } catch (nseErr) {
      nseSessionCookies = "";
      nseSessionExpiry = 0;
      if (attempt < 2) {
        console.log(`  ⚠️ NSE fetch failed for ${endpoint} (attempt ${attempt + 1}): ${nseErr.message}`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      console.warn(`  ❌ NSE fetch failed for ${endpoint}: ${nseErr.message}`);
    }
  }
  
  // All attempts failed — try last-good cache
  const lastGood = getLastGood(lastGoodKey);
  if (lastGood) {
    console.log(`  📦 Serving last-good NSE data for ${endpoint}:${symbol || ""}`);
    setCache(cacheKey, lastGood.data, 60000);
    return { data: lastGood.data, cacheHit: false };
  }
  
  // No cache — return empty object
  return { data: {}, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 3b: TradingView Scanner ──
// ══════════════════════════════════════════════

const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/india/scan";

// Top F&O stocks for TradingView scanning
const FNO_TICKERS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BHARTIARTL",
  "ITC","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","TATAMOTORS","SUNPHARMA",
  "TITAN","WIPRO","ULTRACEMCO","BAJFINANCE","HCLTECH","NTPC","POWERGRID","ONGC",
  "ADANIENT","ADANIPORTS","COALINDIA","DRREDDY","NESTLEIND","CIPLA","BAJAJFINSV",
  "GRASIM","JSWSTEEL","BRITANNIA","TECHM","INDUSINDBK","HINDALCO","M&M","APOLLOHOSP",
  "EICHERMOT","DIVISLAB","BPCL","HEROMOTOCO","TATASTEEL","SBILIFE","HDFCLIFE",
  "SHRIRAMFIN","TRENT","BAJAJ-AUTO","BANKBARODA","PNB","CANBK","IDFCFIRSTB",
  "FEDERALBNK","BANDHANBNK","RBLBANK","AUBANK","MANAPPURAM","MUTHOOTFIN",
  "CHOLAFIN","LICHSGFIN","CANFINHOME","RECLTD","PFC","HAL","BEL","BHEL",
  "IRCTC","ZOMATO","PAYTM","DLF","GODREJPROP","OBEROIRLTY","VEDL","JINDALSTEL",
  "SAIL","NMDC","IOC","GAIL","TATAPOWER","SIEMENS","ABB","VOLTAS","HAVELLS",
  "POLYCAB","LTIM","MPHASIS","COFORGE","PERSISTENT","TORNTPHARM","LUPIN",
  "AUROPHARMA","BIOCON","GODREJCP","DABUR","MARICO","COLPAL","MCX","INDIGO",
  "TVSMOTOR","MRF","ASHOKLEY","ESCORTS","DIXON","CROMPTON","JUBLFOOD","SUNTV",
].map(s => `NSE:${s}`);

const INDEX_TICKERS = ["NSE:NIFTY","NSE:BANKNIFTY","NSE:CNXFINANCE","BSE:SENSEX"];

async function handleTradingViewScan(params) {
  const scanType = params.get("type") || "stocks"; // "stocks" or "indices"
  const cacheKey = `tv:scan:${scanType}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  const isIndices = scanType === "indices";
  const tickers = isIndices ? INDEX_TICKERS : FNO_TICKERS;

  const body = {
    symbols: { tickers },
    columns: [
      "name", "description", "close", "change", "change_abs",
      "volume", "open", "high", "low", "Perf.W", "Perf.1M",
      "market_cap_basic", "average_volume_10d_calc",
      ...(isIndices ? [] : ["sector"]),
    ],
  };

  const res = await fetch(TRADINGVIEW_SCAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://www.tradingview.com/",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TradingView scan error [${res.status}]: ${errText}`);
  }

  const rawData = await res.json();
  
  // Parse TradingView response into clean format
  const stocks = (rawData.data || []).map(item => {
    const d = item.d || [];
    const cols = body.columns;
    const obj = {};
    cols.forEach((col, i) => { obj[col] = d[i]; });
    
    // Extract exchange:symbol from s (e.g. "NSE:RELIANCE")
    const [exchange, symbol] = (item.s || "").split(":");
    
    return {
      symbol: symbol || obj.name || "",
      name: obj.description || symbol || "",
      exchange: exchange || "NSE",
      ltp: obj.close || 0,
      change: obj.change || 0,
      changeAbs: obj.change_abs || 0,
      changePercent: obj.change || 0,
      volume: obj.volume || 0,
      open: obj.open || 0,
      high: obj.high || 0,
      low: obj.low || 0,
      weekChange: obj["Perf.W"] || 0,
      monthChange: obj["Perf.1M"] || 0,
      marketCap: obj.market_cap_basic || 0,
      avgVolume10d: obj.average_volume_10d_calc || 0,
      sector: obj.sector || "",
    };
  });

  console.log(`  📊 TradingView ${scanType}: ${stocks.length} results`);
  setCache(cacheKey, { stocks, totalCount: rawData.totalCount, timestamp: Date.now() }, 15000); // 15s cache
  return { data: { stocks, totalCount: rawData.totalCount, timestamp: Date.now() }, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 4: Upstox Live Market Feed (LTP Polling) ──
// ══════════════════════════════════════════════

const latestTicks = new Map();
let upstoxFeedConnected = false;
let upstoxFeedTimer = null;
let upstoxSessionTimer = null;
let upstoxFeedCredentials = { accessToken: null };
const UPSTOX_POLL_INTERVAL_MS = 2000;
const UPSTOX_AFTER_HOURS_POLL_MS = parseInt(process.env.UPSTOX_AFTER_HOURS_POLL_MS || "60000", 10);

/** NSE cash/F&O regular session (IST). Node proxy uses REST only — slower poll off-hours. */
function isNseLiveSession(date = new Date()) {
  if (["1", "true", "yes"].includes((process.env.UPSTOX_WS_IGNORE_SESSION || "").toLowerCase())) {
    return true;
  }
  const ist = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  return mins >= open && mins <= close;
}

function upstoxPollIntervalMs() {
  return isNseLiveSession() ? UPSTOX_POLL_INTERVAL_MS : UPSTOX_AFTER_HOURS_POLL_MS;
}
/** NSE OI ~3 min — dedupe option-chain REST (see src/lib/dataRefreshPolicy.ts) */
const OI_CHAIN_CACHE_MS = 180_000;

async function pollUpstoxLTP() {
  const token = upstoxFeedCredentials.accessToken || process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return;

  try {
    const instrumentKeys = TICK_INSTRUMENT_KEYS.join(",");
    const result = await upstoxFetch("/v3/market-quote/ltp", {
      query: { instrument_key: instrumentKeys },
      accessToken: token,
    });

    const quotes = result?.data || {};
    upstoxFeedConnected = true;

    for (const [instrumentKey, quote] of Object.entries(quotes)) {
      const meta = INSTRUMENT_KEY_TO_TICK[instrumentKey];
      if (!meta || quote?.last_price == null) continue;

      const ltp = quote.last_price;
      const prevClose = quote.close || quote.prev_close || quote.previous_close || ltp;
      const change = ltp - prevClose;
      const changePercent = prevClose ? (change / prevClose) * 100 : 0;

      const tick = {
        type: "quote",
        securityId: meta.securityId,
        symbol: meta.symbol,
        exchangeSegment: meta.exchangeSegment,
        instrumentKey,
        ltp,
        open: quote.ohlc?.open || ltp,
        high: quote.ohlc?.high || ltp,
        low: quote.ohlc?.low || ltp,
        close: quote.ohlc?.close || prevClose,
        prevClose,
        change,
        changePercent,
        volume: quote.volume || 0,
        timestamp: Date.now(),
      };

      latestTicks.set(meta.securityId, tick);
      broadcastToClients(tick);
    }

    broadcastToClients({
      type: "status",
      connected: true,
      instrumentCount: TICK_INSTRUMENT_KEYS.length,
    });
  } catch (err) {
    upstoxFeedConnected = false;
    broadcastToClients({ type: "status", connected: false });
    if (err.message.includes("429")) {
      console.log("  ⏳ Upstox LTP rate-limited, backing off...");
    }
  }
}

function scheduleUpstoxPoll() {
  if (upstoxFeedTimer) clearInterval(upstoxFeedTimer);
  const ms = upstoxPollIntervalMs();
  pollUpstoxLTP();
  upstoxFeedTimer = setInterval(pollUpstoxLTP, ms);
}

function startUpstoxFeed(accessToken) {
  if (!accessToken) {
    console.log("  ⚠️  No Upstox access token for live feed — skipping");
    return;
  }

  upstoxFeedCredentials = { accessToken };

  if (upstoxSessionTimer) clearInterval(upstoxSessionTimer);
  let lastSessionLive = isNseLiveSession();
  console.log(
    `  🔌 Upstox REST LTP feed (${lastSessionLive ? "session" : "off-hours"}, poll ${upstoxPollIntervalMs()}ms)…`,
  );
  scheduleUpstoxPoll();

  upstoxSessionTimer = setInterval(() => {
    const nowLive = isNseLiveSession();
    if (lastSessionLive !== nowLive) {
      console.log(`  🕐 NSE session now ${nowLive ? "open" : "closed"} — adjusting REST poll interval`);
      scheduleUpstoxPoll();
      lastSessionLive = nowLive;
    }
  }, 30000);
}

function stopUpstoxFeed() {
  if (upstoxFeedTimer) {
    clearInterval(upstoxFeedTimer);
    upstoxFeedTimer = null;
  }
  if (upstoxSessionTimer) {
    clearInterval(upstoxSessionTimer);
    upstoxSessionTimer = null;
  }
  upstoxFeedConnected = false;
}

// ── Local WebSocket Server (Browser ↔ Proxy) ──

const localWSS = new WebSocketServer({ noServer: true });

function broadcastToClients(data) {
  const json = JSON.stringify(data);
  localWSS.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

localWSS.on("connection", (ws) => {
  console.log("  🌐 Browser WebSocket client connected");

  ws.send(JSON.stringify({
    type: "status",
    connected: upstoxFeedConnected,
    feed: "upstox_ltp_rest",
    instrumentCount: TICK_INSTRUMENT_KEYS.length,
    marketSessionOpen: isNseLiveSession(),
  }));

  for (const [, tickData] of latestTicks) {
    ws.send(JSON.stringify(tickData));
  }

  ws.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());

      if (parsed.type === "configure") {
        const { accessToken } = parsed;
        if (accessToken) {
          console.log("  🔑 Received Upstox credentials from browser, starting live feed...");
          startUpstoxFeed(accessToken);
        }
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on("close", () => {
    console.log("  🔌 Browser WebSocket client disconnected");
  });
});

// ══════════════════════════════════════════════
// ── SECTION 4b: Index universe (NSE archive CSV) ──
// ══════════════════════════════════════════════

const INDEX_TAB_CSV = {
  N50: "ind_nifty50list.csv",
  N100: "ind_nifty100list.csv",
  N200: "ind_nifty200list.csv",
  BANK: "ind_niftybanklist.csv",
  IT: "ind_niftyitlist.csv",
  MID50: "ind_niftymidcap50list.csv",
  MID150: "ind_niftymidcap150list.csv",
};

const INDEX_TAB_LABELS = {
  N50: "Nifty 50",
  N100: "Nifty 100",
  N200: "Nifty 200",
  BANK: "Nifty Bank",
  IT: "Nifty IT",
  MID50: "Nifty Midcap 50",
  MID150: "Nifty Midcap 150",
};

async function handleIndexUniverse(params) {
  const tab = (params.get("tab") || "N50").toUpperCase();
  const cacheKey = `index:universe:${tab}`;
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  const csvFile = INDEX_TAB_CSV[tab];
  if (!csvFile) throw new Error(`Unknown index tab: ${tab}`);

  const url = `https://nsearchives.nseindia.com/content/indices/${csvFile}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`NSE archive CSV failed: HTTP ${res.status}`);
  const symbols = parseConstituentCsv(await res.text());
  if (!symbols.length) throw new Error(`Empty symbol list for ${tab}`);

  const payload = {
    symbols,
    symbolCount: symbols.length,
    tab,
    label: INDEX_TAB_LABELS[tab] || tab,
    source: "nse_archive_csv",
    fetchedAt: Date.now(),
  };
  setLastGood(`lastgood:index:universe:${tab}`, payload);
  setCache(cacheKey, payload, 3600000);
  return { data: payload, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 4c: Smallcap universe (CSV + TradingView) ──
// ══════════════════════════════════════════════

const SMALLCAP_CSV_URLS = {
  SC50: "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap50list.csv",
  SC100: "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap100list.csv",
  SC250: "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv",
};

function parseConstituentCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const symIdx = header.indexOf("symbol");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const sym = (cols[symIdx >= 0 ? symIdx : 2] || "").trim().toUpperCase();
    if (sym) out.push(sym);
  }
  return out;
}

async function fetchCsvSymbols(indexKey) {
  const res = await fetch(SMALLCAP_CSV_URLS[indexKey], {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`CSV ${indexKey}: HTTP ${res.status}`);
  const syms = parseConstituentCsv(await res.text());
  if (!syms.length) throw new Error(`CSV ${indexKey}: empty`);
  return syms;
}

async function fetchTvQuotes(symbols) {
  const out = {};
  const chunkSize = 50;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    const tickers = chunk.map((s) => `NSE:${s}`);
    const body = {
      symbols: { tickers },
      columns: ["name", "close", "change", "open", "high", "low"],
    };
    try {
      const res = await fetch("https://scanner.tradingview.com/india/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.tradingview.com/",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) continue;
      const raw = await res.json();
      for (const item of raw.data || []) {
        const sym = (item.s || "").split(":")[1]?.toUpperCase();
        const d = item.d || [];
        const ltp = d[1];
        if (!sym || !ltp) continue;
        const changePct = d[2] || 0;
        const prev = changePct ? ltp / (1 + changePct / 100) : ltp;
        out[sym] = {
          ltp,
          change: ltp - prev,
          changePercent: changePct,
          open: d[3] || ltp,
          high: d[4] || ltp,
          low: d[5] || ltp,
          prevClose: prev,
        };
      }
    } catch {
      /* try next chunk */
    }
  }
  return out;
}

async function handleSmallcapUniverse(params) {
  const filter = params.get("filter") || "all";
  const cacheKey = `smallcap:universe:${filter}`;
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  const keys = filter === "all" ? ["SC50", "SC100", "SC250"] : [filter];
  const csvSets = {};
  for (const key of keys) {
    csvSets[key] = new Set(await fetchCsvSymbols(key));
  }
  const membership = {};
  const allSymbols = new Set();
  for (const key of Object.keys(csvSets)) {
    for (const sym of csvSets[key]) {
      allSymbols.add(sym);
      if (!membership[sym]) membership[sym] = [];
      if (!membership[sym].includes(key)) membership[sym].push(key);
    }
  }
  const symbols =
    filter === "all" ? [...allSymbols].sort() : [...(csvSets[filter] || [])].sort();

  const quotes = await fetchTvQuotes(symbols);
  const stocks = symbols
    .map((sym) => {
      const q = quotes[sym];
      if (!q?.ltp) return null;
      return { symbol: sym, indices: membership[sym] || [filter], ...q };
    })
    .filter(Boolean);

  const payload = {
    stocks,
    symbolCount: symbols.length,
    quotedCount: stocks.length,
    source: stocks.length ? "tradingview" : "csv_only",
    fetchedAt: Date.now(),
    filter,
  };
  if (stocks.length) setLastGood(`lastgood:smallcap:universe:${filter}`, payload);
  setCache(cacheKey, payload, 5000);
  return { data: payload, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 5: HTTP Server ──
// ══════════════════════════════════════════════

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-upstox-access-token",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = url.searchParams;

  res.setHeader("Content-Type", "application/json");
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (url.pathname === "/api/upstox-proxy" || url.pathname === "/api/dhan-proxy") {
      const userAccessToken = req.headers["x-upstox-access-token"] || req.headers["x-dhan-access-token"];
      const { data, cacheHit } = await handleUpstoxProxy(params, userAccessToken);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/nse-proxy") {
      const { data, cacheHit } = await handleNSEProxy(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/smallcap-universe") {
      const { data, cacheHit } = await handleSmallcapUniverse(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/index-universe") {
      const { data, cacheHit } = await handleIndexUniverse(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/tv-scan") {
      const { data, cacheHit } = await handleTradingViewScan(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/test-connection") {
      const userAccessToken = req.headers["x-upstox-access-token"] || req.headers["x-dhan-access-token"];
      try {
        const result = await upstoxFetch("/v2/option/contract", {
          query: { instrument_key: "NSE_INDEX|Nifty 50" },
          accessToken: userAccessToken,
        });
        res.writeHead(200);
        res.end(JSON.stringify({ status: "success", message: "Upstox API connected", data: result }));
      } catch (err) {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "error", message: err.message }));
      }
    } else if (url.pathname === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        reachable: true,
        websocket: {
          upstoxConnected: upstoxFeedConnected,
          dhanConnected: upstoxFeedConnected, // legacy field for UI compatibility
          browserClients: localWSS.clients.size,
          instrumentsSubscribed: TICK_INSTRUMENT_KEYS.length,
          cachedTicks: latestTicks.size,
        },
        sources: {
          upstox: !!process.env.UPSTOX_ACCESS_TOKEN,
          dhan: !!process.env.UPSTOX_ACCESS_TOKEN, // legacy field
          tradingview: true,
          nse: true,
        },
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found. Use /api/upstox-proxy, /api/nse-proxy, /api/tv-scan, or /ws" }));
    }
  } catch (err) {
    console.error(`[Proxy Error] ${url.pathname}:`, err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

// Handle WebSocket upgrade for /ws path
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (url.pathname === "/ws") {
    localWSS.handleUpgrade(request, socket, head, (ws) => {
      localWSS.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  🚀 Mr. Chartist Proxy Server");
  console.log(`  ├─ HTTP:       http://localhost:${PORT}`);
  console.log(`  ├─ WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`  ├─ Health:     http://localhost:${PORT}/health`);
  console.log(`  ├─ Upstox (1°): http://localhost:${PORT}/api/upstox-proxy?endpoint=option-chain&symbol=NIFTY`);
  console.log(`  ├─ NSE  (2°):   http://localhost:${PORT}/api/nse-proxy?endpoint=indices`);
  console.log(`  └─ TV Scanner:  http://localhost:${PORT}/api/tv-scan?type=stocks`);
  console.log("");
  console.log("  Data Priority: Upstox → NSE → TradingView");
  console.log("  Upstox credentials:", process.env.UPSTOX_ACCESS_TOKEN ? "✅ Loaded from .env" : "⚠️  Not set (configure in .env or Broker Settings)");
  console.log("");

  if (process.env.UPSTOX_ACCESS_TOKEN) {
    startUpstoxFeed(process.env.UPSTOX_ACCESS_TOKEN);
  }

  void warmNSESession();
});
