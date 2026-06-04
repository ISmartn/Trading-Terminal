/** Format Indian market volume (shares / contracts). */
export function formatVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(1)} K`;
  return abs.toLocaleString("en-IN");
}

export function volumeStats(candles: { volume?: number }[]): {
  lastVolume: number;
  avgVolume: number;
  totalVolume: number;
} {
  const vols = candles.map((c) => c.volume ?? 0).filter((v) => v > 0);
  const lastVolume = candles.length ? candles[candles.length - 1].volume ?? 0 : 0;
  const window = candles.slice(-20).map((c) => c.volume ?? 0).filter((v) => v > 0);
  const avgVolume = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
  const totalVolume = vols.reduce((a, b) => a + b, 0);
  return { lastVolume, avgVolume, totalVolume };
}
