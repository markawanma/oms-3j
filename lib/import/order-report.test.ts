// lib/import/order-report.test.ts
//
// Unit tests for parseOrderReportXlsx (docs/3j-jewelry/analytics/phase-import-ui-design.md §5).
//
// Two groups:
// 1. Real-fixture regression test against "1-10 Aug sell report.xlsx" — the
//    proven CLI baseline (scripts/import-aug.mjs already imported this file:
//    334 rows / TikTok 245 / LINE 88 / Facebook 1). The file contains real
//    customer PII and must NEVER be committed to the repo — its path is read
//    from an env var (AUG_FIXTURE_PATH, falls back to the machine-local path
//    the file currently lives at) and the whole group is skipped (not
//    failed) when the file isn't present, e.g. in CI or on another machine.
// 2. Synthetic in-memory workbooks (built with XLSX.utils.aoa_to_sheet, never
//    touching disk) exercising shape validation (D1.5) — column swap, column
//    truncation, and a garbled date column all must block via shapeIssues.

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { ImportParseError, parseOrderReportXlsx, type ParsedOrderReport } from "./order-report";

// ============================================================================
// Group 1 — real Aug fixture (regression baseline)
// ============================================================================

const FIXTURE_PATH =
  process.env.AUG_FIXTURE_PATH ??
  "C:\\Users\\Markawan's NoteBook\\OneDrive\\Desktop\\Marketing\\3J sale data\\1-10 Aug sell report.xlsx";

const HAS_FIXTURE = existsSync(FIXTURE_PATH);
if (!HAS_FIXTURE) {
  // Loud, not silent — a green suite that quietly skipped the one test that
  // actually proves the TS port didn't drift from the CLI is worse than no
  // test at all.
  console.warn(
    `[order-report.test.ts] Aug fixture not found at "${FIXTURE_PATH}" — skipping regression test. ` +
      `Set AUG_FIXTURE_PATH to run it.`
  );
}

describe.skipIf(!HAS_FIXTURE)("parseOrderReportXlsx — Aug 2026 fixture (regression baseline)", () => {
  let parsed: ParsedOrderReport;

  beforeAll(() => {
    const buf = readFileSync(FIXTURE_PATH);
    parsed = parseOrderReportXlsx(buf);
  });

  it("parses with no shape issues (real file matches the expected header/date shape)", () => {
    expect(parsed.shapeIssues).toEqual([]);
  });

  it("parses exactly 334 order rows", () => {
    expect(parsed.rows.length).toBe(334);
    expect(parsed.rowCountParsed).toBe(334);
    expect(parsed.skippedRowNos.length).toBe(0);
  });

  it("channel breakdown matches TikTok 245 / LINE 88 / Facebook 1", () => {
    const byLabel = new Map(parsed.channelCounts.map((c) => [c.label, c.count]));
    expect(byLabel.get("TikTok")).toBe(245);
    expect(byLabel.get("LINE")).toBe(88);
    expect(byLabel.get("Facebook")).toBe(1);
    const total = parsed.channelCounts.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(334);
  });

  it("fileHash is a stable 64-char sha256 hex digest", () => {
    expect(parsed.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Optional, opt-in: proves the ported hash matches what the CLI already
  // wrote to stg_import_batch for this exact file (the strongest possible
  // "port didn't drift" evidence). Only runs when DB creds are exported in
  // the shell (same convention as supabase/tests/helpers/db.ts) — skipped
  // otherwise so this suite has no hard network/secrets dependency.
  const hasDbEnv = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  it.skipIf(!hasDbEnv)("fileHash matches the batch already recorded in analytics.stg_import_batch", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false },
    });
    const { data, error } = await db
      .schema("analytics")
      .from("stg_import_batch")
      .select("id, file_hash")
      .eq("file_hash", parsed.fileHash)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });
});

// ============================================================================
// Group 2 — shape validation (synthetic workbooks, no disk I/O)
// ============================================================================

