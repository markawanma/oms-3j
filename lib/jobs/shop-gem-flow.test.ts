// lib/jobs/shop-gem-flow.test.ts — ตรรกะ pure ของพลอยบนมือถือผู้จัดการ (W3 UI)
// ต้องถูก: ตอบ "ฝังพลอยไหม" ก่อน (ไม่เดา) · template ส่งเมื่อไม่แตะอะไรเลยเท่านั้น · มีพลอยต้อง ≥ 1 แถวครบไม่ซ้ำ · รวม = จำนวนเต็ม × จำนวนเต็ม · error แถว/ช่อง · force เฉพาะชื่อที่ยังอยู่ · ข้อความล็อก
// ต้องไม่พัง: แถวจากแม่แบบที่ไม่แตะ = ส่ง "template" · แถวเปล่าที่เพิ่งกด "มีพลอย" ไม่ใช่เนื้อหา · ไม่มีเงิน/ราคาในข้อความ
import { describe, expect, it } from "vitest";
import { emptyGemRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import {
  GEM_LOCK_CODES, SHOP_GEM_TH, addForce, emptyShopGems, gemFieldDomId, gemLineText, gemLockMessage, gemOptionsOf, gemReviewOf, gemStepIssue, gemSummaryNotices, gemsInputOf, interpretIntakeGemFail,
  isGemConflict, isTemplateUntouched, myJobGemLine, pruneForce, rowFromIntakeLine, seedFromTemplate, stripRowPrefix,
} from "@/lib/jobs/shop-gem-flow";
import type { ShopGemState } from "@/lib/jobs/shop-gem-flow";
import type { IntakeGemLine } from "@/lib/jobs/worker-server";

const PID = "11111111-1111-4111-8111-111111111111";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const I1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const I2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const line = (o: Partial<IntakeGemLine> = {}): IntakeGemLine => ({ gemItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", typeId: T1, typeName: "โกเมน", shapeId: S2, shapeName: "ไข่", hasLength: true, sizeA: 4, sizeB: 6, qtyPerPiece: 2, position: null, ...o });
/** แถวที่ผู้ใช้กรอกครบ (ชนิด/รูปทรงจากรายการ · ขนาดเดียว) */
const done = (o: Partial<GemDraftRow> = {}): GemDraftRow => ({
  ...emptyGemRow("manual"), type: { kind: "existing", id: T1, name: "โกเมน" }, shape: { kind: "existing", id: S1, name: "กลม", hasLength: false }, sizeA: "4", qty: "2", ...o,
});
const has = (rows: GemDraftRow[], o: Partial<ShopGemState> = {}): ShopGemState => ({ ...emptyShopGems(), answer: "has", rows, ...o });

describe("gemsInputOf — payload ของ intakeOpen (S3: ไม่มีทาง null)", () => {
  it("none → { answer: none } · ไม่มี lines/force", () => {
    expect(gemsInputOf({ ...emptyShopGems(), answer: "none" }, null)).toEqual({ answer: "none" });
  });
  it("🔴 ยังไม่ตอบ (unset) ห้ามเดาเป็น 'ไม่มีพลอย' → รูปที่ action ปฏิเสธเสมอ (has + ไม่มีแถว)", () => {
    expect(gemsInputOf(emptyShopGems(), PID)).toEqual({ answer: "has", lines: [] });
  });
  it("has (กรอกเอง) → lines ผ่าน draftRowsToInputs · force เฉพาะเมื่อมี", () => {
    const r = done({ position: "ล้อมรอบ" });
    const out = gemsInputOf(has([r]), null);
    expect(out).toEqual({ answer: "has", lines: [{ qtyPerPiece: 2, position: "ล้อมรอบ", sizeA: 4, sizeB: null, typeId: T1, shapeId: S1 }] });
    expect(gemsInputOf(has([r], { force: [{ kind: "type", name: "โกเมนต์" }] }), null)).toMatchObject({ force: [{ kind: "type", name: "โกเมนต์" }] });
    expect("force" in (gemsInputOf(has([r]), null) as object)).toBe(false);
  });
  it("พิมพ์ชนิด/รูปทรงใหม่ → newTypeName / newShape (ชื่อเข้าแคตตาล็อกตอนเปิดใบ ไม่ใช่ตอนพิมพ์)", () => {
    const r = done({ type: { kind: "new", name: "ทับทิม" }, shape: { kind: "new", name: "ทรงใบไม้", hasLength: true }, sizeB: "6" });
    expect(gemsInputOf(has([r]), null)).toMatchObject({ answer: "has", lines: [{ newTypeName: "ทับทิม", newShape: { name: "ทรงใบไม้", hasLength: true }, sizeA: 4, sizeB: 6 }] });
  });
  it("แม่แบบ SKU ที่ไม่แตะเลย → 'template' (DB คัดลอกเอง) · แก้/ลบ/เพิ่มแถว/เปลี่ยนสินค้า → 'has' + lines", () => {
    const s = seedFromTemplate(PID, [line(), line({ gemItemId: I2, label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30 })]);
    expect(isTemplateUntouched(s, PID)).toBe(true);
    expect(gemsInputOf(s, PID)).toEqual({ answer: "template" });
    // แก้แถวหนึ่ง (ป้าย แก้แล้ว)
    const edited = { ...s, rows: s.rows.map((r, i) => (i === 0 ? { ...r, qty: "3", edited: true } : r)) };
    expect(gemsInputOf(edited, PID)).toEqual({ answer: "has", lines: [{ gemItemId: I1, qtyPerPiece: 3, position: null }, { gemItemId: I2, qtyPerPiece: 30, position: null }] });
    // ลบแถว
    expect(gemsInputOf({ ...s, rows: s.rows.slice(1) }, PID)).toMatchObject({ answer: "has", lines: [{ gemItemId: I2 }] });
    // เพิ่มแถว
    expect(gemsInputOf({ ...s, rows: [...s.rows, done()] }, PID)).toMatchObject({ answer: "has" });
    // สินค้าอื่น/ไม่มี SKU
    expect(gemsInputOf(s, "99999999-9999-4999-8999-999999999999")).toMatchObject({ answer: "has" });
    expect(gemsInputOf(s, null)).toMatchObject({ answer: "has" });
  });
  it("seed ที่แม่แบบว่าง (count 0) ไม่ใช่ 'template'", () => {
    expect(isTemplateUntouched({ ...emptyShopGems(), answer: "has", seed: { productId: PID, count: 0 } }, PID)).toBe(false);
  });
});

describe("gemStepIssue — ไปขั้นถัดไปได้ไหม", () => {
  it("ยังไม่ตอบ = ไม่ได้ (ข้อความ 'เลือกก่อนว่าฝังพลอยไหม') · ไม่มีพลอย = ผ่าน", () => {
    expect(gemStepIssue(emptyShopGems())).toEqual({ message: "เลือกก่อนว่าฝังพลอยไหม", rowKey: null });
    expect(gemStepIssue({ answer: "none", rows: [] })).toBeNull();
  });
  it("มีพลอยแต่ไม่มีแถว = ไม่ได้ · 31 แถว = ไม่ได้", () => {
    expect(gemStepIssue(has([]))?.message).toBe(SHOP_GEM_TH.needRows);
    expect(gemStepIssue(has(Array.from({ length: 31 }, (_, i) => done({ sizeA: String(i + 1) }))))?.message).toBe(SHOP_GEM_TH.tooMany);
  });
  it("แถวไม่ครบ → บอกแถวที่ n + เหตุผล + key ของแถว", () => {
    const a = done();
    const b = done({ shape: null, sizeA: "" });
    const i = gemStepIssue(has([a, b]));
    expect(i).toEqual({ message: "แถว 2 ยังไม่ครบ — เลือกรูปทรง", rowKey: b.key });
  });
  it("แถวซ้ำ (ชนิด+รูปทรง+ขนาดเดียวกัน) → ไม่ได้ จนกว่าจะรวม/แก้ให้ต่าง", () => {
    const a = done();
    const b = done();
    const i = gemStepIssue(has([a, b]));
    expect(i?.rowKey).toBe(b.key);
    expect(i?.message).toBe("แถว 2: มีพลอยแบบเดียวกันอยู่แล้วที่แถว 1 — กด “รวมเข้าแถว 1” หรือแก้ให้ต่างกัน");
    expect(gemStepIssue(has([a, done({ sizeA: "5" })]))).toBeNull();
  });
  it("ขนาด > 30 มม. ต้องติ๊กยืนยัน — ยังไม่ติ๊ก = ไม่ผ่าน", () => {
    const big = done({ sizeA: "35" });
    expect(gemStepIssue(has([big]))?.message).toContain("ยังไม่ครบ");
    expect(gemStepIssue(has([{ ...big, bigConfirmed: true }]))).toBeNull();
  });
  it("แถวจากแม่แบบ (รายการเดิม) ตรวจเฉพาะจำนวน/ตำแหน่ง", () => {
    expect(gemStepIssue(seedFromTemplate(PID, [line()]))).toBeNull();
    const bad = { ...seedFromTemplate(PID, [line()]), rows: [{ ...rowFromIntakeLine(line(), "template"), qty: "0" }] };
    expect(gemStepIssue(bad)?.message).toContain("จำนวนต่อชิ้น");
  });
});

describe("gemReviewOf — รวมทั้งใบ = จำนวนเต็ม × จำนวนเต็ม", () => {
  it("30 × 35 ชิ้น: แถวละ n/ชิ้น → รวมแถว · รวมทั้งใบ (ไม่ปัดเศษ ไม่บวกเผื่อแตก)", () => {
    const v = gemReviewOf(has([done({ qty: "30", sizeA: "1.5" }), done({ qty: "2", sizeA: "4" })]), 35);
    expect(v.count).toBe(2);
    expect(v.total).toBe(30 * 35 + 2 * 35);
    expect(v.lines.map((l) => [l.perPiece, l.total])).toEqual([[30, 1050], [2, 70]]);
    expect(v.lines[0].label).toBe("โกเมน · กลม · 1.5 มม.");
    expect(gemLineText(v.lines[0])).toBe("30/ชิ้น → 1,050");
  });
  it("ใหญ่ถึงหลักล้านไม่ผิดเพี้ยน · ไม่รู้จำนวนผลิต = total null", () => {
    expect(gemReviewOf(has([done({ qty: "1000" })]), 100000).total).toBe(100_000_000);
    expect(gemReviewOf(has([done()]), null).total).toBeNull();
  });
  it("none/unset/ชื่อใหม่", () => {
    expect(gemReviewOf({ answer: "none", rows: [] }, 5)).toMatchObject({ state: "none", count: 0, lines: [] });
    expect(gemReviewOf(emptyShopGems(), 5).state).toBe("unset");
    expect(gemReviewOf(has([done({ type: { kind: "new", name: "ทับทิม" } })]), 5).hasNewNames).toBe(true);
    expect(gemReviewOf(has([done()]), 5).hasNewNames).toBe(false);
  });
});

describe("force — เฉพาะชื่อที่ผู้ใช้ยืนยันและยังเป็นชื่อใหม่ในแถว", () => {
  const rows = [done({ type: { kind: "new", name: "โกเมนต์" } }), done({ shape: { kind: "new", name: "ทรงใบไม้", hasLength: true }, sizeB: "6" })];
  it("pruneForce ตัดชื่อที่ถูกแก้/ลบแถวไปแล้ว · เทียบหลัง normalize (ช่องว่าง/ตัวพิมพ์)", () => {
    const f = [{ kind: "type" as const, name: "โกเมนต์" }, { kind: "type" as const, name: "อื่น" }, { kind: "shape" as const, name: "ทรง ใบไม้" }];
    expect(pruneForce(f, rows)).toEqual([f[0], f[2]]);
    expect(pruneForce(f, [])).toEqual([]);
    // kind ต้องตรง: ชื่อชนิดไม่ปลดคำถามของรูปทรง
    expect(pruneForce([{ kind: "shape", name: "โกเมนต์" }], rows)).toEqual([]);
  });
  it("addForce ไม่ซ้ำ", () => {
    const a = addForce([], { kind: "type", name: "โกเมนต์" });
    expect(addForce(a, { kind: "type", name: "โกเมน ต์" })).toEqual(a);
    expect(addForce(a, { kind: "shape", name: "โกเมนต์" })).toHaveLength(2);
  });
});

describe("interpretIntakeGemFail — กลับ W-4 แถว/ช่องที่ผิด", () => {
  const rows = [done(), done({ sizeA: "5" })];
  it("แถวผิดจาก DB → ผูกกับแถวนั้น · ตัดหัว 'พลอยแถว n:' (จอใส่เอง) · พา focus ไปช่อง", () => {
    const v = interpretIntakeGemFail({ error: "พลอยแถว 2: ขนาดต้องเป็นตัวเลขมากกว่า 0", code: "gem_line_invalid", gem: { code: "size_invalid", row: 2, field: "size_a" } }, rows);
    expect(v.rowErrors).toEqual({ [rows[1].key]: { field: "size_a", message: "ขนาดต้องเป็นตัวเลขมากกว่า 0" } });
    expect(v).toMatchObject({ generalError: null, similar: null, focusRowKey: rows[1].key, focusField: "size_a" });
  });
  it("ชื่อคล้าย → similar (ไม่ใช่ error) · แถวนอกช่วง/ไม่มี row → ข้อความทั้งขั้น", () => {
    const similar = [{ kind: "type" as const, name: "โกเมนต์", rows: [1], matches: [{ id: T1, name: "โกเมน" }] }];
    expect(interpretIntakeGemFail({ error: "x", code: "gem_similar", similar }, rows)).toMatchObject({ similar: similar[0], generalError: null, rowErrors: {} });
    expect(interpretIntakeGemFail({ error: "ส่งถี่", code: "gem_name_cap" }, rows)).toMatchObject({ generalError: "ส่งถี่", rowErrors: {}, similar: null });
    expect(interpretIntakeGemFail({ error: "ล้นแถว", code: "gem_line_invalid", gem: { code: "too_many_lines", row: 31 } }, rows).generalError).toBe("ล้นแถว");
    expect(interpretIntakeGemFail({ error: "e", gem: { code: "x", row: 0 } }, rows).generalError).toBe("e");
  });
  it("stripRowPrefix", () => {
    expect(stripRowPrefix("พลอยแถว 12: ใส่ขนาด (มม.)")).toBe("ใส่ขนาด (มม.)");
    expect(stripRowPrefix("ไม่มีหัว")).toBe("ไม่มีหัว");
  });
  it("gemFieldDomId: field ของ DB → id ของช่อง (ไม่รู้จัก = ช่องจำนวน)", () => {
    const k = "gr9";
    expect(gemFieldDomId("p", k, "type")).toBe("p-gr9-type-btn");
    expect(gemFieldDomId("p", k, "shape")).toBe("p-gr9-shape-btn");
    expect(gemFieldDomId("p", k, "size_a")).toBe("p-gr9-size-a");
    expect(gemFieldDomId("p", k, "size_b")).toBe("p-gr9-size-b");
    expect(gemFieldDomId("p", k, "qty_per_piece")).toBe("p-gr9-qty");
    expect(gemFieldDomId("p", k, "position")).toBe("p-gr9-pos");
    expect(gemFieldDomId("p", k, null)).toBe("p-gr9-qty");
    expect(gemFieldDomId("p", k, "gem_item_id")).toBe("p-gr9-qty");
  });
});

describe("W-9 / W-10 / W-8", () => {
  it("myJobGemLine: specified / not_needed / unspecified (amber) / null = ไม่แสดง", () => {
    expect(myJobGemLine({ gemState: "specified", gemCount: 3, gemPieces: 94 })).toEqual({ text: "พลอย 3 รายการ · รวม 94 เม็ด", warn: false });
    expect(myJobGemLine({ gemState: "specified", gemCount: 2, gemPieces: 1120 })?.text).toBe("พลอย 2 รายการ · รวม 1,120 เม็ด");
    expect(myJobGemLine({ gemState: "not_needed", gemCount: 0, gemPieces: 0 })).toEqual({ text: "ไม่มีพลอย", warn: false });
    expect(myJobGemLine({ gemState: "unspecified", gemCount: 0, gemPieces: 0 })).toEqual({ text: "ยังไม่ระบุพลอย", warn: true });
    expect(myJobGemLine({ gemState: null, gemCount: 0, gemPieces: 0 })).toBeNull();
  });
  it("gemLockMessage: ทุก lockCode · ไม่มีขั้นฝัง = แจ้งออฟฟิศเพิ่มขั้นฝังพลอย · แก้ได้ = null", () => {
    expect(gemLockMessage("job_locked", true)).toBe("ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ");
    expect(gemLockMessage("job_cancelled", true)).toBe("ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้");
    expect(gemLockMessage("job_closed", true)).toBe("ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้");
    expect(gemLockMessage("job_not_open", true)).toContain("ไม่อยู่ในสถานะที่แก้พลอยได้");
    expect(gemLockMessage("no_gem_stage", false)).toBe("ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศเพิ่มขั้นฝังพลอย");
    expect(gemLockMessage(null, false)).toBe("ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศเพิ่มขั้นฝังพลอย");
    expect(gemLockMessage(null, true)).toBeNull();
    for (const c of GEM_LOCK_CODES) expect(gemLockMessage(c, true), c).not.toBeNull();
  });
  it("isGemConflict · GEM_LOCK_CODES", () => {
    expect(isGemConflict("gem_conflict")).toBe(true);
    expect(isGemConflict("gem_rev_invalid")).toBe(true);
    expect(isGemConflict("gem_similar")).toBe(false);
    expect([...GEM_LOCK_CODES].sort()).toEqual(["job_cancelled", "job_closed", "job_locked", "job_not_open", "no_gem_stage"]);
  });
  it("gemSummaryNotices: ใช้ตัวเดิมให้ · รวมแถวซ้ำ · ชื่อใหม่เข้าแคตตาล็อก (ไม่เงียบ)", () => {
    expect(gemSummaryNotices({ createdTypes: [], createdShapes: [], reused: [], mergedRows: [] })).toEqual([]);
    const n = gemSummaryNotices({ createdTypes: ["ทับทิม"], createdShapes: ["ทรงใบไม้"], reused: [{ row: 1, kind: "type", typed: "โกเมนต์", name: "โกเมน" }, { row: null, kind: "shape", typed: "ไข", name: "ไข่" }], mergedRows: [[1, 2], [4, 5, 6], [9]] });
    expect(n).toEqual([
      "ชนิด “โกเมนต์” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “โกเมน” ให้",
      "รูปทรง “ไข” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “ไข่” ให้",
      "รวมแถวซ้ำ 3 แถว (แถว 1, 2 · แถว 4, 5, 6) — จำนวนต่อชิ้นถูกบวกกันให้แล้ว",
      "เพิ่มเข้ารายการพลอยของร้านแล้ว: ทับทิม · ทรงใบไม้",
    ]);
  });
});

describe("gemOptionsOf · rowFromIntakeLine", () => {
  it("items มาจากแถวที่รู้ id (ชนิด/รูปทรง/ขนาดครบ) — แถวที่ไม่ครบไม่เข้า", () => {
    const o = gemOptionsOf([{ id: T1, name: "โกเมน" }], [{ id: S2, name: "ไข่", hasLength: true }], [line(), line({ gemItemId: I2, typeId: null })]);
    expect(o.types).toEqual([{ id: T1, name: "โกเมน" }]);
    expect(o.shapes).toEqual([{ id: S2, name: "ไข่", hasLength: true }]);
    expect(o.items).toEqual([{ gemItemId: I1, typeId: T1, shapeId: S2, sizeA: 4, sizeB: 6, sizeLabel: "4×6" }]);
  });
  it("แถวจากแม่แบบ = รายการเดิม (itemId + ฉลาก) ป้าย template ยังไม่ 'แก้แล้ว'", () => {
    const r = rowFromIntakeLine(line({ position: "ล้อมรอบ" }), "template");
    expect(r).toMatchObject({ itemId: I1, canonicalId: I1, label: "โกเมน · ไข่ · 4×6 มม.", qty: "2", position: "ล้อมรอบ", origin: "template", edited: false });
  });
});

describe("🔴 ข้อความของพลอยบนหน้างานไม่มีเงิน/ราคา", () => {
  it("SHOP_GEM_TH ทุกข้อความ", () => {
    const all = JSON.stringify(Object.values(SHOP_GEM_TH).map((v) => (typeof v === "function" ? v(1 as never) : v)));
    expect(all).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|เผื่อแตก/i);
  });
});
