/**
 * Shared proxy URL configuration.
 * Works with either the Node.js (proxy-server.mjs) or Python (proxy_server) proxy.
 * Override via VITE_PROXY_URL in .env.
 *
 * In dev, defaults to same-origin (empty base) so Vite proxies /api, /health, /ws
 * to port 4002 — works with localhost or LAN IP on WSL.
 */
function defaultProxyBase(): string {
  if (import.meta.env.VITE_PROXY_URL) return import.meta.env.VITE_PROXY_URL;
  if (import.meta.env.DEV && typeof window !== "undefined") return window.location.origin;
  return "http://localhost:4002";
}

export const PROXY_BASE = defaultProxyBase().replace(/\/$/, "");

/** WebSocket URL derived from PROXY_BASE */
export function getProxyWebSocketUrl(): string {
  if (import.meta.env.DEV && typeof window !== "undefined" && !import.meta.env.VITE_PROXY_URL) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  if (PROXY_BASE.startsWith("https://")) {
    return PROXY_BASE.replace(/^https/, "wss") + "/ws";
  }
  return PROXY_BASE.replace(/^http/, "ws") + "/ws";
}

/** Human-readable proxy port for UI messages */
export function getProxyPortLabel(): string {
  if (import.meta.env.DEV && typeof window !== "undefined" && !import.meta.env.VITE_PROXY_URL) {
    return "4002";
  }
  try {
    return new URL(PROXY_BASE).port || "4002";
  } catch {
    return "4002";
  }
}
