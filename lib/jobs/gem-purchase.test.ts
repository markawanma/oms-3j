// lib/jobs/gem-purchase.ts (0192 G1b): mapper ประกอบทีละ field · ไม่มีราคาใน summary/mark · ผลผิดรูป = null ทั้งก้อน · ต้นทุน null ต้องสอดคล้องกับธง missing_price
import { describe, expect, it } from "vitest";
import { mapGemPurchaseCost, mapGemPurchaseMark, mapGemPurchaseSummary } from "./gem-purchase";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const job = (over: Record<string, unknown> = {}) => ({
  job_id: U(1), job_no: "JB-0001", design_label: "แหวนทดสอบ", due_date: "2026-11-01", qty_needed_now: 6, qty_ordered: 0, qty_remaining: 6, qty_excess: 0,
  is_ordered: false, changed_after_order: false, ordered_at: null, ordered_by: null, line_ids: [U(10)], lines: [{ line_id: U(10), qty_needed_now: 6, ordered_qty: null }], ...over,
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
    const j = job({ qty_needed_now: 90, qty_ordered: 70, qty_remaining: 20, is_ordered: true, changed_after_order: true, ordered_at: "2026-10-24T01:00:00+00:00", ordered_by: U(99), lines: [{ line_id: U(10), qty_needed_now: 90, ordered_qty: 70 }] });
    const m = mapGemPurchaseSummary(summary({ groups: [group({ jobs: [j], qty_needed_now: 90, qty_ordered: 70, qty_remaining: 20 })] }));
    expect(m?.groups[0].jobs[0]).toMatchObject({ qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true, orderedBy: U(99) });
  });
  it("ใบหลาย line ของรายการเดียวกัน (หลังรวมชื่อ): ยอดต่อ line ผ่านครบ · ผลรวม = ยอดของใบ · ใช้เป็น expected ของ markGemPurchase ได้ตรงๆ", () => {
    const j = job({ qty_needed_now: 8, qty_remaining: 5, qty_ordered: 3, line_ids: [U(10), U(11)], lines: [{ line_id: U(10), qty_needed_now: 6, ordered_qty: 3 }, { line_id: U(11), qty_needed_now: 2, ordered_qty: null }] });
    const m = mapGemPurchaseSummary(summary({ groups: [group({ jobs: [j], line_ids: [U(10), U(11)], qty_needed_now: 8, qty_remaining: 5, qty_ordered: 3 })] }));
    const lines = m?.groups[0].jobs[0].lines;
    expect(lines).toEqual([{ lineId: U(10), qtyNeededNow: 6, orderedQty: 3 }, { lineId: U(11), qtyNeededNow: 2, orderedQty: null }]);
    expect(lines?.reduce((n, l) => n + l.qtyNeededNow, 0)).toBe(m?.groups[0].jobs[0].qtyNeededNow);
    const expected = Object.fromEntries((lines ?? []).map((l) => [l.lineId, l.qtyNeededNow]));
    expect(expected).toEqual({ [U(10)]: 6, [U(11)]: 2 });
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
    ["N6: line_ids ของกลุ่มเกินเพดาน 500 → null (ไม่ตัดเงียบ)", summary({ groups: [group({ line_ids: Array.from({ length: 501 }, (_v, i) => U(i + 1)) })] })],
    ["N6: line_ids ของกลุ่มมีค่าที่ไม่ใช่ uuid → null (ไม่ทิ้งเงียบ)", summary({ groups: [group({ line_ids: [U(10), "x"] })] })],
    ["N6: line_ids ของกลุ่มว่าง → null", summary({ groups: [group({ line_ids: [] })] })],
    ["N6: line_ids ของใบเกิน 30 → null", summary({ groups: [group({ jobs: [job({ line_ids: Array.from({ length: 31 }, (_v, i) => U(i + 1)) })] })] })],
    ["lines ต่อ line: ขาด lines → null", summary({ groups: [group({ jobs: [{ ...job(), lines: undefined }] })] })],
    ["lines ว่าง → null", summary({ groups: [group({ jobs: [job({ lines: [] })] })] })],
    ["lines: line_id ไม่ใช่ uuid → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: "x", qty_needed_now: 6, ordered_qty: null }] })] })] })],
    ["lines: ยอดเป็นข้อความ → null (ไม่ coerce)", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(10), qty_needed_now: "6", ordered_qty: null }] })] })] })],
    ["lines: ยอด 0/ทศนิยม → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(10), qty_needed_now: 0, ordered_qty: null }] })] })] })],
    ["lines: ordered_qty ผิดรูป (0 · ข้อความ · ขาด key) → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(10), qty_needed_now: 6, ordered_qty: 0 }] })] })] })],
    ["lines: ordered_qty เป็นข้อความ → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(10), qty_needed_now: 6, ordered_qty: "5" }] })] })] })],
    ["lines: ขาด key ordered_qty → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(10), qty_needed_now: 6 }] })] })] })],
    ["lines: id ไม่ตรง line_ids → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(11), qty_needed_now: 6, ordered_qty: null }] })] })] })],
    ["lines: ผลรวมยอด ≠ ยอดของใบ → null", summary({ groups: [group({ jobs: [job({ lines: [{ line_id: U(10), qty_needed_now: 5, ordered_qty: null }] })] })] })],
    ["lines: line_id ซ้ำ → null", summary({ groups: [group({ jobs: [job({ line_ids: [U(10), U(10)], qty_needed_now: 12, lines: [{ line_id: U(10), qty_needed_now: 6, ordered_qty: null }, { line_id: U(10), qty_needed_now: 6, ordered_qty: null }] })] })] })],
    ["lines เกิน 30 → null", summary({ groups: [group({ jobs: [job({ lines: Array.from({ length: 31 }, (_v, i) => ({ line_id: U(i + 1), qty_needed_now: 1, ordered_qty: null })) })] })] })],
    ["N6: line_ids ของใบมีค่าเสีย → null",summary({ groups: [group({ jobs: [job({ line_ids: [U(10), 5] })] })] })],
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
  const ok = { requested: 2, changed: 1, unchanged: 1, ordered: true, lines: [{ line_id: U(10), job_id: U(1), job_no: "JB-0001", canonical_item_id: U(2), is_ordered: true, qty_needed_now: 6, qty_ordered: 6, qty_remaining: 0, qty_excess: 0, changed_after_order: false, prev_ordered_qty: null, new_ordered_qty: 6 }] };
  it("แปลงครบ + ไม่มีราคา", () => {
    const m = mapGemPurchaseMark({ ...ok, price: 5 });
    expect(m).toMatchObject({ requested: 2, changed: 1, unchanged: 1, ordered: true });
    expect(m?.lines[0]).toMatchObject({ lineId: U(10), isOrdered: true, qtyRemaining: 0 });
    expect(JSON.stringify(m)).not.toMatch(/price|cost/i);
  });
  it("M1 ทางยาว: prev_ordered_qty (null = ไม่เคยติ๊ก) / new_ordered_qty ผ่านครบ · ยกเลิกติ๊ก: prev มีค่า new = null", () => {
    const mk = (over: Record<string, unknown>) => ({ ...ok, lines: [{ ...ok.lines[0], ...over }] });
    expect(mapGemPurchaseMark(mk({ prev_ordered_qty: null, new_ordered_qty: 6 }))?.lines[0]).toMatchObject({ prevOrderedQty: null, newOrderedQty: 6 });
    expect(mapGemPurchaseMark(mk({ prev_ordered_qty: 5, new_ordered_qty: 10 }))?.lines[0]).toMatchObject({ prevOrderedQty: 5, newOrderedQty: 10 });
    expect(mapGemPurchaseMark(mk({ prev_ordered_qty: 6, new_ordered_qty: null }))?.lines[0]).toMatchObject({ prevOrderedQty: 6, newOrderedQty: null });
  });
  it.each([
    ["ขาด key prev_ordered_qty (ไม่เดาว่าไม่เคยติ๊ก — จะเปิดปุ่มย้อนผิด)", (() => { const { prev_ordered_qty: _p, ...rest } = ok.lines[0]; void _p; return { ...ok, lines: [rest] }; })()],
    ["ขาด key new_ordered_qty", (() => { const { new_ordered_qty: _n, ...rest } = ok.lines[0]; void _n; return { ...ok, lines: [rest] }; })()],
    ["prev = 0", { ...ok, lines: [{ ...ok.lines[0], prev_ordered_qty: 0 }] }],
    ["prev ทศนิยม", { ...ok, lines: [{ ...ok.lines[0], prev_ordered_qty: 1.5 }] }],
    ["new ติดลบ", { ...ok, lines: [{ ...ok.lines[0], new_ordered_qty: -1 }] }],
    ["prev เป็นข้อความ", { ...ok, lines: [{ ...ok.lines[0], prev_ordered_qty: "5" }] }],
  ])("ผลผิดรูป → null: %s", (_n, raw) => {
    expect(mapGemPurchaseMark(raw)).toBeNull();
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
  it("N7: missingPrice = missingPriceRemaining || missingPriceOrdered (ไม่เชื่อธง missing_price ที่ DB ส่งแยก)", () => {
    const m = mapGemPurchaseCost(cost({
      groups: [cg({ cost_ordered_thb: null, missing_price_ordered: true, missing_price: false })],
      totals: { groups: 1, groups_missing_price: 1, cost_remaining_thb: 12.5, cost_ordered_thb: 0, complete: false },
    }));
    expect(m?.groups[0].missingPrice).toBe(true);
    const m2 = mapGemPurchaseCost(cost({ groups: [cg({ missing_price: true })] }));
    expect(m2?.groups[0].missingPrice).toBe(false);
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
