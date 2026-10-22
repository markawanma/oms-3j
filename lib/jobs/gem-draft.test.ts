// lib/jobs/gem-draft.ts — โมเดลแถวพลอยในฟอร์ม: ตรวจก่อนส่ง · แถวซ้ำ/รวม · รวมทั้งใบ (จำนวนเต็ม) · แปลงเป็น wire (allowlist) · diff
import { describe, expect, it } from "vitest";
import { toWireGemLines } from "@/lib/jobs/gems";
import type { GemBomLine, GemOptions } from "@/lib/jobs/gems";
import {
  diffGemLines,
  draftRowToInput,
  draftRowsToInputs,
  draftTotals,
  emptyGemRow,
  findDuplicateRows,
  gemRowIssues,
  mergeDraftRows,
  newNameIssue,
  parseGemQty,
  pendingNewNames,
  rowDupKey,
  rowFromBomLine,
  rowIncompleteReason,
  rowLabelPreview,
  rowSizes,
  unlockRow,
} from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";

const T1 = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";
const I1 = "44444444-4444-4444-8444-444444444444";

function row(o: Partial<GemDraftRow> = {}): GemDraftRow {
  return {
    ...emptyGemRow(),
    type: { kind: "existing", id: T1, name: "โกเมน" },
    shape: { kind: "existing", id: S1, name: "ไข่", hasLength: true },
    sizeA: "4",
    sizeB: "6",
    qty: "2",
    ...o,
  };
}

describe("gemRowIssues — ตรวจก่อนส่ง (ข้อความตาม UX §3.6)", () => {
  it("แถวครบ = ไม่มีปัญหา", () => {
    expect(gemRowIssues(row())).toEqual([]);
    expect(rowIncompleteReason(row())).toBeNull();
  });
  it("ว่างทุกช่อง: ชนิด/รูปทรง/จำนวน", () => {
    const m = gemRowIssues(emptyGemRow()).map((i) => [i.field, i.message]);
    expect(m).toContainEqual(["type", "เลือกหรือพิมพ์ชนิดพลอย"]);
    expect(m).toContainEqual(["shape", "เลือกรูปทรง"]);
    expect(m).toContainEqual(["qty_per_piece", "จำนวนต่อชิ้นต้องเป็นเลข 1–1,000"]);
  });
  it("ขนาด 1 ค่า / 2 ค่า: ว่าง = ข้อความถูกข้อ", () => {
    expect(gemRowIssues(row({ shape: { kind: "existing", id: S2, name: "กลม", hasLength: false }, sizeA: "", sizeB: "" }))[0].message).toBe("ใส่ขนาด (มม.)");
    expect(gemRowIssues(row({ sizeB: "" })).map((i) => i.message)).toContain("ใส่ทั้งกว้างและยาว (มม.)");
  });
  it("ขนาดผิด: 0 · ติดลบ · ทศนิยม 3 ตำแหน่ง · > 100 · ตัวอักษร · e-notation ถูกปฏิเสธ", () => {
    for (const bad of ["0", "-1", "1.234", "101", "abc", "1e2", "NaN", "Infinity"]) {
      const msgs = gemRowIssues(row({ sizeA: bad })).map((i) => i.message);
      expect(msgs.join("|"), bad).toContain("ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม.");
    }
  });
  it("รับ , เป็นจุด และ 100 พอดี (ขอบ) ผ่าน", () => {
    expect(gemRowIssues(row({ sizeA: "1,5", sizeB: "100", bigConfirmed: true }))).toEqual([]);
  });
  it("> 30 มม. ต้องติ๊กยืนยัน · ติ๊กแล้วผ่าน · 30 พอดีไม่ต้อง", () => {
    expect(gemRowIssues(row({ sizeA: "31", sizeB: "35" })).some((i) => i.message.includes("ขนาดใหญ่ผิดปกติ"))).toBe(true);
    expect(gemRowIssues(row({ sizeA: "31", sizeB: "35", bigConfirmed: true }))).toEqual([]);
    expect(gemRowIssues(row({ sizeA: "30", sizeB: "30" }))).toEqual([]);
  });
  it("จำนวนต่อชิ้น: 1 และ 1000 ผ่าน · 0 · 1001 · ทศนิยม · ว่าง ไม่ผ่าน", () => {
    expect(parseGemQty("1")).toBe(1);
    expect(parseGemQty(" 1000 ")).toBe(1000);
    for (const bad of ["0", "1001", "1.5", "", "-3", "1e3", "๓"]) expect(parseGemQty(bad), bad).toBeNull();
  });
  it("ตำแหน่ง: > 40 ตัวอักษร หรือมี < > ไม่ผ่าน", () => {
    expect(gemRowIssues(row({ position: "ก".repeat(41) })).some((i) => i.field === "position")).toBe(true);
    expect(gemRowIssues(row({ position: "<b>" })).some((i) => i.field === "position")).toBe(true);
    expect(gemRowIssues(row({ position: "ก".repeat(40) }))).toEqual([]);
  });
  it("แถวรายการเดิม (itemId) ตรวจเฉพาะจำนวน/ตำแหน่ง", () => {
    const r = { ...emptyGemRow("saved"), itemId: I1, label: "CZ · กลม · 1.5 มม.", qty: "30" };
    expect(gemRowIssues(r)).toEqual([]);
    expect(gemRowIssues({ ...r, qty: "0" }).map((i) => i.field)).toEqual(["qty_per_piece"]);
  });
});

