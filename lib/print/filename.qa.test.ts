// QA (R2-D2) — edge case เพิ่มเติมของชื่อไฟล์ PDF ที่เทสต์เดิมยังไม่ครอบ
// ที่มาของ fixture: รูปแบบข้อมูลจริงจาก DB (timestamptz แบบ Postgres ที่มีไมโครวินาที + offset, ชื่อบริษัทไทยยาว, ชื่อว่าง/null) — ไม่มีชื่อลูกค้าจริงในไฟล์นี้
import { describe, expect, it } from "vitest";
import { bkkDateISO, bkkYYMMDD, printFileTitle, sanitizeFileTitlePart } from "@/lib/print/filename";
import { invoicePrintTitle, quotePrintTitle, receiptPrintTitle } from "@/lib/oem/print-title";
import { jobPrintTitle } from "@/lib/jobs/print-title";

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

describe("bkkDateISO — รูปแบบ timestamp ที่ Postgres/PostgREST ส่งจริง", () => {
  it("ไมโครวินาที + offset +00:00 (ตรงกับ created_at ที่ DB คืน) · ใบสร้าง 19:22Z = วันถัดไปของไทย", () => {
    expect(bkkDateISO("2026-08-25T19:22:51.249109+00:00")).toBe("2026-08-26");
    expect(bkkDateISO("2026-10-19T19:32:44.443174+00:00")).toBe("2026-10-20");
  });
  it("ไมโครวินาที + offset สั้น +00 / เว้นวรรคแทน T", () => {
    expect(bkkDateISO("2026-08-25 19:22:51.249109+00")).toBe("2026-08-26");
  });
  it("offset +07:00 / +07 / +0700 ได้วันเดียวกัน · offset ลบ -05:00 อ่านถูก", () => {
    expect(bkkDateISO("2026-10-21T00:30:00+07:00")).toBe("2026-10-21");
    expect(bkkDateISO("2026-10-21T00:30:00+07")).toBe("2026-10-21");
    expect(bkkDateISO("2026-10-21T00:30:00+0700")).toBe("2026-10-21");
    // 2026-10-20T13:00-05:00 = 18:00Z = 01:00 ไทยวันที่ 21
    expect(bkkDateISO("2026-10-20T13:00:00-05:00")).toBe("2026-10-21");
  });
  it("z ตัวเล็ก · ปีอธิกสุรทิน 29 ก.พ.", () => {
    expect(bkkDateISO("2026-10-20T18:00:00z")).toBe("2026-10-21");
    expect(bkkDateISO("2028-02-29")).toBe("2028-02-29");
    expect(bkkDateISO("2027-02-29")).toBe("");
    expect(bkkDateISO("2028-02-29T17:00:00Z")).toBe("2028-03-01");
  });
  it("ขยะ: ตัวเลขล้วน / ข้อความ / เดือน 13 / วันที่ 00 / ปี 5 หลัก / ช่องว่างล้วน = '' ไม่ throw", () => {
    for (const bad of ["1761000000", "ไม่ใช่วันที่", "2026-13-01", "2026-00-10", "2026-10-00", "12026-10-21", "   ", "2026-10-21T25:00:00Z", "2026-10-21T"]) {
      expect(() => bkkDateISO(bad), bad).not.toThrow();
      expect(bkkDateISO(bad), bad).toBe("");
    }
  });
  it("Date ที่ invalid = ''", () => {
    expect(bkkDateISO(new Date("nope"))).toBe("");
    expect(bkkYYMMDD(new Date("nope"))).toBe("");
  });
});

