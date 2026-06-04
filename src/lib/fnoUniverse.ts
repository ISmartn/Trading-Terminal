import { PROXY_BASE } from "@/lib/proxyConfig";
import { registerEquityInstrumentKeys } from "@/hooks/useChartData";
import { fetchInstrumentMaster } from "@/lib/marketApi";
import { getSessionJSON, setSessionJSON } from "@/lib/sessionCache";

/** NSE F&O index underlyings */
export const FNO_INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"] as const;

/** Offline fallback when instrument master is unavailable */
export const FALLBACK_FNO_STOCKS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "SBIN", "BHARTIARTL",
  "ITC", "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA",
  "TITAN", "WIPRO", "ULTRACEMCO", "BAJFINANCE", "HCLTECH", "NTPC", "POWERGRID", "ONGC",
  "ADANIENT", "ADANIPORTS", "COALINDIA", "DRREDDY", "NESTLEIND", "CIPLA", "BAJAJFINSV",
  "GRASIM", "JSWSTEEL", "BRITANNIA", "TECHM", "INDUSINDBK", "HINDALCO", "M&M", "APOLLOHOSP",
  "EICHERMOT", "DIVISLAB", "BPCL", "HEROMOTOCO", "TATASTEEL", "SBILIFE", "HDFCLIFE",
  "SHRIRAMFIN", "TRENT", "BAJAJ-AUTO", "BANKBARODA", "PNB", "CANBK", "IDFCFIRSTB",
  "FEDERALBNK", "BANDHANBNK", "RBLBANK", "AUBANK", "MANAPPURAM", "MUTHOOTFIN",
  "CHOLAFIN", "LICHSGFIN", "CANFINHOME", "RECLTD", "PFC", "HAL", "BEL", "BHEL",
  "IRCTC", "ZOMATO", "PAYTM", "DLF", "GODREJPROP", "OBEROIRLTY", "VEDL", "JINDALSTEL",
  "SAIL", "NMDC", "IOC", "GAIL", "TATAPOWER", "SIEMENS", "ABB", "VOLTAS", "HAVELLS",
  "POLYCAB", "LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "TORNTPHARM", "LUPIN",
  "AUROPHARMA", "BIOCON", "GODREJCP", "DABUR", "MARICO", "COLPAL", "MCX", "INDIGO",
  "TVSMOTOR", "MRF", "ASHOKLEY", "ESCORTS", "DIXON", "CROMPTON", "JUBLFOOD", "SUNTV",
];

const INDEX_NAME_TO_SYMBOL: Record<string, string> = {
  NIFTY: "NIFTY",
  "NIFTY 50": "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  "NIFTY BANK": "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  "NIFTY FIN SERVICE": "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
  "NIFTY MID SELECT": "MIDCPNIFTY",
  "NIFTY MIDCAP SELECT": "MIDCPNIFTY",
  "NIFTY SMALLCAP 50": "NIFTYSC50",
  "NIFTY SMALLCAP 100": "NIFTYSC100",
  "NIFTY SMALLCAP 250": "NIFTYSC250",
};

function normalizeIndexSymbol(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (INDEX_NAME_TO_SYMBOL[upper]) return INDEX_NAME_TO_SYMBOL[upper];
  if (upper.includes("MID") && upper.includes("SELECT")) return "MIDCPNIFTY";
  if (upper.includes("FIN") && upper.includes("SERVICE")) return "FINNIFTY";
  if (upper.includes("BANK") && upper.includes("NIFTY")) return "BANKNIFTY";
  if (upper === "NIFTY" || upper.startsWith("NIFTY ")) return "NIFTY";
  return null;
}

