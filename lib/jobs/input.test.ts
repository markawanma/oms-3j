import { describe, expect, it } from "vitest";
import { INVISIBLE_RE, isUuid, parseCount, parseLabel, parseDate, parsePin, parseScrapReason, parseSeq, parseStageCodes, parseText, parseWeight, parseWeightOrZero } from "./input";

describe("parseWeight", () => {
  it("ค่าที่ถูก: ทศนิยม ≤3 ตำแหน่ง · จุลภาคตัวเดียวไม่มีจุด = ทศนิยม · number · ขอบเขต", () => {
    expect(parseWeight("12.345")).toEqual({ ok: true, value: 12.345 });
    expect(parseWeight("95,5")).toEqual({ ok: true, value: 95.5 });
    expect(parseWeight("0,25")).toEqual({ ok: true, value: 0.25 });
    expect(parseWeight(0.001)).toEqual({ ok: true, value: 0.001 });
    expect(parseWeight("100000")).toEqual({ ok: true, value: 100000 });
  });
  it("ว่าง/ไม่ส่ง = null (ไม่ใช่ 0)", () => {
    for (const v of ["", "  ", null, undefined]) expect(parseWeight(v)).toEqual({ ok: true, value: null });
  });
  it("ห้ามผ่าน: 0 · ติดลบ · NaN · Infinity · 4 ทศนิยม · เกินเพดาน · ตัวอักษร · เลขวิทยาศาสตร์ · วัตถุ", () => {
    for (const v of ["0", "0.000", "-1", "NaN", "Infinity", "1.2345", "100000.001", "abc", "1e3", "1.", ".5", "0x10", {}, [], true, NaN, Infinity, -5]) {
      expect(parseWeight(v as never).ok, String(v)).toBe(false);
    }
  });
});

describe("parseWeightOrZero (เติมโลหะ)", () => {
  it("ว่าง/0 = 0 · ค่าบวก = ค่านั้น · ติดลบ/NaN ไม่ผ่าน", () => {
    for (const v of [undefined, null, "", " ", "0", "0.0", "0.000"]) expect(parseWeightOrZero(v, "เติมโลหะ")).toEqual({ ok: true, value: 0 });
    expect(parseWeightOrZero("0.4", "เติมโลหะ")).toEqual({ ok: true, value: 0.4 });
    for (const v of ["-0.1", "NaN", "abc", "1.2345"]) expect(parseWeightOrZero(v, "เติมโลหะ").ok, v).toBe(false);
  });
});

describe("parseCount / parseSeq", () => {
  it("จำนวนเต็ม 0..max", () => {
    expect(parseCount(0, "เสีย")).toEqual({ ok: true, value: 0 });
    expect(parseCount("3", "เสีย")).toEqual({ ok: true, value: 3 });
    expect(parseCount(100000, "เสีย").ok).toBe(true);
  });
  it("ห้ามผ่าน: ติดลบ · ทศนิยม · เกินเพดาน · NaN · ข้อความ", () => {
    for (const v of [-1, 1.5, 100001, NaN, Infinity, "1.5", "-2", "abc", "", null, undefined, {}]) expect(parseCount(v, "เสีย").ok, String(v)).toBe(false);
  });
  it("seq 1..100 เท่านั้น", () => {
    expect(parseSeq(1).ok).toBe(true);
    expect(parseSeq(100).ok).toBe(true);
    for (const v of [0, 101, 1.5, "1", NaN, null]) expect(parseSeq(v as never).ok, String(v)).toBe(false);
  });
});

describe("parseDate", () => {
  it("วันจริงปี 2025–2035", () => {
    expect(parseDate("2026-10-12").ok).toBe(true);
    expect(parseDate("2035-12-31").ok).toBe(true);
  });
  it("ห้ามผ่าน: วันที่ไม่มีจริง · รูปแบบผิด · ปีนอกช่วง", () => {
    for (const v of ["2026-02-30", "2026-13-01", "26-10-12", "2026/10/12", "2024-12-31", "2036-01-01", "", null, 20261012, "2026-10-12T00:00:00Z"]) {
      expect(parseDate(v as never).ok, String(v)).toBe(false);
    }
  });
});