describe("sanitizeFileTitlePart — ชื่อที่ลูกค้า/ช่างอาจพิมพ์จริง", () => {
  it("path traversal / ชื่อไฟล์ซ่อน / จุดล้วน ไม่เหลือ / หรือ . นำหน้า", () => {
    expect(sanitizeFileTitlePart("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeFileTitlePart("..")).toBe("");
    expect(sanitizeFileTitlePart(".hidden")).toBe("hidden");
    expect(sanitizeFileTitlePart("C:\\Windows\\System32")).toBe("C-Windows-System32");
  });
  it("ชื่อ Windows reserved (CON/NUL) ไม่เป็นปัญหาเพราะมีวันที่นำหน้า — ชื่อไฟล์เต็มไม่เคยเป็นคำเดียว", () => {
    expect(printFileTitle({ date: "261021", docNo: "OEM-2610-097", name: "CON" })).toBe("261021_OEM-2610-097_CON");
    expect(printFileTitle({ date: "261021", docNo: "CON" })).toBe("261021_CON");
  });
  it("ไทยหลายรูปแบบ: ชื่อบริษัท วงเล็บ มหาชน · บจก. · ตัวเลขไทย ผ่านครบ (ไม่ถูกตัดวงเล็บ/จุดกลาง)", () => {
    expect(sanitizeFileTitlePart("บริษัท เอ บี จำกัด (มหาชน)")).toBe("บริษัท-เอ-บี-จำกัด-(มหาชน)");
    expect(sanitizeFileTitlePart("บจก. ทดสอบ ๒")).toBe("บจก.-ทดสอบ-๒");
  });
  it("อีโมจิ + ช่องว่างซ้อน + ZWJ: ไม่มีตัวต้องห้าม ไม่ปล่อย - ซ้อน", () => {
    const s = sanitizeFileTitlePart("นาย  สมชาย \u200b ใจดี 😀🙏");
    expect(s).toBe("นาย-สมชาย-ใจดี-😀🙏");
    expect(s).not.toMatch(/--/);
  });
  it("ทุกจุดตัดที่ 1..60 ของสตริงไทยที่มี สระอำ/สระลอย/วรรณยุกต์ — ไม่ลงท้ายสระหน้า · ไม่ขึ้นต้นด้วย mark ลอย · ไม่ว่างหลังตัด", () => {
    const src = "สำนักงานใหญ่โรงแรมเกี๊ยวซ่าเปิ้ลไอศกรีมเสื้อโค้ทใหม่ๆ";
    for (let n = 1; n <= 60; n++) {
      const out = sanitizeFileTitlePart(src, n);
      expect(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(out)).length, `n=${n}`).toBeLessThanOrEqual(n);
      expect(out, `n=${n}`).not.toMatch(/[\u0E40-\u0E44]$/u);
      expect(out, `n=${n}`).not.toMatch(/^\p{M}/u);
      expect(out, `n=${n}`).not.toMatch(/[-_.\s]$/);
    }
  });
});

describe("printFileTitle — ส่วนประกอบเป็นขยะ/ผิดรูป", () => {
  it("date เลขเต็มความกว้าง / มีขีด / ยาวเกิน = ไม่ถูกใส่ (ASCII 6 หลักเท่านั้น)", () => {
    expect(printFileTitle({ date: "２６１０２１", docNo: "X" })).toBe("X");
    expect(printFileTitle({ date: "26-10-21", docNo: "X" })).toBe("X");
    expect(printFileTitle({ date: "2610210", docNo: "X" })).toBe("X");
  });
  it("docNo ยาวผิดปกติ (hostile) — วันที่ยังอยู่หน้า · รวมไม่เกิน 100 · ไม่มี _ ห้อยท้าย", () => {
    const t = printFileTitle({ date: "261021", docNo: "N".repeat(500), name: "ชื่อ" });
    expect(t.startsWith("261021_")).toBe(true);
    expect(Array.from(t).length).toBeLessThanOrEqual(100);
    expect(t).not.toMatch(/[_\-.\s]$/);
  });
  it("docNo มี _ ข้างใน คงไว้ (ไม่ใช่ตัวต้องห้าม)", () => {
    expect(printFileTitle({ date: "261021", docNo: "A_B", name: "x" })).toBe("261021_A_B_x");
  });
});

describe("OEM title — ชื่อผู้ซื้อ: fallback + ว่าง", () => {
  const base = { quoteNo: "OEM-2610-005", createdAt: "2026-10-09T05:57:05.407484+00:00" };
  it("billLegalName เป็นล่องหน/ช่องว่างล้วน → ใช้ customerName", () => {
    expect(quotePrintTitle({ ...base, billLegalName: " \u200b\u2800 ", customerName: "ลูกค้า ก" })).toBe("261009_OEM-2610-005_ลูกค้า-ก");
  });
  it("ทั้งสองชื่อ null / ว่าง / ล่องหน → เหลือแค่ วันที่_เลขที่ (ไม่มี _ ห้อย) — กรณีใบจริง OEM-2610-005 ที่ไม่มีชื่อลูกค้า", () => {
    expect(quotePrintTitle({ ...base, billLegalName: null, customerName: null })).toBe("261009_OEM-2610-005");
    expect(quotePrintTitle({ ...base, billLegalName: "", customerName: "\u200b" })).toBe("261009_OEM-2610-005");
  });
  it("createdAt เป็น null/ขยะ (ไม่ควรเกิด) = ตัดวันที่ ไม่เดาเป็นวันนี้", () => {
    expect(quotePrintTitle({ quoteNo: "OEM-1", createdAt: "garbage", billLegalName: "ก", customerName: null })).toBe("OEM-1_ก");
  });
  it("ใบเสร็จ/ใบแจ้งหนี้: issueDate เป็น date ล้วนไม่เลื่อนแม้เป็นช่วง 00:00-07:00 ไทย (ไม่ผ่านโซนเวลา)", () => {
    expect(invoicePrintTitle({ invoiceNo: "IV-2610-001", issueDate: "2026-10-16", buyerLegalName: "ก" })).toBe("261016_IV-2610-001_ก");
    expect(receiptPrintTitle({ receiptNo: "RT-2610-001", issueDate: "2026-10-01", buyerLegalName: "ก" })).toBe("261001_RT-2610-001_ก");
  });
  it("ผลลัพธ์ทุกกรณีไม่มีอักขระต้องห้ามของชื่อไฟล์", () => {
    const evil = 'ร้าน "A/B" <ทอง> : x* y? | \\ \u0000 \u202e';
    for (const t of [
      quotePrintTitle({ ...base, billLegalName: evil, customerName: evil }),
      invoicePrintTitle({ invoiceNo: 'IV/2610:1', issueDate: "2026-10-16", buyerLegalName: evil }),
      receiptPrintTitle({ receiptNo: "RT*1", issueDate: "2026-10-16", buyerLegalName: evil }),
      jobPrintTitle({ jobNo: "JB-1", createdAt: "2026-10-16T01:00:00Z", designLabel: evil, sku: null }),
    ]) {
      expect(t).not.toMatch(FORBIDDEN);
      expect(t).not.toMatch(/\u202e/);
    }
  });
});

describe("jobPrintTitle — ใบงานที่ designLabel เป็นขยะ", () => {
  it("designLabel ต้องห้ามล้วน + sku ใช้ได้ → ถอยไป SKU", () => {
    expect(jobPrintTitle({ jobNo: "JB-0040", createdAt: "2026-10-22T05:49:57.544081+00:00", designLabel: "///", sku: "RP1002" })).toBe("261022_JB-0040_RP1002");
  });
  it("ใบย่อยลำดับเป็นทศนิยม/ติดลบ/NaN = ถือเป็นใบแม่ (ไม่เกิด -ส่วน1.5)", () => {
    const j = { jobNo: "JB-0001", createdAt: "2026-10-22T05:49:57+00:00", designLabel: "ก", sku: null };
    for (const seq of [1.5, -1, Number.NaN, 0, null, undefined]) expect(jobPrintTitle(j, seq as never), String(seq)).toBe("261022_JB-0001_ก");
  });
});
