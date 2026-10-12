import { describe, expect, it } from "vitest";
import { isUuid, parseCount, parseDate, parsePin, parseScrapReason, parseSeq, parseStageCodes, parseText, parseWeight, parseWeightOrZero } from "./input";

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
