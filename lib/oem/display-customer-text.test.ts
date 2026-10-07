// lib/oem/display-customer-text.test.ts — 0165: ชุดอักขระ "ล่องหน" ฝั่ง JS ต้องตรงกับฝั่ง DB (analytics.oem_text_strip_invisible)
// ตาราง cp ด้านล่างคือสัญญาเดียวกับ verify-0165.sql (Part H) — แก้ชุดอักขระที่หนึ่ง ต้องแก้อีกที่
import { describe, expect, it } from "vitest";
import { contactFromBilling, customerTextIssue, stripInvisibleText } from "./display";

const cp = (n: number) => String.fromCodePoint(n);
const ZWJ = "\u200D";

// code point ที่ต้องถูกปฏิเสธ (ชื่อ "a<ch>b") — ตรงกับ 0165 header
const MUST_REJECT: [string, number][] = [
  ["soft hyphen", 0x00ad],
  ["combining grapheme joiner", 0x034f],
  ["arabic letter mark", 0x061c],
  ["hangul choseong filler", 0x115f],
  ["hangul jungseong filler", 0x1160],
  ["khmer inherent vowel aq", 0x17b4],
  ["khmer inherent vowel aa", 0x17b5],
  ["mongolian vowel separator", 0x180e],
  ["zero width space", 0x200b],
  ["zero width non-joiner", 0x200c],
  ["LRM", 0x200e],
  ["RLM", 0x200f],
  ["line separator", 0x2028],
  ["paragraph separator", 0x2029],
  ["LRE", 0x202a],
  ["RLE", 0x202b],
  ["PDF", 0x202c],
  ["LRO", 0x202d],
  ["RLO", 0x202e],
  ["word joiner", 0x2060],
  ["invisible times", 0x2062],
  ["LRI", 0x2066],
  ["RLI", 0x2067],
  ["FSI", 0x2068],
  ["PDI", 0x2069],
  ["inhibit symmetric swapping", 0x206a],
  ["nominal digit shapes", 0x206f],
  ["hangul filler U+3164", 0x3164],
  ["BOM/ZWNBSP", 0xfeff],
  ["halfwidth hangul filler", 0xffa0],
  ["shorthand format control", 0x1bca0],
  ["shorthand format control (end)", 0x1bca3],
  ["variation selector supplement (first)", 0xe0100],
  ["variation selector supplement (last)", 0xe01ef],
  ["C1 control NEL", 0x0085],
  ["C1 control (end)", 0x009f],
  ["DEL", 0x007f],
  ["NUL-adjacent control", 0x0001],
  ["newline", 0x000a],
  ["tab", 0x0009],
];

