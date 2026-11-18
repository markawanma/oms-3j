// lib/ring-builder/last-size.ts — ผลวัดไซซ์ล่าสุดจาก /ring-size (อ่านอย่างเดียว · ฝั่ง client · localStorage)
// ใช้ readLastResult() (key ringSize:lastResult:v1) + circToRec() ตัวเดียวกับที่ /ring-size ใช้ — ห้ามเขียนสูตรเบอร์ซ้ำ (parity: last-size.test.ts)
// 🔴 boundary: กราฟของหน้าสาธารณะ import จาก lib/ring-size ได้เฉพาะ 2 ไฟล์นี้ (calibration.ts · size.ts) — ห้ามแตะ /ring-size (ไม่แก้ ไม่เขียนกลับ)
import { readLastResult, type StorageLike } from "@/lib/ring-size/calibration";
import { circToRec } from "@/lib/ring-size/size";
import { RING_BUILDER_SIZES } from "./config";

export interface LastMeasuredSize {
  /** เบอร์แนะนำจากกฎของวิธีวัดนั้น */
  size: number;
  method: "A" | "B";
  savedAt: number;
  /** อยู่ในช่วงร้านทั้งหมด (45-68) */
  inShopRange: boolean;
}

export function getLastMeasuredSize(storage?: StorageLike | null): LastMeasuredSize | null {
  const last = storage === undefined ? readLastResult() : readLastResult(storage);
  if (!last) return null;
  const rec = circToRec(last.circ, last.method);
  if (!rec) return null;
  return { size: rec.rec, method: last.method, savedAt: last.savedAt, inShopRange: rec.rec >= RING_BUILDER_SIZES.min && rec.rec <= RING_BUILDER_SIZES.max };
}

/** ผลวัดอยู่ในช่วงของแบบนี้ไหม (นอกช่วง = แจ้ง + ทางทักแอดมิน — UI ไม่เลือกให้เอง) */
export function fitsDesignRange(size: number, design: { sizeMin: number; sizeMax: number }): boolean {
  return Number.isInteger(size) && size >= design.sizeMin && size <= design.sizeMax;
}

