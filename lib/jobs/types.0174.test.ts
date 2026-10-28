// 0174: แมปคอลัมน์ใหม่ + สรุป event น้ำหนักรับไม่ตรง (หน้า owner/admin เท่านั้น) + ห้าม <> ในชื่อ
import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, WORKER_LOCK_COLUMNS, mapBoardRow, mapLockRow, mapWorkerRow, summarizeEvent } from "./types";
import { parseLabel } from "./input";

describe("mapBoardRow / v_job_board.handoff_mismatch_count", () => {
  const base = { id: "i", job_no: "JB-1" };
  it("อ่านจำนวนครั้ง · ผิดชนิด/ไม่มี = 0 · เลือกคอลัมน์นี้ใน select", () => {
    expect(mapBoardRow({ ...base, handoff_mismatch_count: 2 })!.handoffMismatchCount).toBe(2);
    expect(mapBoardRow({ ...base, handoff_mismatch_count: "x" })!.handoffMismatchCount).toBe(0);
    expect(mapBoardRow(base)!.handoffMismatchCount).toBe(0);
    expect(BOARD_COLUMNS).toContain("handoff_mismatch_count");
  });
});

describe("v_worker_lock.pin_warning", () => {
  it("mapLockRow อ่าน pin_warning (เฉพาะ true จริง) · select มีคอลัมน์นี้ · ไม่มี pin_hash", () => {
    expect(mapLockRow({ worker_id: "w", lock_state: "none", failed_attempts: 4, in_window: true, pin_warning: true })).toMatchObject({ pinWarning: true, failedAttempts: 4 });
    expect(mapLockRow({ worker_id: "w", lock_state: "none", failed_attempts: 4, in_window: true, pin_warning: "true" })!.pinWarning).toBe(false);
    expect(WORKER_LOCK_COLUMNS).toContain("pin_warning");
    expect(WORKER_LOCK_COLUMNS).not.toMatch(/pin_hash/);
  });
  it("mapWorkerRow รับ pinWarning จาก lock · ไม่มี lock = false", () => {
    const r = { id: "i", display_name: "ช่างเอ" };
    expect(mapWorkerRow(r, { lockState: "none", failedAttempts: 3, pinWarning: true })!.pinWarning).toBe(true);
    expect(mapWorkerRow(r)!.pinWarning).toBe(false);
  });
});

describe("summarizeEvent — รูปจากหน้างาน (0189 W2)", () => {
  it("ผู้จัดการแนบ/ลบรูปจากหน้างาน = 'จากหน้างาน' · ออฟฟิศลบพร้อมเหตุผล = 'เหตุผล: …' · ไม่ dump payload อื่น (photo_id/bytes)", () => {
    expect(summarizeEvent("photo_add", { photo_id: "x", kind: "reference", source: "shopfloor", bytes: 123, is_primary: true })).toBe("จากหน้างาน");
    expect(summarizeEvent("photo_add", { photo_id: "x", source: "office" })).toBeNull();
    expect(summarizeEvent("photo_remove", { photo_id: "x", source: "shopfloor" })).toBe("จากหน้างาน");
    expect(summarizeEvent("photo_remove", { photo_id: "x", reason: "ภาพไม่ชัด" })).toBe("เหตุผล: ภาพไม่ชัด");
    expect(summarizeEvent("photo_remove", { photo_id: "x", reason: null })).toBeNull();
    expect(summarizeEvent("photo_remove", null)).toBeNull();
    expect(String(summarizeEvent("photo_add", { source: "shopfloor", bytes: 999 }))).not.toMatch(/999|photo_id/);
  });
});

describe("summarizeEvent — weigh/handoff_mismatch", () => {
  it("แสดงน้ำหนักที่ช่างใส่/ขั้นก่อนส่ง/ส่วนต่าง (หน้า owner/admin)", () => {
    const s = summarizeEvent("weigh", { kind: "handoff_mismatch", weight_in_g: 10.2, prev_weight_out_g: 10.5, gap_g: -0.3 });
    expect(s).toContain("ช่างใส่ 10.2 g");
    expect(s).toContain("ขั้นก่อนส่ง 10.5 g");
    expect(s).toContain("ต่าง −0.3 g");
  });
  it("payload ไม่ครบ/ชนิด weigh อื่น: ไม่พังและไม่ dump payload ดิบ", () => {
    expect(summarizeEvent("weigh", { kind: "handoff_mismatch" })).toContain("—");
    expect(summarizeEvent("weigh", { kind: "other", secret: "x" })).toBeNull();
    expect(summarizeEvent("weigh", null)).toBeNull();
  });
});

describe("parseLabel — ห้าม < >", () => {
  it("ผ่านชื่อปกติ (ไทย/อังกฤษ/ตัวเลข/เครื่องหมายทั่วไป) · ปฏิเสธ < > พร้อมข้อความไทย", () => {
    expect(parseLabel("แหวนลายใบไม้ ไซส์ 7 (A-1)", "ชื่อ", 60, true)).toEqual({ ok: true, value: "แหวนลายใบไม้ ไซส์ 7 (A-1)" });
    for (const bad of ["a<b", "a>b", "<script>", "ช่าง>"]) {
      expect(parseLabel(bad, "ชื่อ", 60, true)).toEqual({ ok: false, error: "ชื่อห้ามมีเครื่องหมาย < หรือ >" });
    }
  });
  it("กฎของ parseText ยังอยู่: ว่างเมื่อ required = ปฏิเสธ · ไม่ required ว่าง = null", () => {
    expect(parseLabel("  ", "ชื่อ", 60, true).ok).toBe(false);
    expect(parseLabel(null, "ชื่อ", 60, false)).toEqual({ ok: true, value: null });
  });
});
