import { describe, expect, it } from "vitest";
import { GENERIC_JOB_ERROR, OFFICE_HINT_TH, WORKER_CODE_TH, officeErrorMessage, safeLogShape, workerFailMessage } from "./messages";

const THAI = /[฀-๿]/;
const TECH = /[a-z]+_[a-z_]+|analytics\.|select |insert |p_[a-z]/i;

describe("WORKER_CODE_TH — ทุก code ที่ RPC ฝั่งช่างคืนได้ มีข้อความไทยสั้นและไม่มีศัพท์เทคนิค", () => {
  // รายการ code จริงจาก 0172 (grep job_fail) — เพิ่ม code ใหม่ใน DB ต้องเพิ่มที่นี่ (เทสต์นี้ล้ม = ลืมแปล)
  const CODES = [
    "already_received", "already_sent", "awaiting_deposit", "bad_credentials", "date_invalid", "invalid_token", "job_closed", "job_not_found",
    "job_on_hold", "locked", "not_holder", "not_received", "note_invalid", "note_required", "out_of_order", "prev_not_sent", "qty_invalid",
    "rate_limited", "reason_required", "reason_unexpected", "session_required", "stage_changed", "stage_not_allowed", "weight_invalid",
    "weight_over", "weight_required", "who_required",
  ];
  it.each(CODES)("%s", (code) => {
    const m = workerFailMessage(code, "ข้อความ DB");
    expect(m).toBe(WORKER_CODE_TH[code]);
    expect(THAI.test(m)).toBe(true);
    expect(TECH.test(m)).toBe(false);
    expect(m.length).toBeLessThanOrEqual(90);
  });
});

describe("workerFailMessage — code ที่ไม่รู้จัก", () => {
  it("ใช้ข้อความ DB ถ้าเป็นไทยสะอาด", () => {
    expect(workerFailMessage("brand_new_code", "ขั้นนี้ปิดแล้ว")).toBe("ขั้นนี้ปิดแล้ว");
  });
  it("ข้อความ DB ไม่สะอาด (อังกฤษ/เทคนิค/ยาวเกิน/ไม่ใช่ string) → ข้อความกลาง", () => {
    for (const m of ["permission denied for table job", "ERROR: violates constraint js_weight_ck", "analytics.job_stage ล้มเหลว", "x".repeat(400), undefined, null, 5]) {
      expect(workerFailMessage("brand_new_code", m)).toBe(GENERIC_JOB_ERROR);
    }
    expect(workerFailMessage(undefined, undefined)).toBe(GENERIC_JOB_ERROR);
  });
  it("code เป็น prototype key (constructor/toString) ไม่หลุดเป็นข้อความ", () => {
    expect(workerFailMessage("constructor", null)).toBe(GENERIC_JOB_ERROR);
    expect(workerFailMessage("__proto__", null)).toBe(GENERIC_JOB_ERROR);
  });
});

describe("officeErrorMessage", () => {
  it("42501 → ไม่มีสิทธิ์", () => {
    expect(officeErrorMessage({ code: "42501", message: "x" })).toMatch(/เจ้าของร้าน/);
  });
  it("22023 + hint รู้จัก + ข้อความ DB ไทยสะอาด → ใช้ข้อความ DB (มีเลขงาน/จำนวน)", () => {
    const m = officeErrorMessage({ code: "22023", hint: "job_exists", message: "รายการนี้มีใบงาน JB-0007 อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน" });
    expect(m).toContain("JB-0007");
  });
  it("22023 + hint รู้จัก แต่ข้อความ DB มี snake_case/อังกฤษ → ข้อความจากตาราง hint", () => {
    expect(officeErrorMessage({ code: "22023", hint: "quote_not_won", message: "job_create_from_quote_item: status=lost" })).toBe(OFFICE_HINT_TH.quote_not_won);
  });
  it("ตัด prefix ชื่อฟังก์ชัน 'fn_name: ' ออก", () => {
    expect(officeErrorMessage({ code: "22023", hint: "due_invalid", message: "job_set_due: กำหนดส่งต้องไม่ย้อนหลัง" })).toBe("กำหนดส่งต้องไม่ย้อนหลัง");
  });
  it("22023 ไม่มี hint แต่ข้อความไทยสะอาด → ใช้ข้อความ · อื่นๆ → fallback", () => {
    expect(officeErrorMessage({ code: "22023", message: "น้ำหนักสุทธิต้องมากกว่า 0" })).toBe("น้ำหนักสุทธิต้องมากกว่า 0");
    expect(officeErrorMessage({ code: "XX000", message: "connection reset" }, "ล้มเหลว")).toBe("ล้มเหลว");
    expect(officeErrorMessage(null)).toBe(GENERIC_JOB_ERROR);
    expect(officeErrorMessage("boom")).toBe(GENERIC_JOB_ERROR);
  });
  it("ทุก hint ในตาราง เป็นไทยสะอาด", () => {
    for (const [k, v] of Object.entries(OFFICE_HINT_TH)) {
      expect(THAI.test(v), k).toBe(true);
      expect(TECH.test(v), k).toBe(false);
    }
  });
});

describe("safeLogShape — log เฉพาะ code/hint ไม่มีข้อความดิบ", () => {
  it("ไม่คืน message/params", () => {
    const s = safeLogShape({ code: "22P02", hint: "h", message: 'invalid input syntax for type uuid: "SECRET-TOKEN"', details: "pin=1234" });
    expect(s).toEqual({ code: "22P02", hint: "h" });
    expect(JSON.stringify(s)).not.toContain("SECRET");
    expect(safeLogShape(null)).toEqual({ code: null, hint: null });
  });
});
