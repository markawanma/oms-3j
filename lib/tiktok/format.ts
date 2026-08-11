// lib/tiktok/format.ts — display formatting shared by the TikTok Ops "sales"
// module (KPI cards, charts, scope note). Kept separate from lib/format.ts
// (formatTHB there always shows 2 decimals for order amounts — the sales
// module wants compact whole-baht figures for KPI/chart labels, per the
// mockup's sK()/sN() helpers) rather than changing a shared OMS util.

import type { ChannelCode } from "@/lib/types";

/** "฿12,480" — whole baht, no decimals (KPI cards / chart bar labels). */
export function formatTHBCompact(amount: number): string {
  return `฿${Math.round(amount).toLocaleString("en-US")}`;
}

/** "12,480" — plain thousands-separated integer (order counts). */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "1.2M" / "480k" / "320" — abbreviated, for chart axis ticks where full
 * numbers would collide. Mirrors the mockup's sK(). */
export function formatAbbrev(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

const THAI_MONTH_ABBR = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-03" -> "มี.ค. 2026", "2026-03-14" -> "14 มี.ค. 2026" — period bucket
 * key (as returned by SalesPeriodPoint.period) to a short Thai label. */
export function formatPeriodLabel(period: string, granularity: "day" | "month"): string {
  if (granularity === "month") {
    const [y, m] = period.split("-");
    const idx = Number(m) - 1;
    return THAI_MONTH_ABBR[idx] ? `${THAI_MONTH_ABBR[idx]} ${y}` : period;
  }
  const [, m, d] = period.split("-");
  const idx = Number(m) - 1;
  return `${Number(d)} ${THAI_MONTH_ABBR[idx] ?? m}`;
}

/** Short month-only label for chart x-axis ticks: "2026-03" -> "มี.ค." */
export function formatMonthShort(period: string): string {
  const [, m] = period.split("-");
  const idx = Number(m) - 1;
  return THAI_MONTH_ABBR[idx] ?? period;
}

// Marketplace-only per lib/tiktok/types.ts (no LINE — see tiktok-sales.ts
// module header). Labels mirror components/domain/ChannelBadge.tsx; colors
// are plain hex (not Tailwind classes) since they're used as raw SVG fill
// values, chosen to stay distinct from each other and from `primary` indigo.
export const CHANNEL_LABEL_TH: Record<ChannelCode, string> = {
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  lazada: "Lazada",
};

export const CHANNEL_COLOR_HEX: Record<ChannelCode, string> = {
  shopee: "#f97316", // orange-500 — matches ChannelBadge's "orange" tone
  tiktok: "#0f172a", // slate-900 — matches ChannelBadge's "black" tone
  lazada: "#4f46e5", // indigo-600 — matches ChannelBadge's "indigo" tone
};

// Bucket key derived in Asia/Bangkok local date (business day), not UTC —
// orders is stored as timestamptz/UTC (lib/format.ts header) but a TikTok
// live that runs past midnight UTC (07:00 Bangkok) must still land in the
// Bangkok calendar day the seller thinks of as "today". Shared by the sales
// server action (bucketing) and the sales page (default date-range
// boundaries) so both sides agree on what "today" means — see M1 review
// finding (timezone mismatch caused "today" totals to disappear before
// 07:00 Bangkok when the page defaulted `to` from UTC).
export function effectiveDateBangkok(iso: string): string {
  // en-CA locale formats as YYYY-MM-DD, which is what we want directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** "YYYY-MM-DD" -> "10 ส.ค. 2569" (Thai locale, Buddhist era) — same locale
 * convention as lib/format.ts's formatBangkokTime, date-only. */
export function formatThaiDateOnly(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}
