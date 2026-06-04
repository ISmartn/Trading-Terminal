import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import { getActiveBroker } from "./brokerConfig";
import { PROXY_BASE } from "./proxyConfig";

function getUpstoxAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  if (activeBroker?.brokerId === "upstox" && activeBroker.values.accessToken) {
    headers["x-upstox-access-token"] = activeBroker.values.accessToken;
  }
  return headers;
}

async function fetchUpstoxProxy(endpoint: string, params?: Record<string, string>): Promise<any> {
  const qp = new URLSearchParams({ endpoint, ...params });
  const url = `${PROXY_BASE}/api/upstox-proxy?${qp.toString()}`;

  const res = await fetch(url, { headers: getUpstoxAuthHeaders() });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upstox proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// NSE proxy for indices & market status
async function fetchNSEProxy(endpoint: string, symbol?: string): Promise<any> {
  const params = new URLSearchParams({ endpoint });
  if (symbol) params.set("symbol", symbol);
  const url = `${PROXY_BASE}/api/nse-proxy?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`NSE proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// ── Parse Upstox Option Chain Response ──

interface UpstoxOptionChainRow {
  strike_price: number;
  underlying_spot_price?: number;
  call_options?: {
    market_data?: {
      ltp?: number;
      oi?: number;
      volume?: number;
      bid_price?: number;
      ask_price?: number;
      prev_oi?: number;
    };
    option_greeks?: {
      iv?: number;
      delta?: number;
      gamma?: number;
      theta?: number;
      vega?: number;
    };
  };
  put_options?: {
    market_data?: {
      ltp?: number;
      oi?: number;
      volume?: number;
      bid_price?: number;
      ask_price?: number;
      prev_oi?: number;
    };
    option_greeks?: {
      iv?: number;
      delta?: number;
      gamma?: number;
      theta?: number;
      vega?: number;
    };
  };
}

interface UpstoxOptionChainData {
  status: string;
  data: UpstoxOptionChainRow[];
}

function mapUpstoxLeg(leg?: UpstoxOptionChainRow["call_options"]) {
  const md = leg?.market_data || {};
  const greeks = leg?.option_greeks || {};
  const oi = md.oi || 0;
  const prevOi = md.prev_oi ?? oi;
  return {
    ltp: md.ltp || 0,
    oi,
    oiChange: oi - prevOi,
    volume: md.volume || 0,
    iv: greeks.iv || 0,
    delta: greeks.delta || 0,
    gamma: greeks.gamma || 0,
    theta: greeks.theta || 0,
    vega: greeks.vega || 0,
    bidPrice: md.bid_price || 0,
    askPrice: md.ask_price || 0,
  };
}

export function parseUpstoxOptionChain(raw: UpstoxOptionChainData): {
  chain: OptionData[];
  spotPrice: number;
  totalCEOI: number;
  totalPEOI: number;
} {
  const rows = raw?.data || [];
  let spotPrice = 0;
  let totalCEOI = 0;
  let totalPEOI = 0;

  const chain: OptionData[] = rows
    .map((row) => {
      if (row.underlying_spot_price) spotPrice = row.underlying_spot_price;
      const ce = mapUpstoxLeg(row.call_options);
      const pe = mapUpstoxLeg(row.put_options);
      totalCEOI += ce.oi;
      totalPEOI += pe.oi;
      return {
        strikePrice: row.strike_price,
        ce,
        pe,
      };
    })
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return { chain, spotPrice, totalCEOI, totalPEOI };
}

/** @deprecated Use parseUpstoxOptionChain — kept for test compatibility */
export const parseDhanOptionChain = parseUpstoxOptionChain;

// ── Parse NSE Indices Response (kept for Dashboard) ──

export function parseNSEIndices(raw: any): IndexData[] {
  const indices = [
    "NIFTY 50",
    "NIFTY BANK",
    "NIFTY FINANCIAL SERVICES",
    "NIFTY MIDCAP 50",
    "NIFTY SMALLCAP 50",
    "NIFTY SMALLCAP 100",
    "NIFTY SMALLCAP 250",
  ];
  const symbolMap: Record<string, string> = {
    "NIFTY 50": "NIFTY",
    "NIFTY BANK": "BANKNIFTY",
    "NIFTY FINANCIAL SERVICES": "FINNIFTY",
    "NIFTY MIDCAP 50": "MIDCPNIFTY",
    "NIFTY SMALLCAP 50": "NIFTYSC50",
    "NIFTY SMALLCAP 100": "NIFTYSC100",
    "NIFTY SMALLCAP 250": "NIFTYSC250",
  };

  if (!raw?.data) return [];

  return raw.data
    .filter((d: any) => indices.includes(d.index))
    .map((d: any) => ({
      name: d.index,
      symbol: symbolMap[d.index] || d.index,
      ltp: d.last,
      change: d.variation || 0,
      changePercent: d.percentChange || 0,
      high: d.high || d.last,
      low: d.low || d.last,
      open: d.open || d.last,
      prevClose: d.previousClose || d.last,
    }));
}

interface NSEOptionChainResponse {
  records: {
    expiryDates: string[];
    strikePrices: number[];
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: any;
      PE?: any;
    }>;
  };
  filtered: {
    CE: { totOI: number; totVol: number };
    PE: { totOI: number; totVol: number };
  };
}

export function parseNSEOptionChain(raw: NSEOptionChainResponse, selectedExpiry?: string) {
  if (!raw?.records?.expiryDates || !raw?.records?.data) {
    return { chain: [], spotPrice: 0, expiries: [], totalCEOI: 0, totalPEOI: 0 };
  }

  const expiries: ExpiryDate[] = raw.records.expiryDates.map((exp) => {
    const d = new Date(exp);
    const now = new Date();
    const days = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    return { label: exp, value: exp, daysToExpiry: days };
  });

  const expiryFilter = selectedExpiry || raw.records.expiryDates[0];
  const filteredData = raw.records.data.filter((d) => d.expiryDate === expiryFilter);

  let spotPrice = 0;
  const chain: OptionData[] = filteredData.map((item) => {
    if (item.CE?.underlyingValue) spotPrice = item.CE.underlyingValue;
    if (item.PE?.underlyingValue) spotPrice = item.PE.underlyingValue;
    const defaultLeg = { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
    return {
      strikePrice: item.strikePrice,
      ce: item.CE ? {
        ltp: item.CE.lastPrice, oi: item.CE.openInterest, oiChange: item.CE.changeinOpenInterest,
        volume: item.CE.totalTradedVolume, iv: item.CE.impliedVolatility,
        delta: 0, gamma: 0, theta: 0, vega: 0,
        bidPrice: item.CE.bidprice, askPrice: item.CE.askPrice,
      } : defaultLeg,
      pe: item.PE ? {
        ltp: item.PE.lastPrice, oi: item.PE.openInterest, oiChange: item.PE.changeinOpenInterest,
        volume: item.PE.totalTradedVolume, iv: item.PE.impliedVolatility,
        delta: 0, gamma: 0, theta: 0, vega: 0,
        bidPrice: item.PE.bidprice, askPrice: item.PE.askPrice,
      } : defaultLeg,
    };
  });

  return { chain, spotPrice, expiries, totalCEOI: raw.filtered?.CE?.totOI || 0, totalPEOI: raw.filtered?.PE?.totOI || 0 };
}

// ── Exported fetch functions ──

export async function fetchLiveOptionChain(
  symbol: string,
  expiry?: string,
  options?: { refresh?: boolean },
) {
  try {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    if (expiry) params.expiry = expiry;
    if (options?.refresh) params.refresh = "1";
    const raw = await fetchUpstoxProxy("option-chain", params);
    if (raw?.status === "success" && Array.isArray(raw?.data) && raw.data.length > 0) {
      const parsed = parseUpstoxOptionChain(raw);
      let expiries: ExpiryDate[] = [];
      try {
        const expiryRaw = await fetchUpstoxProxy("expiry-list", { symbol: symbol.toUpperCase() });
        if (expiryRaw?.data) {
          expiries = expiryRaw.data.map((dateStr: string) => {
            const d = new Date(dateStr);
            const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            return {
              label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
              value: dateStr,
              daysToExpiry: days,
            };
          });
        }
      } catch {
        // Expiry fetch failed, continue with chain data
      }
      return {
        ...parsed, expiries, source: "upstox" as const,
        afterHours: raw.afterHours || false,
        cachedAt: raw.cachedAt || null,
      };
    }
  } catch (e) {
    console.warn("Upstox option chain fetch failed, trying NSE:", e);
  }

  try {
    const raw = await fetchNSEProxy("option-chain", symbol);
    const parsed = parseNSEOptionChain(raw, expiry);
    return { ...parsed, source: "nse" as const, afterHours: false, cachedAt: null };
  } catch (e) {
    console.warn("NSE option chain also failed:", e);
    throw e;
  }
}

export async function fetchExpiryList(symbol: string): Promise<ExpiryDate[]> {
  try {
    const raw = await fetchUpstoxProxy("expiry-list", { symbol: symbol.toUpperCase() });
    if (raw?.data) {
      return raw.data.map((dateStr: string) => {
        const d = new Date(dateStr);
        const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        return {
          label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          value: dateStr,
          daysToExpiry: days,
        };
      });
    }
  } catch (e) {
    console.warn("Upstox expiry list fetch failed:", e);
  }
  return [];
}

export async function fetchLiveIndices() {
  const raw = await fetchNSEProxy("indices");
  return parseNSEIndices(raw);
}

export async function fetchMarketStatus() {
  return fetchNSEProxy("market-status");
}

export async function fetchFnOStocks() {
  return fetchNSEProxy("equity-derivatives");
}

const SECTOR_INDEX_MAP: Record<string, string> = {
  "NIFTY IT": "IT",
  "NIFTY BANK": "Banking",
  "NIFTY AUTO": "Auto",
  "NIFTY PHARMA": "Pharma",
  "NIFTY METAL": "Metal",
  "NIFTY ENERGY": "Energy",
  "NIFTY FMCG": "FMCG",
  "NIFTY REALTY": "Realty",
  "NIFTY MEDIA": "Media",
  "NIFTY PSU BANK": "PSU Bank",
  "NIFTY FIN SERVICE": "Fin Svc",
  "NIFTY INFRA": "Infra",
  "NIFTY HEALTHCARE INDEX": "Health",
  "NIFTY CONSUMER DURABLES": "Consumer",
};

export async function fetchAllIndices() {
  const raw = await fetchNSEProxy("indices");
  if (!raw?.data) return null;

  const vixEntry = raw.data.find((d: any) => d.index === "INDIA VIX");
  const vix = vixEntry ? {
    value: vixEntry.last,
    change: vixEntry.variation || 0,
    changePercent: vixEntry.percentChange || 0,
    high: vixEntry.high || vixEntry.last,
    low: vixEntry.low || vixEntry.last,
  } : null;

  const sectors = raw.data
    .filter((d: any) => SECTOR_INDEX_MAP[d.index])
    .map((d: any) => ({
      name: SECTOR_INDEX_MAP[d.index],
      fullName: d.index,
      change: d.percentChange || 0,
      ltp: d.last || 0,
      open: d.open || d.last,
      high: d.high || d.last,
      low: d.low || d.last,
    }));

  const nifty50 = raw.data.find((d: any) => d.index === "NIFTY 50");
  const advances = nifty50?.advances || 0;
  const declines = nifty50?.declines || 0;
  const unchanged = nifty50?.unchanged || 0;

  return { vix, sectors, advances, declines, unchanged };
}

export interface FnOStockData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  totalTradedVolume?: number;
  openInterest?: number;
  oiChange?: number;
  sector?: string;
}

export async function fetchLiveFnOStocks(): Promise<FnOStockData[]> {
  try {
    const raw = await fetchNSEProxy("equity-derivatives");
    if (raw?.data?.length > 0) {
      return raw.data
        .filter((d: any) => d.symbol && d.symbol !== "NIFTY 50" && d.lastPrice)
        .map((d: any) => ({
          symbol: d.symbol,
          ltp: d.lastPrice || 0,
          change: d.change || 0,
          changePercent: d.pChange || 0,
          open: d.open || d.lastPrice,
          high: d.dayHigh || d.lastPrice,
          low: d.dayLow || d.lastPrice,
          previousClose: d.previousClose || d.lastPrice,
          volume: d.totalTradedVolume || 0,
          totalTradedVolume: d.totalTradedVolume || 0,
          openInterest: d.openInterest || 0,
          oiChange: d.changeinOpenInterest || 0,
          sector: d.meta?.industry || "",
        }));
    }
  } catch (e) {
    console.warn("NSE F&O stocks fetch failed, trying TradingView:", e);
  }

  try {
    const tvData = await fetchTradingViewStocks();
    if (tvData.length > 0) return tvData;
  } catch (e) {
    console.warn("TradingView stocks fetch also failed:", e);
  }

  return [];
}

export async function fetchTradingViewStocks(): Promise<FnOStockData[]> {
  const url = `${PROXY_BASE}/api/tv-scan?type=stocks`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV scan error: ${res.status}`);
  const data = await res.json();

  return (data.stocks || []).map((s: any) => ({
    symbol: s.symbol || "",
    ltp: s.ltp || 0,
    change: s.changeAbs || 0,
    changePercent: s.changePercent || 0,
    open: s.open || 0,
    high: s.high || 0,
    low: s.low || 0,
    previousClose: (s.ltp || 0) - (s.changeAbs || 0),
    volume: s.volume || 0,
    totalTradedVolume: s.volume || 0,
    openInterest: 0,
    oiChange: 0,
    sector: s.sector || "",
  }));
}

export async function fetchTradingViewIndices(): Promise<any[]> {
  const url = `${PROXY_BASE}/api/tv-scan?type=indices`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV indices error: ${res.status}`);
  const data = await res.json();
  return data.stocks || [];
}

