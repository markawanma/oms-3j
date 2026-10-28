import { describe, expect, it } from "vitest";
import { applySimilarChoice, interpretGemFail, reusedNotices } from "@/lib/jobs/gem-save";
import { emptyGemRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import type { GemSimilarHit } from "@/lib/jobs/gems";

const T = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const mk = (o: Partial<GemDraftRow> = {}): GemDraftRow => ({ ...emptyGemRow(), type: { kind: "new", name: "โกเมนต์" }, shape: { kind: "existing", id: S, name: "ไข่", hasLength: true }, sizeA: "4", sizeB: "6", qty: "2", ...o });

describe("interpretGemFail", () => {
  const rows = [mk(), mk({ qty: "3" })];
  it("similar → hit แรก ไม่มี error อื่น", () => {
    const hit: GemSimilarHit = { kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T, name: "โกเมน" }] };
    const v = interpretGemFail({ error: "พบชื่อที่คล้าย", code: "gem_similar", gem: { code: "gem_similar", similar: [hit] } }, rows);
    expect(v.similar).toEqual(hit);
    expect(v.generalError).toBeNull();
    expect(v.rowErrors).toEqual({});
  });
  it("error ของแถว 2 → ผูกกับ key ของแถว 2 + ช่อง", () => {
    const v = interpretGemFail({ error: "จำนวนต่อชิ้นต้องเป็นเลข 1–1,000", gem: { code: "qty_invalid", row: 2, field: "qty_per_piece" } }, rows);
    expect(v.rowErrors[rows[1].key]).toEqual({ field: "qty_per_piece", message: "จำนวนต่อชิ้นต้องเป็นเลข 1–1,000" });
    expect(v.focusRowKey).toBe(rows[1].key);
    expect(v.generalError).toBeNull();
  });
  it("แถวเกินจำนวนที่มี / ไม่มี row → ข้อความระดับฟอร์ม", () => {
    expect(interpretGemFail({ error: "x", gem: { code: "line_invalid", row: 9 } }, rows).generalError).toBe("x");
    expect(interpretGemFail({ error: "ล้ม" }, rows).generalError).toBe("ล้ม");
    expect(interpretGemFail({ error: "reason", gem: { code: "reason_required", row: 0 } }, rows).generalError).toBe("reason");
  });
});

describe("applySimilarChoice", () => {
  it("ชนิด: ทุกแถวที่พิมพ์ชื่อนั้นชี้ไปตัวที่มี · แถวอื่นไม่ถูกแตะ", () => {
    const rows = [mk(), mk({ type: { kind: "existing", id: T, name: "CZ" } }), mk()];
    const hit: GemSimilarHit = { kind: "type", name: "โกเมนต์", rows: [1, 3], matches: [] };
    const out = applySimilarChoice(rows, hit, { id: T, name: "โกเมน" }, null);
    expect(out[0].type).toEqual({ kind: "existing", id: T, name: "โกเมน" });
    expect(out[2].type).toEqual({ kind: "existing", id: T, name: "โกเมน" });
    expect(out[1].type).toEqual({ kind: "existing", id: T, name: "CZ" });
  });
  it("match.id = null (ชื่อใหม่อีกตัวในคำขอเดียวกัน) → เป็นชื่อใหม่ตามตัวนั้น", () => {
    const out = applySimilarChoice([mk()], { kind: "type", name: "x", rows: [1], matches: [] }, { id: null, name: "โกเมน" }, null);
    expect(out[0].type).toEqual({ kind: "new", name: "โกเมน" });
  });
  it("รูปทรง: ใช้ hasLength จาก options · 1 ค่า ล้างด้านที่สอง", () => {
    const row = mk({ shape: { kind: "new", name: "ทรงไข", hasLength: true } });
    const out = applySimilarChoice([row], { kind: "shape", name: "ทรงไข", rows: [1], matches: [] }, { id: S, name: "กลม" }, { types: [], shapes: [{ id: S, name: "กลม", hasLength: false }], items: [] });
    expect(out[0].shape).toEqual({ kind: "existing", id: S, name: "กลม", hasLength: false });
    expect(out[0].sizeB).toBe("");
  });
  it("hit ไม่มีแถว (สร้าง/เปลี่ยนชื่อตรงๆ) = ไม่แก้อะไร", () => {
    const rows = [mk()];
    expect(applySimilarChoice(rows, { kind: "type", name: "x", rows: [], matches: [] }, { id: T, name: "โกเมน" }, null)).toEqual(rows);
  });
});

describe("reusedNotices", () => {
  it("ข้อความ 'ใช้ตัวเดิมให้' ตาม UX §3.6", () => {
    expect(reusedNotices([{ row: 1, kind: "type", typed: "cz", name: "CZ" }])).toEqual(["ชนิด “cz” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “CZ” ให้"]);
  });
});
