// lib/import/order-line-report.ts — server-only Shipnity line-item report
// (Excel, "สินค้าในออเดอร์") parser.
//
// Design: docs/3j-jewelry/analytics/phase-lineitem-import-design.md §5.
// Ported pattern from lib/import/order-report.ts (reuses its
// toNumberOrNull/toIntOrNull/toTextOrNull/parseThaiDateText/ImportParseError —
// do NOT fork a second copy of those). Confirmed against all 8 real Shipnity
// files (Jan–Aug 2026): every file is exactly 20 columns with an identical
// header row, so the shape check below is strict equality (== 20), unlike
// order-report.ts's 23–25 range for the order-level report.
//
// 20-column positional map (design §5):
//   [0] sku_raw            [1] product_name_raw   [2] unit_price
//   [3] qty                [4] source_order_no     [5..19] captured verbatim
//   in `raw` only (order revenue, shipping, address, carrier, bank, dates —
//   none of it typed here; the staging table (0041) only has typed columns
//   for [0]-[4], everything else rides in `raw` jsonb for audit).
import "server-only";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { toNumberOrNull, toIntOrNull, toTextOrNull, parseThaiDateText, ImportParseError } from "./order-report";

export { ImportParseError };

// ============================================================================
// Contract (design §5 / §2.1 stg_order_line_import)
// ============================================================================

export interface StgOrderLineInsertRow {
  source_row_no: number;
  raw: Record<string, unknown>;
  source_order_no: string | null;
  /** Running index within this file, scoped per source_order_no — assigned
   * here (not by the DB) so it's stable across re-imports of the same file
   * and gives the (shop_id, source_order_no, line_no) unique key its
   * idempotency (design §2.1/§7 decision 5). Rows are NOT necessarily
   * contiguous per order in the source file (confirmed against the real Jun
   * 2026 fixture: 26 interleaved order groups), so this is a running counter
   * keyed by source_order_no across the whole file, not "index within a
   * contiguous run". */
  line_no: number;
  sku_raw: string | null;
  product_name_raw: string | null;
  unit_price: number | null;
  qty: number | null;
  /** Raw, unnormalized text of the SKU cell (column 0) — preserves stray
   * Thai marks / invisible Unicode characters that toTextOrNull() (used for
   * sku_raw above) strips via its nbsp/whitespace-collapse + trim (design:
   * SKU-hygiene preview check). ONLY for hygiene analysis at preview time —
   * must NEVER reach the DB. See lib/actions/import-line-items.ts's
   * payloadRows, which lists staging-table fields explicitly and does not
   * include this one; do not add it there. */
  sku_cell_text: string | null;
}

export type LineReportShapeIssue =
  | { kind: "column_count"; found: number }
  | { kind: "header_mismatch"; colIndex: number; expected: string; found: string }
  | { kind: "date_column_unparseable"; parsedPct: number };

export interface ParsedLineReport {
  fileHash: string;
  rowCountParsed: number;
  rows: StgOrderLineInsertRow[];
  shapeIssues: LineReportShapeIssue[];
  dateWarningCount: number;
  /** distinct non-null source_order_no across the file (preview rollup, design §5). */
  distinctOrders: number;
  /** rows where sku_raw is null — adjustment/shipping lines, not real SKUs (design §7 decision 4). */
  blankSkuCount: number;
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
}

// ============================================================================
// Shape validation (design §5: col count = 20 + 4 header anchors) — must run
// BEFORE anything downstream trusts positional indices, same fail-loud
// contract as order-report.ts's validateShape.
// ============================================================================

function checkHeaderAnchor(
  headerRow: unknown[],
  colIndex: number,
  matcher: (cell: string) => boolean,
  expected: string,
  issues: LineReportShapeIssue[]
): void {
  const cell = toTextOrNull(headerRow[colIndex]) ?? "";
  if (!matcher(cell)) {
    issues.push({ kind: "header_mismatch", colIndex, expected, found: cell });
  }
}

function validateShape(headerRow: unknown[], dataRows: unknown[][]): LineReportShapeIssue[] {
  const issues: LineReportShapeIssue[] = [];

  const colCount = headerRow.length;
  if (colCount !== 20) {
    issues.push({ kind: "column_count", found: colCount });
  }

  checkHeaderAnchor(headerRow, 0, (c) => c.includes("รหัสสินค้า"), "รหัสสินค้า", issues);
  checkHeaderAnchor(headerRow, 2, (c) => c.includes("ราคา"), "ราคา", issues);
  checkHeaderAnchor(headerRow, 3, (c) => c.includes("จำนวน"), "จำนวน", issues);
  checkHeaderAnchor(headerRow, 4, (c) => c.includes("เลขที่ออเดอร์"), "เลขที่ออเดอร์", issues);

  // Date sanity on col 19 ("วันที่สร้าง") — same >=90%-parseable rule as
  // order-report.ts, feeds periodHint below and catches a shifted column.
  const dateCells = dataRows.map((r) => r[19]).filter((v) => toTextOrNull(v) !== null);
  if (dateCells.length > 0) {
    const parsedCount = dateCells.filter((v) => parseThaiDateText(v) !== null).length;
    const parsedPct = parsedCount / dateCells.length;
    if (parsedPct < 0.9) {
      issues.push({ kind: "date_column_unparseable", parsedPct });
    }
  }

  return issues;
}

