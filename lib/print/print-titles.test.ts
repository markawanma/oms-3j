// ชื่อไฟล์ PDF ต่อหน้าพิมพ์ — ตัวอย่างจริงของแต่ละหน้า + ล็อกว่า "ไม่มีเงิน/ต้นทุน/ข้อมูลภายใน" เข้าชื่อไฟล์ได้
import { describe, expect, it } from "vitest";
import { jobPrintTitle, shopQrPrintTitle } from "@/lib/jobs/print-title";
import { invoicePrintTitle, quotePrintTitle, receiptPrintTitle } from "@/lib/oem/print-title";

const JOB = { jobNo: "JB-0034", createdAt: "2026-10-21T03:00:00+00:00", designLabel: "ต่างหู", sku: "ER-001" };

describe("ใบงาน A5 / ใบย่อย", () => {
  it("ใบแม่ = วันเปิดใบงาน + เลขใบ + ชื่อแบบ", () => {
    expect(jobPrintTitle(JOB)).toBe("261021_JB-0034_ต่างหู");
  });
  it("วันที่ = วันเปิดใบ (เวลาไทย) ไม่ใช่วันพิมพ์: เปิด 17:30Z (00:30 ไทยวันถัดไป) → 261022", () => {
    expect(jobPrintTitle({ ...JOB, createdAt: "2026-10-21T17:30:00+00:00" })).toBe("261022_JB-0034_ต่างหู");
  });
  it("ใบย่อย = เลขใบแม่-ส่วนN · วันเปิดใบแม่", () => {
    expect(jobPrintTitle(JOB, 2)).toBe("261021_JB-0034-ส่วน2_ต่างหู");
    expect(jobPrintTitle(JOB, 10)).toBe("261021_JB-0034-ส่วน10_ต่างหู");
  });
  it("lotSeq 0/null/ไม่ใช่จำนวนเต็ม = ใบแม่", () => {
    for (const s of [0, null, undefined, -1, 1.5, Number.NaN]) expect(jobPrintTitle(JOB, s)).toBe("261021_JB-0034_ต่างหู");
  });
  it("designLabel ว่าง → ใช้ SKU · ว่างทั้งคู่ → ตัดส่วนชื่อ (ไม่มี _ ห้อย)", () => {
    expect(jobPrintTitle({ ...JOB, designLabel: "" })).toBe("261021_JB-0034_ER-001");
    expect(jobPrintTitle({ ...JOB, designLabel: "   " })).toBe("261021_JB-0034_ER-001");
    expect(jobPrintTitle({ ...JOB, designLabel: "", sku: null })).toBe("261021_JB-0034");
    expect(jobPrintTitle({ ...JOB, designLabel: "", sku: "" })).toBe("261021_JB-0034");
    expect(jobPrintTitle({ ...JOB, designLabel: "?/\\", sku: "ER-001" })).toBe("261021_JB-0034_ER-001"); // ต้องห้ามล้วน = ว่างหลังทำความสะอาด → ถอยไป SKU
    expect(jobPrintTitle({ ...JOB, designLabel: "\u{200B}\u{2800}", sku: null })).toBe("261021_JB-0034");
  });
  it("ไม่มีวันเปิดใบ (createdAt null/อ่านไม่ได้) → ตัดส่วนวันที่ ไม่เดา/ไม่ใช้วันนี้", () => {
    expect(jobPrintTitle({ ...JOB, createdAt: null })).toBe("JB-0034_ต่างหู");
    expect(jobPrintTitle({ ...JOB, createdAt: "not-a-date" })).toBe("JB-0034_ต่างหู");
  });
  it("ชื่อแบบมีอักขระต้องห้าม/ยาว", () => {
    expect(jobPrintTitle({ ...JOB, designLabel: 'แหวน "Pinky" 1/2 นิ้ว' })).toBe("261021_JB-0034_แหวน-Pinky-12-นิ้ว");
    expect(jobPrintTitle({ ...JOB, designLabel: "ก".repeat(100) })).toBe(`261021_JB-0034_${"ก".repeat(40)}`);
  });
});