describe("rowSizes — เรียงกว้าง ≤ ยาว + บอกว่าสลับ", () => {
  it("6×4 → 4×6 swapped", () => {
    expect(rowSizes(row({ sizeA: "6", sizeB: "4" }))).toEqual({ a: 4, b: 6, swapped: true });
    expect(rowSizes(row({ sizeA: "4.0", sizeB: "6.00" }))).toEqual({ a: 4, b: 6, swapped: false });
  });
  it("รูปทรง 1 ค่า: b = null ไม่สนช่อง B", () => {
    expect(rowSizes(row({ shape: { kind: "existing", id: S2, name: "กลม", hasLength: false }, sizeA: "1.5", sizeB: "9" }))).toEqual({ a: 1.5, b: null, swapped: false });
  });
  it("ยังไม่ครบ = null", () => {
    expect(rowSizes(row({ sizeB: "" }))).toBeNull();
    expect(rowSizes({ ...row(), shape: null })).toBeNull();
  });
});

describe("ตัวอย่างชื่อ + คีย์แถวซ้ำ", () => {
  it("ตัวอย่างชื่อตัดศูนย์ท้าย", () => {
    expect(rowLabelPreview(row({ sizeA: "4.0", sizeB: "6.50" }))).toBe("โกเมน · ไข่ · 4×6.5 มม.");
    expect(rowLabelPreview(row({ sizeB: "" }))).toBeNull();
  });
  it("ซ้ำ: 4×6 กับ 6×4 (หลังเรียง) กับ 4.0×6.0 = key เดียวกัน", () => {
    const rows = [row(), row({ sizeA: "6", sizeB: "4" }), row({ sizeA: "4.0", sizeB: "6.0" }), row({ sizeA: "4", sizeB: "7" })];
    expect([...findDuplicateRows(rows)]).toEqual([[1, 0], [2, 0]]);
  });
  it("ชื่อใหม่ซ้ำกันหลัง normalize (CZ / cz / C Z) = ซ้ำ · แถวยังไม่ครบไม่ตรวจ", () => {
    const n = (name: string) => row({ type: { kind: "new", name }, shape: { kind: "existing", id: S2, name: "กลม", hasLength: false }, sizeA: "2", sizeB: "" });
    expect(rowDupKey(n("CZ"))).toBe(rowDupKey(n("c z")));
    expect(rowDupKey(emptyGemRow())).toBeNull();
  });
  it("รายการเดิมซ้ำกันด้วย id", () => {
    const a = { ...emptyGemRow("saved"), itemId: I1, label: "x", qty: "1" };
    expect([...findDuplicateRows([a, { ...a, key: "k2" }])]).toEqual([[1, 0]]);
  });
});