/** Extract unique F&O underlyings from Upstox instrument master rows. */
export function extractFnoSymbolsFromInstruments(instruments: Array<Record<string, unknown>>): string[] {
  const symbols = new Set<string>(FNO_INDEX_SYMBOLS);

  for (const inst of instruments) {
    const seg = String(inst.exchangeSegment ?? "");
    if (seg !== "NSE_FNO" && seg !== "NSE_FO") continue;

    const itype = String(inst.instrumentType ?? "").toUpperCase();
    const undType = String(inst.underlyingType ?? "").toUpperCase();
    const undKey = String(inst.underlyingKey ?? "");
    const undSym = String(inst.underlyingSymbol ?? inst.symbol ?? "")
      .trim()
      .toUpperCase();

    const isIndex = undType === "INDEX" || undKey.startsWith("NSE_INDEX|") || undKey.startsWith("BSE_INDEX|");
    const isEquity = undType === "EQUITY" || undType === "EQ" || undKey.startsWith("NSE_EQ|");

    if (isIndex) {
      const mapped = normalizeIndexSymbol(undSym);
      if (mapped) symbols.add(mapped);
      continue;
    }

    if (isEquity && ["CE", "PE", "FUT", "FUTSTK", "OPTSTK"].includes(itype) && undSym) {
      symbols.add(undSym);
    }
  }

  return Array.from(symbols).sort((a, b) => a.localeCompare(b));
}

let cachedSymbols: string[] | null = null;
let cacheTime = 0;
const CACHE_MS = 60 * 60 * 1000;
const FNO_SYMBOLS_SESSION_KEY = "fno-symbols-list";

function fallbackSymbolList(): string[] {
  return Array.from(new Set([...FNO_INDEX_SYMBOLS, ...FALLBACK_FNO_STOCKS])).sort((a, b) =>
    a.localeCompare(b),
  );
}

/** All NSE F&O underlyings (indices + stocks) from Upstox instrument master. */
export async function fetchAllFnoSymbols(): Promise<string[]> {
  if (cachedSymbols && Date.now() - cacheTime < CACHE_MS) {
    return cachedSymbols;
  }

  const sessionList = getSessionJSON<string[]>(FNO_SYMBOLS_SESSION_KEY, CACHE_MS);
  if (sessionList?.length) {
    cachedSymbols = sessionList;
    cacheTime = Date.now();
    return cachedSymbols;
  }

  try {
    const res = await fetch(`${PROXY_BASE}/api/fno-symbols`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) {
      const json = await res.json();
      if (import.meta.env.DEV && json.debug) {
        console.debug("[fno-universe]", json.debug);
      }
      let symbols: string[] = Array.isArray(json.symbols)
        ? json.symbols.map((s: string) => String(s).toUpperCase())
        : [];

      // Bust stale cache missing equityKeys or indices-only list
      const equityKeyCount = json.equityKeys ? Object.keys(json.equityKeys).length : 0;
      if (symbols.length > 0 && (symbols.length <= 4 || equityKeyCount === 0)) {
        const refreshRes = await fetch(`${PROXY_BASE}/api/fno-symbols?refresh=1`, {
          signal: AbortSignal.timeout(90_000),
        });
        if (refreshRes.ok) {
          const refreshed = await refreshRes.json();
          if (import.meta.env.DEV && refreshed.debug) {
            console.debug("[fno-universe] refreshed", refreshed.debug);
          }
          if (Array.isArray(refreshed.symbols) && refreshed.symbols.length > symbols.length) {
            symbols = refreshed.symbols.map((s: string) => String(s).toUpperCase());
          }
        }
      }

      if (symbols.length > 0) {
        if (json.equityKeys && typeof json.equityKeys === "object") {
          registerEquityInstrumentKeys(json.equityKeys);
        }
        cachedSymbols = symbols;
        cacheTime = Date.now();
        setSessionJSON(FNO_SYMBOLS_SESSION_KEY, cachedSymbols);
        return cachedSymbols;
      }
    } else if (import.meta.env.DEV) {
      console.error("[fno-universe] API error", res.status, await res.text());
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[fno-universe] fetch failed", err);
    }
  }

  try {
    const master = await fetchInstrumentMaster();
    const extracted = extractFnoSymbolsFromInstruments(master.instruments ?? []);
    if (extracted.length > 0) {
      cachedSymbols = extracted;
      cacheTime = Date.now();
      return cachedSymbols;
    }
  } catch {
    // use static fallback
  }

  cachedSymbols = fallbackSymbolList();
  cacheTime = Date.now();
  return cachedSymbols;
}
