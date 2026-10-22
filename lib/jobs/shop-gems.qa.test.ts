// lib/jobs/shop-gems.qa.test.ts — QA (R2-D2 · 22 ต.ค. 69) · parity ของ shop-gems.ts กับ DB จริง (migration 0190 · dry-run บน DB จริงแล้วถอยกลับ)
// ค่าคาดหวังด้านล่างคือ "ผลที่ DB ตอบจริง" ของ analytics.gem_name_similar / gem_name_norm (ไม่ใช่ค่าที่เดาจากโค้ด TS) — จับจาก scripts/verify/verify-0190-qa.sql ชุด parity 735 คู่ (0 ต่าง) แล้วคัดชุดที่ครอบ Unicode/ไทย/ขอบ threshold มาไว้ที่นี่
// it.fails = ข้อบกพร่อง/ช่องต่างที่เจอและยังไม่แก้ — เมื่อแก้แล้วเทสต์จะ "ล้ม" (vitest: it.fails ที่ผ่านถือว่าล้ม) ให้ลบ .fails ออก
import { describe, expect, it } from "vitest";
import { cleanGemName, gemNameSimilar, normalizeGemName } from "./shop-gems";

// [a, b, similar(a,b), norm(a), norm(b)] — ค่าจาก DB
const DB_ROWS: [string, string, boolean, string, string][] = [
  ["โกเมน", "โกเมนต์", true, "โกเมน", "โกเมนต์"],
  ["อเมทิสต์", "อเมทิส", true, "อเมทิสต์", "อเมทิส"],
  ["CZ", "cz", true, "cz", "cz"],
  ["CZ", "C Z", true, "cz", "cz"],
  ["ไพลิน", "ไพลิน ", true, "ไพลิน", "ไพลิน"],
  ["ＣＺ", "cz", true, "cz", "cz"],
  ["ทับทิม", "ไพลิน", false, "ทับทิม", "ไพลิน"],
  ["ซิทริน", "เพอริดอท", false, "ซิทริน", "เพอริดอท"],
  ["กลม", "หยดน้ำ", false, "กลม", "หยดน้ํา"],
  ["CZ", "AZ", false, "cz", "az"],
  ["หัวใจ", "ทรงหัวใจ", true, "หัวใจ", "ทรงหัวใจ"],
  ["Moonstone", "Sunstone", true, "moonstone", "sunstone"],
  ["6 เหลี่ยม", "8 เหลี่ยม", true, "6เหลี่ยม", "8เหลี่ยม"],
  ["น้ำ", "นํ้า", false, "น้ํา", "นํ้า"],
  ["แหวน", "เเหวน", false, "แหวน", "เเหวน"],
  ["ก้อน", "ก้อนๆ", true, "ก้อน", "ก้อนๆ"],
  ["Ａ１", "A1", true, "a1", "a1"],
  ["ﬁne", "fine", true, "fine", "fine"],
  ["İstanbul", "istanbul", true, "i̇stanbul", "istanbul"],
  ["ǅ", "dž", true, "dž", "dž"],
  ["ß", "ss", false, "ß", "ss"],
  ["Σ", "ς", false, "σ", "ς"],
  ["straße", "STRASSE", true, "straße", "strasse"],
  ["ก็", "กํ", false, "ก็", "กํ"],
  ["เพอริดอท", "เพริดอท", true, "เพอริดอท", "เพริดอท"],
  ["ทัวร์มาลีน", "ทัวร์มาลิน", true, "ทัวร์มาลีน", "ทัวร์มาลิน"],
  ["CZ·", "CZ", true, "cz", "cz"],
  ["C.Z.", "CZ", true, "cz", "cz"],
  ["C-Z", "C_Z", true, "cz", "cz"],
  ["ＡＢＣＤ", "abcd", true, "abcd", "abcd"],
  ["abcd", "abce", true, "abcd", "abce"],
  ["abcde", "abcdf", true, "abcde", "abcdf"],
  ["abcdef", "abcdgg", true, "abcdef", "abcdgg"],
  ["abcdefg", "abcdxxx", false, "abcdefg", "abcdxxx"],
  ["abcdefgh", "abcdxxxx", false, "abcdefgh", "abcdxxxx"],
];

