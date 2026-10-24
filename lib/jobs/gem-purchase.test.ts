// lib/jobs/gem-purchase.ts (0192 G1b): mapper ประกอบทีละ field · ไม่มีราคาใน summary/mark · ผลผิดรูป = null ทั้งก้อน · ต้นทุน null ต้องสอดคล้องกับธง missing_price
import { describe, expect, it } from "vitest";
import { mapGemPurchaseCost, mapGemPurchaseMark, mapGemPurchaseSummary } from "./gem-purchase";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const job = (over: Record<string, unknown> = {}) => ({
  job_id: U(1), job_no: "JB-0001", design_label: "แหวนทดสอบ", due_date: "2026-11-01", qty_needed_now: 6, qty_ordered: 0, qty_remaining: 6, qty_excess: 0,
  is_ordered: false, changed_after_order: false, ordered_at: null, ordered_by: null, line_ids: [U(10)], ...over,
});
const group = (over: Record<string, unknown> = {}) => ({
  canonical_item_id: U(2), type_id: U(3), type_name: "โกเมน", shape_id: U(4), shape_name: "ไข่", size_a: 4, size_b: 6, size_label: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
  qty_needed_now: 6, qty_ordered: 0, qty_remaining: 6, qty_excess: 0, job_count: 1, earliest_due: "2026-11-01", earliest_due_remaining: "2026-11-01",
  line_ids: [U(10)], jobs: [job()], ...over,
});
const summary = (over: Record<string, unknown> = {}) => ({
  server_now: "2026-10-24T14:00:00+07:00", today_bkk: "2026-10-24", groups: [group()], unspecified_jobs: [], removed_after_order: [],
  totals: { groups: 1, jobs: 1, qty_needed_now: 6, qty_ordered: 0, qty_remaining: 6, qty_excess: 0, unspecified_jobs: 0 }, ...over,
});

describe("mapGemPurchaseSummary", () => {
  it("แปลงครบ · ประกอบทีละ field · ไม่มีคีย์ราคา/ต้นทุนใน output แม้ DB ส่งแถมมา", () => {
    const raw = summary({ groups: [group({ price: 7391.2468, cost_thb: 12.5, jobs: [job({ price: 9, supplier: "x" })] })] });
    const m = mapGemPurchaseSummary(raw);
    expect(m).not.toBeNull();
    expect(m?.groups[0]).toMatchObject({ canonicalItemId: U(2), label: "โกเมน · ไข่ · 4×6 มม.", qtyRemaining: 6, sizeB: 6 });
    expect(JSON.stringify(m)).not.toMatch(/price|cost|supplier|7391/i);
    expect(m?.totals).toEqual({ groups: 1, jobs: 1, qtyNeededNow: 6, qtyOrdered: 0, qtyRemaining: 6, qtyExcess: 0, unspecifiedJobs: 0 });
  });
  it("ใบที่ติ๊กแล้วแต่ยอดเปลี่ยน: ordered/ที่เหลือ/เกิน/ธง changed ผ่านครบ", () => {
    const j = job({ qty_needed_now: 90, qty_ordered: 70, qty_remaining: 20, is_ordered: true, changed_after_order: true, ordered_at: "2026-10-24T01:00:00+00:00", ordered_by: U(99) });
    const m = mapGemPurchaseSummary(summary({ groups: [group({ jobs: [j], qty_needed_now: 90, qty_ordered: 70, qty_remaining: 20 })] }));
    expect(m?.groups[0].jobs[0]).toMatchObject({ qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true, orderedBy: U(99) });
  });
  it("ใบ unspecified ผ่าน · ว่างได้แม้ groups ว่าง", () => {
    const m = mapGemPurchaseSummary(summary({ groups: [], unspecified_jobs: [{ job_id: U(5), job_no: "JB-0005", design_label: "x", due_date: null }], totals: { groups: 0, jobs: 0, qty_needed_now: 0, qty_ordered: 0, qty_remaining: 0, qty_excess: 0, unspecified_jobs: 1 } }));
    expect(m?.groups).toEqual([]);
    expect(m?.unspecifiedJobs).toEqual([{ jobId: U(5), jobNo: "JB-0005", designLabel: "x", dueDate: null }]);
  });
  it("removed_after_order ผ่าน (ติ๊กแล้วแถวถูกลบ) · ไม่มีราคา · label null ได้", () => {
    const raw = summary({ removed_after_order: [
      { job_id: U(1), job_no: "JB-0001", canonical_item_id: U(2), label: "โกเมน · ไข่ · 4×6 มม.", qty: 3, removed_at: "2026-10-24T01:00:00+00:00", price: 5 },
      { job_id: U(5), job_no: "JB-0005", canonical_item_id: U(6), label: null, qty: 7, removed_at: null },
    ] });
    const m = mapGemPurchaseSummary(raw);
    expect(m?.removedAfterOrder).toEqual([
      { jobId: U(1), jobNo: "JB-0001", canonicalItemId: U(2), label: "โกเมน · ไข่ · 4×6 มม.", qty: 3, removedAt: "2026-10-24T01:00:00+00:00" },
      { jobId: U(5), jobNo: "JB-0005", canonicalItemId: U(6), label: null, qty: 7, removedAt: null },
    ]);
    expect(JSON.stringify(m)).not.toMatch(/price/i);
  });
  it.each([
    ["ไม่ใช่ object", null],
    ["ไม่มี removed_after_order (DB เก่า/ผลผิดรูป)", { ...summary(), removed_after_order: undefined }],
    ["removed_after_order แถวเสีย → ทิ้งทั้งก้อน", summary({ removed_after_order: [{ job_id: "x", job_no: "JB-1", canonical_item_id: U(2), qty: 1 }] })],
    ["removed_after_order qty 0", summary({ removed_after_order: [{ job_id: U(1), job_no: "JB-1", canonical_item_id: U(2), qty: 0 }] })],
    ["groups ไม่ใช่ array", summary({ groups: {} })],
    ["ไม่มี server_now", summary({ server_now: null })],
    ["today_bkk ผิดรูป", summary({ today_bkk: "24/10/2026" })],
    ["จำนวนติดลบ", summary({ groups: [group({ qty_remaining: -1 })] })],
    ["จำนวนทศนิยม", summary({ groups: [group({ qty_needed_now: 1.5 })] })],
    ["จำนวนเป็นข้อความขยะ", summary({ groups: [group({ qty_ordered: "abc" })] })],
    ["id กลุ่มไม่ใช่ uuid", summary({ groups: [group({ canonical_item_id: "x" })] })],
    ["ใบในกลุ่มเสีย 1 ใบ → ทิ้งทั้งก้อน (ไม่แสดงยอดที่ขาด)", summary({ groups: [group({ jobs: [job(), job({ job_no: null })] })] })],
    ["กลุ่มไม่มีใบเลย", summary({ groups: [group({ jobs: [] })] })],
    ["ใบ unspecified เสีย", summary({ unspecified_jobs: [{ job_id: "bad", job_no: "JB-1" }] })],
    ["totals ขาด", summary({ totals: { groups: 1 } })],
  ])("ผลผิดรูป → null: %s", (_n, raw) => {
    expect(mapGemPurchaseSummary(raw)).toBeNull();
  });
});