describe("mergeDraftRows — รวมเข้าแถวที่ผู้ใช้กดเอง", () => {
  it("บวกจำนวน · ตำแหน่งต่อกันด้วย ', ' ตัดซ้ำทีละคำ · ลบแถวที่รวม", () => {
    const rows = [row({ qty: "2", position: "บ่าซ้าย" }), row({ qty: "3", position: "บ่าซ้าย, บ่าขวา" })];
    const out = mergeDraftRows(rows, 1, 0);
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe("5");
    expect(out[0].position).toBe("บ่าซ้าย, บ่าขวา");
  });
  it("ตำแหน่ง 'ซ้าย' ไม่ถูกตัดทิ้งเพราะเป็น substring ของ 'บ่าซ้าย' (รวมทีละคำ)", () => {
    const out = mergeDraftRows([row({ position: "บ่าซ้าย" }), row({ position: "ซ้าย" })], 1, 0);
    expect(out[0].position).toBe("บ่าซ้าย, ซ้าย");
  });
  it("ดัชนีผิด/รวมกับตัวเอง = ไม่เปลี่ยน", () => {
    const rows = [row(), row({ sizeA: "5" })];
    expect(mergeDraftRows(rows, 0, 0)).toHaveLength(2);
    expect(mergeDraftRows(rows, 9, 0)).toHaveLength(2);
  });
  it("รวมแล้วเกิน 1000 → ถูกจับโดย gemRowIssues (ไม่ตัดเงียบ)", () => {
    const out = mergeDraftRows([row({ qty: "600" }), row({ qty: "500" })], 1, 0);
    expect(out[0].qty).toBe("1100");
    expect(gemRowIssues(out[0]).some((i) => i.field === "qty_per_piece")).toBe(true);
  });
});

describe("draftTotals — จำนวนเต็ม × จำนวนเต็ม (ไม่ปัดเศษ · UX P10)", () => {
  it("รวม = จำนวน/ชิ้น × จำนวนที่จะผลิต ต่อแถว แล้วบวก", () => {
    const t = draftTotals([row({ qty: "2" }), row({ qty: "30" })], 35);
    expect(t.lineTotals).toEqual([70, 1050]);
    expect(t.total).toBe(1120);
    expect(t.pieces).toBe(32);
  });
  it("ใหญ่ถึงหลักล้านไม่เพี้ยน: 1000 × 100000 = 100,000,000", () => {
    expect(draftTotals([row({ qty: "1000" })], 100000).total).toBe(100_000_000);
  });
  it("ยังไม่รู้จำนวนผลิต / จำนวนแถวยังผิด = null (ไม่เดาเป็น 0)", () => {
    expect(draftTotals([row()], null).total).toBeNull();
    expect(draftTotals([row({ qty: "abc" })], 10).lineTotals).toEqual([null]);
  });
});

describe("draftRowToInput → toWireGemLines (allowlist ของ server action)", () => {
  it("แถวที่เลือกจากรายการ: typeId/shapeId + ขนาดเรียงแล้ว + จำนวนเป็นเลข", () => {
    const w = toWireGemLines(draftRowsToInputs([row({ sizeA: "6", sizeB: "4", position: "  บ่า   ซ้าย " })]));
    expect(w).toEqual({ ok: true, value: [{ type_id: T1, shape_id: S1, size_a: 4, size_b: 6, qty_per_piece: 2, position: "บ่า ซ้าย" }] });
  });
  it("ชื่อใหม่: newTypeName + newShape(hasLength) — ไม่ส่ง id", () => {
    const w = toWireGemLines(draftRowsToInputs([row({ type: { kind: "new", name: "โกเมนต์" }, shape: { kind: "new", name: "ทรงใบไม้", hasLength: false }, sizeA: "4", sizeB: "" })]));
    expect(w).toEqual({ ok: true, value: [{ new_type_name: "โกเมนต์", new_shape: { name: "ทรงใบไม้", has_length: false }, size_a: 4, qty_per_piece: 2 }] });
  });
  it("แถวรายการเดิม: ส่ง gemItemId เท่านั้น (ฉลาก snapshot คงเดิม) ไม่ส่งชนิด/ขนาด", () => {
    const w = toWireGemLines([draftRowToInput({ ...emptyGemRow("saved"), itemId: I1, label: "L", qty: "5", position: "" })]);
    expect(w).toEqual({ ok: true, value: [{ gem_item_id: I1, qty_per_piece: 5 }] });
  });
  it("ผลลัพธ์ไม่มี key ราคา/ต้นทุน/เผื่อแตก/คีย์ฝั่ง client", () => {
    const w = toWireGemLines(draftRowsToInputs([row()]));
    expect(JSON.stringify(w)).not.toMatch(/price|cost|breakage|thb|key|origin|label/i);
  });
});

