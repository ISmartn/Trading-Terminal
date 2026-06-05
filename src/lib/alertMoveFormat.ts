/** Shared price/volume formatting for move alerts (UI, toast, push). */

export function formatMovePoints(fromPrice: number, toPrice: number, decimals = 2): string {
  const pts = toPrice - fromPrice;
  const sign = pts >= 0 ? "+" : "";
  return `${sign}${pts.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })} pts`;
}

export function formatMovePct(movePct: number): string {
  const sign = movePct >= 0 ? "+" : "";
  return `${sign}${movePct.toFixed(2)}%`;
}

export function formatVolumeShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return Math.round(n).toLocaleString("en-IN");
}

export function formatVolumeMultiple(multiple: number | null | undefined): string {
  if (multiple == null || !Number.isFinite(multiple) || multiple <= 0) return "";
  return `${multiple.toFixed(2)}× avg`;
}

export interface MoveAlertSummaryInput {
  label: string;
  direction: "up" | "down";
  movePct: number;
  fromPrice: number;
  toPrice: number;
  window?: string;
  volumeSummary?: string | null;
}

export function buildMoveHeadline(input: MoveAlertSummaryInput): string {
  const dir = input.direction === "up" ? "UP" : "DOWN";
  const win = input.window ? ` (${input.window})` : "";
  const pts = formatMovePoints(input.fromPrice, input.toPrice);
  const pct = formatMovePct(input.movePct);
  const vol = input.volumeSummary ? ` · ${input.volumeSummary}` : "";
  return `${input.label} ${dir} ${pct} (${pts})${win}${vol}`;
}

export function buildMoveNotifyBody(input: MoveAlertSummaryInput & { extra?: string }): string {
  const pts = formatMovePoints(input.fromPrice, input.toPrice);
  const pct = formatMovePct(input.movePct);
  const parts = [
    `${input.fromPrice.toLocaleString("en-IN")} → ${input.toPrice.toLocaleString("en-IN")} (${pct}, ${pts})`,
  ];
  if (input.volumeSummary) parts.push(input.volumeSummary);
  if (input.extra) parts.push(input.extra);
  return parts.join(" · ");
}
