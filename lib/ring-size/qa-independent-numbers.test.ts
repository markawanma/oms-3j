// lib/ring-size/qa-independent-numbers.test.ts — ตารางตัวเลขที่ QA คำนวณมือแยกต่างหาก (ไม่ใช้สูตรเดียวกับโค้ด)
//
// ทุกค่า expected เป็น "ตัวเลขที่เขียนตรงๆ" — คำนวณด้วยมือ/เครื่องคิดเลขจากนิยาม:
//   ppm = ความยาวบนจอ (px) ÷ ความยาวจริง (มม.) · เส้นรอบวง c = π × d (π = 3.14159265…) · ปัด c เป็น 0.1 แล้ว เบอร์ = ปัดขึ้นเมื่อเศษ ≥ 0.3
//   (เศษ .0–.2 → ลงเบอร์เต็มที่ใกล้สุดด้านล่าง · .3–.9 → ขึ้นเบอร์ถัดไป) · "ระหว่างเบอร์" = เศษ .3–.7 (ห่างเบอร์เต็มที่ใกล้สุดเกิน 0.25)
// ค่าอ้างอิง: เหรียญ 26 มม. · บัตร 53.98 มม. (ส่งต่อจาก spec ข้อ 5 — เจ้าของ/โรงกษาปณ์/ISO ID-1)
import { describe, expect, it } from "vitest";
import { clampPpm, computePxPerMm, maxPpmFor, refPxFor, stepPpm } from "./calibration";
import { circToRec, diameterToCirc, formatMm, inShopRange, isPlausibleCirc } from "./size";
import { circleRadiusFor, cardLineXs, discRadiusPx, ringInnerDiameterPx, rulerHeightPx, rulerMmFromY, rulerYPx } from "./stage-geometry";

describe("บัตร/เหรียญ → px ต่อ มม. (ค่า literal)", () => {
  // [ref, ความยาวบนจอ px, ppm ที่ถูกต้อง]
  it.each([
    ["coin", 78, 3.0],
    ["coin", 117, 4.5],
    ["coin", 130, 5.0],
    ["coin", 156, 6.0],
    ["coin", 195, 7.5],
    ["coin", 234, 9.0],
    ["card", 242.91, 4.5], // 53.98 × 4.5
    ["card", 323.88, 6.0], // 53.98 × 6
    ["card", 404.85, 7.5], // 53.98 × 7.5
    ["card", 485.82, 9.0], // 53.98 × 9
  ] as const)("%s %s px → %s px/มม.", (ref, px, ppm) => {
    expect(computePxPerMm(ref, px)).toBeCloseTo(ppm, 9);
    expect(refPxFor(ref, ppm)).toBeCloseTo(px, 9);
  });

  it("iPhone SE/6-8 (375 pt · 326 ppi → 163 pt/นิ้ว = 6.417 pt/มม.): บัตรกว้าง ≈ 346.4 px · เหรียญ ≈ 166.9 px", () => {
    // 163 ÷ 25.4 = 6.41732… (คิดมือ) → 53.98 × 6.41732 = 346.40 · 26 × 6.41732 = 166.85
    expect(refPxFor("card", 6.41732)).toBeCloseTo(346.40, 1);
    expect(refPxFor("coin", 6.41732)).toBeCloseTo(166.85, 1);
  });
});

describe("เรขาคณิตเวที (literal) — ขอบในของเส้น 2 px = ขอบวัตถุ", () => {
  // [ppm, r ของวงเหรียญ] r = 26×ppm/2 + 1
  it.each([
    [3.0, 40],
    [4.5, 59.5],
    [6.0, 79],
    [7.5, 98.5],
    [9.0, 118],
  ])("เหรียญ ppm %s → r = %s และเส้นผ่านศูนย์กลางด้านในเท่ากับ 26 × ppm", (ppm, r) => {
    expect(circleRadiusFor(26, ppm, 2)).toBeCloseTo(r, 9);
    expect(ringInnerDiameterPx(r, 2)).toBeCloseTo(26 * ppm, 9);
  });

  // [ppm, ระยะจากกึ่งกลางถึงเส้น] = 53.98×ppm/2 + 1
  it.each([
    [4.5, 122.455],
    [6.0, 162.94],
    [7.5, 203.425],
    [9.0, 243.91],
  ])("บัตร ppm %s → เส้นอยู่ห่างกึ่งกลาง ±%s px", (ppm, off) => {
    const [l, r] = cardLineXs(200, 53.98, ppm, 2);
    expect(200 - l).toBeCloseTo(off, 9);
    expect(r - 200).toBeCloseTo(off, 9);
    // ขอบในของเส้น (ตัดครึ่งเส้นออกข้างละ 1 px) ห่างกัน 53.98 × ppm
    expect(r - l - 2).toBeCloseTo(53.98 * ppm, 9);
  });

  it("วงทึบ R5A: r = d × ppm ÷ 2 (14.0 มม. @6 → 42 · 17.2 @5 → 43 · 24.0 @7.5 → 90)", () => {
    expect(discRadiusPx(14.0, 6)).toBeCloseTo(42, 9);
    expect(discRadiusPx(17.2, 5)).toBeCloseTo(43, 9);
    expect(discRadiusPx(24.0, 7.5)).toBeCloseTo(90, 9);
  });

  it("ไม้บรรทัด R5B: ความสูง @4.5 = 384 · @6 = 504 · @7.5 = 624 · ขีด 50 มม. @6 อยู่ y=312 · อ่านย้อนกลับได้ 50", () => {
    expect(rulerHeightPx(4.5, 80)).toBeCloseTo(384, 9);
    expect(rulerHeightPx(6, 80)).toBeCloseTo(504, 9);
    expect(rulerHeightPx(7.5, 80)).toBeCloseTo(624, 9);
    expect(rulerYPx(50, 6)).toBeCloseTo(312, 9);
    expect(rulerMmFromY(312, 6)).toBeCloseTo(50, 9);
    expect(rulerYPx(0, 6)).toBe(12);
    expect(rulerYPx(80, 6)).toBe(492);
  });
});

