#!/usr/bin/env node
/**
 * Wait for proxy /health, then start Vite (used by npm run dev / dev:python).
 * Avoids quoting issues with inline bash under concurrently.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HEALTH_URL = process.env.PROXY_HEALTH_URL || "http://127.0.0.1:4002/health";
const MAX_ATTEMPTS = 80;
const DELAY_MS = 250;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function proxyReady() {
  const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2500) });
  return res.ok;
}

for (let i = 0; i < MAX_ATTEMPTS; i++) {
  try {
    if (await proxyReady()) {
      const vite = spawn("npx", ["vite"], {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      vite.on("exit", (code, signal) => {
        process.exit(code ?? (signal ? 1 : 0));
      });
      process.on("SIGINT", () => vite.kill("SIGINT"));
      process.on("SIGTERM", () => vite.kill("SIGTERM"));
      break;
    }
  } catch {
    /* retry */
  }
  if (i === MAX_ATTEMPTS - 1) {
    console.error(`Proxy not ready at ${HEALTH_URL}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
