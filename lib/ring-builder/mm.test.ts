import { describe, expect, it } from "vitest";
import { formatMm100, parseMm100, parseStoneSize, stoneLabel } from "./mm";

describe("parseMm100 — จำนวนเต็ม 1/100 มม. ไม่ใช้ parseFloat", () => {
  it.each([
    ["2", 200], ["2.5", 250], ["2.50", 250], ["2.05", 205], ["0.5", 50], ["0.50", 50], ["20", 2000], ["20.00", 2000], ["10.99", 1099], ["02", 200], [" 3 ", 300],
  ])("%s → %d", (s, v) => expect(parseMm100(s)).toBe(v));

  it.each([
    ["2,5", "จุลภาคกำกวม"], ["2.555", "ทศนิยม 3 ตำแหน่ง"], ["NaN", "NaN"], ["Infinity", "Infinity"], ["0", "ต่ำกว่า 0.50"], ["0.49", "ต่ำกว่า 0.50"], ["25", "เกิน 20.00"],
    ["20.01", "เกิน 20.00"], ["", "ว่าง"], ["  ", "ช่องว่าง"], ["-2", "ติดลบ"], ["+2", "เครื่องหมายบวก"], [".5", "ไม่มีเลขหน้าจุด"], ["2.", "จุดลอย"], ["1e1", "เลขยกกำลัง"],
    ["0x10", "hex"], ["2 5", "ช่องว่างกลางเลข"], ["２", "เลขเต็มความกว้าง"], ["๒", "เลขไทย"], ["4x3", "ไม่ใช่เลขเดี่ยว"],
  ])("%s → null (%s)", (s) => expect(parseMm100(s)).toBeNull());

  it("ไม่ใช่สตริง → null", () => {
    for (const v of [null, undefined, 2, NaN, {}, [], true]) expect(parseMm100(v)).toBeNull();
  });
});

describe("parseStoneSize — กว้าง×ยาว · canonical major ≥ minor", () => {
  it("เลขเดียว = กลม (2 = 2×2)", () => expect(parseStoneSize("2")).toEqual({ ok: true, major: 200, minor: 200 }));
  it.each([["4x3"], ["4X3"], ["4×3"], ["4*3"], [" 4 × 3 "], ["3x4"], ["3×4"]])("%s → major 400 minor 300 (สลับก็เป็นเม็ดเดียวกัน)", (s) => {
    expect(parseStoneSize(s)).toEqual({ ok: true, major: 400, minor: 300 });
  });
  it("ทศนิยม", () => expect(parseStoneSize("2.5x1.25")).toEqual({ ok: true, major: 250, minor: 125 }));
  it.each([["", "empty"], ["  ", "empty"]])("%j → %s", (s, r) => expect(parseStoneSize(s)).toEqual({ ok: false, reason: r }));
  it.each(["4x3x2", "x", "4x", "x3", "4,5x3", "2.555x2", "NaN", "4 3", "4xx3", "4××3"])("%s → format", (s) => {
    expect(parseStoneSize(s)).toEqual({ ok: false, reason: "format" });
  });
  it.each(["0x3", "25x3", "4x0.4", "25"])("%s → range", (s) => expect(parseStoneSize(s)).toEqual({ ok: false, reason: "range" }));
  it("ไม่ใช่สตริง → empty", () => expect(parseStoneSize(undefined)).toEqual({ ok: false, reason: "empty" }));
});

describe("formatMm100 / stoneLabel", () => {
  it.each([[200, "2"], [250, "2.5"], [205, "2.05"], [50, "0.5"], [2000, "20"], [1099, "10.99"]])("%d → %s", (n, s) => expect(formatMm100(n)).toBe(s));
  it("ป้ายขนาด", () => {
    expect(stoneLabel(400, 300)).toBe("4×3");
    expect(stoneLabel(200, 200)).toBe("2×2");
  });
  it("round-trip: format → parse ได้ค่าเดิมทุกค่าในช่วง", () => {
    for (let n = 50; n <= 2000; n++) expect(parseMm100(formatMm100(n))).toBe(n);
  });
});
