// lib/crm/import-client.ts — small client-side helpers for the order-report
// import flow (docs/3j-jewelry/analytics/phase-import-ui-design.md §3.3).
// No "server-only" here on purpose: OrderImportClient.tsx imports this
// directly, so it must be safe to ship in the client bundle (formatting +
// pure client-side file guards only, no secrets/DB access).

import { formatPeriodLabel } from "@/lib/tiktok/format";

export const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024; // 4MB — mirrors next.config.mjs serverActions.bodySizeLimit (D1)

/** Client-side guard before a file ever leaves the browser (D1): reject
 * anything that isn't a .xlsx or is over the body-size-limit budget, with a
 * Thai message shown immediately instead of waiting on a round trip that
 * would fail server-side anyway. */
export function validateXlsxFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return "ต้องเป็นไฟล์ .xlsx เท่านั้น";
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return "ไฟล์ใหญ่เกิน 4MB";
  }
  return null;
}

/** "2026-08" -> "ส.ค. 2026", "2026-01..2026-02" -> "ม.ค. 2026 – ก.พ. 2026". */
export function formatPeriodHint(hint: string | null): string {
  if (!hint) return "-";
  if (hint.includes("..")) {
    const [a, b] = hint.split("..");
    return `${formatPeriodLabel(a, "month")} – ${formatPeriodLabel(b, "month")}`;
  }
  return formatPeriodLabel(hint, "month");
}

const dateOnlyFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return dateOnlyFormatter.format(d);
}

/** Formats an ISO date range for the preview card. Accepts either date-only
 * ("2026-08-01") or full timestamp ISO strings (order_created_at) — the
 * server contract (§3.2 ImportPreview) doesn't pin the exact shape, so this
 * parses with `new Date()` directly rather than assuming one or the other.
 * Pass `max: null` to format a single date. */
export function formatDateRange(min: string | null, max: string | null): string {
  const a = formatDateOnly(min);
  const b = formatDateOnly(max);
  if (!a && !b) return "ไม่ทราบช่วงวันที่";
  if (!b || a === b) return a ?? "-";
  return `${a} – ${b}`;
}
