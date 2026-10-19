// 0175: ป้าย surplusPending / underPlanned · qtyLabel · parseQtyText — pure
import { describe, expect, it } from "vitest";
import { ATTENTION_MAX_RANK, bufferLabel, bufferQtyOf, cardBadges, matchesSignal, primaryStatus, qtyLabel, qtyOrderPlannedText, secondaryStatuses, statusSignals } from "@/lib/jobs/board";
import { parseBufferText, parseQtyText } from "@/lib/jobs/input";
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

describe("ป้าย 'เผื่อ +n' (มติเจ้าของ 18 ต.ค. 69 — เผื่อของเสียไม่บังคับ)", () => {
  it("ใบที่เริ่มผลิต > สั่ง: ป้ายฟ้า 'เผื่อ +5' rank 10.2 หลัง underPlanned (10.1) · ข้อมูลประกอบ ไม่ใช่ป้ายหลัก", () => {
    const r = row({ qty_planned: 35 });
    const s = statusSignals(r, TODAY).find((x) => x.key === "buffer")!;
    expect(s).toMatchObject({ label: "เผื่อ +5", tone: "blue", rank: 10.2 });
    expect(s.rank).toBeGreaterThan(ATTENTION_MAX_RANK);
    expect(primaryStatus(r, TODAY).key).toBe("normal");
    expect(secondaryStatuses(r, TODAY).map((x) => x.key)).toContain("buffer");
  });
  it("ใบเดิม (เท่ากัน) ไม่ขึ้นป้าย · ใบที่เริ่มผลิตน้อยกว่าสั่ง (ผลิตบางส่วน) ไม่ขึ้น 'เผื่อ' แต่ยังขึ้น underPlanned", () => {
    expect(statusSignals(row(), TODAY).map((s) => s.key)).not.toContain("buffer");
    const less = statusSignals(row({ qty_planned: 28, under_planned: true }), TODAY).map((s) => s.key);
    expect(less).not.toContain("buffer");
    expect(less).toContain("underPlanned");
  });
  it("bufferQtyOf / bufferLabel: ผลต่างจำนวนชิ้นเมื่อเริ่มผลิต > สั่งเท่านั้น · หลักพันมีจุลภาค", () => {
    expect(bufferQtyOf({ qtyOrder: 100, qtyPlanned: 105 })).toBe(5);
    expect(bufferQtyOf({ qtyOrder: 100, qtyPlanned: 100 })).toBe(0);
    expect(bufferQtyOf({ qtyOrder: 100, qtyPlanned: 90 })).toBe(0);
    expect(bufferLabel(5)).toBe("เผื่อ +5");
    expect(bufferLabel(1200)).toBe("เผื่อ +1,200");
  });
});

