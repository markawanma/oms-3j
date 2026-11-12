// lib/ring-builder/viewer/gem-colors.ts — สีพลอยบนภาพ 3D
// 🔴 แหล่งเดียว = GEM_QUIZ_STONES[].colors.base (lib/gem-quiz/config.ts) — ห้ามมีตารางสีพลอยชุดที่สองที่นี่
// CZ ขาว = ค่าตายตัวของต้นฉบับ (STONES[0] ใน trinity-ring-preview.html) · ห้ามเรียกว่าเพชร (กฎแบรนด์)
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizStoneCode } from "@/lib/gem-quiz/config";

export interface GemTint {
  /** 0..1 */
  rgb: readonly [number, number, number];
  /** CZ ขาว: ประกายขาวล้วน · ไม่ใช่ = ประกายคงโทนสี */
  cz: boolean;
}

export const CZ_TINT: GemTint = { rgb: [0.9, 0.92, 0.96], cz: true };

/** "#RRGGBB" → [r,g,b] 0..1 · ผิดรูป = null (ไม่เดาสี) */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export function stoneTint(code: GemQuizStoneCode): GemTint {
  const rgb = hexToRgb(GEM_QUIZ_STONE_BY_CODE[code].colors.base);
  if (!rgb) throw new Error(`gem-colors: สีของ "${code}" ไม่ใช่ #RRGGBB`);
  return { rgb, cz: false };
}

/** [พลอยไข่บน, พลอยไข่ล่าง, CZ เล็ก, CZ เล็ก] — null = CZ ขาว (เข้าตรงไม่มีพลอยจาก quiz) */
export function ringTints(top: GemQuizStoneCode | null, bottom: GemQuizStoneCode | null): GemTint[] {
  return [top ? stoneTint(top) : CZ_TINT, bottom ? stoneTint(bottom) : CZ_TINT, CZ_TINT, CZ_TINT];
}
