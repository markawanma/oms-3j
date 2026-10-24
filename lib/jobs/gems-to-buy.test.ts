// lib/jobs/gems-to-buy.ts (G1b UI): view จาก summary (orderedBy = me/other · ไม่มี uuid) · แถวต่อแท็บ · เร่งด่วนจาก today_bkk · กรอง/เรียง · URL · scope เลือก ∩ ที่เห็น · undo เฉพาะแถวสะอาด
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GEM_PURCHASE_MAX_LINES, mapGemPurchaseSummary } from "./gem-purchase";
import {
  GTB_EMPTY_FILTERS,
  GTB_MAX_LINES_PER_MARK,


  applyFilters,
  buildGtbQuery,
  copyButtonLabel,
  countUrgent,
  distinctJobCount,
  lineIdsOfRows,

  parseGtbParams,
  resolveScope,
  rowsForTab,
  serverClock,
  sortRows,
  toGemsToBuyView,
  urgencyOf,
  visibleSelected,
} from "./gems-to-buy";
import type { GtbGroup, GtbJob } from "./gems-to-buy";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(900);

const withLines = (j: Omit<GtbJob, "lines"> & { lines?: GtbJob["lines"] }): GtbJob => ({ ...j, lines: j.lines ?? j.lineIds.map((id) => ({ lineId: id, qtyNeededNow: Math.floor(j.qtyNeededNow / j.lineIds.length), orderedQty: null })) });
const job = (n: number, o: Partial<GtbJob> = {}): GtbJob => withLines({
  jobId: U(1000 + n), jobNo: `JB-${String(n).padStart(4, "0")}`, designLabel: `แบบ ${n}`, dueDate: "2026-11-10", qtyNeededNow: 10, qtyOrdered: 0, qtyRemaining: 10, qtyExcess: 0,
  isOrdered: false, changedAfterOrder: false, orderedAt: null, orderedBy: null, lineIds: [U(2000 + n)], ...o,
});
const group = (n: number, jobs: GtbJob[], o: Partial<GtbGroup> = {}): GtbGroup => ({
  canonicalItemId: U(n), typeId: U(100), typeName: "โกเมน", shapeId: U(200), shapeName: "ไข่", sizeA: 4, sizeB: 6, sizeLabel: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
  qtyNeededNow: jobs.reduce((s, j) => s + j.qtyNeededNow, 0), qtyOrdered: jobs.reduce((s, j) => s + j.qtyOrdered, 0), qtyRemaining: jobs.reduce((s, j) => s + j.qtyRemaining, 0), qtyExcess: jobs.reduce((s, j) => s + j.qtyExcess, 0),
  jobCount: jobs.length, earliestDue: null, earliestDueRemaining: null, jobs, ...o,
});
const TODAY = "2026-10-24";

