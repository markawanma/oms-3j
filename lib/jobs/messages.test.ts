import { describe, expect, it } from "vitest";
import { GENERIC_JOB_ERROR, OFFICE_HINT_TH, WORKER_CODE_TH, officeErrorMessage, prevNotSentMessage, safeLogShape, waitMinutes, workerFailMessage } from "./messages";

const THAI = /[฀-๿]/;
const TECH = /[a-z]+_[a-z_]+|analytics\.|select |insert |p_[a-z]/i;

describe("WORKER_CODE_TH — ทุก code ที่ RPC ฝั่งช่างคืนได้ มีข้อความไทยสั้นและไม่มีศัพท์เทคนิค", () => {
  // รายการ code จริงจาก 0172 (grep job_fail) — เพิ่ม code ใหม่ใน DB ต้องเพิ่มที่นี่ (เทสต์นี้ล้ม = ลืมแปล)
  const CODES = [
    "already_sent", "awaiting_deposit", "bad_credentials", "date_invalid", "handoff_mismatch", "invalid_token", "job_closed", "job_not_found",
    "job_on_hold", "locked", "locked_office", "token_budget_exhausted", "not_holder", "not_received", "note_invalid", "note_required", "out_of_order", "prev_not_sent", "qty_invalid",
    "rate_limited", "reason_required", "reason_unexpected", "scrap_over", "scrap_weight_not_asked", "session_required", "stage_changed", "stage_not_allowed", "weight_invalid",
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

describe("workerFailMessage — สัญญา 0173 (ตัวเลขประกอบข้อความ)", () => {
  it("PIN ผิดครั้งที่ 1-2: ไม่เตือน · ตั้งแต่ครั้งที่ 3: เหลืออีก N ครั้ง", () => {
    expect(workerFailMessage("bad_credentials", null, { attemptsLeft: 4, attemptsUntilOffice: 14, tokenBudgetLeft: 18 })).toBe("ชื่อหรือ PIN ไม่ถูกต้อง");
    expect(workerFailMessage("bad_credentials", null, { attemptsLeft: 2, attemptsUntilOffice: 12, tokenBudgetLeft: 17 })).toContain("เหลืออีก 2 ครั้ง");
    expect(workerFailMessage("bad_credentials", null, { attemptsLeft: 1, attemptsUntilOffice: 11, tokenBudgetLeft: 16 })).toContain("เหลืออีก 1 ครั้ง");
  });
  it("ใกล้ล็อกจนออฟฟิศปลด / งบต่อใบใกล้หมด ก็เตือน", () => {
    expect(workerFailMessage("bad_credentials", null, { attemptsLeft: 2, attemptsUntilOffice: 2 })).toContain("ออฟฟิศปลดล็อก");
    expect(workerFailMessage("bad_credentials", null, { tokenBudgetLeft: 3 })).toContain("ใส่ PIN ผิดได้อีก 3 ครั้ง");
  });
  it("เตือนซ้อนหลายอย่างพร้อมกัน → โชว์ประโยคเดียว: อันที่เหลือครั้งน้อยสุด · เท่ากันเอาอันหนักกว่า", () => {
    const all = (e: Parameters<typeof workerFailMessage>[2]) => workerFailMessage("bad_credentials", null, e);
    // เหลือน้อยสุดชนะ
    expect(all({ attemptsLeft: 1, attemptsUntilOffice: 2, tokenBudgetLeft: 3 })).toBe("ชื่อหรือ PIN ไม่ถูกต้อง · เหลืออีก 1 ครั้งก่อนถูกล็อกชั่วคราว");
    expect(all({ attemptsLeft: 2, attemptsUntilOffice: 1, tokenBudgetLeft: 3 })).toBe("ชื่อหรือ PIN ไม่ถูกต้อง · เหลืออีก 1 ครั้งจะถูกล็อกจนกว่าออฟฟิศปลดล็อก");
    expect(all({ attemptsLeft: 2, attemptsUntilOffice: 3, tokenBudgetLeft: 0 })).toBe("ชื่อหรือ PIN ไม่ถูกต้อง · ใบนี้ใส่ PIN ผิดได้อีก 0 ครั้งวันนี้");
    // เท่ากัน: ล็อกทั้งใบ > ล็อกจนออฟฟิศปลด > ล็อกชั่วคราว
    expect(all({ attemptsLeft: 2, attemptsUntilOffice: 2, tokenBudgetLeft: 2 })).toContain("ใบนี้ใส่ PIN ผิดได้อีก 2 ครั้ง");
    expect(all({ attemptsLeft: 2, attemptsUntilOffice: 2 })).toContain("ออฟฟิศปลดล็อก");
    // ไม่มีสองประโยคต่อกัน
    expect(all({ attemptsLeft: 1, attemptsUntilOffice: 1, tokenBudgetLeft: 1 }).split(" · ")).toHaveLength(2);
  });
  it("locked: ลองใหม่ใน N นาที (ปัดขึ้น) · ไม่มีเวลา = ข้อความทั่วไป", () => {
    expect(workerFailMessage("locked", null, { retryAfterSeconds: 900 })).toContain("ลองใหม่ใน 15 นาที");
    expect(workerFailMessage("locked", null, { retryAfterSeconds: 3600 })).toContain("ลองใหม่ใน 60 นาที");
    expect(workerFailMessage("locked", null, { retryAfterSeconds: 61 })).toContain("2 นาที");
    expect(workerFailMessage("locked", null)).toBe(WORKER_CODE_TH.locked);
    expect(waitMinutes(0)).toBe(1);
  });
  it("locked_office / token_budget_exhausted ตามถ้อยคำที่กำหนด", () => {
    expect(workerFailMessage("locked_office", null)).toBe("ล็อกแล้ว ให้ออฟฟิศปลดล็อก");
    expect(workerFailMessage("token_budget_exhausted", null)).toBe("ใบนี้ใส่ PIN ผิดเกินกำหนด ขอพิมพ์ใบใหม่จากออฟฟิศ");
  });
  it("handoff_mismatch (0174): ข้อความตายตัว ไม่บอกขนาดส่วนต่าง/น้ำหนักขั้นก่อน (ผู้รับชั่งแบบไม่รู้คำตอบ) แม้ส่ง extra มา", () => {
    const want = "น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ";
    expect(workerFailMessage("handoff_mismatch", null)).toBe(want);
    expect(workerFailMessage("handoff_mismatch", "ข้อความ DB ต่าง 0.37 g", { gapG: -0.12 } as never)).toBe(want);
    expect(WORKER_CODE_TH.handoff_mismatch).not.toMatch(/[0-9]/);
  });
  it("already_received: ใช้ชื่อผู้ชนะ (by) ก่อน · ไม่มี by ใช้ข้อความ DB ที่สะอาด · ไม่มีทั้งคู่ใช้ตาราง", () => {
    expect(workerFailMessage("already_received", "ข้อความ DB", { by: "สมชาย" })).toBe("ช่าง สมชาย รับขั้นนี้ไปแล้ว");
    expect(workerFailMessage("already_received", "ขั้นนี้ถูกรับไปแล้วโดย สมหญิง")).toContain("สมหญิง");
    expect(workerFailMessage("already_received", undefined)).toBe(WORKER_CODE_TH.already_received);
  });
  it("prev_not_sent: ใส่ชื่อขั้นที่ค้าง · ไม่รู้ชื่อ = ข้อความทั่วไป", () => {
    expect(prevNotSentMessage("หล่อ")).toBe("ขั้นก่อน (หล่อ) ยังไม่กดส่งพร้อมน้ำหนัก — ให้เขากดส่งก่อน หรือแจ้งออฟฟิศ");
    expect(prevNotSentMessage(null)).toBe(WORKER_CODE_TH.prev_not_sent);
  });
  it("all_done มีข้อความในตาราง", () => {
    expect(WORKER_CODE_TH.all_done).toBe("งานนี้ทำครบแล้ว รอออฟฟิศปิดงาน");
  });
  it("ตัวเลขนอกช่วง/ชนิดผิด ไม่ทำให้ข้อความเพี้ยน", () => {
    const m = workerFailMessage("bad_credentials", null, { attemptsLeft: Number.NaN, attemptsUntilOffice: -5, tokenBudgetLeft: 99 });
    expect(m).toBe("ชื่อหรือ PIN ไม่ถูกต้อง");
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
