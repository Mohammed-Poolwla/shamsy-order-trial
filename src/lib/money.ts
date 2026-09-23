/** Money & discount rules — integers only (USD cents, SDG pounds, rate as integer). */

export const MIN_EXCHANGE_RATE_FALLBACK = 8000;

/** Basis points: 100 bps = 1%. */
export function discountBps(discountCents: number, lineValueCents: number): number {
  if (lineValueCents <= 0) return 0;
  return Math.floor((discountCents * 10000) / lineValueCents);
}

export type DiscountBand = "none" | "sand" | "red" | "blocked";

/** Visual status after owner approval of a >5% line. */
export type LineDisplayBand = DiscountBand | "unblocked";

export function lineBand(bps: number): DiscountBand {
  if (bps === 0) return "none";
  if (bps <= 300) return "sand"; // >0% up to 3%
  if (bps <= 500) return "red"; // >3% up to 5%
  return "blocked"; // >5%
}

/** Band for UI: approved blocked lines show as unblocked (green). */
export function lineDisplayBand(
  bps: number,
  approval: "none" | "required" | "approved" = "none",
): LineDisplayBand {
  const band = lineBand(bps);
  if (band === "blocked" && approval === "approved") return "unblocked";
  return band;
}

export function lineDisplayLabel(band: LineDisplayBand): string {
  switch (band) {
    case "sand":
      return "Sand ≤3%";
    case "red":
      return "Red ≤5%";
    case "blocked":
      return "Blocked >5%";
    case "unblocked":
      return "Unblocked";
    default:
      return "No discount";
  }
}

export function formatUsdFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
}

export function formatSdg(pounds: number): string {
  return `${pounds.toLocaleString("en-US")} SDG`;
}

export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = (bps % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

/** Convert USD cents → SDG whole pounds at a locked rate. */
export function usdCentsToSdg(usdCents: number, rate: number): number {
  return Math.floor((usdCents * rate) / 100);
}

export function clampExchangeRate(rate: number, minRate: number): {
  rate: number;
  refused: boolean;
} {
  if (!Number.isFinite(rate) || rate < minRate) {
    return { rate: minRate, refused: true };
  }
  return { rate: Math.floor(rate), refused: false };
}

export type DraftLine = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
};

export function computeLine(line: DraftLine) {
  const lineValueCents = line.unitPriceCents * line.quantity;
  const discountCents = Math.max(0, Math.min(line.discountCents, lineValueCents));
  const lineTotalCents = lineValueCents - discountCents;
  const bps = discountBps(discountCents, lineValueCents);
  const band = lineBand(bps);
  return {
    lineValueCents,
    discountCents,
    lineTotalCents,
    bps,
    band,
    needsApproval: band === "blocked",
  };
}

export function computeOrderTotals(lines: DraftLine[], exchangeRate: number) {
  const computed = lines.map(computeLine);
  const totalUsdCents = computed.reduce((s, l) => s + l.lineTotalCents, 0);
  const totalSdg = usdCentsToSdg(totalUsdCents, exchangeRate);
  const hasBlocked = computed.some((l) => l.band === "blocked");
  return { computed, totalUsdCents, totalSdg, hasBlocked };
}
