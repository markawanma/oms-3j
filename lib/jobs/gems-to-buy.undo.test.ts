// G1b UI รอบแก้ (security M1/M2 · review B1/N1): ปุ่มย้อนตัดสินจากผล server · expected ต่อ line · removed_after_order forceShow · view ประกอบทีละ field
import { describe, expect, it } from "vitest";
import { mapGemPurchaseMark, mapGemPurchaseSummary } from "./gem-purchase";
import type { GemPurchaseMarkResult } from "./gem-purchase";
import {
  MARK_CHANGED_MESSAGE,
  MARK_FAILED_MESSAGE,
  MARK_QTY_CHANGED_AFTER_COPY_MESSAGE,
  MARK_QTY_CHANGED_MESSAGE,
  expectedForJobs,
  jobItemKey,
  markFailureMessage,
  removedQtyByJobItem,
  removedWithPendingLine,
  rowsForTab,
  toGemsToBuyView,
  undoPlanFromResult,
} from "./gems-to-buy";
import type { GtbGroup, GtbJob } from "./gems-to-buy";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n: number, o: Partial<GtbJob> = {}): GtbJob => ({
  jobId: U(1000 + n), jobNo: `JB-${String(n).padStart(4, "0")}`, designLabel: null, dueDate: null, qtyNeededNow: 10, qtyOrdered: 0, qtyRemaining: 10, qtyExcess: 0,
  isOrdered: false, changedAfterOrder: false, orderedAt: null, orderedBy: null, lineIds: [U(2000 + n)], ...o,
});
const group = (n: number, jobs: GtbJob[]): GtbGroup => ({
  canonicalItemId: U(n), typeId: U(100), typeName: "โกเมน", shapeId: U(200), shapeName: "ไข่", sizeA: 4, sizeB: 6, sizeLabel: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
  qtyNeededNow: 0, qtyOrdered: 0, qtyRemaining: jobs.reduce((s, j) => s + j.qtyRemaining, 0), qtyExcess: 0, jobCount: jobs.length, earliestDue: null, earliestDueRemaining: null, jobs,
});

/** ผล gem_purchase_mark ตามรูป DB จริง (ผ่าน mapper ตัวจริง — กัน fixture ที่ mapper ไม่ยอมรับ) */
const dbLine = (id: number, o: Record<string, unknown> = {}) => ({
  line_id: U(id), job_id: U(1), job_no: "JB-0001", canonical_item_id: U(50), is_ordered: true, qty_needed_now: 10, qty_ordered: 10, qty_remaining: 0, qty_excess: 0,
  changed_after_order: false, prev_ordered_qty: null, new_ordered_qty: 10, ...o,
});
const result = (ordered: boolean, lines: Record<string, unknown>[], o: Record<string, unknown> = {}): GemPurchaseMarkResult => {
  const m = mapGemPurchaseMark({ requested: lines.length, changed: lines.length, unchanged: 0, ordered, lines, ...o });
  if (!m) throw new Error("fixture ผิดรูป");
  return m;
};

