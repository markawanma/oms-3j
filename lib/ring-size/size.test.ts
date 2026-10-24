import { describe, expect, it } from "vitest";
import { SHOP_RING_SIZES } from "./config";
import { SIZE_RULE } from "./config";
import { circSide, circToRec, diameterToCirc, formatMm, formatThaiDate, inShopRange, isPlausibleCirc, roundTenth } from "./size";

// ตารางปัดเบอร์ (build spec ข้อ 6 B4) — ปัด 0.1 ก่อน แล้ว rec = ceil(c − 0.25)
// 🔴 กับดัก: 54.25 ไม่ใช่ค่า 1 ทศนิยม → ปัดเป็น 54.3 → เบอร์ 55 (ไม่ใช่ 54)
describe("circToRec วิธี B (กระดาษพันนิ้ว) — ตารางปัดเบอร์ ceil(c−0.25) (ค่าหลังปัด 0.1)", () => {
  it.each([
    [54.0, 54, null],
    [54.2, 54, null],
    [54.3, 55, { lo: 54, hi: 55 }],
    [54.5, 55, { lo: 54, hi: 55 }],
    [54.7, 55, { lo: 54, hi: 55 }],
    [54.8, 55, null],
    [53.7, 54, { lo: 53, hi: 54 }],
  ])("c=%s → เบอร์ %s · between=%j", (c, rec, between) => {
    const r = circToRec(c, "B");
    expect(r).not.toBeNull();
    expect(r!.rec).toBe(rec);
    expect(r!.between).toEqual(between);
    expect(r!.circ).toBe(c);
  });

  it("ค่าดิบ 54.2499 → ปัดเป็น 54.2 → เบอร์ 54 (ไม่ between)", () => {
    const r = circToRec(54.2499, "B")!;
    expect(r.circ).toBe(54.2);
    expect(r.rec).toBe(54);
    expect(r.between).toBeNull();
  });

  it("ค่าดิบ 54.25 → ปัดเป็น 54.3 → เบอร์ 55 (ระหว่าง 54–55)", () => {
    const r = circToRec(54.25, "B")!;
    expect(r.circ).toBe(54.3);
    expect(r.rec).toBe(55);
    expect(r.between).toEqual({ lo: 54, hi: 55 });
  });

  it("ค่าดิบ 54.2501 และ 54.7499/54.75 ตามกฎปัด 0.1 ก่อน", () => {
    expect(circToRec(54.2501, "B")!.rec).toBe(55); // 54.3
    expect(circToRec(54.7499, "B")!.rec).toBe(55); // 54.7
    expect(circToRec(54.75, "B")!.rec).toBe(55); // 54.8
    expect(circToRec(54.75, "B")!.between).toBeNull();
  });

  it("เบอร์ตรงเลขจำนวนเต็มทุกค่า 40–75 ไม่ตกเป็นเบอร์ถัดไป", () => {
    for (let n = 40; n <= 75; n++) {
      expect(circToRec(n, "B")!.rec).toBe(n);
      expect(circToRec(n + 0.2, "B")!.rec).toBe(n);
      expect(circToRec(n + 0.3, "B")!.rec).toBe(n + 1);
    }
  });

  it("between เสมอ rec = hi (แนะนำเบอร์ใหญ่กว่า) และ hi = lo + 1", () => {
    for (let c10 = 400; c10 <= 750; c10++) {
      const r = circToRec(c10 / 10, "B")!;
      if (r.between) {
        expect(r.rec).toBe(r.between.hi);
        expect(r.between.hi).toBe(r.between.lo + 1);
      }
    }
  });

  it("NaN/Infinity → null (ห้ามสร้างเบอร์จากค่าเสีย)", () => {
    expect(circToRec(Number.NaN, "B")).toBeNull();
    expect(circToRec(Number.POSITIVE_INFINITY, "B")).toBeNull();
    expect(isPlausibleCirc(Number.NaN)).toBe(false);
  });
});

describe("diameterToCirc / formatMm / roundTenth", () => {
  it("c = π × d", () => {
    expect(diameterToCirc(10)).toBeCloseTo(31.4159, 4);
  });
  it("แสดงมม. 1 ทศนิยมเสมอ (ไม่ใช่จำนวนเต็ม)", () => {
    expect(formatMm(54)).toBe("54.0");
    expect(formatMm(54.25)).toBe("54.3");
    expect(formatMm(44.2965)).toBe("44.3");
    expect(roundTenth(0.05)).toBe(0.1);
  });
});

describe("isPlausibleCirc / circSide (G4 ช่วง 40–75)", () => {
  it("ขอบช่วงผ่าน · นอกช่วงตก", () => {
    expect(isPlausibleCirc(40)).toBe(true);
    expect(isPlausibleCirc(75)).toBe(true);
    expect(isPlausibleCirc(39.94)).toBe(false); // ปัดเป็น 39.9 < 40
  });
  it("ตัดสินด้วยค่าหลังปัด 0.1", () => {
    expect(isPlausibleCirc(39.9)).toBe(false);
    expect(isPlausibleCirc(39.95)).toBe(true); // ปัดเป็น 40.0
    expect(isPlausibleCirc(75.04)).toBe(true); // 75.0
    expect(isPlausibleCirc(75.05)).toBe(false); // 75.1
    expect(circSide(39.9)).toBe("เล็ก");
    expect(circSide(75.1)).toBe("ใหญ่");
    expect(circSide(50)).toBeNull();
  });
});

