// lib/ring-size/size.ts — แปลงขนาดที่วัดได้ → เส้นรอบวง → เบอร์แหวน (pure · ไม่แตะ DOM)
//
// ระบบเบอร์ = เส้นรอบวงด้านใน (มม.) ตามมติเจ้าของ
// กฎเป็น "ต่อวิธีวัด" (SIZE_RULE ใน config.ts — มติเจ้าของ 24 ต.ค. 69):
//   วิธี B (กระดาษพันนิ้ว) = biasUp: ปัดเส้นรอบวงเป็น 0.1 มม. "ก่อน" แล้ว rec = ceil(c − 0.25) (build spec ข้อ 6 B4 / workflow §3 R6)
//     ระวัง: 54.25 ปัด 0.1 ก่อน = 54.3 → เบอร์ 55 (ไม่ใช่ 54) · 54.2499 → 54.2 → 54
//     "ระหว่างเบอร์" = ห่างเบอร์ที่ใกล้สุดเกิน 0.25 มม. (ค่า 1 ทศนิยมจึงไม่มีทางตกขอบพอดี)
//   วิธี A (แหวนวงเดิม) = nearest: ปัด 0.1 ก่อน แล้วปัดใกล้สุดที่เบอร์เต็ม (.5 ขึ้น): 60.4 → 60 · 60.5 → 61 · 59.6 → 60 · ไม่มี "ระหว่างเบอร์"
//     เหตุ: แหวนวงเดิมที่ใส่พอดีคือเบอร์นั้นอยู่แล้ว ไม่ต้องเผื่อใหญ่ขึ้น
// ทุกพื้นผิว (การ์ดสดบนจอวัด · R6 · ข้อความ LINE · ผลล่าสุด · การ์ดแชร์ · ข้อความคัดลอก) เรียก circToRec(c, method) ตัวเดียวกัน (B16)
import { MEASURE, ROUND_BIAS, SHOP_RING_SIZES, SIZE_RULE, type Method } from "./config";

/** ปัดเป็นทศนิยม 1 ตำแหน่ง (ปัดครึ่งขึ้น) */
export function roundTenth(x: number): number {
  return Math.round(x * 10) / 10;
}

/** เส้นผ่านศูนย์กลางด้านใน (มม.) → เส้นรอบวง (มม.) */
export function diameterToCirc(diameterMm: number): number {
  return Math.PI * diameterMm;
}

export interface SizeRec {
  /** เส้นรอบวงที่ปัด 0.1 แล้ว — ค่านี้คือค่าที่แสดง/ส่งทุกที่ */
  circ: number;
  /** เบอร์แนะนำ (เต็มเบอร์) */
  rec: number;
  /** ไม่ null เมื่ออยู่ระหว่างเบอร์ (เฉพาะวิธี B) · rec = hi เสมอเมื่อ between · วิธี A เป็น null เสมอ */
  between: { lo: number; hi: number } | null;
}

/** ตัวกฎ — circ = เส้นรอบวงที่ปัด 0.1 แล้ว */
const RULES: Record<"nearest" | "biasUp", (circ: number) => Pick<SizeRec, "rec" | "between">> = {
  // วิธีแหวนวงเดิม: ใกล้สุด (.5 ขึ้น) ไม่มีระหว่างเบอร์
  nearest: (circ) => ({ rec: Math.round(circ), between: null }),
  // วิธีกระดาษ: เอนใหญ่ + ระหว่างเบอร์เมื่อห่างเบอร์ใกล้สุด > ROUND_BIAS
  biasUp: (circ) => {
    const nearest = Math.round(circ);
    return {
      rec: Math.ceil(circ - ROUND_BIAS),
      between: Math.abs(circ - nearest) > ROUND_BIAS ? { lo: Math.floor(circ), hi: Math.floor(circ) + 1 } : null,
    };
  },
};

/** เส้นรอบวงดิบ (มม.) → เบอร์ ตามกฎของวิธีวัดนั้น (SIZE_RULE) · ค่าไม่ใช่ตัวเลขจำกัด = null (ห้ามสร้างเบอร์จาก NaN) */
export function circToRec(rawCirc: number, method: Method): SizeRec | null {
  if (!Number.isFinite(rawCirc)) return null;
  const circ = roundTenth(rawCirc);
  return { circ, ...RULES[SIZE_RULE[method]](circ) };
}

/** G4: เส้นรอบวงอยู่ในช่วงที่สมเหตุสมผลสำหรับแหวนผู้ใหญ่ (ตัดสินด้วยค่าที่ปัด 0.1 แล้ว) */
export function isPlausibleCirc(rawCirc: number): boolean {
  if (!Number.isFinite(rawCirc)) return false;
  const c = roundTenth(rawCirc);
  return c >= MEASURE.G4[0] && c <= MEASURE.G4[1];
}

/** ทิศที่ค่านอกช่วง (ใช้เลือกคำ "เล็ก/ใหญ่" ใน G4) */
export function circSide(rawCirc: number): "เล็ก" | "ใหญ่" | null {
  const c = roundTenth(rawCirc);
  if (c < MEASURE.G4[0]) return "เล็ก";
  if (c > MEASURE.G4[1]) return "ใหญ่";
  return null;
}

/** เบอร์ (หลังปัด) อยู่ในช่วงที่ร้านทำไหม · null = ยังไม่กำหนดช่วง (ห้ามแต่งเอง) */
export function inShopRange(rec: number): boolean | null {
  if (!SHOP_RING_SIZES) return null;
  return rec >= SHOP_RING_SIZES.min && rec <= SHOP_RING_SIZES.max;
}

/** แสดงมม. 1 ทศนิยมเสมอ (R5A · R5B · R6 · ShareCard · LINE · ข้อความคัดลอก ใช้ตัวเดียวกัน) */
export function formatMm(mm: number): string {
  return roundTenth(mm).toFixed(1);
}

/** วันที่แบบไทย พ.ศ. เช่น "24 ต.ค. 2569" — ไม่พึ่ง Intl/locale เพื่อให้ผลเหมือนกันทุกเครื่อง */
export function formatThaiDate(ms: number, months: readonly string[]): string {
  const d = new Date(ms);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}
