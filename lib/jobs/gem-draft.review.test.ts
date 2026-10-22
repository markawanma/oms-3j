// รอบ review/QA 22 ต.ค. — gem-draft: แถวซ้ำข้าม "รายการเดิม vs เลือกชนิด/รูปทรง/ขนาด" · gemRowsBlocking · size_big · diff ด้วย canonical id · ข้อความ diff · เหตุผล (whitelist DB) · แจ้งแถวที่ DB รวมให้
import { describe, expect, it } from "vitest";
import {
  diffGemLines,
  emptyGemRow,
  findDuplicateRows,
  gemCreateDecision,
  gemDiffText,
  gemRowIssues,
  gemRowsBlocking,
  rowDupKey,
  rowFromBomLine,
} from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { gemReasonIssue } from "@/lib/jobs/gem-reason";
import { mergedNotices, saveNotices } from "@/lib/jobs/gem-save";
import type { GemBomLine, GemOptions } from "@/lib/jobs/gems";

const T = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const ITEM = "44444444-4444-4444-8444-444444444444";
const ITEM2 = "44444444-4444-4444-8444-444444444445";
const OPTIONS: GemOptions = {
  types: [{ id: T, name: "โกเมน" }],
  shapes: [{ id: S, name: "ไข่", hasLength: true }],
  items: [{ gemItemId: ITEM, typeId: T, shapeId: S, sizeA: 4, sizeB: 6, sizeLabel: "4×6" }],
};
const line = (o: Partial<GemBomLine> = {}): GemBomLine => ({ id: null, gemItemId: ITEM, canonicalItemId: ITEM, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 1, qtyTotal: null, position: null, source: "product", renamed: false, via: null, ...o });
const picked = (o: Partial<GemDraftRow> = {}): GemDraftRow => ({
  ...emptyGemRow("manual"),
  type: { kind: "existing", id: T, name: "โกเมน" },
  shape: { kind: "existing", id: S, name: "ไข่", hasLength: true },
  sizeA: "4",
  sizeB: "6",
  qty: "2",
  ...o,
});

describe("แถวซ้ำข้าม 'รายการเดิม' กับ 'เลือกชนิด/รูปทรง/ขนาดเดียวกัน' (QA4 — DB รวมเงียบ จอต้องจับก่อน)", () => {
  it("ไม่มี options: เทียบด้วยฉลาก (แม่แบบรู้แค่ id + ฉลาก) → ซ้ำ", () => {
    expect([...findDuplicateRows([rowFromBomLine(line(), "template"), picked()])]).toEqual([[1, 0]]);
    expect([...findDuplicateRows([picked(), rowFromBomLine(line(), "template")])]).toEqual([[1, 0]]);
  });
  it("มี options: เทียบด้วยชนิด/รูปทรง/ขนาดของรายการ (ฉลากถูกเปลี่ยนชื่อทีหลังก็ยังจับได้)", () => {
    const stale = rowFromBomLine(line({ label: "ชื่อเก่า · ไข่ · 4×6 มม." }), "template");
    expect([...findDuplicateRows([stale, picked()])]).toEqual([]); // ไม่มี options + ฉลากเก่า = จับไม่ได้ (รู้แล้ว)
    expect([...findDuplicateRows([stale, picked()], OPTIONS)]).toEqual([[1, 0]]);
    expect(rowDupKey(stale, OPTIONS)).toBe(rowDupKey(picked(), OPTIONS));
  });
  it("ขนาดต่าง/รูปทรงต่าง = ไม่ซ้ำ · 6×4 (กลับด้าน) กับ 4×6 ซ้ำ", () => {
    const tpl = rowFromBomLine(line(), "template");
    expect(findDuplicateRows([tpl, picked({ sizeA: "5", sizeB: "7" })], OPTIONS).size).toBe(0);
    expect(findDuplicateRows([tpl, picked({ sizeA: "6", sizeB: "4" })], OPTIONS).size).toBe(1);
  });
  it("รายการเดิมสองแถวคนละ id แต่ชี้รายการจริง (canonical) เดียวกัน = ซ้ำ · คนละรายการจริง ฉลากเหมือนกัน = ไม่ซ้ำ", () => {
    const a = rowFromBomLine(line({ gemItemId: ITEM, canonicalItemId: ITEM }), "saved");
    const merged = rowFromBomLine(line({ gemItemId: ITEM2, canonicalItemId: ITEM, label: "โกเมนต์ · ไข่ · 4×6 มม." }), "saved");
    expect(findDuplicateRows([a, merged]).size).toBe(1);
    const other = rowFromBomLine(line({ gemItemId: ITEM2, canonicalItemId: ITEM2 }), "saved"); // ฉลากเหมือน แต่ id ต่าง
    expect(findDuplicateRows([a, other]).size).toBe(0);
  });
});

describe("gemRowsBlocking — ใช้ทุกจอ คำนวณจาก rows ทุกครั้ง", () => {
  it("ครบและไม่ซ้ำ = null · ไม่ครบ = เหตุผลของแถวแรกที่ผิด · ซ้ำ = บอกให้รวม", () => {
    expect(gemRowsBlocking([picked()])).toBeNull();
    expect(gemRowsBlocking([picked(), emptyGemRow()])).toBe("พลอยแถว 2 ยังไม่ครบ — เลือกหรือพิมพ์ชนิดพลอย");
    expect(gemRowsBlocking([picked(), picked()])).toContain("พลอยแถว 2 ซ้ำกับแถว 1");
    expect(gemRowsBlocking([rowFromBomLine(line(), "template"), picked()], OPTIONS)).toContain("ซ้ำกับแถว 1");
    expect(gemRowsBlocking([])).toBeNull();
  });
  it("gemCreateDecision ใช้ตัวเดียวกัน (แถวจากแม่แบบซ้ำกับแถวที่เลือกเอง = บล็อก)", () => {
    const d = gemCreateDecision({ touched: true, rows: [rowFromBomLine(line(), "template"), picked()], gemTicked: true, hasGemStage: true, templateCount: 1, options: OPTIONS });
    expect(d.blocking).toContain("ซ้ำกับแถว 1");
  });
});