describe("ค่าคงที่ซ้ำกับ backend", () => {
  it("GTB_MAX_LINES_PER_MARK เท่ากับ GEM_PURCHASE_MAX_LINES (ไม่ import runtime เพื่อไม่ลากโมดูลราคา)", () => {
    expect(GTB_MAX_LINES_PER_MARK).toBe(GEM_PURCHASE_MAX_LINES);
    expect(GTB_MAX_LINES_PER_MARK).toBe(200);
  });
  it("gems-to-buy.ts ไม่ import runtime จากโมดูลราคา (import type เท่านั้น) และไม่มีคำเรื่องราคา/ต้นทุนในโค้ด", () => {
    const src = readFileSync(join(process.cwd(), "lib/jobs/gems-to-buy.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");
    expect(/^\s*import\s+(?!type\b)[^;]*from\s*["']@\/lib\/(?:jobs\/gem-purchase|actions\/gems|jobs\/gems)["']/m.test(code)).toBe(false);
    expect(/\bprice\b|\bcost\b|ราคา|ต้นทุน|฿|บาท/i.test(code)).toBe(false);
  });
});

describe("toGemsToBuyView", () => {
  const raw = {
    server_now: "2026-10-24T14:32:10+07:00", today_bkk: TODAY,
    groups: [{
      canonical_item_id: U(1), type_id: U(100), type_name: "โกเมน", shape_id: U(200), shape_name: "ไข่", size_a: 4, size_b: 6, size_label: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
      qty_needed_now: 20, qty_ordered: 10, qty_remaining: 10, qty_excess: 0, job_count: 2, earliest_due: "2026-10-22", earliest_due_remaining: "2026-10-28", line_ids: [U(11), U(12)],
      jobs: [
        { job_id: U(21), job_no: "JB-0021", design_label: "ก", due_date: "2026-10-22", qty_needed_now: 10, qty_ordered: 10, qty_remaining: 0, qty_excess: 0, is_ordered: true, changed_after_order: false, ordered_at: "2026-10-23T03:00:00+00:00", ordered_by: ME, line_ids: [U(11)], lines: [{ line_id: U(11), qty_needed_now: 10, ordered_qty: 10 }] },
        { job_id: U(22), job_no: "JB-0022", design_label: "ข", due_date: "2026-10-28", qty_needed_now: 10, qty_ordered: 0, qty_remaining: 10, qty_excess: 0, is_ordered: false, changed_after_order: false, ordered_at: null, ordered_by: null, line_ids: [U(12)], lines: [{ line_id: U(12), qty_needed_now: 10, ordered_qty: null }] },
      ],
    }],
    unspecified_jobs: [], removed_after_order: [], totals: { groups: 1, jobs: 2, qty_needed_now: 20, qty_ordered: 10, qty_remaining: 10, qty_excess: 0, unspecified_jobs: 0 },
  };
  const summary = mapGemPurchaseSummary(raw);

  it("ผู้ติ๊กเป็น session ตัวเอง = me · คนอื่น = other · ไม่มีผู้ติ๊ก = null · ไม่มี uuid หลุดใน view", () => {
    expect(summary).not.toBeNull();
    const mine = toGemsToBuyView(summary!, ME);
    expect(mine.groups[0].jobs.map((j) => j.orderedBy)).toEqual(["me", null]);
    const other = toGemsToBuyView(summary!, U(901));
    expect(other.groups[0].jobs[0].orderedBy).toBe("other");
    expect(toGemsToBuyView(summary!, null).groups[0].jobs[0].orderedBy).toBe("other");
    expect(JSON.stringify(mine)).not.toContain(ME);
    expect(JSON.stringify(mine)).not.toMatch(/price|cost|ราคา|ต้นทุน/i);
  });
  it("เทียบ uuid ไม่สนตัวพิมพ์", () => {
    expect(toGemsToBuyView(summary!, ME.toUpperCase()).groups[0].jobs[0].orderedBy).toBe("me");
  });
  it("serverClock: HH:mm จาก server_now (ไม่ใช้นาฬิกา client) · รูปผิด = ว่าง", () => {
    expect(serverClock("2026-10-24T14:32:10+07:00")).toBe("14:32");
    expect(serverClock("garbage")).toBe("");
  });
});

describe("rowsForTab — ยังไม่สั่ง vs สั่งแล้ว", () => {
  const partial = group(1, [job(1, { qtyOrdered: 10, qtyRemaining: 0, isOrdered: true, dueDate: "2026-10-22" }), job(2, { dueDate: "2026-10-28" })]);
  const allOrdered = group(2, [job(3, { qtyOrdered: 10, qtyRemaining: 0, isOrdered: true })], { sizeA: 2, sizeB: null, sizeLabel: "2", label: "โกเมน · ไข่ · 2 มม." });
  const none = group(3, [job(4)], { sizeA: 3, sizeB: null, sizeLabel: "3", label: "โกเมน · ไข่ · 3 มม." });
  const groups = [partial, allOrdered, none];

  it("แท็บยังไม่สั่ง: เฉพาะใบที่ยังเหลือ · ยอด = qtyRemaining ของ DB · กำหนดเร็วสุดนับเฉพาะใบที่เหลือ", () => {
    const rows = rowsForTab(groups, "pending");
    expect(rows.map((r) => r.key)).toEqual([U(1), U(3)]);
    expect(rows[0]).toMatchObject({ qty: 10, earliestDue: "2026-10-28" });
    expect(rows[0].jobs.map((j) => j.jobNo)).toEqual(["JB-0002"]);
    expect(rows[0].lineIds).toEqual([U(2002)]);
  });
  it("แท็บสั่งแล้ว: เฉพาะใบที่ติ๊กไว้ · ยอด = qtyOrdered ของ DB", () => {
    const rows = rowsForTab(groups, "ordered");
    expect(rows.map((r) => r.key)).toEqual([U(1), U(2)]);
    expect(rows[0]).toMatchObject({ qty: 10, earliestDue: "2026-10-22" });
    expect(rows[0].jobs.map((j) => j.jobNo)).toEqual(["JB-0001"]);
  });
  it("รายการเดียวขึ้นได้ทั้งสองแท็บ (สั่งบางใบแล้ว) แต่ line ids ไม่ปนกัน", () => {
    const p = rowsForTab([partial], "pending")[0];
    const o = rowsForTab([partial], "ordered")[0];
    expect(p.lineIds).not.toEqual(o.lineIds);
    expect(p.lineIds.filter((id) => o.lineIds.includes(id))).toEqual([]);
  });
  it("ใบ 'ใบแก้จำนวนหลังสั่ง' (ติ๊ก 70 ตอนนี้ 90): อยู่ทั้งสองแท็บ · เหลือ 20 และ qtyExcess แยกกัน ไม่หักลบ", () => {
    const g = group(5, [job(9, { qtyNeededNow: 90, qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true })]);
    expect(rowsForTab([g], "pending")[0].qty).toBe(20);
    expect(rowsForTab([g], "ordered")[0].qty).toBe(70);
    const over = group(6, [job(10, { qtyNeededNow: 50, qtyOrdered: 70, qtyRemaining: 0, qtyExcess: 20, isOrdered: true })]);
    expect(rowsForTab([over], "pending")).toEqual([]);
    expect(rowsForTab([over], "ordered")[0].group.qtyExcess).toBe(20);
  });
});

describe("urgencyOf — นับจาก today_bkk ที่ DB ส่ง", () => {
  it("เลยกำหนด n วัน · ครบวันนี้/ใน n วัน (≤ 3) · ไกลกว่า = later · ไม่มีกำหนด = nodate", () => {
    expect(urgencyOf("2026-10-22", TODAY)).toEqual({ kind: "overdue", days: 2 });
    expect(urgencyOf("2026-10-24", TODAY)).toEqual({ kind: "soon", days: 0 });
    expect(urgencyOf("2026-10-27", TODAY)).toEqual({ kind: "soon", days: 3 });
    expect(urgencyOf("2026-10-28", TODAY)).toEqual({ kind: "later" });
    expect(urgencyOf(null, TODAY)).toEqual({ kind: "nodate" });
  });
  it("ข้ามเดือน/ปี", () => {
    expect(urgencyOf("2026-11-01", "2026-10-30")).toEqual({ kind: "soon", days: 2 });
    expect(urgencyOf("2026-12-30", "2027-01-02")).toEqual({ kind: "overdue", days: 3 });
  });
});

describe("กรอง / เรียง", () => {
  const A = group(1, [job(1, { dueDate: "2026-10-26" })], { typeId: U(100), typeName: "โกเมน", shapeId: U(200), shapeName: "ไข่", sizeA: 4, sizeB: 6, sizeLabel: "4×6", label: "โกเมน · ไข่ · 4×6 มม." });
  const B = group(2, [job(2, { dueDate: null })], { typeId: U(101), typeName: "ทับทิม", shapeId: U(201), shapeName: "กลม", sizeA: 1.5, sizeB: null, sizeLabel: "1.5", label: "ทับทิม · กลม · 1.5 มม." });
  const C = group(3, [job(3, { dueDate: "2026-10-20" })], { typeId: U(100), typeName: "โกเมน", shapeId: U(201), shapeName: "กลม", sizeA: 2, sizeB: null, sizeLabel: "2", label: "โกเมน · กลม · 2 มม." });
  const D = group(4, [job(4, { dueDate: "2026-12-01" })], { typeId: U(102), typeName: "ไพลิน", shapeId: U(201), shapeName: "กลม", sizeA: 2, sizeB: null, sizeLabel: "2", label: "ไพลิน · กลม · 2 มม." });
  const rows = rowsForTab([A, B, C, D], "pending");

  it("เรียงเร่งด่วน: เลยกำหนด → ใกล้ → ไกล · ไม่ระบุกำหนดท้ายสุด", () => {
    expect(sortRows(rows, "urgent").map((r) => r.group.label)).toEqual(["โกเมน · กลม · 2 มม.", "โกเมน · ไข่ · 4×6 มม.", "ไพลิน · กลม · 2 มม.", "ทับทิม · กลม · 1.5 มม."]);
  });
  it("เรียงตามชนิด: ชนิด → รูปทรง → ขนาด", () => {
    expect(sortRows(rows, "type").map((r) => r.group.typeName + r.group.shapeName)).toEqual(["โกเมนกลม", "โกเมนไข่", "ทับทิมกลม", "ไพลินกลม"]);
  });
  it("ไม่แก้ array เดิม", () => {
    const before = rows.map((r) => r.key);
    sortRows(rows, "type");
    expect(rows.map((r) => r.key)).toEqual(before);
  });
  it("ค้นหาไม่สนช่องว่าง/วรรคตอน (ไข่4×6 เจอ โกเมน · ไข่ · 4×6)", () => {
    expect(applyFilters(rows, { ...GTB_EMPTY_FILTERS, q: "ไข่4×6" }, TODAY).map((r) => r.key)).toEqual([U(1)]);
    expect(applyFilters(rows, { ...GTB_EMPTY_FILTERS, q: "ทับ ทิม" }, TODAY).map((r) => r.key)).toEqual([U(2)]);
  });
  it("ชนิด/รูปทรง/เร่งด่วน (เลยกำหนด+ครบใน 3 วัน — ไม่ระบุกำหนดไม่นับ)", () => {
    expect(applyFilters(rows, { ...GTB_EMPTY_FILTERS, typeId: U(100) }, TODAY)).toHaveLength(2);
    expect(applyFilters(rows, { ...GTB_EMPTY_FILTERS, shapeId: U(201) }, TODAY)).toHaveLength(3);
    expect(applyFilters(rows, { ...GTB_EMPTY_FILTERS, urgent: true }, TODAY).map((r) => r.key).sort()).toEqual([U(1), U(3)].sort());
  });
  it("จำนวนเร่งด่วน = นับหลังกรองอื่น ไม่รวมตัวกรองเร่งด่วนเอง", () => {
    expect(countUrgent(rows, GTB_EMPTY_FILTERS, TODAY)).toBe(2);
    expect(countUrgent(rows, { ...GTB_EMPTY_FILTERS, urgent: true }, TODAY)).toBe(2);
    expect(countUrgent(rows, { ...GTB_EMPTY_FILTERS, typeId: U(101) }, TODAY)).toBe(0);
  });
  it("จำนวนใบไม่ซ้ำ", () => {
    const g = group(7, [job(1), job(2)]);
    const g2 = group(8, [job(1)], { sizeA: 9, sizeLabel: "9", label: "x" });
    expect(distinctJobCount(rowsForTab([g, g2], "pending"))).toBe(2);
  });
});

describe("URL state — ไม่เชื่อ query string", () => {
  it("parse: ค่าผิดรูป → ค่าเริ่ม · uuid ผิดรูปทิ้ง · q ตัด 80", () => {
    expect(parseGtbParams({})).toEqual({ tab: "pending", filters: GTB_EMPTY_FILTERS });
    const p = parseGtbParams({ tab: "ordered", q: "x".repeat(200), type: "not-a-uuid", shape: U(5), sort: "type", urgent: "1" });
    expect(p.tab).toBe("ordered");
    expect(p.filters).toEqual({ q: "x".repeat(80), typeId: "", shapeId: U(5), urgent: true, sort: "type" });
    expect(parseGtbParams({ tab: ["ordered", "x"], sort: "evil", urgent: "yes" })).toEqual({ tab: "ordered", filters: GTB_EMPTY_FILTERS });
  });
  it("build ↔ parse ไปกลับได้ · ค่าเริ่มไม่อยู่ใน URL", () => {
    expect(buildGtbQuery("pending", GTB_EMPTY_FILTERS)).toBe("");
    const f = { q: "โกเมน", typeId: U(100), shapeId: U(200), urgent: true, sort: "type" as const };
    const qs = buildGtbQuery("ordered", f);
    const back = parseGtbParams(Object.fromEntries(new URLSearchParams(qs)));
    expect(back).toEqual({ tab: "ordered", filters: f });
  });
});

describe("scope ของคัดลอก/ติ๊ก — เลือก ∩ ที่เห็น", () => {
  const rows = rowsForTab([group(1, [job(1)]), group(2, [job(2)], { sizeLabel: "2", label: "b" }), group(3, [job(3)], { sizeLabel: "3", label: "c" })], "pending");
  it("ไม่เลือก/ไม่กรอง = ทั้งหมด (ปุ่มบอกจำนวน)", () => {
    const s = resolveScope(rows, new Set(), 3, false);
    expect(s.kind).toBe("all");
    expect(copyButtonLabel(s)).toBe("คัดลอกไปส่งร้านพลอย (3)");
  });
  it("กรองแล้วไม่ได้เลือก = ตามตัวกรอง (n จาก N)", () => {
    const s = resolveScope(rows.slice(0, 1), new Set(), 3, true);
    expect(copyButtonLabel(s)).toBe("คัดลอกตามตัวกรอง (1 จาก 3)");
  });
  it("เลือก 2 = ที่เลือก (2)", () => {
    const s = resolveScope(rows, new Set([rows[0].key, rows[2].key]), 3, false);
    expect(s.kind).toBe("selected");
    expect(copyButtonLabel(s)).toBe("คัดลอกที่เลือก (2)");
    expect(s.rows.map((r) => r.key)).toEqual([rows[0].key, rows[2].key]);
  });
  it("รายการที่เลือกไว้แต่ถูกซ่อนด้วยตัวกรอง ไม่ถูกนับ/ไม่ถูกกระทำ (เคสห้ามผ่าน: หลุดรายการที่ซ่อน)", () => {
    const visible = rows.slice(0, 1);
    const selected = new Set([rows[0].key, rows[1].key, rows[2].key]);
    expect(visibleSelected(selected, visible).map((r) => r.key)).toEqual([rows[0].key]);
    const s = resolveScope(visible, selected, 3, true);
    expect(s.kind).toBe("selected");
    expect(s.rows).toHaveLength(1);
    expect(lineIdsOfRows(s.rows)).toEqual(rows[0].lineIds);
  });
  it("เลือกแต่ทุกตัวถูกซ่อน = ตกกลับเป็นตามตัวกรอง (ไม่ใช่ 0 รายการเงียบๆ)", () => {
    const s = resolveScope(rows.slice(0, 1), new Set([rows[2].key]), 3, true);
    expect(s.kind).toBe("filtered");
    expect(s.rows).toHaveLength(1);
  });
  it("0 รายการ = scope ว่าง", () => {
    expect(resolveScope([], new Set(), 0, false).rows).toEqual([]);
  });
  it("lineIdsOfRows ไม่ซ้ำ", () => {
    const g = group(1, [job(1, { lineIds: [U(1), U(2)] }), job(2, { lineIds: [U(2), U(3)] })]);
    expect(lineIdsOfRows(rowsForTab([g], "pending"))).toEqual([U(1), U(2), U(3)]);
  });
});

