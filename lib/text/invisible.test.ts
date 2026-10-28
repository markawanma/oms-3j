// lib/text/invisible.test.ts — leaf module อักขระล่องหน (แยกจาก lib/oem/display ให้กราฟหน้างาน /w/s/ ใช้ตรวจชื่อพลอยได้โดยไม่ลาก lib/oem)
// ต้องถูก: re-export จาก lib/oem/display เป็นตัวเดียวกัน (ไม่ใช่สำเนา) · ลบล่องหน/bidi/ZWJ เดี่ยว · ต้องไม่พัง: ตัวอักษรไทย/สระ/อีโมจิครอบครัวไม่ถูกลบ · ไม่มี import
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as OEM from "@/lib/oem/display";
import * as LEAF from "@/lib/text/invisible";
import { normalizeGemName } from "@/lib/jobs/shop-gems";

const cp = (...n: number[]) => String.fromCodePoint(...n);

describe("lib/text/invisible", () => {
  it("lib/oem/display re-export ตัวเดียวกัน (identity)", () => {
    expect(OEM.stripInvisibleText).toBe(LEAF.stripInvisibleText);
  });
  it("ลบ zero-width / bidi / soft hyphen / tag · ZWJ เดี่ยวระหว่างตัวอักษร", () => {
    expect(LEAF.stripInvisibleText(`โก${cp(0x200b)}เมน`)).toBe("โกเมน");
    expect(LEAF.stripInvisibleText(`ab${cp(0x202e)}cd${cp(0xad)}`)).toBe("abcd");
    expect(LEAF.stripInvisibleText(`x${cp(0xe0041)}y`)).toBe("xy");
    expect(LEAF.stripInvisibleText(`ก${cp(0x200d)}ข`)).toBe("กข");
    expect(LEAF.stripInvisibleText(5)).toBe("");
  });
  it("ไม่ลบข้อความปกติ: ไทย (สระ/วรรณยุกต์) · ละติน · เลข · อีโมจิครอบครัวที่ใช้ ZWJ คั่น", () => {
    const thai = "อเมทิสต์ น้ำเงิน ๑๒ CZ 1.5";
    expect(LEAF.stripInvisibleText(thai)).toBe(thai);
    const family = `${cp(0x1f468)}${cp(0x200d)}${cp(0x1f469)}`;
    expect(LEAF.stripInvisibleText(family)).toBe(family);
  });
  it("ชื่อพลอยที่มีอักขระล่องหนเท่ากับชื่อที่ไม่มี (normalize เดียวกัน)", () => {
    expect(normalizeGemName(`โก${cp(0x200b)}เมน`)).toBe(normalizeGemName("โกเมน"));
  });
  it("เป็น leaf: ไม่มี import เลย", () => {
    const src = readFileSync(join(process.cwd(), "lib", "text", "invisible.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/\bimport\b|\brequire\(/.test(src)).toBe(false);
  });
});