describe("parseText", () => {
  it("ยุบช่องว่าง · trim · ว่างและไม่บังคับ = null", () => {
    expect(parseText("  ก   ข  ", "เหตุผล", 20, true)).toEqual({ ok: true, value: "ก ข" });
    expect(parseText("  ", "หมายเหตุ", 20, false)).toEqual({ ok: true, value: null });
    expect(parseText(undefined, "หมายเหตุ", 20, false)).toEqual({ ok: true, value: null });
  });
  it("ห้ามผ่าน: บังคับแต่ว่าง · ยาวเกิน · control char · ไม่ใช่ string", () => {
    expect(parseText("", "เหตุผล", 20, true).ok).toBe(false);
    expect(parseText(undefined, "เหตุผล", 20, true).ok).toBe(false);
    expect(parseText("ก".repeat(21), "เหตุผล", 20, true).ok).toBe(false);
    expect(parseText("a\u0000b", "เหตุผล", 20, true).ok).toBe(false);
    expect(parseText(5 as never, "เหตุผล", 20, true).ok).toBe(false);
  });
});

describe("parsePin / parseStageCodes / parseScrapReason / isUuid", () => {
  it("PIN 4 หลักเท่านั้น (ความง่ายให้ DB ตัดสิน)", () => {
    expect(parsePin("4831").ok).toBe(true);
    for (const v of ["123", "12345", "12a4", " 123", "", null, 1234, "１２３４"]) expect(parsePin(v as never).ok, String(v)).toBe(false);
  });
  it("รหัสขั้น: รูปแบบ · ไม่ซ้ำ · ไม่ว่าง (เมื่อไม่อนุญาต)", () => {
    expect(parseStageCodes(["cast", "polish"], false)).toEqual({ ok: true, value: ["cast", "polish"] });
    expect(parseStageCodes([], true)).toEqual({ ok: true, value: [] });
    for (const v of [[], ["cast", "cast"], ["Cast"], ["a"], ["x y"], [1], "cast", null, Array.from({ length: 31 }, (_, i) => `s${i}x`)]) {
      expect(parseStageCodes(v as never, false).ok, JSON.stringify(v)).toBe(false);
    }
  });
  it("เหตุผลของเสีย: ไม่มีของเสีย = null · มี = ต้องอยู่ใน allowlist", () => {
    expect(parseScrapReason(null, 0)).toEqual({ ok: true, value: null });
    expect(parseScrapReason("junk", 0)).toEqual({ ok: true, value: null });
    expect(parseScrapReason("porosity", 2)).toEqual({ ok: true, value: "porosity" });
    for (const v of [null, "", "junk", 5, "POROSITY"]) expect(parseScrapReason(v as never, 1).ok, String(v)).toBe(false);
  });
  it("uuid", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    for (const v of ["", "x", "JB-0001", "11111111-1111-4111-8111-11111111111", null, 5]) expect(isUuid(v)).toBe(false);
  });
});

describe("parseWeight — เพดานเฉพาะช่อง (opts.max · 0175 BUG-4)", () => {
  it("ไม่ส่ง opts = เพดานเดิม 100,000 ข้อความเดิม", () => {
    expect(parseWeight("100000")).toEqual({ ok: true, value: 100000 });
    expect(parseWeight("100001", "น้ำหนัก")).toEqual({ ok: false, error: "น้ำหนักต้องมากกว่า 0 และไม่เกิน 100,000 กรัม" });
  });
  it("max 10,000: 10000 ผ่าน · 10000.001 / 10001 / 100000 ไม่ผ่าน ข้อความบอกเพดานจริง", () => {
    const o = { max: 10000 };
    expect(parseWeight("10000", "เป้าหมาย", o)).toEqual({ ok: true, value: 10000 });
    for (const v of ["10000.001", "10001", "100000"]) expect(parseWeight(v, "เป้าหมาย", o)).toEqual({ ok: false, error: "เป้าหมายต้องมากกว่า 0 และไม่เกิน 10,000 กรัม" });
    expect(parseWeight("", "เป้าหมาย", o)).toEqual({ ok: true, value: null });
  });
});