describe("mapGemPurchaseMark", () => {
  const ok = { requested: 2, changed: 1, unchanged: 1, ordered: true, lines: [{ line_id: U(10), job_id: U(1), job_no: "JB-0001", canonical_item_id: U(2), is_ordered: true, qty_needed_now: 6, qty_ordered: 6, qty_remaining: 0, qty_excess: 0, changed_after_order: false }] };
  it("แปลงครบ + ไม่มีราคา", () => {
    const m = mapGemPurchaseMark({ ...ok, price: 5 });
    expect(m).toMatchObject({ requested: 2, changed: 1, unchanged: 1, ordered: true });
    expect(m?.lines[0]).toMatchObject({ lineId: U(10), isOrdered: true, qtyRemaining: 0 });
    expect(JSON.stringify(m)).not.toMatch(/price|cost/i);
  });
  it.each([["ordered ไม่ใช่ boolean", { ...ok, ordered: "true" }], ["lines ไม่ใช่ array", { ...ok, lines: null }], ["changed ติดลบ", { ...ok, changed: -1 }], ["แถวเสีย", { ...ok, lines: [{ ...ok.lines[0], line_id: "x" }] }]])("ผิดรูป → null: %s", (_n, raw) => {
    expect(mapGemPurchaseMark(raw)).toBeNull();
  });
});

describe("mapGemPurchaseCost", () => {
  const cg = (over: Record<string, unknown> = {}) => ({
    canonical_item_id: U(2), qty_remaining: 6, qty_ordered: 0, cost_remaining_thb: 12.5, cost_ordered_thb: 0, missing_price_remaining: false, missing_price_ordered: false, missing_price: false, ...over,
  });
  const cost = (over: Record<string, unknown> = {}) => ({
    today_bkk: "2026-10-24", groups: [cg()], totals: { groups: 1, groups_missing_price: 0, cost_remaining_thb: 12.5, cost_ordered_thb: 0, complete: true }, ...over,
  });
  it("แปลงครบ", () => {
    expect(mapGemPurchaseCost(cost())).toEqual({
      todayBkk: "2026-10-24",
      groups: [{ canonicalItemId: U(2), qtyRemaining: 6, qtyOrdered: 0, costRemainingThb: 12.5, costOrderedThb: 0, missingPriceRemaining: false, missingPriceOrdered: false, missingPrice: false }],
      totals: { groups: 1, groupsMissingPrice: 0, costRemainingThb: 12.5, costOrderedThb: 0, complete: true },
    });
  });
  it("ไม่มีราคา = null + ธง (ไม่เดาเป็น 0) · complete=false", () => {
    const m = mapGemPurchaseCost(cost({
      groups: [cg({ cost_remaining_thb: null, missing_price_remaining: true, missing_price: true })],
      totals: { groups: 1, groups_missing_price: 1, cost_remaining_thb: 0, cost_ordered_thb: 0, complete: false },
    }));
    expect(m?.groups[0].costRemainingThb).toBeNull();
    expect(m?.groups[0].missingPrice).toBe(true);
    expect(m?.totals.complete).toBe(false);
  });
  it.each([
    ["null แต่ไม่มีธง missing", cost({ groups: [cg({ cost_remaining_thb: null })] })],
    ["มีธง missing แต่มีตัวเลข", cost({ groups: [cg({ missing_price_remaining: true })] })],
    ["ต้นทุนติดลบ", cost({ groups: [cg({ cost_remaining_thb: -1 })] })],
    ["รวมติดลบ", cost({ totals: { groups: 1, groups_missing_price: 0, cost_remaining_thb: -5, cost_ordered_thb: 0, complete: true } })],
    ["complete ไม่ใช่ boolean", cost({ totals: { groups: 1, groups_missing_price: 0, cost_remaining_thb: 1, cost_ordered_thb: 0, complete: 1 } })],
    ["ไม่ใช่ object", "x"],
  ])("ผิดรูป/ขัดกัน → null: %s", (_n, raw) => {
    expect(mapGemPurchaseCost(raw)).toBeNull();
  });
});
