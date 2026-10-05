// lib/gem-quiz/stone-colors.ts
//
// สีจุดแทนรูปพลอยจริง (เจ้าของยืนยัน 5 ต.ค. 69: ยังไม่มีรูปถ่ายพลอยของร้านเอง
// — ใช้จุดสีไปก่อนตามที่ design doc §11 คำถาม C2 เสนอไว้เป็นแผนสำรอง) เปลี่ยน
// เป็นรูปจริงได้ทีหลังโดยไม่ต้องแก้โครง component — แค่เพิ่ม imageUrl ต่อพลอย
// แล้วสลับที่ใช้ตรงนี้
//
// สีที่เลือกเป็นสีพลอยที่มาตรฐานสากลยอมรับทั่วไป (ไม่ใช่เคลมทางการตลาด/ข้อเท็จจริง
// ที่ต้องผ่าน 3 ด่าน content — เป็นแค่ swatch ช่วยแยกตัวเลือกด้วยตา) ไม่มีผลต่อ
// data model หรือ RPC ใดๆ เป็น client-side presentation ล้วน
import type { GemQuizStoneConfig } from "./config";

export const GEM_QUIZ_STONE_COLORS: Readonly<Record<string, string>> = {
  blue_topaz: "#A9D6E5",
  amethyst: "#8E5FA8",
  peridot: "#9ACD32",
  citrine: "#E0A030",
  garnet: "#7B1F2E",
  pearl: "#F2EEE6",
  nil: "#1C1C1C",
  ruby: "#A91E3C",
  sapphire: "#1A4FA0",
  busarakham: "#F2C230",
  iolite: "#5B5EA6",
  kyanite: "#3F6FA8",
};

/** fallback เผื่อโค้ดรายชื่อพลอยใน config.ts ถูกเพิ่มในอนาคตแล้วลืมเพิ่มสีคู่กัน
 * — สีเทากลางๆ ไม่ชี้นำว่าพลอยไหนสำคัญกว่ากัน (ไม่ใช่ null เพราะ swatch ที่ไม่มี
 * สีเลยจะดู broken กว่าสีเทาเฉยๆ). */
const FALLBACK_COLOR = "#D4D4D4";

export function getStoneColor(code: GemQuizStoneConfig["code"] | string): string {
  return GEM_QUIZ_STONE_COLORS[code] ?? FALLBACK_COLOR;
}
