// lib/jobs/history.ts + dates (bkkDateOf / thaiMonthYear) — pure: map · ยอดทั้งต้นไม้ · ค้นหา · ตัวกรอง · เดือน · ส่วนเหลือ
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  HISTORY_COLUMNS,
  HISTORY_TREE_COLUMNS,
  applyHistoryFilters,
  applyTreeTotals,
  closedDateOf,
  closedMonthOf,
  historyQuery,
  isFiltered,
  isSurplusPending,
  mapHistoryRow,
  matchesSearch,
  monthOptions,
  parseHistoryFilters,
  surplusQty,
} from "@/lib/jobs/history";
import type { HistoryRow } from "@/lib/jobs/history";
import { bkkDateOf, thaiMonthYear } from "@/lib/jobs/dates";

const raw = (o: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", job_no: "JB-0018", seq: 18, source_kind: "oem", design_label: "แหวนโกเมนไข่", sku_snapshot: "RG-001", metal: "silver",
  qty_order: 50, qty_planned: 50, qty_good: 45, qty_scrap: 3, status: "done", done_at: "2026-10-19T10:00:00Z", cancelled_at: null, cancel_reason: null, surplus_disposition: "hold", updated_at: "2026-10-19T10:00:00Z", ...o,
});
const row = (o: Partial<HistoryRow> = {}): HistoryRow => ({ ...mapHistoryRow(raw())!, ...o });

describe("HISTORY_COLUMNS — whitelist (ไม่มีราคา/ลูกค้า/source_ref)", () => {
  it("ตรงสเปกเป๊ะ", () => {
    expect(HISTORY_COLUMNS.split(", ")).toEqual(["id", "job_no", "seq", "source_kind", "design_label", "sku_snapshot", "metal", "qty_order", "qty_planned", "qty_good", "qty_scrap", "status", "done_at", "cancelled_at", "cancel_reason", "surplus_disposition", "updated_at"]);
    expect(HISTORY_COLUMNS).not.toMatch(/source_ref|price|cost|customer|buyer|amount|thb|quote|note\b|weight/i);
    expect(HISTORY_TREE_COLUMNS).toBe("root_job_id, qty_done_good, qty_scrap_total");
  });
});

describe("mapHistoryRow", () => {
  it("แปลงฟิลด์ · closedAt = done_at", () => {
    expect(mapHistoryRow(raw())).toMatchObject({ jobNo: "JB-0018", seq: 18, status: "done", qtyOrder: 50, qtyGood: 45, qtyScrap: 3, metal: "silver", sku: "RG-001", closedAt: "2026-10-19T10:00:00Z" });
  });
  it("ยกเลิก: closedAt = cancelled_at เมื่อไม่มี done_at · มีทั้งคู่ = done_at ก่อน", () => {
    expect(mapHistoryRow(raw({ status: "cancelled", done_at: null, cancelled_at: "2026-10-05T01:00:00Z", cancel_reason: "ลูกค้ายกเลิก" }))).toMatchObject({ status: "cancelled", closedAt: "2026-10-05T01:00:00Z", cancelReason: "ลูกค้ายกเลิก" });
    expect(mapHistoryRow(raw({ done_at: "2026-10-19T10:00:00Z", cancelled_at: "2026-10-01T00:00:00Z" }))?.closedAt).toBe("2026-10-19T10:00:00Z");
  });
  it("ไม่มีเวลาปิดเลย = closedAt null (ไม่เดา)", () => {
    expect(mapHistoryRow(raw({ done_at: null, cancelled_at: null }))?.closedAt).toBeNull();
  });
  it("status ที่ไม่ใช่ done/cancelled · ไม่มี id/เลขใบ = ทิ้ง", () => {
    for (const s of ["open", "in_progress", "on_hold", "hack", null]) expect(mapHistoryRow(raw({ status: s })), String(s)).toBeNull();
    expect(mapHistoryRow(raw({ id: "" }))).toBeNull();
    expect(mapHistoryRow(raw({ job_no: null }))).toBeNull();
  });
  it("qty_order ไม่มี = ใช้ qty_planned · ตัวเลขผิดชนิด = null/0 (ไม่พัง)", () => {
    expect(mapHistoryRow(raw({ qty_order: null, qty_planned: 30 }))?.qtyOrder).toBe(30);
    expect(mapHistoryRow(raw({ qty_good: "45", qty_scrap: NaN }))).toMatchObject({ qtyGood: null, qtyScrap: null });
  });
  it("ไม่หลุด field นอกสเปก (ราคา/ลูกค้า/source_ref ที่ใครเผลอ select มา)", () => {
    const m = mapHistoryRow(raw({ source_ref: "QT-2608-001", price: 1000, customer_name: "คุณเอ", unit_cost: 5 })) as unknown as Record<string, unknown>;
    for (const k of ["sourceRef", "source_ref", "price", "customer_name", "unit_cost"]) expect(m).not.toHaveProperty(k);
    expect(JSON.stringify(m)).not.toMatch(/QT-2608|คุณเอ|1000/);
  });
});

