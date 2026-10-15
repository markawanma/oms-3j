// 0175: ป้าย surplusPending / underPlanned · qtyLabel · parseQtyText — pure
import { describe, expect, it } from "vitest";
import { ATTENTION_MAX_RANK, primaryStatus, qtyLabel, secondaryStatuses, statusSignals } from "@/lib/jobs/board";
import { parseQtyText } from "@/lib/jobs/input";
import { mapBoardRow } from "@/lib/jobs/types";
import { OFFICE_HINT_TH, officeErrorMessage } from "@/lib/jobs/messages";

const TODAY = "2026-10-15";
const row = (o: Record<string, unknown> = {}) =>
  mapBoardRow({ id: "11111111-1111-4111-8111-111111111111", job_no: "JB-0100", seq: 100, source_kind: "oem", metal: "silver", qty_planned: 30, qty_order: 30, status: "in_progress", ...o })!;

describe("ป้าย 0175", () => {
  it("ใบเดิม (สั่ง = เริ่มผลิต · under_planned false) ไม่มี underPlanned/surplusPending", () => {
    const keys = statusSignals(row(), TODAY).map((s) => s.key);
    expect(keys).not.toContain("underPlanned");
    expect(keys).not.toContain("surplusPending");
  });

  it("underPlanned: 'เริ่มผลิต 28 จากสั่ง 30' · tone ฟ้า · rank 10.1 (ข้อมูลประกอบ ไม่ใช่ป้ายหลัก)", () => {
    const r = row({ qty_planned: 28, under_planned: true });
    const s = statusSignals(r, TODAY).find((x) => x.key === "underPlanned")!;
    expect(s).toMatchObject({ label: "เริ่มผลิต 28 จากสั่ง 30", tone: "blue", rank: 10.1 });
    expect(primaryStatus(r, TODAY).key).toBe("normal");
    expect(secondaryStatuses(r, TODAY).map((x) => x.key)).toContain("underPlanned");
  });

  it("under_planned จาก DB เป็นจริงเท่านั้นถึงขึ้นป้าย (ไม่คำนวณเองจากตัวเลขอย่างเดียว)", () => {
    expect(statusSignals(row({ qty_planned: 28, under_planned: false }), TODAY).map((s) => s.key)).not.toContain("underPlanned");
  });

  it("surplusPending: 'เหลือ 3 ชิ้น ยังไม่ตัดสิน' amber rank 6.5 = ป้ายหลัก (ต้องดู)", () => {
    const r = row({ status: "done", surplus_pending: true, qty_surplus: 3 });
    const s = statusSignals(r, TODAY).find((x) => x.key === "surplusPending")!;
    expect(s).toMatchObject({ label: "เหลือ 3 ชิ้น ยังไม่ตัดสิน", tone: "amber", rank: 6.5 });
    expect(s.rank).toBeLessThanOrEqual(ATTENTION_MAX_RANK);
    expect(primaryStatus(r, TODAY).key).toBe("surplusPending");
  });

  it("surplusPending ที่ไม่มีของเหลือจริง (qty_surplus null/0) ไม่ขึ้นป้าย", () => {
    expect(statusSignals(row({ status: "done", surplus_pending: true, qty_surplus: null }), TODAY).map((s) => s.key)).not.toContain("surplusPending");
    expect(statusSignals(row({ status: "done", surplus_pending: true, qty_surplus: 0 }), TODAY).map((s) => s.key)).not.toContain("surplusPending");
  });

});

describe("qtyLabel", () => {
  it("เท่ากัน = 'n ชิ้น' · ต่างกัน = 'สั่ง (เริ่ม n) ชิ้น'", () => {
    expect(qtyLabel(row())).toBe("30 ชิ้น");
    expect(qtyLabel(row({ qty_planned: 35 }))).toBe("30 (เริ่ม 35) ชิ้น");
  });
  it("แถวที่ view ยังไม่ส่ง qty_order ถอยไปใช้ qty_planned (ไม่ขึ้น 0 ปลอม)", () => {
    const r = mapBoardRow({ id: "11111111-1111-4111-8111-111111111111", job_no: "JB-0001", qty_planned: 12 })!;
    expect(qtyLabel(r)).toBe("12 ชิ้น");
  });
});

describe("parseQtyText — จำนวนเต็มเข้ม", () => {
  it.each([["35", 35], [" 35 ", 35], ["1", 1], ["100000", 100000]])("%j → %i", (t, n) => {
    expect(parseQtyText(t)).toEqual({ ok: true, value: n });
  });
  it.each([["1,5"], ["1.5"], ["3,000"], ["-3"], ["+3"], ["0"], ["100001"], [""], ["  "], ["abc"], ["1e3"], ["๓๕"], ["99999999999999999999"]])("%j ถูกปฏิเสธ (ไม่กรองทิ้งเงียบ)", (t) => {
    const r = parseQtyText(t);
    expect(r.ok).toBe(false);
  });
  it("ข้อความ error ของรูปแบบผิด = 'ใส่เป็นจำนวนเต็ม เช่น 35'", () => {
    expect(parseQtyText("1,5")).toEqual({ ok: false, error: "ใส่เป็นจำนวนเต็ม เช่น 35" });
  });
});

describe("hint 0175 → ข้อความไทยอ่านรู้เรื่อง", () => {
  it.each(["plan_drift", "plan_override_stale", "cast_started", "started", "surplus_oem_no_stock", "surplus_unexpected", "surplus_invalid", "no_surplus", "target_source_invalid"])("%s มีข้อความไทย ไม่มี snake_case/ชื่อฟังก์ชัน", (h) => {
    const t = OFFICE_HINT_TH[h];
    expect(t, h).toBeTruthy();
    expect(t).toMatch(/[ก-๙]/);
    expect(t).not.toMatch(/[a-z]+_[a-z_]+|job_plan|p_/);
    // ผ่านทางจริง: DB ส่งข้อความที่มีชื่อฟังก์ชัน → ใช้ตารางแทน
    expect(officeErrorMessage({ code: "22023", hint: h, message: `ERROR: job_plan_set failed (${h})` })).toBe(t);
  });
});