const VALID_HEADER = [
  "เลขที่ออเดอร์",
  "ชื่อลูกค้า",
  "เบอร์โทร",
  "ช่องทางติดต่อ",
  "ชื่อที่แสดงในการติดต่อ",
  "ขนส่ง",
  "ค่าส่งลูกค้าจ่าย",
  "จังหวัด",
  "ธนาคาร",
  "เลขพัสดุ",
  "ค่าส่งร้านจ่าย",
  "หมายเหตุ",
  "ผู้สร้างออเดอร์",
  "วันที่สร้างออเดอร์",
  "วันที่ชำระเงิน",
  "วันที่พิมพ์",
  "Marketplace Order ID",
  "โค้ดส่วนลด",
  "ส่วนลดรวม",
  "จำนวนสินค้ารวม",
  "ยอดขาย",
  "กำไร",
  "แท็ก",
  "col23",
  "col24",
];

function validDataRow(orderNo: string, channel: string, dateText: string): unknown[] {
  const row: unknown[] = new Array(25).fill(null);
  row[0] = orderNo;
  row[1] = "ลูกค้าทดสอบ";
  row[2] = "0812345678";
  row[3] = channel;
  row[6] = 50;
  row[10] = 30;
  row[13] = dateText;
  row[18] = 0;
  row[19] = 1;
  row[20] = 500;
  return row;
}

function buildXlsxBuffer(header: unknown[], dataRows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseOrderReportXlsx — shape validation (D1.5)", () => {
  it("well-formed file: no shape issues, rows parsed", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      validDataRow("A001", "Tiktok", "01/08/2026 10:00"),
      validDataRow("A002", "line_oa", "02/08/2026 11:00"),
      validDataRow("A003", "facebook", "03/08/2026 12:00"),
    ]);
    const parsed = parseOrderReportXlsx(buf);
    expect(parsed.shapeIssues).toEqual([]);
    expect(parsed.rows.length).toBe(3);
  });

  it("swapped columns ([0] <-> [3]): header_mismatch at both indices, fails loud", () => {
    const swapped = [...VALID_HEADER];
    [swapped[0], swapped[3]] = [swapped[3], swapped[0]];
    const buf = buildXlsxBuffer(swapped, [validDataRow("A001", "Tiktok", "01/08/2026 10:00")]);
    const parsed = parseOrderReportXlsx(buf);
    const mismatchIdx = parsed.shapeIssues
      .filter((i): i is Extract<typeof i, { kind: "header_mismatch" }> => i.kind === "header_mismatch")
      .map((i) => i.colIndex);
    expect(mismatchIdx).toEqual(expect.arrayContaining([0, 3]));
  });

  it("truncated to 10 columns: column_count issue, blocks", () => {
    const truncatedHeader = VALID_HEADER.slice(0, 10);
    const truncatedRow = validDataRow("A001", "Tiktok", "01/08/2026 10:00").slice(0, 10);
    const buf = buildXlsxBuffer(truncatedHeader, [truncatedRow]);
    const parsed = parseOrderReportXlsx(buf);
    expect(parsed.shapeIssues.some((i) => i.kind === "column_count" && i.found === 10)).toBe(true);
  });

  it("garbled date column (all unparseable): date_column_unparseable issue", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      validDataRow("A001", "Tiktok", "not-a-date"),
      validDataRow("A002", "Tiktok", "also-not-a-date"),
      validDataRow("A003", "Tiktok", "2026/08/01"), // wrong separator/order, also unparseable
    ]);
    const parsed = parseOrderReportXlsx(buf);
    const issue = parsed.shapeIssues.find((i) => i.kind === "date_column_unparseable");
    expect(issue).toBeDefined();
    if (issue && issue.kind === "date_column_unparseable") {
      expect(issue.parsedPct).toBeLessThan(0.9);
    }
  });

  it("throws ImportParseError when the sheet has a header but no data rows", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, []);
    expect(() => parseOrderReportXlsx(buf)).toThrow(ImportParseError);
  });

  it("filters rows with no source_order_no and reports them as skipped", () => {
    const buf = buildXlsxBuffer(VALID_HEADER, [
      validDataRow("A001", "Tiktok", "01/08/2026 10:00"),
      validDataRow("", "Tiktok", "02/08/2026 10:00"), // blank order no -> skipped
    ]);
    const parsed = parseOrderReportXlsx(buf);
    expect(parsed.rows.length).toBe(1);
    expect(parsed.skippedRowNos).toEqual([2]);
  });
});