describe("applyTreeTotals — ยอดทั้งต้นไม้", () => {
  it("ใบแม่ที่แบ่งส่วน/arrived: ดี 47 เสีย 3 จากสรุปต้นไม้ ไม่ใช่ 45 ของใบแม่ล้วน (JB-0018)", () => {
    const r = applyTreeTotals(row({ qtyGood: 45, qtyScrap: 3 }), { root_job_id: "x", qty_done_good: 47, qty_scrap_total: 3 });
    expect(r).toMatchObject({ qtyGood: 47, qtyScrap: 3 });
  });
  it("ไม่มีสรุป = คงยอดเดิม · ใบยกเลิก = ไม่แตะ · ฟิลด์ผิดชนิด = คงเดิม", () => {
    expect(applyTreeTotals(row(), undefined)).toMatchObject({ qtyGood: 45, qtyScrap: 3 });
    expect(applyTreeTotals(row({ status: "cancelled" }), { qty_done_good: 99, qty_scrap_total: 9 })).toMatchObject({ qtyGood: 45, qtyScrap: 3 });
    expect(applyTreeTotals(row(), { qty_done_good: "x", qty_scrap_total: null })).toMatchObject({ qtyGood: 45, qtyScrap: 3 });
  });
});

describe("isSurplusPending / surplusQty", () => {
  it("done + ดี > สั่ง + hold = ค้างตัดสิน · เหลือ n", () => {
    const r = row({ qtyGood: 53, qtyOrder: 50, surplusDisposition: "hold" });
    expect(isSurplusPending(r)).toBe(true);
    expect(surplusQty(r)).toBe(3);
  });
  it("ต้องไม่ติด: ตัดสินแล้ว (stock/keep) · ดี = สั่ง · ดี < สั่ง · ยกเลิก · ดี null", () => {
    expect(isSurplusPending(row({ qtyGood: 53, qtyOrder: 50, surplusDisposition: "stock" }))).toBe(false);
    expect(isSurplusPending(row({ qtyGood: 50, qtyOrder: 50, surplusDisposition: "hold" }))).toBe(false);
    expect(isSurplusPending(row({ qtyGood: 47, qtyOrder: 50, surplusDisposition: "hold" }))).toBe(false);
    expect(isSurplusPending(row({ status: "cancelled", qtyGood: 53, qtyOrder: 50, surplusDisposition: "hold" }))).toBe(false);
    expect(isSurplusPending(row({ qtyGood: null }))).toBe(false);
    expect(surplusQty(row({ qtyGood: 40, qtyOrder: 50 }))).toBe(0);
  });
});