describe("customerTextIssue — ชุดอักขระ 0165", () => {
  it.each(MUST_REJECT)("ปฏิเสธ: %s (U+%s)", (_name, code) => {
    expect(customerTextIssue("a" + cp(code) + "b", "ชื่อลูกค้า")).toMatch(/^ชื่อลูกค้าห้ามมี/);
  });

  it("ขอบเขตที่ต้องไม่ถูกปฏิเสธ: U+FE0F (emoji VS16) · U+FE00-FE0E · U+00A0 (NBSP กลางข้อความ) · อักษรไทยวรรณยุกต์/สระ", () => {
    expect(customerTextIssue("❤" + cp(0xfe0f) + " รัก", "ชื่อ")).toBeNull();
    expect(customerTextIssue("a" + cp(0xfe00) + "b", "ชื่อ")).toBeNull();
    expect(customerTextIssue("a" + cp(0xfe0e) + "b", "ชื่อ")).toBeNull();
    expect(customerTextIssue("นาย\u00A0สมชาย", "ชื่อ")).toBeNull();
    expect(customerTextIssue("ผู้ใหญ่ ก๊าซ ไม้เอก ให้ ใจ", "ชื่อ")).toBeNull();
  });

  it("ZWJ: ผ่านเมื่อคั่นอีโมจิ (ครอบครัว/ธงรุ้ง/อาชีพ) · ปฏิเสธเมื่อติดอักษร/ต้นท้าย/ตัวเดียว", () => {
    expect(customerTextIssue("👨" + ZWJ + "👩" + ZWJ + "👧", "ชื่อ")).toBeNull();
    expect(customerTextIssue("🏳" + cp(0xfe0f) + ZWJ + "🌈", "ชื่อ")).toBeNull();
    expect(customerTextIssue("🏃" + ZWJ + "♀" + cp(0xfe0f), "ชื่อ")).toBeNull();
    expect(customerTextIssue("ก" + ZWJ + "ข", "ชื่อ")).not.toBeNull();
    expect(customerTextIssue("a" + ZWJ + "b", "ชื่อ")).not.toBeNull();
    expect(customerTextIssue(ZWJ + "👩", "ชื่อ")).not.toBeNull();
    expect(customerTextIssue("👩" + ZWJ, "ชื่อ")).not.toBeNull();
    expect(customerTextIssue("👩" + ZWJ + "ก", "ชื่อ")).not.toBeNull();
  });

  it("ว่าง/เว้นวรรค/NBSP ล้วน = ใช้ได้ (ล้างค่า) · ไม่ใช่ string = ข้อความไทย ไม่ throw", () => {
    expect(customerTextIssue(null, "ชื่อ")).toBeNull();
    expect(customerTextIssue(undefined, "ชื่อ")).toBeNull();
    expect(customerTextIssue("   ", "ชื่อ")).toBeNull();
    expect(customerTextIssue("\u00A0\u3000 ", "ชื่อ")).toBeNull();
    expect(customerTextIssue(123, "ชื่อ")).toBe("ชื่อต้องเป็นข้อความ");
    expect(customerTextIssue({ a: 1 }, "ชื่อ")).toBe("ชื่อต้องเป็นข้อความ");
    expect(customerTextIssue(["x"], "ชื่อ")).toBe("ชื่อต้องเป็นข้อความ");
  });

  it("ความยาว: 200 ตัวอักษรพอดีผ่าน · 201 ปฏิเสธ · นับเป็น code point (อีโมจิ 1 ตัว = 1)", () => {
    expect(customerTextIssue("ก".repeat(200), "ชื่อ")).toBeNull();
    expect(customerTextIssue("ก".repeat(201), "ชื่อ")).toMatch(/200/);
    expect(customerTextIssue("😀".repeat(200), "ชื่อ")).toBeNull();
    expect(customerTextIssue("😀".repeat(201), "ชื่อ")).toMatch(/200/);
  });
});

describe("stripInvisibleText (L2 — เหตุผลราคาพิเศษ)", () => {
  it("ลบอักขระล่องหน/bidi ทั้งชุด · เหลือข้อความปกติ", () => {
    for (const [, code] of MUST_REJECT.filter(([, c]) => c > 0x7f || c === 0x00ad)) {
      expect(stripInvisibleText("bid" + cp(code) + "A")).toBe(code >= 0x80 && code <= 0x9f ? "bid" + cp(code) + "A" : "bidA");
    }
  });
  it("เหตุผลที่มีแต่อักขระล่องหน → ว่างหลังลบ+trim", () => {
    expect(stripInvisibleText("\u2060\u2060").trim()).toBe("");
    expect(stripInvisibleText("\uFEFF\uFEFF").trim()).toBe("");
    expect(stripInvisibleText("\u202E").trim()).toBe("");
    expect(stripInvisibleText(" \u200B \u200C ").trim()).toBe("");
  });
  it("อีโมจิ ZWJ ที่คั่นจริงอยู่ครบ · ZWJ ลอยถูกลบ · ไม่ใช่ string = ว่าง", () => {
    expect(stripInvisibleText("👨" + ZWJ + "👩" + ZWJ + "👧")).toBe("👨" + ZWJ + "👩" + ZWJ + "👧");
    expect(stripInvisibleText("ก" + ZWJ + "ข")).toBe("กข");
    expect(stripInvisibleText(123)).toBe("");
    expect(stripInvisibleText(null)).toBe("");
  });
});

describe("contactFromBilling (เดิม — ต้องไม่พัง)", () => {
  it("ต่อด้วย ' / ' ข้ามช่องว่าง", () => {
    expect(contactFromBilling("081", "LINE @a")).toBe("081 / LINE @a");
    expect(contactFromBilling(null, "LINE @a")).toBe("LINE @a");
  });
});