describe("โปสเตอร์ QR ร้าน", () => {
  it("วันที่ออก QR (เวลาไทย)", () => {
    expect(shopQrPrintTitle("2026-10-23T03:00:00+00:00")).toBe("261023_QR-ร้าน");
    expect(shopQrPrintTitle("2026-10-22T17:30:00Z")).toBe("261023_QR-ร้าน");
  });
  it("issuedAt อ่านไม่ได้ → ใช้ 'ตอนนี้' ตามเวลาไทย", () => {
    const now = new Date("2026-10-23T18:00:00Z"); // 01:00 ไทยวันที่ 24
    expect(shopQrPrintTitle(null, now)).toBe("261024_QR-ร้าน");
    expect(shopQrPrintTitle("", now)).toBe("261024_QR-ร้าน");
    expect(shopQrPrintTitle("garbage", now)).toBe("261024_QR-ร้าน");
  });
});

describe("OEM — ใบเสนอราคา / ใบแจ้งหนี้ / ใบเสร็จ", () => {
  it("ใบเสนอราคา: วันออกใบ + เลขที่จริง + ชื่อผู้ซื้อที่พิมพ์ (billLegalName ก่อน customerName)", () => {
    const q = { quoteNo: "QT-2610-007", createdAt: "2026-10-21T02:00:00+00:00", billLegalName: "บริษัท เอบีซี จำกัด", customerName: "คุณสมชาย" };
    expect(quotePrintTitle(q)).toBe("261021_QT-2610-007_บริษัท-เอบีซี-จำกัด");
    expect(quotePrintTitle({ ...q, billLegalName: null })).toBe("261021_QT-2610-007_คุณสมชาย");
    expect(quotePrintTitle({ ...q, billLegalName: "", customerName: null })).toBe("261021_QT-2610-007");
  });
  it("ใบแจ้งหนี้: issueDate (date ล้วน ไม่เลื่อนโซน) + invoiceNo + buyerLegalName", () => {
    expect(invoicePrintTitle({ invoiceNo: "INV-2610-003", issueDate: "2026-10-21", buyerLegalName: "ห้างหุ้นส่วน 3J / สาขา 1" })).toBe("261021_INV-2610-003_ห้างหุ้นส่วน-3J-สาขา-1");
  });
  it("ใบเสร็จ: issueDate (ไม่ใช่วันรับเงิน) + receiptNo + buyerLegalName", () => {
    const r = { receiptNo: "RT-2608-016", issueDate: "2026-10-21", buyerLegalName: "Acme Co., Ltd." };
    expect(receiptPrintTitle(r)).toBe("261021_RT-2608-016_Acme-Co.,-Ltd");
    expect(receiptPrintTitle({ ...r, buyerLegalName: "" })).toBe("261021_RT-2608-016");
  });
  it("ชื่อผู้ซื้อยาวมาก ตัดที่ 40 ตัวอักษร · รวมไม่เกิน 100", () => {
    const t = receiptPrintTitle({ receiptNo: "RT-2608-016", issueDate: "2026-10-21", buyerLegalName: "บริษัท ".concat("ก".repeat(300)) });
    expect(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)).length).toBeLessThanOrEqual(100);
    expect(t.startsWith("261021_RT-2608-016_บริษัท-")).toBe(true);
  });
  it("🔴 รับได้เฉพาะ field เลข/วันที่/ชื่อ — ยอดเงิน/ต้นทุนที่แนบมาเกินชนิดก็ไม่เข้าชื่อไฟล์", () => {
    const sneaky = { receiptNo: "RT-1", issueDate: "2026-10-21", buyerLegalName: "ลูกค้า", amountThb: 123456.78, costPiece: 999.99, marginActualPct: 31.5 };
    const t = receiptPrintTitle(sneaky);
    expect(t).toBe("261021_RT-1_ลูกค้า");
    expect(t).not.toMatch(/123456|999|31\.5/);
  });
});
