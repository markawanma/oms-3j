// 0190 G1a: ตัวแปลงพลอย — allowlist แถวขาเข้า · parse error ของ RPC · mapper (ไม่มีราคานอก catalog) · PrintableJob.gems · ป้ายประวัติ
import { describe, expect, it } from "vitest";
import { EVENT_TYPE_LABEL, mapJobDetail, summarizeEvent } from "./types";
import { toPrintableJob } from "./print";
import { findForbiddenKeys } from "./worker-view";
import { OFFICE_HINT_TH, officeErrorMessage } from "./messages";
import { GEM_ERROR_TH, GEM_HINTS, mapGemPriceHistory, mapGemCatalog, mapGemOptions, mapGemSaveSummary, mapJobGems, mapGemMergePlan, parseGemRpcError, toWireGemLines, wireFailResult } from "./gems";

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("toWireGemLines — allowlist ขาเข้า", () => {
  it("แถวปกติ (camelCase) → snake_case · '4,5' → '4.5' · ไม่มีค่าเริ่มแอบเติม", () => {
    const r = toWireGemLines([
      { typeId: U(1), shapeId: U(2), sizeA: "4,5", sizeB: 6, qtyPerPiece: "30", position: "ล้อมรอบ" },
      { newTypeName: "โกเมน", newShape: { name: "ไข่", hasLength: true }, sizeA: 4, sizeB: 6, qtyPerPiece: 2 },
      { gemItemId: U(3), qtyPerPiece: 1 },
    ]);
    expect(r).toEqual({
      ok: true,
      value: [
        { type_id: U(1), shape_id: U(2), size_a: "4.5", size_b: 6, qty_per_piece: 30, position: "ล้อมรอบ" },
        { new_type_name: "โกเมน", new_shape: { name: "ไข่", has_length: true }, size_a: 4, size_b: 6, qty_per_piece: 2 },
        { gem_item_id: U(3), qty_per_piece: 1 },
      ],
    });
  });
  it.each([
    ["key ราคา", [{ typeId: U(1), shapeId: U(2), sizeA: 2, qtyPerPiece: 1, price: 10 }], "line_invalid", 1],
    ["key ต้นทุน", [{ typeId: U(1), cost: 1 }], "line_invalid", 1],
    ["ไม่ใช่ array", { a: 1 }, "lines_invalid", null],
    ["เกิน 30 แถว", Array.from({ length: 31 }, () => ({ gemItemId: U(1), qtyPerPiece: 1 })), "too_many_lines", 31],
    ["แถวไม่ใช่ object", ["x"], "line_invalid", 1],
    ["newShape ขาด hasLength", [{ newShape: { name: "ไข่" } }], "shape_new_invalid", 1],
    ["newShape มี key แปลก", [{ newShape: { name: "ไข่", hasLength: true, price: 1 } }], "shape_new_invalid", 1],
    ["qty เป็นข้อความ", [{ gemItemId: U(1), qtyPerPiece: "abc" }], "qty_invalid", 1],
    ["qty NaN", [{ gemItemId: U(1), qtyPerPiece: NaN }], "qty_invalid", 1],
    ["size Infinity", [{ typeId: U(1), shapeId: U(2), sizeA: Infinity }], "size_invalid", 1],
    ["position ไม่ใช่ข้อความ", [{ gemItemId: U(1), qtyPerPiece: 1, position: 5 }], "position_invalid", 1],
    ["typeId ไม่ใช่ข้อความ", [{ typeId: 5 }], "line_invalid", 1],
  ])("ปฏิเสธ: %s", (_n, input, code, row) => {
    const r = toWireGemLines(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code);
      expect(r.row).toBe(row);
      expect(/[ก-๛]/.test(r.error)).toBe(true);
    }
  });
  it("ชื่อ key แปลกที่ไม่ปลอดภัยไม่สะท้อนกลับเป็น field", () => {
    const r = toWireGemLines([{ ["<script>"]: 1 }]);
    expect(r.ok === false && r.field === null).toBe(true);
  });
});