describe("🔴 undoPlanFromResult — ตัดสินจากผล server (security M1)", () => {
  it("ติ๊กแถวที่ไม่เคยติ๊ก (prev null ทุกแถว + เปลี่ยนครบ) = ย้อนได้ด้วยการยกเลิก", () => {
    expect(undoPlanFromResult(true, result(true, [dbLine(1), dbLine(2)]))).toEqual({ ordered: false });
  });
  it("ใบผสม: มีแถวที่เคยติ๊กไว้ (prev 70) ปนกับแถวที่ไม่เคย → ไม่เสนอ (เดิมตัดสินจาก isOrdered ระดับใบ = bool_and ผิด)", () => {
    const mixed = result(true, [dbLine(1), dbLine(2, { prev_ordered_qty: 70, new_ordered_qty: 90, qty_needed_now: 90 })]);
    expect(undoPlanFromResult(true, mixed)).toBeNull();
  });
  it("ติ๊กซ้ำแถวเดียวที่ปรับยอดขึ้น (prev 70 → 90) = ไม่เสนอ (ยกเลิกจะได้ 0 ไม่ใช่ 70 → สั่งซ้ำ)", () => {
    expect(undoPlanFromResult(true, result(true, [dbLine(1, { prev_ordered_qty: 70, new_ordered_qty: 90, qty_needed_now: 90 })]))).toBeNull();
  });
  it("เปลี่ยนไม่ครบ (บางแถวคนอื่นทำไว้ = changed < requested) / changed 0 / lines ไม่ครบ = ไม่เสนอ", () => {
    expect(undoPlanFromResult(true, result(true, [dbLine(1), dbLine(2)], { changed: 1, unchanged: 1 }))).toBeNull();
    expect(undoPlanFromResult(true, result(true, [dbLine(1)], { changed: 0, unchanged: 1 }))).toBeNull();
    expect(undoPlanFromResult(true, result(true, [dbLine(1)], { requested: 2, changed: 2 }))).toBeNull();
    expect(undoPlanFromResult(true, result(true, []))).toBeNull();
  });
  it("แถวที่ผลบอก new = null ทั้งที่สั่งติ๊ก (ผิดปกติ) = ไม่เสนอ", () => {
    expect(undoPlanFromResult(true, result(true, [dbLine(1, { new_ordered_qty: null })]))).toBeNull();
  });
  it("ยกเลิกแถวสะอาด (ยอดที่ล้าง = ยอดที่ต้องใช้) = ย้อนด้วยติ๊กใหม่ พร้อม expected สดจากผล server", () => {
    const r = result(false, [dbLine(1, { is_ordered: false, prev_ordered_qty: 10, new_ordered_qty: null, qty_ordered: 0, qty_remaining: 10 }), dbLine(2, { is_ordered: false, prev_ordered_qty: 10, new_ordered_qty: null, qty_needed_now: 10, qty_ordered: 0, qty_remaining: 10 })]);
    expect(undoPlanFromResult(false, r)).toEqual({ ordered: true, expected: { [U(1)]: 10, [U(2)]: 10 } });
  });
  it("ยกเลิกแถวที่ยอดเปลี่ยนหลังสั่ง (ล้าง 70 แต่ตอนนี้ใช้ 90) / สั่งเกิน = ไม่เสนอ (ติ๊กใหม่จะได้ 90 ไม่ใช่ 70)", () => {
    const base = { is_ordered: false, new_ordered_qty: null, qty_ordered: 0 };
    expect(undoPlanFromResult(false, result(false, [dbLine(1, { ...base, prev_ordered_qty: 70, qty_needed_now: 90, qty_remaining: 90 })]))).toBeNull();
    expect(undoPlanFromResult(false, result(false, [dbLine(1, { ...base, prev_ordered_qty: 70, qty_needed_now: 50, qty_remaining: 50 })]))).toBeNull();
  });
  it("ยกเลิกแต่ปนแถวที่ไม่ได้ติ๊กอยู่ (prev null = ไม่มีอะไรให้ย้อน) = ไม่เสนอ", () => {
    const r = result(false, [dbLine(1, { prev_ordered_qty: 10, new_ordered_qty: null, is_ordered: false }), dbLine(2, { prev_ordered_qty: null, new_ordered_qty: null, is_ordered: false })]);
    expect(undoPlanFromResult(false, r)).toBeNull();
  });
});

describe("mapper ของผลติ๊ก: prev/new ต้องมี key (ไม่เดาว่าไม่เคยติ๊กแล้วเปิดปุ่มย้อนผิด)", () => {
  it("ขาด prev_ordered_qty = ผลผิดรูป (null ทั้งก้อน)", () => {
    const { prev_ordered_qty: _p, ...noPrev } = dbLine(1);
    void _p;
    expect(mapGemPurchaseMark({ requested: 1, changed: 1, unchanged: 0, ordered: true, lines: [noPrev] })).toBeNull();
  });
});