/** Coerces a raw cell value to text WITHOUT any of toTextOrNull's cleanup
 * (no &nbsp;/whitespace normalization, no trim) — the whole point is to keep
 * whatever stray characters the cell actually contains, for sku-hygiene
 * analysis. A non-string cell (e.g. Excel auto-typed the SKU column as a
 * number) is stringified as-is; that path never contains dirty characters,
 * so String() is safe here. */
function toRawCellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s === "" ? null : s;
}

function buildRaw(headerRow: unknown[], cells: unknown[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  headerRow.forEach((h, i) => {
    const key = toTextOrNull(h) ?? `col_${i + 1}`;
    raw[key] = cells[i] ?? null;
  });
  return raw;
}

function derivePeriod(dates: string[]): {
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
} {
  let minIso: string | null = null;
  let maxIso: string | null = null;
  const months = new Set<string>();

  for (const iso of dates) {
    months.add(iso.slice(0, 7));
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

export function parseOrderLineReportXlsx(buf: Buffer): ParsedLineReport {
  const fileHash = createHash("sha256").update(buf).digest("hex");

  const workbook = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ImportParseError("ไม่พบชีตในไฟล์ Excel — ตรวจว่าไฟล์ไม่เสียหายและเป็น .xlsx จริง");
  }
  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (allRows.length < 2) {
    throw new ImportParseError("ไฟล์นี้ไม่มีแถวข้อมูล — ต้องมีอย่างน้อยหัวตาราง + 1 แถวข้อมูล");
  }
  // Same decompression-bomb guard as order-report.ts — a real monthly line
  // report tops out around ~1,600 rows (June 2026: 1,628); cap well above
  // that.
  const MAX_DATA_ROWS = 50_000;
  if (allRows.length - 1 > MAX_DATA_ROWS) {
    throw new ImportParseError(
      `ไฟล์มีจำนวนแถวมากผิดปกติ (${(allRows.length - 1).toLocaleString()} แถว เกินเพดาน ${MAX_DATA_ROWS.toLocaleString()}) — ตรวจว่าเป็นรายงานสินค้าในออเดอร์จริง`
    );
  }
  const [headerRow, ...dataRows] = allRows;

  const shapeIssues = validateShape(headerRow, dataRows);

  let dateWarningCount = 0;
  const dates: string[] = [];
  // Running per-order line_no counter. Rows lacking source_order_no (design
  // §2.1: nullable — "blank-SKU/manual adjustment might not have one") never
  // collide on the (shop_id, source_order_no, line_no) unique key regardless
  // of their line_no value, since Postgres treats NULL as distinct from NULL
  // in a multi-column unique constraint — so each gets its own fresh counter
  // key rather than sharing one "null" bucket.
  const orderLineCounters = new Map<string, number>();
  let nullOrderRowSeq = 0;

  const rows: StgOrderLineInsertRow[] = dataRows.map((cells, idx) => {
    const rowNo = idx + 1;
    const raw = buildRaw(headerRow, cells);
    const sourceOrderNo = toTextOrNull(cells[4]);
    const skuRaw = toTextOrNull(cells[0]);
    const skuCellText = toRawCellText(cells[0]);
    const productNameRaw = toTextOrNull(cells[1]);
    const unitPrice = toNumberOrNull(cells[2]);
    const qty = toIntOrNull(cells[3]);

    const createdDateCell = cells[19];
    if (toTextOrNull(createdDateCell) !== null) {
      const iso = parseThaiDateText(createdDateCell);
      if (iso === null) dateWarningCount += 1;
      else dates.push(iso);
    }

    const counterKey = sourceOrderNo ?? `__null_${++nullOrderRowSeq}__`;
    const lineNo = (orderLineCounters.get(counterKey) ?? 0) + 1;
    orderLineCounters.set(counterKey, lineNo);

    return {
      source_row_no: rowNo,
      raw,
      source_order_no: sourceOrderNo,
      line_no: lineNo,
      sku_raw: skuRaw,
      sku_cell_text: skuCellText,
      product_name_raw: productNameRaw,
      unit_price: unitPrice,
      qty,
    };
  });

  const distinctOrders = new Set(rows.map((r) => r.source_order_no).filter((v): v is string => v !== null)).size;
  const blankSkuCount = rows.filter((r) => r.sku_raw === null).length;
  const { periodHint, periodMin, periodMax, crossesMonth } = derivePeriod(dates);

  return {
    fileHash,
    rowCountParsed: dataRows.length,
    rows,
    shapeIssues,
    dateWarningCount,
    distinctOrders,
    blankSkuCount,
    periodHint,
    periodMin,
    periodMax,
    crossesMonth,
  };
}
