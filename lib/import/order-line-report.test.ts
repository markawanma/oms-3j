// lib/import/order-line-report.test.ts
//
// Unit tests for parseOrderLineReportXlsx (docs/3j-jewelry/analytics/phase-lineitem-import-design.md §5).
//
// Two groups, same shape as order-report.test.ts:
// 1. Real-fixture regression test against all 8 Shipnity "สินค้าในออเดอร์"
//    files (Jan–Aug 2026) — baseline confirmed by a one-off inspection script
//    against the raw files: 5,732 total data rows / 196 distinct SKU / 109
//    blank-SKU rows, all 8 files share the identical 20-column header. The
//    files contain real customer PII and must NEVER be committed to the
//    repo — the directory path is read from an env var (SHIPNITY_FIXTURE_DIR,
//    falls back to the machine-local path) and the whole group is skipped
//    (not failed) when the directory isn't present.
// 2. Synthetic in-memory workbooks exercising shape validation + the per-order
//    line_no counter (incl. interleaved order groups, matching what the real
//    June 2026 file does).

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { ImportParseError, parseOrderLineReportXlsx, type ParsedLineReport } from "./order-line-report";

// ============================================================================
// Group 1 — real Shipnity fixtures (regression baseline)
// ============================================================================

const FIXTURE_DIR =
  process.env.SHIPNITY_FIXTURE_DIR ??
  "C:\\Users\\Markawan's NoteBook\\OneDrive\\Desktop\\Marketing\\3J sale data\\Shipnity";

const HAS_FIXTURES = existsSync(FIXTURE_DIR);
if (!HAS_FIXTURES) {
  console.warn(
    `[order-line-report.test.ts] Shipnity fixture dir not found at "${FIXTURE_DIR}" — skipping regression test. ` +
      `Set SHIPNITY_FIXTURE_DIR to run it.`
  );
}