describe("parseGemRpcError", () => {
  const err = (hint: string, details: unknown, code = "22023") => ({ code, hint, message: "x", details: typeof details === "string" ? details : JSON.stringify(details) });
  it("แถวพลอยผิด: code + row + field", () => {
    expect(parseGemRpcError(err("qty_invalid", { row: 2, field: "qty_per_piece", code: "qty_invalid" }))).toEqual({ code: "qty_invalid", row: 2, field: "qty_per_piece" });
  });
  it("gem_similar: similar[] ที่ตรวจรูปร่างแล้ว (kind/ชื่อ/แถว/ที่ตรงกัน)", () => {
    const e = parseGemRpcError(err("gem_similar", { similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: U(1), name: "โกเมน" }, { id: null, name: "อื่น" }] }, { kind: "bad", name: "x" }] }));
    expect(e?.code).toBe("gem_similar");
    expect(e?.similar).toEqual([{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: U(1), name: "โกเมน" }, { id: null, name: "อื่น" }] }]);
  });
  it("name_exists / gem_in_use พา existing / usage", () => {
    expect(parseGemRpcError(err("name_exists", { id: U(4), name: "โกเมน" }))?.existing).toEqual({ id: U(4), name: "โกเมน" });
    expect(parseGemRpcError(err("gem_in_use", { items: 2, templates: 0, jobs: 3, merged_refs: 0, evil: 9 }))?.usage).toEqual({ items: 2, templates: 0, jobs: 3, merged_refs: 0 });
  });
  it("ไม่ใช่ error พลอย (hint อื่น/ไม่มี hint/sqlstate อื่น) = null · detail พัง/ยาวเกิน = คง code ไม่ใส่ detail", () => {
    expect(parseGemRpcError(err("job_closed", {}))).toBeNull();
    expect(parseGemRpcError({ code: "22023", message: "x" })).toBeNull();
    expect(parseGemRpcError(err("qty_invalid", {}, "23514"))).toBeNull();
    expect(parseGemRpcError(null)).toBeNull();
    expect(parseGemRpcError(err("qty_invalid", "{not json"))).toEqual({ code: "qty_invalid" });
    expect(parseGemRpcError(err("qty_invalid", { row: 99, field: "Bad Field!" }))).toEqual({ code: "qty_invalid" });
  });
  it("ข้อความสำรองไทยครบทุก hint · ไม่มี snake_case/ราคา · ผ่าน officeErrorMessage", () => {
    for (const h of GEM_HINTS) {
      expect(GEM_ERROR_TH[h], h).toBeTruthy();
      expect(/[ก-๛]/.test(GEM_ERROR_TH[h])).toBe(true);
      expect(GEM_ERROR_TH[h]).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(OFFICE_HINT_TH[h], h).toBeTruthy();
    }
    expect(officeErrorMessage({ code: "42501", hint: "gem_actor_forbidden", message: "x" })).toMatch(/เจ้าของร้าน/);
    expect(officeErrorMessage({ code: "22023", hint: "gem_in_use", message: "ERROR: bad_snake" })).toBe(GEM_ERROR_TH.gem_in_use);
  });
});

