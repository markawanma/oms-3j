// lib/import/order-report.ts — server-only Excel order-report parser.
//
// TS PORT of scripts/import-aug.mjs (the proven CLI baseline — Aug file:
// 334 rows / TikTok 245 / LINE 88 / Facebook 1). Per
// docs/3j-jewelry/analytics/phase-import-ui-design.md §3.1: COLUMN_MAP,
// parseThaiDateText, toNumberOrNull, toIntOrNull, toTextOrNull and the
// no-source_order_no filter are copied **semantics-for-semantics** — do NOT
// "improve" them here. The Aug fixture is the regression baseline; if this
// file's output ever diverges from the CLI's for that fixture, that is a bug
// in this file, not an improvement.
//
// New in this file (not in the CLI, design D1.5): shape validation, so a
// silently-reordered/truncated column set doesn't get trusted positionally
// (which would put money in the wrong field with no visible error).
import "server-only";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

// ============================================================================
// Contract (design §3.1)
// ============================================================================

export interface StgOrderInsertRow {
  source_row_no: number;
  raw: Record<string, unknown>;
  source_kind: "excel";
  source_order_no: string | null;
  marketplace_order_id: string | null;
  channel_raw: string | null;
  customer_name_raw: string | null;
  contact_display_name_raw: string | null;
  phone_raw: string | null;
  province_raw: string | null;
  carrier_raw: string | null;
  tracking_no: string | null;
  shipping_fee_customer: number | null;
  shipping_cost_shop: number | null;
  revenue: number | null;
  discount_total: number | null;
  discount_code: string | null;
  item_count_total: number | null;
  profit_raw: number | null;
  order_created_at: string | null;
  paid_at: string | null;
  printed_at: string | null;
  created_by_raw: string | null;
  note_raw: string | null;
  bank_raw: string | null;
  tags_raw: string | null;
}

export type ShapeIssue =
  | { kind: "column_count"; found: number }
  | { kind: "header_mismatch"; colIndex: number; expected: string; found: string }
  | { kind: "date_column_unparseable"; parsedPct: number };

export interface ParsedOrderReport {
  fileHash: string;
  rowCountParsed: number;
  rows: StgOrderInsertRow[];
  skippedRowNos: number[];
  shapeIssues: ShapeIssue[];
  dateWarningCount: number;
  channelCounts: { key: string; label: string; count: number }[];
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
}

/** Thrown only when the file can't be read at all (no sheet / no data rows) —
 * everything else (bad shape, unparseable dates) goes into `shapeIssues` so
 * the caller can show a fail-loud message instead of a stack trace. */
export class ImportParseError extends Error {}