describe("matchesSearch", () => {
  const r = row({ jobNo: "JB-0018", seq: 18, designLabel: "แหวนโกเมนไข่", sku: "RG-001" });
  it("เลขใบ: 'JB-0018' · 'jb0018' · 'JB 18' · '18' · '0018' ตรง seq 18", () => {
    for (const q of ["JB-0018", "jb0018", "JB 18", "jb-18", "18", "0018", "  18  "]) expect(matchesSearch(r, q), q).toBe(true);
  });
  it("เลขที่ไม่ใช่ seq นี้ไม่ตรง (ไม่ใช่ substring: '1' ไม่ติด JB-0018)", () => {
    for (const q of ["1", "8", "JB-0019", "19", "0001"]) expect(matchesSearch(r, q), q).toBe(false);
  });
  it("ชื่อแบบ/SKU: ไม่สนตัวพิมพ์ ขีด ช่องว่าง", () => {
    expect(matchesSearch(r, "โกเมน")).toBe(true);
    expect(matchesSearch(r, "แหวน โกเมน")).toBe(true);
    expect(matchesSearch(r, "rg001")).toBe(true);
    expect(matchesSearch(r, "RG-001")).toBe(true);
    expect(matchesSearch(r, "rg 001")).toBe(true);
    expect(matchesSearch(r, "สร้อย")).toBe(false);
  });
  it("ตัวเลขห้าหลักขึ้นไปเป็นข้อความทั่วไป (ไม่ใช่ seq) · คำค้นว่าง = ผ่านทุกแถว", () => {
    expect(matchesSearch(r, "00018")).toBe(false);
    expect(matchesSearch(r, "")).toBe(true);
    expect(matchesSearch(r, "   ")).toBe(true);
    expect(matchesSearch(r, "---")).toBe(true);
  });
  it("seq ไม่มี (null) ไม่ตรงเลขใบ แต่ยังค้นด้วยชื่อได้", () => {
    const n = row({ seq: null, jobNo: "JB-0018" });
    expect(matchesSearch(n, "18")).toBe(false);
    expect(matchesSearch(n, "แหวน")).toBe(true);
  });
});

describe("bkkDateOf / closedMonthOf — เวลาไทย", () => {
  it("17:30 UTC วันที่ 31 = 00:30 ไทยวันที่ 1 เดือนถัดไป (เดือนที่ปิดต้องตามเวลาไทย)", () => {
    expect(bkkDateOf("2026-10-31T17:30:00Z")).toBe("2026-11-01");
    expect(closedMonthOf({ closedAt: "2026-10-31T17:30:00Z" })).toBe("2026-11");
    expect(bkkDateOf("2026-10-31T16:59:00Z")).toBe("2026-10-31");
  });
  it("ไม่ใช่วันที่/ว่าง = null", () => {
    expect(bkkDateOf("abc")).toBeNull();
    expect(bkkDateOf(null)).toBeNull();
    expect(bkkDateOf("")).toBeNull();
    expect(closedDateOf({ closedAt: null })).toBeNull();
  });
  it("thaiMonthYear: '2026-10' → 'ต.ค. 2569' · ผิดรูป = '—'", () => {
    expect(thaiMonthYear("2026-10")).toBe("ต.ค. 2569");
    expect(thaiMonthYear("2026-01")).toBe("ม.ค. 2569");
    for (const x of ["2026-13", "2026-00", "2026", "", null, undefined]) expect(thaiMonthYear(x as string), String(x)).toBe("—");
  });
});

describe("monthOptions", () => {
  it("เดือนที่ปิด ใหม่ → เก่า · ไม่ซ้ำ · ไม่นับใบที่ไม่มีเวลาปิด · ป้ายไทย", () => {
    const opts = monthOptions([
      row({ id: "a", closedAt: "2026-10-19T10:00:00Z" }),
      row({ id: "b", closedAt: "2026-10-02T10:00:00Z" }),
      row({ id: "c", closedAt: "2026-09-30T10:00:00Z" }),
      row({ id: "d", closedAt: "2025-12-31T20:00:00Z" }), // 03:00 ไทย 1 ม.ค. 2026
      row({ id: "e", closedAt: null }),
    ]);
    expect(opts).toEqual([
      { value: "2026-10", label: "ต.ค. 2569" },
      { value: "2026-09", label: "ก.ย. 2569" },
      { value: "2026-01", label: "ม.ค. 2569" },
    ]);
  });
  it("ไม่มีแถว = []", () => expect(monthOptions([])).toEqual([]));
});