describe("expectedForJobs — ยอดต่อ line ที่จอเห็น", () => {
  it("ใบละ 1 line = qtyNeededNow ของใบ (ยอด 'ต้องใช้' ไม่ใช่ยอดที่เหลือ)", () => {
    expect(expectedForJobs([job(1, { qtyNeededNow: 90, qtyRemaining: 20, qtyOrdered: 70, isOrdered: true }), job(2, { qtyNeededNow: 5, qtyRemaining: 5 })])).toEqual({ [U(2001)]: 90, [U(2002)]: 5 });
  });
  it("ใบที่มีหลาย line ของรายการเดียวกัน = null (ไม่แบ่งยอดเดา)", () => {
    expect(expectedForJobs([job(1, { lineIds: [U(1), U(2)], qtyNeededNow: 20 })])).toBeNull();
    expect(expectedForJobs([job(1), job(2, { lineIds: [U(7), U(8)] })])).toBeNull();
  });
  it("ว่าง / ยอดไม่ใช่จำนวนเต็มบวก / ไม่มี line = null", () => {
    expect(expectedForJobs([])).toBeNull();
    expect(expectedForJobs([job(1, { qtyNeededNow: 0 })])).toBeNull();
    expect(expectedForJobs([job(1, { qtyNeededNow: 1.5 })])).toBeNull();
    expect(expectedForJobs([job(1, { lineIds: [] })])).toBeNull();
  });
  it("line เดียวกันซ้ำ (ผิดปกติ) = null — key ต้องเท่ากับจำนวนใบ", () => {
    expect(expectedForJobs([job(1, { lineIds: [U(1)] }), job(2, { lineIds: [U(1)] })])).toBeNull();
  });
});

describe("ข้อความเมื่อติ๊กล้ม", () => {
  it("job_closed / gem_stage_started / purchase_line_not_found = เปลี่ยนไป · qty_changed แยกข้อความ · afterCopy บอกให้คัดลอกใหม่แล้วส่งส่วนต่าง", () => {
    for (const c of ["job_closed", "gem_stage_started", "purchase_line_not_found"]) expect(markFailureMessage(c)).toBe(MARK_CHANGED_MESSAGE);
    expect(markFailureMessage("qty_changed")).toBe(MARK_QTY_CHANGED_MESSAGE);
    expect(markFailureMessage("qty_changed", true)).toBe(MARK_QTY_CHANGED_AFTER_COPY_MESSAGE);
    expect(MARK_QTY_CHANGED_AFTER_COPY_MESSAGE).toMatch(/ยอดเปลี่ยนหลังคัดลอก — คัดลอกใหม่แล้วส่งร้านส่วนต่าง/);
    expect(markFailureMessage(undefined)).toBe(MARK_FAILED_MESSAGE);
    expect(markFailureMessage("whatever", true)).toBe(MARK_FAILED_MESSAGE);
    expect(MARK_CHANGED_MESSAGE).toMatch(/ไม่ได้ทำเครื่องหมายรายการใดเลย/);
    expect(MARK_QTY_CHANGED_MESSAGE).toMatch(/ไม่ได้ทำเครื่องหมายรายการใดเลย/);
  });
});