describe("ก้าว −/+ และแถบเลื่อน (literal)", () => {
  it("ก้าวที่ ppm 6: บัตร 0.6 ÷ 53.98 = 0.0111152 · เหรียญ 0.3 ÷ 26 = 0.0115385", () => {
    expect(stepPpm("card", 6)).toBeCloseTo(0.0111152, 7);
    expect(stepPpm("coin", 6)).toBeCloseTo(0.0115385, 7);
  });
  it("max ppm ของบัตรตามความกว้างเวที: 375 → 6.5765 · 390 → 6.8544 · 360 → 6.2986 · 320 → 5.5576 · 480 → 8.5 (ไม่ถึง 9)", () => {
    // (W − 2×8 − 2×2) ÷ 53.98
    expect(maxPpmFor("card", 375)).toBeCloseTo(6.5765, 4);
    expect(maxPpmFor("card", 390)).toBeCloseTo(6.8544, 4);
    expect(maxPpmFor("card", 360)).toBeCloseTo(6.2986, 4);
    expect(maxPpmFor("card", 320)).toBeCloseTo(5.5576, 4);
    expect(maxPpmFor("card", 480)).toBeCloseTo(8.5, 1); // (480−20)/53.98 = 8.5217
    expect(maxPpmFor("card", 700)).toBe(9); // ล้นก็ไม่เกิน 9.0
    expect(maxPpmFor("coin", 320)).toBe(9);
  });
  it("375 pt (6.417 px/มม.) เทียบบัตรถึง · 360 pt (6.2986 < 6.417) เทียบบัตรไม่ถึง", () => {
    expect(maxPpmFor("card", 375)).toBeGreaterThan(6.41732);
    expect(maxPpmFor("card", 360)).toBeLessThan(6.41732);
  });
  it("clamp: ต่ำกว่า 3.0 → 3.0 · เกิน max → max · NaN → 6.0", () => {
    expect(clampPpm(2.0, 9)).toBe(3.0);
    expect(clampPpm(12, 6.5)).toBe(6.5);
    expect(clampPpm(Number.NaN, 9)).toBe(6.0);
  });
});

describe("R5A: เส้นผ่านศูนย์กลาง d → เส้นรอบวง c → เบอร์ (ตารางคำนวณมือ)", () => {
  // [d มม., c ปัด 0.1, เบอร์, between ("lo-hi" | null), G4 (นอก 40–75)]
  const rows: Array<[number, string, number, string | null, boolean]> = [
    [12.0, "37.7", 38, "37-38", true], // < 40 → G4 ทิศเล็ก
    [12.7, "39.9", 40, null, true], // 39.898 → 39.9 → ต่ำกว่า 40 → G4
    [12.8, "40.2", 40, null, false], // 40.212 → ขอบล่างผ่าน
    [14.0, "44.0", 44, null, false], // ค่าเริ่มของ R5A → นอกช่วงร้าน (44 < 45)
    [14.07, "44.2", 44, null, false], // 44.2022 → เศษ .2 ลง → 44
    [14.1, "44.3", 45, "44-45", false], // 44.2965 → .3 ขึ้น → 45 ระหว่าง
    [17.2, "54.0", 54, null, false], // 54.0354
    [17.25, "54.2", 54, null, false], // 54.1925
    [17.27, "54.3", 55, "54-55", false], // 54.2553 → ข้ามเกณฑ์ 54.25 → 55 (ตัวอย่างในสั่งงาน)
    [17.3, "54.3", 55, "54-55", false], // 54.3496
    [17.4, "54.7", 55, "54-55", false], // 54.6637
    [17.5, "55.0", 55, null, false], // 54.9779
    [17.6, "55.3", 56, "55-56", false], // 55.2920
    [21.6, "67.9", 68, null, false], // 67.8584 → ในช่วงร้าน (68)
    [21.7, "68.2", 68, null, false], // 68.1726 → ยัง 68 (ในช่วง)
    [21.75, "68.3", 69, "68-69", false], // 68.3296 → 69 นอกช่วงร้าน
    [21.8, "68.5", 69, "68-69", false], // 68.4867
    [23.8, "74.8", 75, null, false], // 74.7699
    [23.87, "75.0", 75, null, false], // 74.9898 → ขอบบนผ่าน
    [23.9, "75.1", 75, null, true], // 75.0841 → เกิน 75 → G4 ทิศใหญ่
    [24.0, "75.4", 76, "75-76", true], // 75.3982
  ];
  it.each(rows)("d=%s → c=%s → เบอร์ %s · ระหว่าง=%s · G4=%s", (d, c, rec, between, g4) => {
    const raw = diameterToCirc(d);
    const r = circToRec(raw)!;
    expect(formatMm(r.circ)).toBe(c);
    expect(r.rec).toBe(rec);
    expect(r.between ? `${r.between.lo}-${r.between.hi}` : null).toBe(between);
    expect(!isPlausibleCirc(raw)).toBe(g4);
  });

  it("ตัวอย่างจากสั่งงาน: 14.0 → 44.0 → 44 · 17.2 → 54.0 → 54 · 17.27 → 54.3 → 55 (ระหว่างเบอร์)", () => {
    expect([formatMm(circToRec(diameterToCirc(14.0))!.circ), circToRec(diameterToCirc(14.0))!.rec]).toEqual(["44.0", 44]);
    expect([formatMm(circToRec(diameterToCirc(17.2))!.circ), circToRec(diameterToCirc(17.2))!.rec]).toEqual(["54.0", 54]);
    const r = circToRec(diameterToCirc(17.27))!;
    expect([formatMm(r.circ), r.rec, r.between]).toEqual(["54.3", 55, { lo: 54, hi: 55 }]);
  });
});

