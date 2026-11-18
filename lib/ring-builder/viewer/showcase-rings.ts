// lib/ring-builder/viewer/showcase-rings.ts — แหล่งเดียวที่สร้างโมเดล 3D ของ 7 แบบ (pure · cache ราย id)
// 🔴 เป็นไฟล์เดียวที่ import row-ring/row-presets ได้ (Z7/Z9) และถูก import จาก RingViewer.tsx เท่านั้น → อยู่ใน chunk lazy ไม่เข้า first-load
// id ตรงกับ ShowcaseDesignId ของ showcase/designs.ts (test ไขว้ล็อกว่าลำดับ/ชุดเท่ากัน)
import { BYPASS2, buildBypassRing } from "./bypass-ring";
import { ROW_PRESETS, ROW_PRESET_IDS, type RowDesignId } from "./row-presets";
import { buildRowRing } from "./row-ring";
import type { ViewerRing } from "./ring-types";

export type ShowcaseRingId = "bypass2" | RowDesignId;
export const SHOWCASE_RING_IDS: readonly ShowcaseRingId[] = ["bypass2", ...ROW_PRESET_IDS];

const cache = new Map<ShowcaseRingId, ViewerRing>();

/** โมเดล 3D ของแบบนั้น (สร้างครั้งแรกแล้วเก็บ) · id นอกรายการ = throw (ผู้เรียกจับแล้วตกเป็น fallback) */
export function getShowcaseRing(id: ShowcaseRingId): ViewerRing {
  const hit = cache.get(id);
  if (hit) return hit;
  let ring: ViewerRing;
  if (id === "bypass2") ring = buildBypassRing(BYPASS2);
  else if ((ROW_PRESET_IDS as readonly string[]).includes(id)) ring = buildRowRing(ROW_PRESETS[id]);
  else throw new Error(`showcase-rings: ไม่รู้จักแบบ "${String(id)}"`);
  cache.set(id, ring);
  return ring;
}

/** ดัชนีเม็ด "พลอยหลัก" ของแถว n เม็ด (เรียงซ้าย→ขวา): คี่ = 1 เม็ดกลาง · คู่ = 2 เม็ดกลาง */
export function mainIndexes(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) return [];
  return n % 2 === 1 ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
}

/** ล้าง cache (ใช้ใน test เท่านั้น) */
export function clearShowcaseRingCache(): void {
  cache.clear();
}