describe("rowFromBomLine / unlockRow", () => {
  const line: GemBomLine = { id: null, gemItemId: I1, canonicalItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: "บ่า", source: "product", renamed: false, via: null };
  const options: GemOptions = {
    types: [{ id: T1, name: "โกเมน" }],
    shapes: [{ id: S1, name: "ไข่", hasLength: true }],
    items: [{ gemItemId: I1, typeId: T1, shapeId: S1, sizeA: 4, sizeB: 6, sizeLabel: "4×6" }],
  };
  it("เริ่มเป็นรายการเดิม (ล็อก) พร้อมฉลาก/จำนวน/ตำแหน่ง", () => {
    const r = rowFromBomLine(line, "template");
    expect(r).toMatchObject({ itemId: I1, label: line.label, qty: "2", position: "บ่า", origin: "template", edited: false });
  });
  it("ปลดล็อก: เติมชนิด/รูปทรง/ขนาดจาก options · ติดธงแก้แล้ว", () => {
    const r = unlockRow(rowFromBomLine(line, "template"), options);
    expect(r.itemId).toBeNull();
    expect(r.type).toEqual({ kind: "existing", id: T1, name: "โกเมน" });
    expect(r.shape).toEqual({ kind: "existing", id: S1, name: "ไข่", hasLength: true });
    expect([r.sizeA, r.sizeB]).toEqual(["4", "6"]);
    expect(r.edited).toBe(true);
  });
  it("ปลดล็อกแต่ไม่พบใน options (ปิดใช้/ถูกรวม): ช่องว่างให้เลือกใหม่ ไม่เดา", () => {
    const r = unlockRow(rowFromBomLine(line, "saved"), { types: [], shapes: [], items: [] });
    expect(r.type).toBeNull();
    expect(r.shape).toBeNull();
    expect(r.sizeA).toBe("");
  });
  it("ปลดล็อกด้วย options = null (โหลดรายการไม่ได้) ไม่ล้ม", () => {
    expect(unlockRow(rowFromBomLine(line, "saved"), null).itemId).toBeNull();
  });
});

describe("pendingNewNames / newNameIssue", () => {
  it("ชื่อใหม่ที่พิมพ์ในฟอร์ม ไม่ซ้ำ (normalize) — ใช้ขึ้นรายการของแถวถัดไป", () => {
    const rows = [row({ type: { kind: "new", name: "CZ" } }), row({ type: { kind: "new", name: "c z" } }), row({ type: { kind: "existing", id: T1, name: "โกเมน" } })];
    expect(pendingNewNames(rows, "type")).toEqual([{ name: "CZ" }]);
  });
  it("รูปทรงใหม่พก hasLength ไปด้วย", () => {
    expect(pendingNewNames([row({ shape: { kind: "new", name: "ใบไม้", hasLength: true } })], "shape")).toEqual([{ name: "ใบไม้", hasLength: true }]);
  });
  it("ชื่อ: เลขล้วน · เครื่องหมายล้วน · 1 ตัวอักษร · < > ไม่ผ่าน · ชื่อปกติผ่าน", () => {
    for (const bad of ["12", "๑๒", "+1", "ก", "<b>x", "  "]) expect(newNameIssue(bad), bad).not.toBeNull();
    for (const ok of ["CZ", "โกเมน", "บลูโทแพซ"]) expect(newNameIssue(ok), ok).toBeNull();
  });
});

describe("diffGemLines", () => {
  const L = (label: string, q: number, p: string | null = null) => ({ label, qtyPerPiece: q, position: p });
  it("เพิ่ม/ลบ/แก้ เทียบด้วยฉลาก", () => {
    const d = diffGemLines([L("A", 1), L("B", 2, "x"), L("C", 3)], [L("A", 1), L("B", 5, "x"), L("D", 1)]);
    expect(d.map((e) => e.op).sort()).toEqual(["add", "change", "remove"]);
  });
  it("เหมือนกัน = ว่าง · ตำแหน่ง null กับ '' ถือว่าเท่ากัน", () => {
    expect(diffGemLines([L("A", 1, null)], [L("A", 1, "")])).toEqual([]);
  });
});
