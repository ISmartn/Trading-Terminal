/**
 * WebSocket Client — Singleton manager for real-time Upstox market feed
 *
 * Connects to the local proxy server's WebSocket endpoint (/ws)
 * which relays Upstox Market Data Feed V3 ticks as JSON. Provides a pub/sub interface for
 * React components to subscribe to specific instrument updates.
 *
 * Architecture:
 *   Upstox Market WS V3 → proxy (Python) → this client (JSON) → React hooks
 *   (NSE indices REST ~5s when Upstox feed unavailable)
 */

import { getActiveBroker } from "./brokerConfig";
import { getProxyWebSocketUrl } from "./proxyConfig";
import { UPSTOX_WS_SECURITY_IDS } from "@/lib/upstoxLiveFeed";

export interface TickData {
  type: "ticker" | "quote" | "prevClose" | "oi" | "full" | "status";
  securityId: number;
  symbol: string;
  exchangeSegment: string;
  instrumentKey?: string;
  ltp?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  prevClose?: number;
  volume?: number;
  oi?: number;
  timestamp?: number;
  connected?: boolean;
  instrumentCount?: number;
}

export type TickListener = (data: TickData) => void;
export type StatusListener = (connected: boolean) => void;

const TICK_STALE_MS = 20_000;

const SYMBOL_TO_SECURITY_ID: Record<string, number> = {
  ...UPSTOX_WS_SECURITY_IDS,
  // Legacy IDs for Fin/Midcap (NSE poll only — not on Upstox WS feed)
  FINNIFTY: 3,
  MIDCPNIFTY: 4,
};

const SECURITY_ID_TO_SYMBOL: Record<number, string> = {};
for (const [sym, id] of Object.entries(SYMBOL_TO_SECURITY_ID)) {
  SECURITY_ID_TO_SYMBOL[id] = sym;
}

export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };

class MarketWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private tickListeners = new Map<number, Set<TickListener>>();
  private globalListeners = new Set<TickListener>();
  private proxyStatusListeners = new Set<StatusListener>();
  private feedStatusListeners = new Set<StatusListener>();
  private latestData = new Map<number, TickData>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private _upstoxConnected = false;
  private intentionalClose = false;
  private credentialsSent = false;

  constructor(url?: string) {
    this.url = url || getProxyWebSocketUrl();
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get isUpstoxConnected(): boolean {
    return this._upstoxConnected;
  }

  /** @deprecated Use isUpstoxConnected */
  get isDhanConnected(): boolean {
    return this._upstoxConnected;
  }

  getLatest(securityId: number): TickData | undefined {
    return this.latestData.get(securityId);
  }

  getLatestBySymbol(symbol: string): TickData | undefined {
    const id = SYMBOL_TO_SECURITY_ID[symbol];
    return id ? this.latestData.get(id) : undefined;
  }

  getAllLatest(): Map<number, TickData> {
    return this.latestData;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn("[MarketWS] Connection error:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[MarketWS] Connected to proxy WebSocket");
      this._connected = true;
      this.reconnectDelay = 1000;
      this.notifyProxyStatus(true);

      if (!this.credentialsSent) {
        this.sendCredentials();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data: TickData = JSON.parse(event.data);

        if (data.type === "status") {
          this._upstoxConnected = data.connected || false;
          this.notifyFeedStatus(this._upstoxConnected);
          return;
        }

        const securityId = Number(data.securityId);
        if (!Number.isFinite(securityId)) return;

        const existing = this.latestData.get(securityId) || ({} as TickData);
        const merged = { ...existing, ...data, securityId, timestamp: Date.now() };
        this.latestData.set(securityId, merged);

        const listeners = this.tickListeners.get(securityId);
        if (listeners) {
          listeners.forEach((cb) => cb(merged));
        }

        this.globalListeners.forEach((cb) => cb(merged));
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this._upstoxConnected = false;
      this.notifyProxyStatus(false);
      this.notifyFeedStatus(false);

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this._connected = false;
    };
  }

  sendCredentials(): void {
    const broker = getActiveBroker();
    if (broker?.brokerId === "upstox" && broker.values.accessToken) {
      this.send({
        type: "configure",
        accessToken: broker.values.accessToken,
      });
      this.credentialsSent = true;
      console.log("[MarketWS] Sent Upstox credentials to proxy");
    }
  }

  subscribe(securityId: number, callback: TickListener): () => void {
    if (!this.tickListeners.has(securityId)) {
      this.tickListeners.set(securityId, new Set());
    }
    this.tickListeners.get(securityId)!.add(callback);

    const cached = this.latestData.get(securityId);
    if (cached) {
      setTimeout(() => callback(cached), 0);
    }

    return () => {
      this.tickListeners.get(securityId)?.delete(callback);
    };
  }

  subscribeAll(callback: TickListener): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /** Upstox LTP feed active on proxy (historical dashboard “live” flag). */
  onStatus(callback: StatusListener): () => void {
    return this.onFeedStatus(callback);
  }

  onProxyStatus(callback: StatusListener): () => void {
    this.proxyStatusListeners.add(callback);
    setTimeout(() => callback(this._connected), 0);
    return () => {
      this.proxyStatusListeners.delete(callback);
    };
  }

  onFeedStatus(callback: StatusListener): () => void {
    this.feedStatusListeners.add(callback);
    setTimeout(() => callback(this._upstoxConnected), 0);
    return () => {
      this.feedStatusListeners.delete(callback);
    };
  }

  isTickFresh(securityId: number, maxAgeMs = TICK_STALE_MS): boolean {
    const tick = this.latestData.get(securityId);
    if (!tick?.ltp || tick.ltp <= 0 || !tick.timestamp) return false;
    return Date.now() - tick.timestamp < maxAgeMs;
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._upstoxConnected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
    this.reconnectTimer = setTimeout(() => {
      console.log("[MarketWS] Reconnecting...");
      this.connect();
    }, this.reconnectDelay);
  }

  private notifyProxyStatus(connected: boolean): void {
    this.proxyStatusListeners.forEach((cb) => cb(connected));
  }

  private notifyFeedStatus(connected: boolean): void {
    this.feedStatusListeners.forEach((cb) => cb(connected));
  }
}

export const marketWS = new MarketWebSocket();

if (typeof window !== "undefined") {
  setTimeout(() => marketWS.connect(), 500);
}
