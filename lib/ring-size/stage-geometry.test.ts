import { describe, expect, it } from "vitest";
import { CALIBRATION } from "./config";
import { computePxPerMm } from "./calibration";
import { cardLineXs, circleRadiusFor, discRadiusPx, ringInnerDiameterPx, rulerHeightPx, rulerMmFromY, rulerYPx, stageHeightCss } from "./stage-geometry";

// เทสต์รัศมี/พิกัดเวที (build spec ข้อ 3.3 ข้อ 1-2 · B11) — ทดสอบที่ ppm 4.5 · 6.0 · 7.5
// กับดักที่กัน: border-box ของ Tailwind ทำให้ border + width ทำวงเล็กลง 2·border (≈ ผิด 2 มม. ที่เส้นรอบวงแหวน)

describe("วงเหรียญ: ขอบในของเส้น = ขอบเหรียญ", () => {
  it("ที่ ppm=6, sw=2 → r = 79 และ 2r − sw = 156 = 26 × 6", () => {
    const r = circleRadiusFor(26, 6, 2);
    expect(r).toBe(79);
    expect(ringInnerDiameterPx(r, 2)).toBe(156);
    expect(ringInnerDiameterPx(r, 2)).toBe(26 * 6);
  });
  it.each([4.5, 6.0, 7.5])("ที่ ppm=%s เส้นผ่านศูนย์กลางด้านในตรง 26 มม. พอดี", (ppm) => {
    const r = circleRadiusFor(CALIBRATION.REF.coin.mm, ppm, CALIBRATION.STROKE_PX);
    expect(ringInnerDiameterPx(r, CALIBRATION.STROKE_PX)).toBeCloseTo(26 * ppm, 10);
    // และอ่านกลับเป็น ppm เดิม (วงเข้า-ออกไม่คลาด)
    expect(computePxPerMm("coin", ringInnerDiameterPx(r, CALIBRATION.STROKE_PX))).toBeCloseTo(ppm, 10);
  });
  it.each([
    [4.5, 59.5],
    [6.0, 79],
    [7.5, 98.5],
  ])("ค่าตายตัวที่คำนวณมือ: ppm=%s → r = %s (26 × ppm ÷ 2 + 1)", (ppm, r) => {
    expect(circleRadiusFor(26, ppm, 2)).toBeCloseTo(r, 10);
  });
  // (กับดัก border-box ของ Tailwind กันด้วย "ไม่มี border บนองค์ประกอบวัด" ที่ copy-guard.test.ts + parts.test.tsx ไม่ใช่ที่นี่)
});

describe("เส้นบัตร: ขอบในของเส้นห่างกัน 53.98 × ppm", () => {
  it("ที่ ppm=6, sw=2 → x = cx ± 162.94 และขอบในห่างกัน 323.88", () => {
    const [xl, xr] = cardLineXs(195, 53.98, 6, 2);
    expect(195 - xl).toBeCloseTo(162.94, 10);
    expect(xr - 195).toBeCloseTo(162.94, 10);
    expect(xr - xl - 2).toBeCloseTo(53.98 * 6, 10); // หักครึ่งความหนาเส้นสองข้าง
    expect(computePxPerMm("card", xr - xl - 2)).toBeCloseTo(6, 10);
  });
  it.each([
    [4.5, 122.455],
    [7.5, 203.425],
  ])("ค่าตายตัวที่คำนวณมือ: ppm=%s → ห่างจากกลาง %s px (53.98 × ppm ÷ 2 + 1)", (ppm, off) => {
    const [xl, xr] = cardLineXs(200, 53.98, ppm, 2);
    expect(200 - xl).toBeCloseTo(off, 9);
    expect(xr - 200).toBeCloseTo(off, 9);
  });
  it.each([4.5, 6.0, 7.5])("ที่ ppm=%s อ่านกลับได้ ppm เดิม", (ppm) => {
    const [xl, xr] = cardLineXs(200, 53.98, ppm, 2);
    expect(computePxPerMm("card", xr - xl - 2)).toBeCloseTo(ppm, 10);
  });
});

describe("วงทึบ R5A / ไม้บรรทัด R5B", () => {
  it("r = d × ppm ÷ 2 (ไม่มีขอบเส้น)", () => {
    expect(discRadiusPx(17.2, 6)).toBeCloseTo(51.6, 10);
    expect(discRadiusPx(14, 4.5) * 2).toBeCloseTo(63, 10);
  });
  it("ไม้บรรทัด: Hruler = 12 + 80 × ppm + 12 · ขีด y = 12 + mm × ppm · กลับด้านได้", () => {
    expect(rulerHeightPx(6, 80)).toBe(504);
    expect(rulerYPx(0, 6)).toBe(12);
    expect(rulerYPx(50, 6)).toBe(312);
    expect(rulerMmFromY(rulerYPx(37.5, 6.4), 6.4)).toBeCloseTo(37.5, 10);
  });
});

describe("ความสูงเวที: clamp + dvh ห้าม 100vh", () => {
  it("สตริง CSS ใช้ dvh และค่าจาก config", () => {
    expect(stageHeightCss("coin")).toBe("clamp(240px, calc(100dvh - 540px), 380px)");
    expect(stageHeightCss("card")).toBe("clamp(200px, calc(100dvh - 500px), 380px)");
    expect(stageHeightCss("disc")).toBe("clamp(220px, calc(100dvh - 470px), 300px)");
    for (const k of ["card", "coin", "disc"] as const) expect(stageHeightCss(k)).not.toMatch(/(?<!d)vh/); // ไม่มี 100vh ล้วน
  });
});
