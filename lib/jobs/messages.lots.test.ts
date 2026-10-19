// ข้อความไทยของ error ใหม่ใน 0181 (ทองชั่งตอนแบ่ง · ส่วนต่างทอง · รับไม่ครบ) — ข้อความตายตัว ไม่มีตัวเลขน้ำหนัก (N1)
import { describe, expect, it } from "vitest";
import { WORKER_CODE_TH, workerFailMessage } from "@/lib/jobs/messages";

describe("workerFailMessage — code ใหม่มีข้อความไทยบนจอ", () => {
  const THAI = /[฀-๿]/;
  it.each(["weight_move_required", "office_required", "weight_over", "weight_invalid", "prev_not_sent", "stage_changed", "weight_unexpected", "qty_hold_required", "invalid_part"])("%s", (code) => {
    const m = workerFailMessage(code, null);
    expect(THAI.test(m), code).toBe(true);
    expect(m).not.toMatch(/_/);
    expect(m).toBe(WORKER_CODE_TH[code]);
    expect(m, code).not.toMatch(/d+(.d+)? ?(g|กรัม)/); // ไม่มีตัวเลขน้ำหนัก
  });
  it("ข้อความของ DB ที่ไม่ใช่ code ที่รู้จัก ไม่ถูกใช้ทับข้อความตายตัว", () => {
    expect(workerFailMessage("weight_move_required", "น้ำหนักต่างกัน 3.5 กรัม")).toBe(WORKER_CODE_TH.weight_move_required);
  });
});