describe("size_big (S4) — field ของตัวเองแทนการเช็คข้อความ", () => {
  it("> 30 มม. ยังไม่ติ๊ก: issue field = size_big (ไม่ใช่ size_a) · ติ๊กแล้วหาย · ขนาดผิดรูปแบบยังเป็น size_a", () => {
    const big = gemRowIssues(picked({ sizeA: "31", sizeB: "35" }));
    expect(big.map((i) => i.field)).toEqual(["size_big"]);
    expect(gemRowIssues(picked({ sizeA: "31", sizeB: "35", bigConfirmed: true }))).toEqual([]);
    expect(gemRowIssues(picked({ sizeA: "abc" })).map((i) => i.field)).toContain("size_a");
  });
});

describe("diffGemLines — เทียบด้วย canonical id", () => {
  const L = (label: string, q: number, key?: string, p: string | null = null) => ({ label, qtyPerPiece: q, position: p, key });
  it("ชื่อถูกเปลี่ยน/รวมทีหลัง (label ต่าง key เดิม) = 'แก้' ไม่ใช่ ลบ+เพิ่ม", () => {
    const d = diffGemLines([L("โกเมนต์ · ไข่", 2, ITEM)], [L("โกเมน · ไข่", 2, ITEM)]);
    expect(d).toHaveLength(1);
    expect(d[0].op).toBe("change");
    expect(gemDiffText(d[0])).toBe("~ แก้ โกเมนต์ · ไข่ → โกเมน · ไข่ : 2/ชิ้น → 2/ชิ้น");
  });
  it("ไม่มี key = เทียบด้วยฉลากเหมือนเดิม · key ต่างฉลากเดียวกัน = คนละรายการ", () => {
    expect(diffGemLines([L("A", 1)], [L("A", 1)])).toEqual([]);
    expect(diffGemLines([L("A", 1, "k1")], [L("A", 1, "k2")]).map((e) => e.op).sort()).toEqual(["add", "remove"]);
  });
  it("gemDiffText: เพิ่ม/ลบ/แก้ (จำนวน+ตำแหน่ง)", () => {
    expect(gemDiffText({ op: "add", to: L("B", 3, undefined, "บ่า") })).toBe("+ เพิ่ม B · 3/ชิ้น · บ่า");
    expect(gemDiffText({ op: "remove", from: L("C", 4) })).toBe("− ลบ C · 4/ชิ้น");
    expect(gemDiffText({ op: "change", from: L("A", 1, undefined, "x"), to: L("A", 2, undefined, "y") })).toBe("~ แก้ A : 1/ชิ้น (x) → 2/ชิ้น (y)");
  });
});

describe("gemReasonIssue — เหตุผลหลังขั้นฝังรับ (whitelist เดียวกับ DB)", () => {
  it("ล่องหน/ควบคุมปน = ปฏิเสธพร้อมข้อความเฉพาะ · ไม่มีตัวอักษรจริง = ข้อความใส่เหตุผล · ปกติ = null · >300 ปฏิเสธ", () => {
    expect(gemReasonIssue("​x")).toContain("ล่องหน");
    expect(gemReasonIssue("\u00851")).toContain("ล่องหน");
    expect(gemReasonIssue("👍")).toContain("ใส่เหตุผล");
    expect(gemReasonIssue("   ")).toContain("ใส่เหตุผล");
    expect(gemReasonIssue("ช่างฝังเปลี่ยนแบบ")).toBeNull();
    expect(gemReasonIssue("ก".repeat(300))).toBeNull();
    expect(gemReasonIssue("ก".repeat(301))).toContain("300");
  });
});

describe("แจ้งแถวซ้ำที่ DB รวมให้ (QA4 — merged_rows)", () => {
  it("[[1,2]] → 'รวมแถวซ้ำ 1 แถว (แถว 1, 2)' · หลายกลุ่มนับรวม · กลุ่มเดี่ยว/ว่างไม่แจ้ง", () => {
    expect(mergedNotices([[1, 2]])).toEqual(["รวมแถวซ้ำ 1 แถว (แถว 1, 2) — จำนวนต่อชิ้นถูกบวกกันให้แล้ว"]);
    expect(mergedNotices([[1, 2], [4, 5, 6]])[0]).toContain("รวมแถวซ้ำ 3 แถว (แถว 1, 2 · แถว 4, 5, 6)");
    expect(mergedNotices([[3]])).toEqual([]);
    expect(mergedNotices([])).toEqual([]);
  });
  it("saveNotices = ใช้ตัวเดิมให้ + รวมแถวซ้ำ", () => {
    const n = saveNotices({ reused: [{ row: 1, kind: "type", typed: "cz", name: "CZ" }], mergedRows: [[1, 2]] });
    expect(n).toHaveLength(2);
    expect(n[1]).toContain("รวมแถวซ้ำ 1 แถว");
  });
});
