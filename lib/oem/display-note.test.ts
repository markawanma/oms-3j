// lib/oem/display-note.test.ts — 0169 M1/L1/L2: เหตุผลอนุมัติใช้ whitelist (oemNotePresent) + ตรวจรูปร่าง (approvalNoteIssue)
// ชุดเดียวกับ analytics.oem_note_present / oem_note_valid (verify-0169 N0a-N0e) · อักขระพิเศษสร้างด้วย String.fromCodePoint ไม่พิมพ์ตรงๆ
import { describe, expect, it } from "vitest";
import { OEM_APPROVAL_GATE_LABEL_TH, approvalNoteIssue, oemNotePresent } from "./display";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const FAMILY = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

describe("oemNotePresent — whitelist: ต้องมีตัวอักษร/ตัวเลขจริง", () => {
  it.each([
    ["ไทย", "ลูกค้าประจำ"],
    ["อังกฤษ", "approved by owner"],
    ["เลขล้วน", "123"],
    ["ตัวอักษรเดียว", "ก"],
    ["ๆ (ตัวย้ำ)", "ๆ"],
    ["มีช่องว่างหัวท้าย", "  อนุมัติ  "],
    ["ข้อความ + อีโมจิครอบครัว (ZWJ)", "ok " + FAMILY],
    ["หลายบรรทัด", "บรรทัด1" + cp(10) + "บรรทัด2"],
    ["ข้อความ + 👍", "approved " + cp(0x1f44d)],
  ])("ผ่าน: %s", (_n, v) => expect(oemNotePresent(v)).toBe(true));

  it.each([
    ["ว่าง", ""],
    ["ช่องว่าง", "   "],
    ["tab/ขึ้นบรรทัดใหม่", cp(9, 10, 13)],
    ["NBSP / ideographic space", cp(0xa0, 0x3000)],
    ["NEL (U+0085)", cp(0x85)],
    ["control (C0)", cp(1, 7)],
    ["Braille blank (U+2800)", cp(0x2800)],
    ["VS16", cp(0xfe0f)],
    ["tag char (U+E0061)", cp(0xe0061)],
    ["จุด", "."],
    ["เครื่องหมายล้วน", "!!! --- ***"],
    ["👍 ล้วน", cp(0x1f44d)],
    ["ล่องหนล้วน (U+2060 U+FEFF)", cp(0x2060, 0xfeff)],
    ["bidi override ล้วน", cp(0x202e)],
  ])("ไม่ผ่าน: %s", (_n, v) => expect(oemNotePresent(v)).toBe(false));

  it("ไม่ใช่ string → false (ไม่ throw)", () => {
    expect(oemNotePresent(null)).toBe(false);
    expect(oemNotePresent(undefined)).toBe(false);
    expect(oemNotePresent(123)).toBe(false);
  });
});

describe("approvalNoteIssue — L2 รูปร่างเหตุผล", () => {
  it("null / undefined / ข้อความปกติ / 500 ตัวพอดี / อีโมจิ ZWJ / หลายบรรทัด+tab → ผ่าน (null)", () => {
    expect(approvalNoteIssue(null)).toBeNull();
    expect(approvalNoteIssue(undefined)).toBeNull();
    expect(approvalNoteIssue("เหตุผลปกติ 123")).toBeNull();
    expect(approvalNoteIssue("ก".repeat(500))).toBeNull();
    expect(approvalNoteIssue("ok " + FAMILY)).toBeNull();
    expect(approvalNoteIssue("บรรทัด1" + cp(10, 9) + "บรรทัด2" + cp(13))).toBeNull();
  });

  it.each([
    ["bidi override นำหน้า", cp(0x202e) + "ok"],
    ["control char (BEL)", cp(7) + "ok"],
    ["C1 (NEL)", cp(0x85) + "ok"],
    ["zero-width space", cp(0x200b) + "ok"],
    ["ZWJ ท้ายข้อความ (ไม่ได้คั่นอีโมจิ)", "ok" + cp(0x200d)],
    ["isolate", cp(0x2068) + "ok"],
    ["ยาว 501", "ก".repeat(501)],
  ])("ไม่ผ่าน: %s → มีข้อความ", (_n, v) => expect(approvalNoteIssue(v)).toBeTruthy());

  it("ไม่ใช่ string → ข้อความ (ไม่ throw) · ใช้ label ที่ส่งมา", () => {
    expect(approvalNoteIssue(5)).toContain("ต้องเป็นข้อความ");
    expect(approvalNoteIssue(cp(7), "เหตุผล")).toContain("เหตุผล");
  });
});

describe("OEM_APPROVAL_GATE_LABEL_TH", () => {
  it("มีป้ายครบ 6 ด่านอ่อนที่ DB บันทึก (0171 เพิ่ม override_below_hard_floor)", () => {
    for (const g of ["moq", "metal_lot", "margin_note_tier", "manual_cost", "override_below_floor", "override_below_hard_floor"]) {
      expect(OEM_APPROVAL_GATE_LABEL_TH[g]).toBeTruthy();
    }
  });
});