// ============================================================================
// Ported verbatim from scripts/import-aug.mjs
// ============================================================================

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value: unknown): number | null {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function toTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Parses "dd/MM/yyyy HH:mm" (optionally "dd/MM/yyyy HH:mm:ss") explicitly —
 * deliberately NOT `new Date(str)` or any locale-based parse, which silently
 * swaps dd/MM for MM/dd on many locales/Node builds. Source dates are TEXT in
 * this format, not Excel date serials. Returns an ISO 8601 string (fixed
 * +07:00 — Thailand has no DST) or null.
 */
function parseThaiDateText(value: unknown): string | null {
  const s = toTextOrNull(value);
  if (s === null) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    console.warn(`  ! could not parse date "${s}" (expected dd/MM/yyyy HH:mm) — leaving null`);
    return null;
  }
  const [, ddStr, MMStr, yyyyStr, HHStr, mmStr, ssStr] = m;
  const dd = Number(ddStr);
  const MM = Number(MMStr);
  const yyyy = Number(yyyyStr);
  const HH = Number(HHStr);
  const mm = Number(mmStr);
  const ss = ssStr ? Number(ssStr) : 0;

  if (MM < 1 || MM > 12 || dd < 1 || dd > 31 || HH > 23 || mm > 59 || ss > 59) {
    console.warn(`  ! date "${s}" out of range after dd/MM/yyyy parse — leaving null`);
    return null;
  }

  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${yyyy}-${pad(MM)}-${pad(dd)}T${pad(HH)}:${pad(mm)}:${pad(ss)}+07:00`;
}

/** Field mapping — task brief, 25-column report (columns 24/25 unmapped,
 * still captured verbatim in `raw`). 0-based column index -> staging field.
 * Kept for documentation/traceability parity with the CLI (which also never
 * programmatically iterates this — mapRow()/buildRow() below hardcodes the
 * same indices directly, matching CLI behavior 1:1). */
export const ORDER_REPORT_COLUMN_MAP: Record<number, string> = {
  0: "source_order_no",
  1: "customer_name_raw",
  2: "phone_raw",
  3: "channel_raw",
  4: "contact_display_name_raw",
  5: "carrier_raw",
  6: "shipping_fee_customer",
  7: "province_raw",
  8: "bank_raw",
  9: "tracking_no",
  10: "shipping_cost_shop",
  11: "note_raw",
  12: "created_by_raw",
  13: "order_created_at",
  14: "paid_at",
  15: "printed_at",
  16: "marketplace_order_id",
  17: "discount_code",
  18: "discount_total",
  19: "item_count_total",
  20: "revenue",
  21: "profit_raw",
  22: "tags_raw",
};

function buildRow(headerRow: unknown[], cells: unknown[], rowNo: number): StgOrderInsertRow {
  const raw: Record<string, unknown> = {};
  headerRow.forEach((h, i) => {
    const key = toTextOrNull(h) ?? `col_${i + 1}`;
    raw[key] = cells[i] ?? null;
  });

  const field = (i: number): unknown => cells[i];

  return {
    source_row_no: rowNo,
    raw,
    source_kind: "excel",
    source_order_no: toTextOrNull(field(0)),
    marketplace_order_id: toTextOrNull(field(16)),
    channel_raw: toTextOrNull(field(3)),
    customer_name_raw: toTextOrNull(field(1)),
    contact_display_name_raw: toTextOrNull(field(4)),
    phone_raw: toTextOrNull(field(2)),
    province_raw: toTextOrNull(field(7)),
    carrier_raw: toTextOrNull(field(5)),
    tracking_no: toTextOrNull(field(9)),
    shipping_fee_customer: toNumberOrNull(field(6)),
    shipping_cost_shop: toNumberOrNull(field(10)),
    revenue: toNumberOrNull(field(20)),
    discount_total: toNumberOrNull(field(18)),
    discount_code: toTextOrNull(field(17)),
    item_count_total: toIntOrNull(field(19)),
    profit_raw: toNumberOrNull(field(21)),
    order_created_at: parseThaiDateText(field(13)),
    paid_at: parseThaiDateText(field(14)),
    printed_at: parseThaiDateText(field(15)),
    created_by_raw: toTextOrNull(field(12)),
    note_raw: toTextOrNull(field(11)),
    bank_raw: toTextOrNull(field(8)),
    tags_raw: toTextOrNull(field(22)),
  };
}

// ============================================================================
// NEW: shape validation (design D1.5) — must run BEFORE anything downstream
// trusts positional indices. Never throws; issues accumulate into
// ParsedOrderReport.shapeIssues so preview/commit can fail loud with a
// specific reason instead of silently mis-mapping columns.
// ============================================================================

function checkHeaderAnchor(
  headerRow: unknown[],
  colIndex: number,
  matcher: (cell: string) => boolean,
  expected: string,
  issues: ShapeIssue[]
): void {
  const cell = toTextOrNull(headerRow[colIndex]) ?? "";
  if (!matcher(cell)) {
    issues.push({ kind: "header_mismatch", colIndex, expected, found: cell });
  }
}

function validateShape(headerRow: unknown[], dataRows: unknown[][]): ShapeIssue[] {
  const issues: ShapeIssue[] = [];

  const colCount = headerRow.length;
  if (colCount < 23 || colCount > 25) {
    issues.push({ kind: "column_count", found: colCount });
  }

  // 5 anchor columns — trim + contains (loose match, header text has known
  // casing/whitespace variance across months).
  checkHeaderAnchor(headerRow, 0, (c) => c.includes("เลขที่ออเดอร์"), "เลขที่ออเดอร์", issues);
  checkHeaderAnchor(headerRow, 3, (c) => c.includes("ช่องทาง"), "ช่องทาง", issues);
  checkHeaderAnchor(headerRow, 13, (c) => c.includes("วันที่สร้าง"), "วันที่สร้าง", issues);
  checkHeaderAnchor(
    headerRow,
    16,
    (c) => c.includes("Marketplace") || c.includes("เลขที่บน"),
    "Marketplace หรือ เลขที่บน",
    issues
  );
  checkHeaderAnchor(headerRow, 20, (c) => c.includes("ยอดขาย"), "ยอดขาย", issues);

  // Date sanity: column 13 must parse dd/MM/yyyy HH:mm for >=90% of the
  // non-empty cells, or the column has shifted / the format changed.
  const dateCells = dataRows.map((r) => r[13]).filter((v) => toTextOrNull(v) !== null);
  if (dateCells.length > 0) {
    const parsedCount = dateCells.filter((v) => parseThaiDateText(v) !== null).length;
    const parsedPct = parsedCount / dateCells.length;
    if (parsedPct < 0.9) {
      issues.push({ kind: "date_column_unparseable", parsedPct });
    }
  }

  return issues;
}

// ============================================================================
// NEW: channel normalization for display (design D2). Grouping happens on the
// normalized LABEL (not just lower/trim of the raw string) so casing *and*
// suffix variants (line / line_oa / LINE_OA) all roll up into one bucket —
// the value written to stg_order_import.channel_raw stays untouched (see
// buildRow() above — this function never mutates rows, only reads them).
// ============================================================================

const CHANNEL_LABEL_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /tiktok/, label: "TikTok" },
  { pattern: /line/, label: "LINE" },
  { pattern: /facebook|(^|[^a-z])fb([^a-z]|$)/, label: "Facebook" },
  { pattern: /shopee/, label: "Shopee" },
  { pattern: /lazada/, label: "Lazada" },
];

function normalizeChannelLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  for (const rule of CHANNEL_LABEL_RULES) {
    if (rule.pattern.test(key)) return rule.label;
  }
  return raw.trim();
}

function buildChannelCounts(rows: StgOrderInsertRow[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const label = row.channel_raw === null ? "ไม่ระบุ" : normalizeChannelLabel(row.channel_raw);
    const key = label.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return Array.from(counts.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// NEW: period derivation (design D3) — derived from order_created_at, never
// from the file name or a user-picked dropdown.
// ============================================================================

function derivePeriod(rows: StgOrderInsertRow[]): {
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
} {
  let minIso: string | null = null;
  let maxIso: string | null = null;
  const months = new Set<string>();

  for (const row of rows) {
    const iso = row.order_created_at;
    if (!iso) continue;
    months.add(iso.slice(0, 7)); // "YYYY-MM" — safe on the fixed +07:00 ISO string
    if (minIso === null || iso < minIso) minIso = iso;
    if (maxIso === null || iso > maxIso) maxIso = iso;
  }

  const sortedMonths = Array.from(months).sort();
  const periodHint =
    sortedMonths.length === 0
      ? null
      : sortedMonths.length === 1
        ? sortedMonths[0]
        : `${sortedMonths[0]}..${sortedMonths[sortedMonths.length - 1]}`;

  return { periodHint, periodMin: minIso, periodMax: maxIso, crossesMonth: sortedMonths.length > 1 };
}

// ============================================================================
// Public entry point
// ============================================================================

export function parseOrderReportXlsx(buf: Buffer): ParsedOrderReport {
  const fileHash = createHash("sha256").update(buf).digest("hex");

  const workbook = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ImportParseError("ไม่พบชีตในไฟล์ Excel — ตรวจว่าไฟล์ไม่เสียหายและเป็น .xlsx จริง");
  }
  const sheet = workbook.Sheets[sheetName];
  // header:1 -> array-of-arrays, raw:true -> keep native cell types (numbers
  // stay numbers; dates in this file are text cells, so they stay strings
  // and go through parseThaiDateText above).
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (allRows.length < 2) {
    throw new ImportParseError("ไฟล์นี้ไม่มีแถวข้อมูล — ต้องมีอย่างน้อยหัวตาราง + 1 แถวข้อมูล");
  }
  // Upper bound: .xlsx is a zip, so a small compressed file can decompress into
  // millions of rows (decompression bomb → OOM). A real monthly report is ~300–
  // 500 rows; cap well above that so legitimate files never trip it but a
  // malformed/hostile sheet is rejected before we map every row (security
  // audit #2). bodySizeLimit only bounds the *compressed* upload.
  const MAX_DATA_ROWS = 50_000;
  if (allRows.length - 1 > MAX_DATA_ROWS) {
    throw new ImportParseError(
      `ไฟล์มีจำนวนแถวมากผิดปกติ (${(allRows.length - 1).toLocaleString()} แถว เกินเพดาน ${MAX_DATA_ROWS.toLocaleString()}) — ตรวจว่าเป็นรายงานยอดขายรายเดือนจริง`
    );
  }
  const [headerRow, ...dataRows] = allRows;

  const shapeIssues = validateShape(headerRow, dataRows);

  let dateWarningCount = 0;
  const mapped: StgOrderInsertRow[] = dataRows.map((cells, idx) => {
    const row = buildRow(headerRow, cells, idx + 1);
    // dateWarningCount tracks order_created_at specifically (the column the
    // shape/date-sanity check above cares about) — a cell that had *some*
    // text but failed to parse, as opposed to a genuinely blank cell.
    if (toTextOrNull(cells[13]) !== null && row.order_created_at === null) dateWarningCount += 1;
    return row;
  });

  const skippedRowNos: number[] = [];
  const rows = mapped.filter((row) => {
    if (!row.source_order_no) {
      skippedRowNos.push(row.source_row_no);
      return false;
    }
    return true;
  });

  const channelCounts = buildChannelCounts(rows);
  const { periodHint, periodMin, periodMax, crossesMonth } = derivePeriod(rows);

  return {
    fileHash,
    rowCountParsed: dataRows.length,
    rows,
    skippedRowNos,
    shapeIssues,
    dateWarningCount,
    channelCounts,
    periodHint,
    periodMin,
    periodMax,
    crossesMonth,
  };
}