describe("R5B: ความยาวกระดาษ (มม.) → เบอร์ (ก้าว 0.5) · ขอบ 45/68 · G4 40/75", () => {
  // [ความยาว, เบอร์, between, ในช่วงร้าน 45–68]
  const rows: Array<[number, number, string | null, boolean]> = [
    [43.5, 44, "43-44", false],
    [44.0, 44, null, false], // ต่ำกว่า 45 → R6Out
    [44.5, 45, "44-45", true], // แนะนำ 45 ในช่วง (เบอร์เล็กกว่า 44 อยู่นอกช่วง)
    [45.0, 45, null, true], // ขอบล่าง
    [45.5, 46, "45-46", true],
    [54.0, 54, null, true],
    [54.5, 55, "54-55", true],
    [57.5, 58, "57-58", true],
    [67.5, 68, "67-68", true],
    [68.0, 68, null, true], // ขอบบน
    [68.5, 69, "68-69", false], // แนะนำ 69 นอกช่วง → R6Out
    [69.0, 69, null, false],
  ];
  it.each(rows)("%s มม. → เบอร์ %s · ระหว่าง=%s · ในช่วงร้าน=%s", (len, rec, between, inRange) => {
    const r = circToRec(len)!;
    expect(r.rec).toBe(rec);
    expect(r.between ? `${r.between.lo}-${r.between.hi}` : null).toBe(between);
    expect(inShopRange(r.rec)).toBe(inRange);
  });

  it("G4: 39.5 ตก · 40.0 ผ่าน · 75.0 ผ่าน · 75.5 ตก · 39.94 ตก (ปัด 39.9) · 39.96 ผ่าน (ปัด 40.0) · 75.04 ผ่าน · 75.06 ตก", () => {
    expect(isPlausibleCirc(39.5)).toBe(false);
    expect(isPlausibleCirc(40.0)).toBe(true);
    expect(isPlausibleCirc(75.0)).toBe(true);
    expect(isPlausibleCirc(75.5)).toBe(false);
    expect(isPlausibleCirc(39.94)).toBe(false);
    expect(isPlausibleCirc(39.96)).toBe(true);
    expect(isPlausibleCirc(75.04)).toBe(true);
    expect(isPlausibleCirc(75.06)).toBe(false);
  });

  it("ขอบ 45/68 ด้วยเส้นรอบวงละเอียด: 44.2 → 44 นอก · 44.3 → 45 ใน · 68.2 → 68 ใน · 68.3 → 69 นอก", () => {
    expect([44.2, 44.3, 68.2, 68.3].map((c) => inShopRange(circToRec(c)!.rec))).toEqual([false, true, true, false]);
  });
});

describe("ค่าเสีย — ไม่สร้างเบอร์จาก NaN/Infinity/ติดลบ", () => {
  it.each([Number.NaN, Infinity, -Infinity])("%s → null", (x) => {
    expect(circToRec(x)).toBeNull();
    expect(isPlausibleCirc(x)).toBe(false);
  });
  it("ติดลบ/ศูนย์ → G4 (ไม่ใช่ผลลัพธ์)", () => {
    expect(isPlausibleCirc(-54)).toBe(false);
    expect(isPlausibleCirc(0)).toBe(false);
  });
});
