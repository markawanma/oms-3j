// 0190 G1a: กติกาพลอยฝั่งจอ — parity กับ SQL (verify-0190 N1-N17) + ขนาด/ฉลาก/รวมแถว
import { describe, expect, it } from "vitest";
import { cleanGemName, findSimilarGemNames, gemLabelPreview, gemNameDistance, gemNameSimilar, gemSizeLabel, gemSizeNeedsConfirm, gemTotals, mergeDuplicateGemRows, normalizeGemName, normalizeGemSizes, parseGemSize } from "./shop-gems";

describe("gemNameSimilar — ชุดเคส UX §3.4 (เหมือน verify-0190 N1-N14)", () => {
  it.each([
    ["โกเมน", "โกเมนต์"], ["อเมทิสต์", "อเมทิส"], ["อะเมทิส", "อเมทิสต์"], ["CZ", "cz"], ["CZ", "C Z"], ["ไพลิน", "ไพลิน "], ["ＣＺ", "cz"], ["C​Z", "cz"], ["หัวใจ", "ทรงหัวใจ"],
  ])("ต้องเตือน: %s ↔ %s", (a, b) => expect(gemNameSimilar(a, b)).toBe(true));
  it.each([
    ["ทับทิม", "ไพลิน"], ["ซิทริน", "เพอริดอท"], ["กลม", "หยดน้ำ"], ["CZ", "AZ"], ["CZ", "CZX"], ["กลม", "กลมๆ"], ["Blue Topaz", "บลูโทแพซ"], ["CZ", "เพชรรัสเซีย"], ["Blue Topaz", "White Topaz"], ["", "โกเมน"],
  ])("ต้องไม่เตือน: %s ↔ %s", (a, b) => expect(gemNameSimilar(a, b)).toBe(false));
  it("normalize: ตัดช่องว่าง/วรรคตอน/ล่องหน · ตัวเล็ก · ไม่ตัดสระ/วรรณยุกต์ไทย", () => {
    expect(normalizeGemName("  C  Z ")).toBe("cz");
    expect(normalizeGemName("C.Z")).toBe("cz");
    expect(normalizeGemName("ไพลิน ")).toBe("ไพลิน");
    expect(normalizeGemName(null)).toBe("");
    expect(gemNameDistance("โกเมน", "โกเมนต์")).toBe(2);
  });
  it("findSimilarGemNames: exact (norm เท่ากัน) แยกจาก similar · ไม่เกิน limit", () => {
    const rows = [{ id: "1", name: "โกเมน" }, { id: "2", name: "ไพลิน" }, { id: "3", name: "โกเมนต์" }];
    const r = findSimilarGemNames("โกเมน ", rows);
    expect(r.exact?.id).toBe("1");
    expect(r.similar.map((x) => x.id)).toEqual(["3"]);
    expect(findSimilarGemNames("ทับทิม", rows)).toEqual({ exact: null, similar: [] });
  });
});

describe("cleanGemName — ตรงกับ gem_name_ok", () => {
  it.each(["โกเมน", "CZ", "6 เหลี่ยม", "ไข่"])("ผ่าน: %s", (n) => expect(cleanGemName(n).ok).toBe(true));
  it.each(["a", "", "12", "1.5", "..", "ab<c", "x\ty", "ก​ข", "​​", "😀😀", "ก".repeat(41), "x>", "   "])("ไม่ผ่าน: %j", (n) => expect(cleanGemName(n).ok).toBe(false));
  it("ยุบช่องว่างซ้ำ + ตัดหัวท้าย · ข้อความไทย", () => {
    expect(cleanGemName("  โกเมน   สด ")).toEqual({ ok: true, value: "โกเมน สด" });
    const bad = cleanGemName("1");
    expect(bad.ok === false && /[ก-๛]/.test(bad.message)).toBe(true);
  });
});

describe("ขนาด/ฉลาก/รวมแถว", () => {
  it("parseGemSize: รับ ',' · ปฏิเสธ 0/ลบ/>100/ทศนิยม 3/NaN/1e2", () => {
    expect(parseGemSize("1,5")).toEqual({ ok: true, value: 1.5 });
    expect(parseGemSize(100)).toEqual({ ok: true, value: 100 });
    for (const bad of [0, "0", -1, "100.01", "1.234", "NaN", "1e2", "", null, Infinity, "abc"]) expect(parseGemSize(bad).ok, String(bad)).toBe(false);
  });
  it("normalizeGemSizes: 6×4 → 4×6 (swapped) · รูปทรง 1 ค่าทิ้ง b · > 30 ต้องยืนยัน", () => {
    expect(normalizeGemSizes(6, 4, true)).toEqual({ a: 4, b: 6, swapped: true });
    expect(normalizeGemSizes(4, 6, true)).toEqual({ a: 4, b: 6, swapped: false });
    expect(normalizeGemSizes(2, 5, false)).toEqual({ a: 2, b: null, swapped: false });
    expect(gemSizeNeedsConfirm(30, null)).toBe(false);
    expect(gemSizeNeedsConfirm(31, null)).toBe(true);
    expect(gemSizeNeedsConfirm(4, 45)).toBe(true);
  });
  it("sizeLabel/labelPreview ตัดศูนย์ท้าย (ตรงกับ SQL N17)", () => {
    expect(gemSizeLabel(4, 6)).toBe("4×6");
    expect(gemSizeLabel(1.5, null)).toBe("1.5");
    expect(gemSizeLabel(2.25, null)).toBe("2.25");
    expect(gemSizeLabel(100, null)).toBe("100");
    expect(gemLabelPreview("โกเมน", "ไข่", 4, 6)).toBe("โกเมน · ไข่ · 4×6 มม.");
  });
  it("gemTotals: จำนวนเต็ม × จำนวนเต็ม (ใหญ่ถึงหลักล้านไม่ปัดเศษ)", () => {
    expect(gemTotals([{ qtyPerPiece: 2 }, { qtyPerPiece: 30 }], 35)).toEqual({ lineTotals: [70, 1050], total: 1120 });
    expect(gemTotals([{ qtyPerPiece: 1000 }], 100000).total).toBe(100_000_000);
  });
  it("mergeDuplicateGemRows: บวกจำนวน · ตำแหน่งต่อกันตัดซ้ำ", () => {
    const m = mergeDuplicateGemRows([{ k: "a", qtyPerPiece: 2, position: "ซ้าย" }, { k: "b", qtyPerPiece: 1, position: null }, { k: "a", qtyPerPiece: 3, position: "ขวา" }, { k: "a", qtyPerPiece: 1, position: "ซ้าย" }], (r) => r.k);
    expect(m).toEqual([{ k: "a", qtyPerPiece: 6, position: "ซ้าย, ขวา" }, { k: "b", qtyPerPiece: 1, position: null }]);
  });
});
