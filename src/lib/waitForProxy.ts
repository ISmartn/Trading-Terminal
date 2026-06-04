import { PROXY_BASE } from "@/lib/proxyConfig";

let readyPromise: Promise<boolean> | null = null;

/**
 * Block until /health responds (proxy on 4002, via Vite proxy in dev).
 * Avoids ECONNREFUSED when UI loads before `npm run dev:python` finishes binding.
 */
export async function waitForProxyReady(maxWaitMs = 30_000): Promise<boolean> {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${PROXY_BASE}/health`, {
          signal: AbortSignal.timeout(2500),
        });
        if (res.ok) return true;
      } catch {
        /* proxy still starting */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })();

  const ok = await readyPromise;
  if (!ok) readyPromise = null;
  return ok;
}

export function resetProxyReadyWait(): void {
  readyPromise = null;
}