describe("inShopRange — เบอร์หลังปัด (A14)", () => {
  it("ช่วงร้านคือ 45–68 (เจ้าของยืนยัน 24 ต.ค.)", () => {
    expect(SHOP_RING_SIZES).toEqual({ min: 45, max: 68 });
  });
  it("45 และ 68 อยู่ในช่วง · 44 และ 69 นอกช่วง", () => {
    expect(inShopRange(45)).toBe(true);
    expect(inShopRange(68)).toBe(true);
    expect(inShopRange(44)).toBe(false);
    expect(inShopRange(69)).toBe(false);
  });
  it("ใช้เบอร์หลังปัดกฎ ceil(c−0.25): c=44.2 → 44 นอกช่วง · 44.3 → 45 ในช่วง", () => {
    expect(inShopRange(circToRec(44.2, "B")!.rec)).toBe(false);
    expect(inShopRange(circToRec(44.3, "B")!.rec)).toBe(true);
    expect(inShopRange(circToRec(68.2, "B")!.rec)).toBe(true); // 68
    expect(inShopRange(circToRec(68.3, "B")!.rec)).toBe(false); // 69
  });
});

describe("formatThaiDate — พ.ศ. ไม่พึ่ง locale", () => {
  it("แปลงเป็นวัน เดือนย่อ ปี พ.ศ.", () => {
    const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const ms = new Date(2026, 9, 24, 12, 0, 0).getTime(); // 24 ต.ค. 2026 (เวลาท้องถิ่น)
    expect(formatThaiDate(ms, months)).toBe("24 ต.ค. 2569");
  });
});

// มติเจ้าของ 24 ต.ค. 69 (หลังลองใช้จริง): วิธีแหวนวงเดิม (A) ปัดใกล้สุด ไม่ปัดขึ้น ไม่มีระหว่างเบอร์ · วิธีกระดาษ (B) คงกฎเดิม
describe("circToRec วิธี A (แหวนวงเดิม) — ปัดใกล้สุด .5 ขึ้น · ไม่มีระหว่างเบอร์", () => {
  it("กฎต่อวิธีอยู่ในตารางเดียว SIZE_RULE", () => {
    expect(SIZE_RULE).toEqual({ A: "nearest", B: "biasUp" });
  });
  it.each([
    [44.4, 44],
    [44.5, 45],
    [54.3, 54],
    [54.5, 55],
    [59.6, 60],
    [60.3, 60],
    [60.4, 60],
    [60.5, 61],
    [68.4, 68],
    [68.5, 69],
  ])("c=%s → เบอร์ %s", (c, rec) => {
    const r = circToRec(c, "A")!;
    expect(r.rec).toBe(rec);
    expect(r.between).toBeNull();
    expect(r.circ).toBe(c);
  });
  it("เบอร์เต็มตรงตัวทุกค่า 40–75 · .4 ลง · .5 ขึ้น · ไม่มีระหว่างเบอร์เลยตลอดช่วง", () => {
    for (let n = 40; n <= 75; n++) {
      expect(circToRec(n, "A")!.rec).toBe(n);
      expect(circToRec(n + 0.4, "A")!.rec).toBe(n);
      expect(circToRec(n + 0.5, "A")!.rec).toBe(n + 1);
    }
    for (let c10 = 400; c10 <= 750; c10++) expect(circToRec(c10 / 10, "A")!.between).toBeNull();
  });
  it("ปัด 0.1 ก่อน: 60.449 → 60.4 → 60 · 60.45 → 60.5 → 61", () => {
    expect(circToRec(60.449, "A")!.circ).toBe(60.4);
    expect(circToRec(60.449, "A")!.rec).toBe(60);
    expect(circToRec(60.45, "A")!.circ).toBe(60.5);
    expect(circToRec(60.45, "A")!.rec).toBe(61);
  });
  it("วิธี B ไม่เปลี่ยน ณ ค่าเดียวกัน: 60.3 → 61 (ระหว่าง 60–61) · วิธี A → 60", () => {
    expect(circToRec(60.3, "B")!.rec).toBe(61);
    expect(circToRec(60.3, "B")!.between).toEqual({ lo: 60, hi: 61 });
    expect(circToRec(60.3, "A")!.rec).toBe(60);
  });
  it("ขอบร้าน 45–68 ใช้เบอร์หลังปัดตามกฎของวิธีนั้น: 44.4 A → 44 นอก · 44.4 B → 45 ใน · 68.4 A → 68 ใน · 68.4 B → 69 นอก", () => {
    expect(inShopRange(circToRec(44.4, "A")!.rec)).toBe(false);
    expect(inShopRange(circToRec(44.4, "B")!.rec)).toBe(true);
    expect(inShopRange(circToRec(68.4, "A")!.rec)).toBe(true);
    expect(inShopRange(circToRec(68.4, "B")!.rec)).toBe(false);
  });
  it("NaN/Infinity → null ทั้งสองวิธี", () => {
    expect(circToRec(Number.NaN, "A")).toBeNull();
    expect(circToRec(Number.POSITIVE_INFINITY, "A")).toBeNull();
  });
});
