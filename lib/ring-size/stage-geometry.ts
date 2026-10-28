// lib/ring-size/stage-geometry.ts — เรขาคณิตของเวทีวัด (pure · ทดสอบได้โดยไม่ต้องมี browser)
//
// 🔴 ทุกเวทีวาดด้วย SVG: 1 หน่วย SVG = 1 CSS px (viewBox = ขนาดที่วัดจริงของเวที)
//    ห้าม border + width — Tailwind preflight ตั้ง border-box ทั้งแอป → border 3px + width d
//    ทำให้เส้นผ่านศูนย์กลางด้านในเหลือ d − 6 px ≈ ผิด 2 มม. ที่เส้นรอบวงแหวน
// ห้ามปัด px เป็นจำนวนเต็ม — ใช้ทศนิยม (shape-rendering="geometricPrecision")
import { CALIBRATION, RULER_LAYOUT } from "./config";

/** เส้นผ่านศูนย์กลางด้านในของวงที่วาดเส้นหนา sw ที่รัศมี r (เส้นอยู่กึ่งกลาง path) = 2r − sw */
export function ringInnerDiameterPx(r: number, sw: number): number {
  return 2 * r - sw;
}

/** รัศมี path ของวงเทียบ เพื่อให้ขอบในของเส้น = ขอบวัตถุ (เส้นผ่านศูนย์กลาง objectMm) */
export function circleRadiusFor(objectMm: number, ppm: number, sw: number): number {
  return (objectMm * ppm) / 2 + sw / 2;
}

/** x ของเส้นแนวตั้งซ้าย/ขวาของเวทีบัตร — ขอบในของเส้นชิดขอบบัตร (กว้าง cardMm) */
export function cardLineXs(cx: number, cardMm: number, ppm: number, sw: number): [number, number] {
  const off = (cardMm * ppm) / 2 + sw / 2;
  return [cx - off, cx + off];
}

/** รัศมีวงทึบของ R5A จากเส้นผ่านศูนย์กลาง (มม.) */
export function discRadiusPx(diameterMm: number, ppm: number): number {
  return (diameterMm * ppm) / 2;
}

/** ความสูงคอลัมน์ไม้บรรทัด R5B = ขอบบน + 80 มม. + ขอบล่าง */
export function rulerHeightPx(ppm: number, rulerMm: number): number {
  return RULER_LAYOUT.TOP_PAD + rulerMm * ppm + RULER_LAYOUT.BOTTOM_PAD;
}

/** y ของขีดที่ mm (นับจากเลข 0) */
export function rulerYPx(mm: number, ppm: number): number {
  return RULER_LAYOUT.TOP_PAD + mm * ppm;
}

/** กลับด้าน: y ที่แตะ → มม. (ยังไม่ clamp) */
export function rulerMmFromY(y: number, ppm: number): number {
  return (y - RULER_LAYOUT.TOP_PAD) / ppm;
}

/** CSS ความสูงเวที = clamp(MIN, 100dvh − RESERVE, MAX) · ห้าม 100vh */
export function stageHeightCss(kind: "card" | "coin" | "disc"): string {
  const [min, max, reserve] = CALIBRATION.STAGE[kind];
  return `clamp(${min}px, calc(100dvh - ${reserve}px), ${max}px)`;
}