describe("removed_after_order — forceShow + chip", () => {
  const removed = [
    { jobId: U(1001), canonicalItemId: U(1), qty: 70 },
    { jobId: U(1002), canonicalItemId: U(1), qty: 30 },
    { jobId: U(1001), canonicalItemId: U(9), qty: 5 },
  ];
  it("เฉพาะใบ×รายการที่ตอนนี้มีแถว 'ยังไม่สั่ง' ในแท็บยังไม่สั่ง ถึงจะ force", () => {
    const rows = rowsForTab([group(1, [job(1)])], "pending"); // ใบ 1001 มีรายการ U(1) ยังไม่สั่ง · ใบ 1002 ไม่มี
    expect([...removedWithPendingLine(removed, rows)]).toEqual([jobItemKey(U(1001), U(1))]);
  });
  it("ใบที่มีรายการเดียวกันแต่สั่งครบแล้ว (ไม่อยู่แท็บยังไม่สั่ง) = ไม่ force", () => {
    const rows = rowsForTab([group(1, [job(1, { qtyOrdered: 10, qtyRemaining: 0, isOrdered: true })])], "pending");
    expect(removedWithPendingLine(removed, rows).size).toBe(0);
  });
  it("ยอดที่เคยสั่งไว้ต่อใบ×รายการ (รวมหลายรายการลบของเดียวกัน)", () => {
    const m = removedQtyByJobItem([...removed, { jobId: U(1001), canonicalItemId: U(1), qty: 3 }]);
    expect(m.get(jobItemKey(U(1001), U(1)))).toBe(73);
    expect(m.get(jobItemKey(U(1002), U(1)))).toBe(30);
    expect(m.get(jobItemKey(U(1003), U(1)))).toBeUndefined();
  });
});

describe("toGemsToBuyView — ประกอบทีละ field (security L1)", () => {
  const raw = {
    server_now: "2026-10-24T14:32:10+07:00", today_bkk: "2026-10-24",
    groups: [{
      canonical_item_id: U(1), type_id: U(100), type_name: "โกเมน", shape_id: U(200), shape_name: "ไข่", size_a: 4, size_b: 6, size_label: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
      qty_needed_now: 10, qty_ordered: 0, qty_remaining: 10, qty_excess: 0, job_count: 1, earliest_due: null, earliest_due_remaining: null, line_ids: [U(11)],
      jobs: [{ job_id: U(21), job_no: "JB-0021", design_label: "ก", due_date: null, qty_needed_now: 10, qty_ordered: 0, qty_remaining: 10, qty_excess: 0, is_ordered: false, changed_after_order: false, ordered_at: null, ordered_by: U(900), line_ids: [U(11)] }],
    }],
    unspecified_jobs: [], removed_after_order: [], totals: { groups: 1, jobs: 1, qty_needed_now: 10, qty_ordered: 0, qty_remaining: 10, qty_excess: 0, unspecified_jobs: 0 },
  };
  it("field ที่เพิ่มใน GemPurchaseJob ทีหลัง (หรือ uuid ผู้ติ๊ก) ไม่หลุดไป view", () => {
    const s = mapGemPurchaseSummary(raw);
    expect(s).not.toBeNull();
    // จำลอง field ใหม่ที่ mapper อนุญาตผ่านมา
    (s as unknown as { groups: { jobs: Record<string, unknown>[] }[] }).groups[0].jobs[0].futureField = "SECRET_VALUE";
    const v = toGemsToBuyView(s!, U(900));
    expect(Object.keys(v.groups[0].jobs[0]).sort()).toEqual(["changedAfterOrder", "designLabel", "dueDate", "isOrdered", "jobId", "jobNo", "lineIds", "orderedAt", "orderedBy", "qtyExcess", "qtyNeededNow", "qtyOrdered", "qtyRemaining"].sort());
    expect(JSON.stringify(v)).not.toContain("SECRET_VALUE");
    expect(JSON.stringify(v)).not.toContain(U(900));
    expect(v.groups[0].jobs[0].orderedBy).toBe("me");
  });
  it("lineIds ของ view เป็นสำเนา (แก้ view ไม่ย้อนไปแก้ต้นทาง)", () => {
    const s = mapGemPurchaseSummary(raw)!;
    const v = toGemsToBuyView(s, null);
    expect(v.groups[0].jobs[0].lineIds).not.toBe(s.groups[0].jobs[0].lineIds);
    expect(v.groups[0].jobs[0].lineIds).toEqual(s.groups[0].jobs[0].lineIds);
  });
});
