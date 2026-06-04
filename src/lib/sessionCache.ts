/** sessionStorage helpers — survive page reload within the same tab session. */

const PREFIX = "mrchartist:";

export interface SessionCacheEntry<T> {
  data: T;
  savedAt: number;
}

export function getSessionJSON<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCacheEntry<T>;
    if (!parsed?.data || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > maxAgeMs) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function setSessionJSON<T>(key: string, data: T): void {
  try {
    const entry: SessionCacheEntry<T> = { data, savedAt: Date.now() };
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // quota exceeded — ignore
  }
}

export function clearSessionKey(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