describe("mapper — ราคาอยู่เฉพาะ catalog", () => {
  it("options: ทิ้ง key ราคา/ผู้สร้างที่ DB ส่งมา (ด่านซ้ำ) · key list ล็อก", () => {
    const o = mapGemOptions({
      types: [{ id: U(1), name: "โกเมน", price: 5, created_by: U(9) }],
      shapes: [{ id: U(2), name: "ไข่", has_length: true, supplier: "x" }],
      items: [{ gem_item_id: U(3), type_id: U(1), shape_id: U(2), size_a: 4, size_b: 6, size_label: "4×6", price: 7391.2468, price_thb_per_unit: 1 }],
    })!;
    expect(Object.keys(o.types[0]).sort()).toEqual(["id", "name"]);
    expect(Object.keys(o.shapes[0]).sort()).toEqual(["hasLength", "id", "name"]);
    expect(Object.keys(o.items[0]).sort()).toEqual(["gemItemId", "shapeId", "sizeA", "sizeB", "sizeLabel", "typeId"]);
    expect(JSON.stringify(o)).not.toContain("7391");
  });
  it("catalog: ราคาที่ยังไม่ตั้ง = null (ไม่ใช่ 0)", () => {
    const c = mapGemCatalog({ types: [], shapes: [], items: [{ gem_item_id: U(3), type_id: U(1), shape_id: U(2), type_name: "โกเมน", shape_name: "ไข่", size_a: 4, size_b: 6, size_label: "4×6", label: "โกเมน · ไข่ · 4×6 มม.", is_active: true, has_price: false, price: null, price_rows: 0 }] })!;
    expect(c.items[0].price).toBeNull();
    expect(c.items[0].hasPrice).toBe(false);
  });
  it("job gems (getter ออฟฟิศ): window/state/lines/template/history · ไม่มี key ราคา · ค่า window นอก enum = null", () => {
    const line = { id: U(5), gem_item_id: U(3), canonical_item_id: U(3), label: "โกเมน · ไข่ · 4×6 มม.", qty_per_piece: 2, qty_total: 70, position: "บ่า", source: "manual", via: "office", renamed: false, price: 9 };
    const g = mapJobGems({ job: { id: U(7), job_no: "JB-0001", qty_planned: 35 }, window: "reason_required", gem_stage: "started", state: "specified", lines: [line], template: null, differs_from_template: null, history: [{ at: "2026-10-22T00:00:00Z", phase: "reason_required", reason: "แตก", before: [], after: [{ label: "x", qty_per_piece: 1 }] }] })!;
    expect(g.window).toBe("reason_required");
    expect(Object.keys(g.lines[0]).sort()).toEqual(["canonicalItemId", "gemItemId", "id", "label", "position", "qtyPerPiece", "qtyTotal", "renamed", "source", "via"]);
    expect(g.history[0].after[0].qtyPerPiece).toBe(1);
    expect(mapJobGems({ job: { id: U(7), job_no: "JB-1", qty_planned: 1 }, window: "weird", lines: [] })).toBeNull();
  });
  it("save summary: reused / created / merged rows", () => {
    const s = mapGemSaveSummary({ changed: true, count: 2, summary: { created_types: [{ id: U(1), name: "โกเมน" }], created_shapes: [], created_items: [{}, {}], reused: [{ row: 1, kind: "type", typed: "โกเมน ", name: "โกเมน" }], merged_rows: [{ rows: [1, 2] }] } })!;
    expect(s).toEqual({ changed: true, count: 2, createdTypes: ["โกเมน"], createdShapes: [], createdItems: 2, reused: [{ row: 1, kind: "type", typed: "โกเมน ", name: "โกเมน" }], mergedRows: [[1, 2]] });
  });
});