describe("parity ของ shop-gems.ts กับ DB (ค่าจับจาก gem_name_similar/gem_name_norm จริง)", () => {
  it.each(DB_ROWS)("similar(%j, %j) = %s เหมือน DB", (a, b, sim) => {
    expect(gemNameSimilar(a, b)).toBe(sim);
    expect(gemNameSimilar(b, a)).toBe(sim); // สมมาตร
  });
  it.each(DB_ROWS)("normalize(%j) / normalize(%j) เหมือน DB", (a, b, _sim, na, nb) => {
    expect(normalizeGemName(a)).toBe(na);
    expect(normalizeGemName(b)).toBe(nb);
  });
  it("ชื่อพลอยจริงที่ตัวดักเตือนเกิน (false positive ที่ DB เป็นแบบเดียวกัน — ตัวดักไม่ใช่ตัวบล็อก ผู้ใช้กดเพิ่มใหม่ได้)", () => {
    // วัดจากชื่อพลอยจริง 64 ชื่อ (2,016 คู่): เตือนมั่ว 3 คู่ + ตัวเลขต่างหลักเดียว (6 เหลี่ยม/8 เหลี่ยม) — ทำเอกสารไว้ ไม่ใช่ข้อกำหนด
    expect(gemNameSimilar("Moonstone", "Sunstone")).toBe(true);
    expect(gemNameSimilar("โรโดไลต์", "ไอโอไลต์")).toBe(true);
    expect(gemNameSimilar("แทนซาไนต์", "โมซาไนต์")).toBe(true);
    expect(gemNameSimilar("6 เหลี่ยม", "8 เหลี่ยม")).toBe(true);
    expect(gemNameSimilar("6 เหลี่ยม", "สามเหลี่ยม")).toBe(true); // รูปทรง seed 2 ตัวเตือนกันเอง
  });
  it("ที่จับไม่ได้ (รู้และยอมรับ): พิมพ์ เ+เ แทน แ · ไทย↔อังกฤษ · ชื่อสั้น ≤ 3", () => {
    expect(gemNameSimilar("แหวน", "เเหวน")).toBe(false);
    expect(gemNameSimilar("ไข่", "ไข")).toBe(false);
    expect(gemNameSimilar("Blue Topaz", "บลูโทแพซ")).toBe(false);
  });
});

describe("ต่าง/บั๊กที่เจอ (it.fails = หนี้ที่รู้และยังไม่แก้ · NC1 เลขล้วนต่างระบบเลข แก้แล้วใน 0190 รอบ 22 ต.ค. → it ปกติ)", () => {
  it.fails("DB เก็บอักขระสัญลักษณ์ ASCII ($ + < = > ^ `  | ~) ไว้ใน norm แต่ TS ตัดทิ้ง (\p{S}) → 'CZ+' เทียบกับ 'CZ' ได้คำตอบต่างกัน (DB: คนละชื่อ · TS: ชื่อเดียวกัน)", () => {
    expect(normalizeGemName("CZ+")).toBe("cz+");
    expect(normalizeGemName("C$Z")).toBe("c$z");
  });
  it("ชื่อที่เป็นเลขล้วนต่างระบบเลข (เลขไทย ๑๒ · อารบิก-อินดิก ١٢) ต้องถูกปฏิเสธเหมือน '12' — ตอนนี้ผ่านทั้ง TS และ DB (gem_name_ok('๑๒') = true)", () => {
    expect(cleanGemName("๑๒").ok).toBe(false);
    expect(cleanGemName("١٢").ok).toBe(false);
  });
});

describe("ที่ต้องไม่พัง (ทดสอบฝั่งตรงข้าม)", () => {
  it("ชื่อไทยปกติที่มีวรรณยุกต์/สระ/ๆ ผ่านและไม่ถูกตัด", () => {
    for (const n of ["ไพลิน", "ก็", "น้ำเงิน", "เพอริดอท", "6 เหลี่ยม", "CZ", "Blue Topaz"]) {
      const r = cleanGemName(n);
      expect(r.ok, n).toBe(true);
      expect(Array.from(normalizeGemName(n)).length, n).toBeGreaterThanOrEqual(2);
    }
  });
});
