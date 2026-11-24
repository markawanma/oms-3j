// capture-pixels — พลิกแถว + un-premultiply (S11) + ตรวจภาพว่าง (S10)
import { describe, expect, it } from "vitest";
import { isBlankCapture, toTopDownStraightRgba } from "./capture-pixels";

const px = (...v: number[]) => Uint8Array.from(v);

describe("toTopDownStraightRgba", () => {
  it("พลิกแถว: แถวล่างสุดของ readPixels กลายเป็นแถวบนสุด", () => {
    // 1×3: readPixels ให้ล่าง→บน = A(แดง), B(เขียว), C(น้ำเงิน) ทึบ
    const src = px(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255);
    const out = toTopDownStraightRgba(src, 1, 3);
    expect(Array.from(out)).toEqual([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it("S11: พิกเซลขอบ premultiplied (a=128 ของสีเงิน 220) → un-premultiply กลับเป็นสีเดิม ไม่ดำ", () => {
    // MSAA ครอบคลุม ~50%: rgb = 220×128/255 ≈ 110, a = 128
    const out = toTopDownStraightRgba(px(110, 110, 110, 128), 1, 1);
    expect(out[3]).toBe(128);
    for (const c of [out[0], out[1], out[2]]) expect(Math.abs(c - 220)).toBeLessThanOrEqual(2);
  });

  it("ผลหารเกิน 255 ถูกตัดที่ 255 (ค่าเพี้ยนจากการปัด) · alpha 255 คงสีเดิม · alpha 0 = (0,0,0,0)", () => {
    const out = toTopDownStraightRgba(px(200, 10, 10, 100, 9, 9, 9, 0, 1, 2, 3, 255), 3, 1);
    expect(out[0]).toBe(255); // 200×255/100 = 510 → 255
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.slice(8, 12))).toEqual([1, 2, 3, 255]);
  });

  it("ขนาดไม่ตรง/ไม่ใช่ integer = throw (ไม่ส่งรูปผิดขนาด)", () => {
    expect(() => toTopDownStraightRgba(new Uint8Array(7), 1, 2)).toThrow();
    expect(() => toTopDownStraightRgba(new Uint8Array(4), 0, 1)).toThrow();
    expect(() => toTopDownStraightRgba(new Uint8Array(4), 1.5, 1)).toThrow();
  });

  it("ไม่แก้ buffer ต้นทาง", () => {
    const src = px(110, 110, 110, 128);
    toTopDownStraightRgba(src, 1, 1);
    expect(Array.from(src)).toEqual([110, 110, 110, 128]);
  });
});

describe("isBlankCapture (S10)", () => {
  it("alpha ทุกตัว 0 = ว่าง · มีพิกเซลทึบแม้ตัวเดียว = ไม่ว่าง · ความยาวไม่ตรง = ว่าง (ปฏิเสธ)", () => {
    expect(isBlankCapture(new Uint8Array(16), 2, 2)).toBe(true);
    const one = new Uint8Array(16);
    one[7] = 1;
    expect(isBlankCapture(one, 2, 2)).toBe(false);
    expect(isBlankCapture(new Uint8Array(12), 2, 2)).toBe(true);
  });
  it("พื้นดำทึบ (rgb 0 · a 255) ไม่ใช่ภาพว่าง — ตัดสินจาก alpha เท่านั้น (ดำทั้งใบที่ทึบเป็นเนื้อหาจริง)", () => {
    const black = new Uint8Array(16);
    for (let i = 3; i < 16; i += 4) black[i] = 255;
    expect(isBlankCapture(black, 2, 2)).toBe(false);
  });
});