describe.skipIf(!HAS_FIXTURES)("parseOrderLineReportXlsx — Shipnity Jan-Aug 2026 fixtures (regression baseline)", () => {
  let parsedByFile: { file: string; parsed: ParsedLineReport }[];

  beforeAll(() => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.toLowerCase().endsWith(".xlsx"));
    parsedByFile = files.map((file) => {
      const buf = readFileSync(`${FIXTURE_DIR}\\${file}`);
      return { file, parsed: parseOrderLineReportXlsx(buf) };
    });
  });

  it("finds all 8 monthly files", () => {
    expect(parsedByFile.length).toBe(8);
  });

  it("every file parses with no shape issues (real files match the expected 20-col header)", () => {
    for (const { file, parsed } of parsedByFile) {
      expect(parsed.shapeIssues, `${file} had shape issues`).toEqual([]);
    }
  });

  it("totals exactly 5,732 line rows across all 8 files", () => {
    const total = parsedByFile.reduce((sum, { parsed }) => sum + parsed.rows.length, 0);
    expect(total).toBe(5732);
  });

  it("totals 196 distinct SKUs across all 8 files", () => {
    const skuSet = new Set<string>();
    for (const { parsed } of parsedByFile) {
      for (const row of parsed.rows) {
        if (row.sku_raw !== null) skuSet.add(row.sku_raw);
      }
    }
    expect(skuSet.size).toBe(196);
  });

  it("totals 109 blank-SKU rows across all 8 files", () => {
    const total = parsedByFile.reduce((sum, { parsed }) => sum + parsed.blankSkuCount, 0);
    expect(total).toBe(109);
  });

  it("line_no is a stable 1-based counter per source_order_no within each file", () => {
    for (const { file, parsed } of parsedByFile) {
      const perOrder = new Map<string, number[]>();
      for (const row of parsed.rows) {
        if (row.source_order_no === null) continue;
        const list = perOrder.get(row.source_order_no) ?? [];
        list.push(row.line_no);
        perOrder.set(row.source_order_no, list);
      }
      for (const [orderNo, lineNos] of perOrder) {
        const expected = Array.from({ length: lineNos.length }, (_, i) => i + 1);
        expect(lineNos, `${file} order ${orderNo}`).toEqual(expected);
      }
    }
  });

  it("fileHash is a stable 64-char sha256 hex digest per file", () => {
    for (const { parsed } of parsedByFile) {
      expect(parsed.fileHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// ============================================================================
// Group 2 — synthetic workbooks (no disk I/O)
// ============================================================================

const VALID_HEADER = [
  "รหัสสินค้า",
  "สินค้า",
  "ราคา",
  "จำนวน",
  "เลขที่ออเดอร์",
  "ยอดขายออเดอร์",
  "ค่าส่งที่เก็บลูกค้า",
  "ผู้ส่ง",
  "ชื่อ",
  "ที่อยู่",
  "รหัสไปรษณีย์",
  "เบอร์โทร",
  "วันที่โอนเงิน",
  "สร้างโดย",
  "ขนส่ง",
  "ช่องทางติดต่อ",
  "ธนาคารที่โอนเงิน",
  "หมายเหตุ",
  "เลขพัสดุ",
  "วันที่สร้าง",
];

function dataRow(sku: string | null, orderNo: string, price: number, qty: number, dateText: string | null): unknown[] {
  const row: unknown[] = new Array(20).fill(null);
  row[0] = sku;
  row[1] = sku ? `สินค้าทดสอบ ${sku}` : "ค่าจัดส่งเพิ่มเติม";
  row[2] = price;
  row[3] = qty;
  row[4] = orderNo;
  row[19] = dateText;
  return row;
}

function buildXlsxBuffer(header: unknown[], dataRows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseOrderLineReportXlsx — shape validation + line_no (design §5)", () => {
  it("well-formed file: no shape issues, rows parsed with typed fields", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      dataRow("NC01", "E001", 100, 1, "01/08/2026 10:00"),
      dataRow("NC02", "E002", 200, 2, "02/08/2026 11:00"),
    ]);
    const parsed = parseOrderLineReportXlsx(buf);
    expect(parsed.shapeIssues).toEqual([]);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0]).toMatchObject({
      source_order_no: "E001",
      sku_raw: "NC01",
      unit_price: 100,
      qty: 1,
      line_no: 1,
    });
    expect(parsed.distinctOrders).toBe(2);
  });

  it("interleaved order groups: line_no still counts correctly per order, not by adjacency", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      dataRow("A", "E100", 10, 1, "01/08/2026 10:00"),
      dataRow("B", "E200", 20, 1, "01/08/2026 10:00"),
      dataRow("C", "E100", 30, 1, "01/08/2026 10:00"), // back to E100, non-contiguous
      dataRow("D", "E100", 40, 1, "01/08/2026 10:00"),
    ]);
    const parsed = parseOrderLineReportXlsx(buf);
    const e100LineNos = parsed.rows.filter((r) => r.source_order_no === "E100").map((r) => r.line_no);
    expect(e100LineNos).toEqual([1, 2, 3]);
    const e200LineNos = parsed.rows.filter((r) => r.source_order_no === "E200").map((r) => r.line_no);
    expect(e200LineNos).toEqual([1]);
  });

  it("blank SKU rows counted but not filtered out (transform decides skip, not the parser)", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      dataRow("A", "E100", 10, 1, "01/08/2026 10:00"),
      dataRow(null, "E100", 40, 1, "01/08/2026 10:00"),
    ]);
    const parsed = parseOrderLineReportXlsx(buf);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.blankSkuCount).toBe(1);
  });

  it("swapped columns ([0] <-> [4]): header_mismatch at both indices, fails loud", () => {
    const swapped = [...VALID_HEADER];
    [swapped[0], swapped[4]] = [swapped[4], swapped[0]];
    const buf = buildXlsxBuffer(swapped, [dataRow("A", "E100", 10, 1, "01/08/2026 10:00")]);
    const parsed = parseOrderLineReportXlsx(buf);
    const mismatchIdx = parsed.shapeIssues
      .filter((i): i is Extract<typeof i, { kind: "header_mismatch" }> => i.kind === "header_mismatch")
      .map((i) => i.colIndex);
    expect(mismatchIdx).toEqual(expect.arrayContaining([0, 4]));
  });

  it("truncated to 10 columns: column_count issue, blocks", () => {
    const truncatedHeader = VALID_HEADER.slice(0, 10);
    const truncatedRow = dataRow("A", "E100", 10, 1, "01/08/2026 10:00").slice(0, 10);
    const buf = buildXlsxBuffer(truncatedHeader, [truncatedRow]);
    const parsed = parseOrderLineReportXlsx(buf);
    expect(parsed.shapeIssues.some((i) => i.kind === "column_count" && i.found === 10)).toBe(true);
  });

  it("garbled date column (all unparseable): date_column_unparseable issue", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      dataRow("A", "E100", 10, 1, "not-a-date"),
      dataRow("B", "E200", 20, 1, "also-not-a-date"),
      dataRow("C", "E300", 30, 1, "2026/08/01"),
    ]);
    const parsed = parseOrderLineReportXlsx(buf);
    const issue = parsed.shapeIssues.find((i) => i.kind === "date_column_unparseable");
    expect(issue).toBeDefined();
    if (issue && issue.kind === "date_column_unparseable") {
      expect(issue.parsedPct).toBeLessThan(0.9);
    }
  });

  it("throws ImportParseError when the sheet has a header but no data rows", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, []);
    expect(() => parseOrderLineReportXlsx(buf)).toThrow(ImportParseError);
  });

  it("rows with no source_order_no are kept (nullable per design §2.1), each gets its own line_no=1", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      dataRow("A", "", 10, 1, "01/08/2026 10:00"),
      dataRow("B", "", 20, 1, "01/08/2026 10:00"),
    ]);
    const parsed = parseOrderLineReportXlsx(buf);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows.every((r) => r.source_order_no === null && r.line_no === 1)).toBe(true);
    expect(parsed.distinctOrders).toBe(0);
  });
});
