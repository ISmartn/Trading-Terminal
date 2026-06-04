/**
 * Web Push — OS notifications on phone when the browser tab is closed.
 * Requires HTTPS (or localhost), service worker, and VAPID keys on the proxy.
 */

import { PROXY_BASE } from "@/lib/proxyConfig";

export interface PushStatus {
  configured: boolean;
  pywebpushInstalled: boolean;
  publicKey: string | null;
  subscriptionCount: number;
  claimsSub?: string | null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function fetchPushStatus(): Promise<PushStatus | null> {
  try {
    const res = await fetch(`${PROXY_BASE}/api/push/status`);
    if (!res.ok) return null;
    return (await res.json()) as PushStatus;
  } catch {
    return null;
  }
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function subscribeMobilePush(): Promise<{ ok: boolean; error?: string }> {
  if (!isWebPushSupported()) {
    return { ok: false, error: "Web Push is not supported in this browser." };
  }

  const status = await fetchPushStatus();
  if (!status?.configured || !status.publicKey) {
    return {
      ok: false,
      error: "Server Web Push is not configured. Add VAPID keys to proxy .env and restart.",
    };
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return { ok: false, error: "Notification permission denied." };
  }

  const reg = await registerServiceWorker();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey),
    });
  }

  const json = sub.toJSON();
  const res = await fetch(`${PROXY_BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as { error?: string }).error || res.statusText };
  }
  return { ok: true };
}

export async function unsubscribeMobilePush(): Promise<void> {
  if (!isWebPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await fetch(`${PROXY_BASE}/api/push/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    }
  } catch {
    /* ignore */
  }
}

export async function sendTestMobilePush(): Promise<{ sent: number; error?: string }> {
  try {
    const res = await fetch(`${PROXY_BASE}/api/push/test`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) return { sent: 0, error: (data as { error?: string }).error || res.statusText };
    return { sent: (data as { sent?: number }).sent ?? 0 };
  } catch (e) {
    return { sent: 0, error: String(e) };
  }
}
