// lib/format.ts — THB currency + Asia/Bangkok time formatting helpers.
// Data is stored as timestamptz (UTC) per design §1/§7; always convert at
// display time, never store a display-local string.

const thbFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});

export function formatTHB(amount: number): string {
  return thbFormatter.format(amount);
}

const bangkokTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatBangkokTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return bangkokTimeFormatter.format(d);
}

const bangkokTimeOnlyFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatBangkokTimeOnly(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return bangkokTimeOnlyFormatter.format(d);
}