describe("parseBufferText — เผื่อกี่ชิ้น (จำนวนเต็มเข้ม ≥ 0)", () => {
  it.each([["0", 0], ["5", 5], [" 12 ", 12], ["099", 99]])("%j = ผ่าน %i", (t, n) => {
    expect(parseBufferText(t, 100)).toEqual({ ok: true, value: n });
  });
  it.each([["-1"], ["-0"], ["1,5"], ["3.5"], ["abc"], [""], ["  "], ["5 ชิ้น"], ["1e2"], ["+5"], ["๕"]])("%j = ปฏิเสธ ไม่ตัดเงียบ", (t) => {
    const r = parseBufferText(t, 100);
    expect(r.ok).toBe(false);
  });
  it("รวมกับจำนวนสั่งเกินเพดาน 100,000 = ปฏิเสธ · พอดีเพดานผ่าน · ตัวเลขใหญ่เกิน safe integer = ปฏิเสธ", () => {
    expect(parseBufferText("99900", 100)).toEqual({ ok: true, value: 99900 });
    expect(parseBufferText("99901", 100).ok).toBe(false);
    expect(parseBufferText("99999999999999999999", 100).ok).toBe(false);
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

describe("review S3 — ใบที่ปิดแล้ว/ยกเลิกไม่ขึ้น 'ครบกำหนด'/'ยังไม่มีมัดจำ'", () => {
  const due = { due_date: "2026-10-17", deposit_missing: true };
  it("ใบที่ยังเดินอยู่: ขึ้น 'ครบใน 2 วัน' + 'ยังไม่มีมัดจำ' (ต้องไม่พัง)", () => {
    const keys = statusSignals(row(due), TODAY).map((s) => s.key);
    expect(keys).toContain("dueSoon");
    expect(keys).toContain("deposit");
    expect(statusSignals(row(due), TODAY).find((s) => s.key === "dueSoon")!.label).toBe("ครบใน 2 วัน");
  });
  it.each(["done", "cancelled"])("ใบ %s: ไม่มี dueSoon และไม่มี deposit", (status) => {
    const keys = statusSignals(row({ ...due, status }), TODAY).map((s) => s.key);
    expect(keys).not.toContain("dueSoon");
    expect(keys).not.toContain("deposit");
  });
  it.each(["done", "cancelled"])("ใบ %s: matchesSignal dueSoon = false · cardBadges ไม่ขึ้นมัดจำ", (status) => {
    const r = row({ ...due, status });
    expect(matchesSignal(r, "dueSoon", TODAY)).toBe(false);
    expect(cardBadges(r).map((b) => b.key)).not.toContain("deposit");
  });
  it("ใบ on_hold ยังขึ้นครบกำหนดตามเดิม (ไม่กว้างเกินไป)", () => {
    expect(statusSignals(row({ ...due, status: "on_hold" }), TODAY).map((s) => s.key)).toContain("dueSoon");
  });
});

describe("qtyOrderPlannedText (N1)", () => {
  it("เท่ากัน = 'n ชิ้น' · alwaysOrder = 'สั่ง n ชิ้น' · ต่างกัน = 'สั่ง X · เริ่มผลิต Y ชิ้น'", () => {
    expect(qtyOrderPlannedText({ qtyOrder: 30, qtyPlanned: 30 })).toBe("30 ชิ้น");
    expect(qtyOrderPlannedText({ qtyOrder: 30, qtyPlanned: 30 }, { alwaysOrder: true })).toBe("สั่ง 30 ชิ้น");
    expect(qtyOrderPlannedText({ qtyOrder: 30, qtyPlanned: 35 })).toBe("สั่ง 30 · เริ่มผลิต 35 ชิ้น");
    expect(qtyOrderPlannedText({ qtyOrder: 30, qtyPlanned: 35 }, { alwaysOrder: true })).toBe("สั่ง 30 · เริ่มผลิต 35 ชิ้น");
  });
});

describe("0176 ป้ายทองไม่มีด่านชั่ง (goldUnguarded)", () => {
  const gold = (o: Record<string, unknown> = {}) => row({ metal: "gold", gold_unguarded: true, ...o });
  it("ป้าย 'ทอง · ไม่มีด่านชั่ง' สีแดง rank 9 = ข้อมูลประกอบ ไม่ใช่ป้ายหลัก · ไม่นับ 'ต้องดู' (ATTENTION_MAX_RANK = 7 คงเดิม)", () => {
    const r = gold();
    const s = statusSignals(r, TODAY).find((x) => x.key === "goldUnguarded")!;
    expect(s).toMatchObject({ label: "ทอง · ไม่มีด่านชั่ง", tone: "red", rank: 9 });
    expect(ATTENTION_MAX_RANK).toBe(7);
    expect(s.rank).toBeGreaterThan(ATTENTION_MAX_RANK);
    expect(primaryStatus(r, TODAY).key).toBe("normal");
    expect(secondaryStatuses(r, TODAY).map((x) => x.key)).toContain("goldUnguarded");
  });
  it("มีป้ายหลักจริง (เลยกำหนด) = ป้ายหลักยังเป็นเลยกำหนด · ป้ายทองเป็นรอง", () => {
    const r = gold({ is_overdue: true, due_date: "2026-10-10" });
    expect(primaryStatus(r, TODAY).key).toBe("overdue");
    expect(secondaryStatuses(r, TODAY).map((x) => x.key)).toContain("goldUnguarded");
  });
  it("gold_unguarded จาก DB เท่านั้น: false/ไม่มี = ไม่ขึ้น · ใบ done/cancelled ไม่ขึ้น", () => {
    expect(statusSignals(row({ metal: "gold" }), TODAY).map((s) => s.key)).not.toContain("goldUnguarded");
    expect(statusSignals(gold({ gold_unguarded: false }), TODAY).map((s) => s.key)).not.toContain("goldUnguarded");
    for (const status of ["done", "cancelled"]) expect(statusSignals(gold({ status }), TODAY).map((s) => s.key)).not.toContain("goldUnguarded");
  });
  it("ลำดับ rank: ทอง 9 < auto 10 < underPlanned 10.1 < qty 11 (เลื่อน auto/qty ตาม spec)", () => {
    const r = gold({ has_auto_closed: true, quote_qty_mismatch: true, quote_item_qty: 8, qty_planned: 28, under_planned: true });
    const sig = statusSignals(r, TODAY);
    const rank = (k: string) => sig.find((s) => s.key === k)!.rank;
    expect([rank("goldUnguarded"), rank("auto"), rank("underPlanned"), rank("qty")]).toEqual([9, 10, 10.1, 11]);
    const keys = sig.map((s) => s.key);
    expect(keys.indexOf("goldUnguarded")).toBeLessThan(keys.indexOf("auto"));
    expect(keys.indexOf("auto")).toBeLessThan(keys.indexOf("qty"));
  });
});
