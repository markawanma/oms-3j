import { describe, expect, it } from "vitest";
import { buildApprovalChecklist, countUndone } from "./approval-checklist";
import { mapPieceRow } from "./piece-types";

const gate = (status: string) => ({ status });
function p(over: Record<string, unknown> = {}) {
  return mapPieceRow({ step_id: "s", campaign_id: "c", title: "t", piece_status: "in_review", piece_kind: "short_clip", gates: {}, ...over });
}

describe("approval checklist (คำอธิบาย ไม่ตัดสิน)", () => {
  it("ด่านที่ยังไม่มีแถว = ยังไม่ผ่าน · ครบทุกอย่าง = 0 ข้อค้าง", () => {
    expect(countUndone(buildApprovalChecklist(p()))).toBe(3);
    const ok = p({ gates: { fact_check: gate("passed"), brand_rule: gate("passed"), risk_owner: gate("na") }, confirm_pending: 0 });
    expect(countUndone(buildApprovalChecklist(ok))).toBe(0);
  });
  it("ข้อต้องยืนยันค้าง (จำนวนหรือ marker ในข้อความ) นับเป็นค้าง", () => {
    const base = { gates: { fact_check: gate("passed"), brand_rule: gate("passed"), risk_owner: gate("passed") } };
    expect(countUndone(buildApprovalChecklist(p({ ...base, confirm_pending: 2 })))).toBe(1);
    expect(countUndone(buildApprovalChecklist(p({ ...base, confirm_marker_in_text: true })))).toBe(1);
  });
  it("ยังไม่ระบุชนิด / LINE ยังไม่เลือกผู้รับ เพิ่มรายการค้าง", () => {
    const g = { gates: { fact_check: gate("passed"), brand_rule: gate("passed"), risk_owner: gate("passed") } };
    expect(countUndone(buildApprovalChecklist(p({ ...g, piece_kind: null })))).toBe(1);
    expect(countUndone(buildApprovalChecklist(p({ ...g, piece_kind: "line_message" })))).toBe(1);
    expect(countUndone(buildApprovalChecklist(p({ ...g, piece_kind: "line_message", line_audience: "all" })))).toBe(0);
  });
});