describe("applyHistoryFilters", () => {
  const rows = [
    row({ id: "1", jobNo: "JB-0001", seq: 1, status: "done", metal: "silver", sourceKind: "oem", closedAt: "2026-10-10T05:00:00Z", designLabel: "แหวน A" }),
    row({ id: "2", jobNo: "JB-0002", seq: 2, status: "cancelled", metal: "gold", sourceKind: "production", closedAt: "2026-10-12T05:00:00Z", designLabel: "สร้อย B" }),
    row({ id: "3", jobNo: "JB-0003", seq: 3, status: "done", metal: "gold", sourceKind: "oem", closedAt: "2026-09-12T05:00:00Z", designLabel: "ต่างหู C" }),
    row({ id: "4", jobNo: "JB-0004", seq: 4, status: "done", metal: "brass", sourceKind: "production", closedAt: null, designLabel: "กำไล D" }),
  ];
  const ids = (f: Partial<typeof EMPTY_FILTERS>) => applyHistoryFilters(rows, { ...EMPTY_FILTERS, ...f }).map((r) => r.id);
  it("ไม่กรอง = ทุกแถว (รวมใบไม่มีเวลาปิด)", () => expect(ids({})).toEqual(["1", "2", "3", "4"]));
  it("สถานะ", () => {
    expect(ids({ status: "done" })).toEqual(["1", "3", "4"]);
    expect(ids({ status: "cancelled" })).toEqual(["2"]);
  });
  it("เดือนที่ปิด: ใบไม่มีเวลาปิดไม่ติด", () => {
    expect(ids({ month: "2026-10" })).toEqual(["1", "2"]);
    expect(ids({ month: "2026-09" })).toEqual(["3"]);
    expect(ids({ month: "2026-08" })).toEqual([]);
  });
  it("โลหะ · แหล่ง", () => {
    expect(ids({ metal: "gold" })).toEqual(["2", "3"]);
    expect(ids({ source: "oem" })).toEqual(["1", "3"]);
  });
  it("รวมหลายเงื่อนไข (AND) + ค้นหา", () => {
    expect(ids({ metal: "gold", status: "done" })).toEqual(["3"]);
    expect(ids({ q: "สร้อย", status: "done" })).toEqual([]);
    expect(ids({ q: "JB-0002" })).toEqual(["2"]);
    expect(ids({ q: "3", month: "2026-09" })).toEqual(["3"]);
  });
  it("ไม่แก้ array เดิม", () => {
    const copy = [...rows];
    applyHistoryFilters(rows, { ...EMPTY_FILTERS, status: "done" });
    expect(rows).toEqual(copy);
  });
});

describe("parseHistoryFilters / historyQuery / isFiltered", () => {
  const get = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  it("อ่านค่าที่ถูก · ค่านอก whitelist = ค่าว่าง", () => {
    expect(parseHistoryFilters(get({ q: "แหวน", s: "done", m: "2026-10", metal: "gold", src: "oem" }))).toEqual({ q: "แหวน", status: "done", month: "2026-10", metal: "gold", source: "oem" });
    expect(parseHistoryFilters(get({ s: "hack", m: "2026-13", metal: "platinum", src: "x" }))).toEqual(EMPTY_FILTERS);
    expect(parseHistoryFilters(get({}))).toEqual(EMPTY_FILTERS);
  });
  it("q ยาวเกิน 80 ตัดทิ้ง", () => {
    expect(parseHistoryFilters(get({ q: "ก".repeat(200) })).q).toHaveLength(80);
  });
  it("historyQuery ไม่ใส่ค่าเริ่ม · ย้อนกลับได้ (round trip)", () => {
    expect(historyQuery(EMPTY_FILTERS)).toBe("");
    const f = { q: "แหวน A", status: "cancelled" as const, month: "2026-10", metal: "silver", source: "production" };
    const qs = new URLSearchParams(historyQuery(f));
    expect(parseHistoryFilters((k) => qs.get(k))).toEqual(f);
  });
  it("isFiltered", () => {
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTERS, q: "  " })).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTERS, status: "done" })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTERS, q: "x" })).toBe(true);
  });
});