describe("PrintableJob.gems — ประกอบทีละ field · ไม่มีราคา · ใบเดิมเหมือนเดิม", () => {
  const job = mapJobDetail({ id: U(7), job_no: "JB-0100", source_kind: "oem", design_label: "แหวน", metal: "silver", qty_planned: 35, qty_order: 30, status: "open" })!;
  it("ไม่ส่ง gems (หรืออ่านไม่ได้ null) → gems = [] · state not_needed", () => {
    for (const g of [undefined, null]) {
      const p = toPrintableJob(job, [], null, g);
      expect(p.gems).toEqual([]);
      expect(p.gemsState).toBe("not_needed");
    }
  });
  it("มีพลอย → แถวละ 4 field เท่านั้น แม้ input มี field แอบมา (ไม่ spread) · ไม่มี forbidden key", () => {
    const sneaky = { label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: null, price: 7391.2468, supplier: "x" } as never;
    const p = toPrintableJob(job, [], null, { state: "specified", gems: [sneaky] });
    expect(Object.keys(p.gems[0]).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
    expect(JSON.stringify(p)).not.toContain("7391");
    expect(findForbiddenKeys(p)).toEqual([]);
    expect(p.gemsState).toBe("specified");
  });
  it("unspecified ผ่านเป็น state (ใบพิมพ์ขึ้นเตือน)", () => {
    expect(toPrintableJob(job, [], null, { state: "unspecified", gems: [] }).gemsState).toBe("unspecified");
  });
});

describe("wireFailResult — ที่เดียวของผลล้มจาก toWireGemLines (review S6)", () => {
  it("พา code/row/field ที่รูปปลอดภัยกลับ · field รูป camelCase/แปลก (ชื่อ key ของ client) ไม่ถูกสะท้อน · ไม่มี row = ไม่ใส่ row", () => {
    const bad = toWireGemLines([{ price: 5 }]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(wireFailResult(bad)).toEqual({ ok: false, error: bad.error, code: "line_invalid", gem: { code: "line_invalid", row: 1, field: "price" } });
    const camel = toWireGemLines([{ typeId: 5 }]);
    if (camel.ok) throw new Error("expected fail");
    const r = wireFailResult(camel);
    expect(r.gem.row).toBe(1);
    expect("field" in r.gem).toBe(false); // "typeId" ไม่ผ่านรูป [a-z_]
    const noRow = toWireGemLines("x");
    if (noRow.ok) throw new Error("expected fail");
    expect(wireFailResult(noRow).gem).toEqual({ code: "lines_invalid" });
  });
});

describe("mapGemMergePlan — พา overflow/products มาด้วย (review N6)", () => {
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  it("template_qty_overflow + template_products (เฉพาะ uuid ถูกรูป) · ไม่มี key = 0 / []", () => {
    const base = { from: { id: U1, name: "ก" }, into: { id: U2, name: "ข" } };
    const m = mapGemMergePlan({ ...base, items_moved: 1, template_lines_summed: 2, template_qty_overflow: 1, template_products: [U1, "x", 5, U2] })!;
    expect(m.templateQtyOverflow).toBe(1);
    expect(m.templateProducts).toEqual([U1, U2]);
    const d = mapGemMergePlan(base)!;
    expect(d.templateQtyOverflow).toBe(0);
    expect(d.templateProducts).toEqual([]);
  });
});

describe("ประวัติราคา + audit (0190 security M1)", () => {
  it("history = rows + audit (old/new/note/actor) · แถว audit ผิดรูป (action แปลก/ไม่มีวันที่) ถูกทิ้ง · รูปไม่ถูกต้อง = null", () => {
    const h = mapGemPriceHistory({
      rows: [{ effective_from: "2026-10-22", price: 7391.2468, supplier: null, note: "x", updated_at: "2026-10-22T00:00:00Z" }],
      audit: [
        { action: "update", effective_from: "2026-10-22", old_price: 5555.1111, new_price: 7391.2468, note: "แก้ราคาจริง", actor: U(9), recorded_at: "2026-10-22T01:00:00Z" },
        { action: "insert", effective_from: "2026-10-22", old_price: null, new_price: 5555.1111, note: null, actor: U(9), recorded_at: "2026-10-22T00:00:00Z" },
        { action: "delete", effective_from: "2026-10-22", new_price: 1 },
        { action: "update", new_price: 1 },
      ],
    })!;
    expect(h.rows).toHaveLength(1);
    expect(h.audit).toEqual([
      { action: "update", effectiveFrom: "2026-10-22", oldPrice: 5555.1111, newPrice: 7391.2468, note: "แก้ราคาจริง", actor: U(9), recordedAt: "2026-10-22T01:00:00Z" },
      { action: "insert", effectiveFrom: "2026-10-22", oldPrice: null, newPrice: 5555.1111, note: null, actor: U(9), recordedAt: "2026-10-22T00:00:00Z" },
    ]);
    expect(mapGemPriceHistory({ rows: "x" })).toBeNull();
    expect(mapGemPriceHistory({ rows: [] })).toEqual({ rows: [], audit: [] });
  });
  it("hint ใหม่ note_required / gem_merge_blocked อยู่ใน GEM_HINTS และมีข้อความไทย", () => {
    for (const h of ["note_required", "gem_merge_blocked"]) {
      expect(GEM_HINTS.has(h)).toBe(true);
      expect(GEM_ERROR_TH[h]).toMatch(/[ก-๛]/);
    }
    expect(parseGemRpcError({ code: "22023", hint: "note_required", message: "x" })).toEqual({ code: "note_required" });
  });
});

describe("ประวัติ bom_change", () => {
  it("มีป้ายไทย · สรุปบรรทัดเดียว (นับรายการ + เหตุผล) ไม่ dump ฉลาก", () => {
    expect(EVENT_TYPE_LABEL.bom_change).toMatch(/พลอย/);
    expect(summarizeEvent("bom_change", { phase: "create", before: [], after: [{ label: "A" }, { label: "B" }] })).toBe("พลอยตอนสร้างใบ 2 รายการ");
    expect(summarizeEvent("bom_change", { phase: "reason_required", reason: "แตก", before: [{}], after: [{}, {}] })).toBe("พลอย 1 → 2 รายการ · เหตุผล: แตก");
  });
});