describe("parseLabel — อักขระล่องหน/bidi (security 0176 L1)", () => {
  const BAD: [string, string][] = [
    ["U+200B zero-width space", "แบบ\u200B1"],
    ["U+200C ZWNJ", "แบบ\u200C1"],
    ["U+200D ZWJ", "แบบ\u200D1"],
    ["U+200E LRM", "แบบ\u200E1"],
    ["U+202E RLO (bidi)", "แบบ\u202E1"],
    ["U+202A LRE", "แบบ\u202A1"],
    ["U+2066 isolate", "แบบ\u20661"],
    ["U+2060 word joiner", "แบบ\u20601"],
    ["U+00AD soft hyphen", "แบบ\u00AD1"],
    ["U+034F CGJ", "แบบ\u034F1"],
    ["U+061C ALM", "แบบ\u061C1"],
    ["U+115F/1160 hangul filler", "แบบ\u115F1"],
    ["U+17B4 khmer", "แบบ\u17B41"],
    ["U+180B mongolian VS", "แบบ\u180B1"],
    ["U+2800 braille blank", "แบบ\u28001"],
    ["U+3164 hangul filler", "แบบ\u31641"],
    ["U+FE0F VS16", "แบบ\uFE0F1"],
    ["U+FEFF BOM", "แบบ\uFEFF1"],
    ["U+FFA0 halfwidth filler", "แบบ\uFFA01"],
    ["tag char U+E0041", "แบบ\u{E0041}1"],
    ["ชื่อมีแต่ตัวล่องหน", "\u200B\u200B"],
  ];
  it.each(BAD)("ปฏิเสธ: %s", (_n, v) => {
    expect(parseLabel(v, "ชื่อแบบ", 60, true)).toEqual({ ok: false, error: "ชื่อแบบมีอักขระที่มองไม่เห็นหรืออักขระควบคุมทิศทาง" });
    expect(parseLabel(v, "ชื่อแบบ", 60, false).ok).toBe(false);
    expect(INVISIBLE_RE.test(v)).toBe(true);
  });
  it("ต้องไม่พัง: ไทย · อังกฤษ · ตัวเลข · เว้นวรรคปกติ · ขีด · อีโมจิพื้นฐาน · วรรณยุกต์/สระไทย ผ่านและคงเดิม", () => {
    for (const v of ["แหวนลายใบไม้ ไซส์ 7", "ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด", "Ring A-01", "ช่างเอ", "แบบ 1 👍", "ก\u0E48\u0E34\u0E49", "ช่าง (สำเนา)"]) {
      expect(parseLabel(v, "ชื่อ", 60, true), v).toEqual({ ok: true, value: v });
    }
    expect(parseLabel("", "ชื่อ", 60, false)).toEqual({ ok: true, value: null });
    expect(parseLabel(null, "ชื่อ", 60, false)).toEqual({ ok: true, value: null });
    expect(parseLabel("   ", "ชื่อ", 60, true).ok).toBe(false);
  });
  it("กฎเดิมยังอยู่: < > ปฏิเสธ · ยาวเกิน · ไม่ใช่ข้อความ", () => {
    expect(parseLabel("แบบ<b>", "ชื่อ", 60, true).ok).toBe(false);
    expect(parseLabel("ก".repeat(61), "ชื่อ", 60, true).ok).toBe(false);
    expect(parseLabel(5 as never, "ชื่อ", 60, true).ok).toBe(false);
  });
});