export interface FIIDIIData {
  category: string;
  date: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

export async function fetchFIIDII(): Promise<FIIDIIData[]> {
  const raw = await fetchNSEProxy("fii-dii");
  if (!raw?.data) return [];

  return raw.data.map((d: any) => ({
    category: d.category || "",
    date: d.date || "",
    buyValue: parseFloat(d.buyValue?.replace(/,/g, "")) || 0,
    sellValue: parseFloat(d.sellValue?.replace(/,/g, "")) || 0,
    netValue: parseFloat(d.netValue?.replace(/,/g, "")) || 0,
  }));
}

export async function testUpstoxConnection(): Promise<{ status: string; message: string }> {
  const res = await fetch(`${PROXY_BASE}/api/test-connection`, { headers: getUpstoxAuthHeaders() });
  return res.json();
}

/** @deprecated Use testUpstoxConnection */
export const testDhanConnection = testUpstoxConnection;

export async function fetchProxyHealth(): Promise<any> {
  const res = await fetch(`${PROXY_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function fetchInstrumentMaster(): Promise<{
  instruments: any[];
  count: number;
}> {
  return fetchUpstoxProxy("instruments");
}

export interface HistoricalCandleResponse {
  status: string;
  data: {
    timestamp: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    oi?: number[];
  };
  remarks?: string;
}

export async function fetchHistoricalCandles(
  instrumentKey: string,
  exchangeSegment: string = "IDX_I",
  instrument: string = "INDEX",
  interval: string = "5",
  fromDate?: string,
  toDate?: string,
): Promise<HistoricalCandleResponse> {
  const params: Record<string, string> = {
    instrumentKey,
    exchangeSegment,
    instrument,
    interval,
  };
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;

  return fetchUpstoxProxy("historical", params);
}
