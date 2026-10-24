// lib/ring-size/calibration.ts — ค่าเทียบจอ (px ต่อ มม.) · อ่าน/เขียน/ตรวจใน localStorage
//
// กติกา (build spec ข้อ 3.3):
//   - เก็บ { pxPerMm, ref, dpr, screenShort, screenLong, portraitWidth, savedAt, version: 2 } เท่านั้น · ไม่เก็บอย่างอื่น
//   - ref นอก whitelist · version ≠ 2 (ค่า v1 เดิมที่ไม่มี portraitWidth = ทิ้ง ถือว่ายังไม่เทียบ) · ค่าไม่ใช่ตัวเลข/นอก 2.0–12.0 → ทิ้งทั้งก้อน เหมือนไม่มี
//   - localStorage ทุกจุด try/catch (webview TikTok/LINE บล็อกได้) — ล้ม = ทำงานต่อโดยไม่จำ ไม่ throw
//   - อ่านใน useEffect เท่านั้น (ไฟล์นี้ไม่อ่านเองตอน import/render — ผู้เรียกต้องเรียกจาก effect/handler)
import { CALIBRATION, type RefKind } from "./config";

export const CALIBRATION_STORAGE_KEY = "ringSize:calibration:v1";
export const LAST_RESULT_STORAGE_KEY = "ringSize:lastResult:v1";
/** v2 (24 ต.ค. 69): เพิ่ม portraitWidth กัน Safari "aA" page zoom ที่ไม่เปลี่ยน dpr — ค่า v1 ที่เก็บไว้ก่อนหน้านี้ถูกทิ้ง */
export const CALIBRATION_VERSION = 2;

export interface Calibration {
  pxPerMm: number;
  ref: RefKind;
  dpr: number;
  screenShort: number;
  screenLong: number;
  /** innerWidth ตอนเทียบ ถ้าถืออยู่แนวตั้ง · null = ตอนนั้นถือแนวนอน (ไม่ใช้เทียบ) */
  portraitWidth: number | null;
  savedAt: number;
  version: 2;
}

export interface ScreenFingerprint {
  dpr: number;
  screenShort: number;
  screenLong: number;
  /**
   * ความกว้างหน้าเว็บ (CSS px) เมื่อถือแนวตั้ง — Safari "aA" (ขยายตัวอักษร/page zoom 115%) เปลี่ยน px/มม. จริง
   * โดย devicePixelRatio ไม่เปลี่ยน แต่ innerWidth เปลี่ยน · แนวนอน = null (กว้างเปลี่ยนตามการหมุน เทียบไม่ได้)
   */
  portraitWidth: number | null;
}

/** ที่เก็บแบบ minimal เพื่อให้ฉีด fake ในเทสต์ได้ (Storage ของจริงใช้ได้ตรงๆ) */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isRef = (x: unknown): x is RefKind => x === "card" || x === "coin";

/** ตรวจก้อนที่ parse จาก storage — ผิดข้อใดข้อหนึ่ง = null */
export function parseCalibration(raw: unknown): Calibration | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== CALIBRATION_VERSION) return null;
  if (!isRef(o.ref)) return null;
  if (!isFiniteNumber(o.pxPerMm)) return null;
  const [lo, hi] = CALIBRATION.PPM_STORAGE_RANGE;
  if (o.pxPerMm < lo || o.pxPerMm > hi) return null;
  if (!isFiniteNumber(o.dpr) || o.dpr <= 0) return null;
  if (!isFiniteNumber(o.screenShort) || o.screenShort <= 0) return null;
  if (!isFiniteNumber(o.screenLong) || o.screenLong <= 0) return null;
  if (!isFiniteNumber(o.savedAt) || o.savedAt <= 0) return null;
  // ต้องเป็นตัวเลขบวกหรือ null (ไม่มี field = ทิ้ง)
  if (o.portraitWidth !== null && (!isFiniteNumber(o.portraitWidth) || o.portraitWidth <= 0)) return null;
  return {
    pxPerMm: o.pxPerMm,
    ref: o.ref,
    dpr: o.dpr,
    screenShort: o.screenShort,
    screenLong: o.screenLong,
    portraitWidth: o.portraitWidth,
    savedAt: o.savedAt,
    version: CALIBRATION_VERSION,
  };
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // บางเบราว์เซอร์ throw แค่ตอนเข้าถึง window.localStorage
  }
}

export function readCalibration(storage: StorageLike | null = defaultStorage()): Calibration | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(CALIBRATION_STORAGE_KEY);
    if (!text) return null;
    return parseCalibration(JSON.parse(text));
  } catch {
    return null;
  }
}

/** true = เขียนสำเร็จ · false = จำไม่ได้ (ทำงานต่อได้ ไม่ต้องแจ้งผู้ใช้) */
export function writeCalibration(c: Calibration, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const clean: Calibration = {
      pxPerMm: c.pxPerMm,
      ref: c.ref,
      dpr: c.dpr,
      screenShort: c.screenShort,
      screenLong: c.screenLong,
      portraitWidth: c.portraitWidth,
      savedAt: c.savedAt,
      version: CALIBRATION_VERSION,
    };
    storage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── ผลล่าสุด (เก็บแค่ตัวเลข + วิธี + เวลา) ─────────────────────────

export interface LastResult {
  /** เส้นรอบวงที่ปัด 0.1 แล้ว */
  circ: number;
  method: "A" | "B";
  ref: RefKind;
  savedAt: number;
  version: 1;
}

export function parseLastResult(raw: unknown): LastResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (o.method !== "A" && o.method !== "B") return null;
  if (!isRef(o.ref)) return null;
  if (!isFiniteNumber(o.circ) || o.circ < 20 || o.circ > 120) return null;
  if (!isFiniteNumber(o.savedAt) || o.savedAt <= 0) return null;
  return { circ: o.circ, method: o.method, ref: o.ref, savedAt: o.savedAt, version: 1 };
}

export function readLastResult(storage: StorageLike | null = defaultStorage()): LastResult | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(LAST_RESULT_STORAGE_KEY);
    if (!text) return null;
    return parseLastResult(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeLastResult(r: LastResult, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const clean: LastResult = { circ: r.circ, method: r.method, ref: r.ref, savedAt: r.savedAt, version: 1 };
    storage.setItem(LAST_RESULT_STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── คำนวณ ─────────────────────────

/** px ต่อ มม. จากความยาวอ้างอิงที่เห็นบนจอ (px): บัตร = ความกว้างระหว่างขอบในของเส้น · เหรียญ = เส้นผ่านศูนย์กลางด้านในวง */
export function computePxPerMm(ref: RefKind, refPx: number): number {
  return refPx / CALIBRATION.REF[ref].mm;
}

/** ความยาวอ้างอิง (px) ที่ ppm นี้ — ส่วนกลับของ computePxPerMm */
export function refPxFor(ref: RefKind, pxPerMm: number): number {
  return pxPerMm * CALIBRATION.REF[ref].mm;
}

/** G3: ค่านอกช่วงที่มือถือส่วนใหญ่เป็น */
export function isTypicalPxPerMm(pxPerMm: number): boolean {
  const [lo, hi] = CALIBRATION.PPM_TYPICAL;
  return pxPerMm >= lo && pxPerMm <= hi;
}

/** ก้าว −/+ ในหน่วย ppm: ขยับขอบวัตถุบนจอทีละ stepMm (มม. ของจอ) ของความยาวอ้างอิง → Δppm = stepMm × ppm ÷ refMm */
export function stepPpm(ref: RefKind, pxPerMm: number): number {
  const r = CALIBRATION.REF[ref];
  return (r.stepMm * pxPerMm) / r.mm;
}

/** ppm สูงสุดของแถบเลื่อน: เหรียญ = 9.0 · บัตร = min(9.0, (ความกว้างเวที − 2×15 − 2×sw) ÷ 53.98) */
export function maxPpmFor(ref: RefKind, stageWidthPx: number | null): number {
  if (ref === "coin" || stageWidthPx === null || !Number.isFinite(stageWidthPx)) return CALIBRATION.PPM_MAX_ABS;
  const usable = stageWidthPx - 2 * CALIBRATION.SIDE_MARGIN_PX - 2 * CALIBRATION.STROKE_PX;
  return Math.min(CALIBRATION.PPM_MAX_ABS, usable / CALIBRATION.REF.card.mm);
}

export function clampPpm(ppm: number, max: number): number {
  if (!Number.isFinite(ppm)) return CALIBRATION.PPM_START;
  return Math.min(Math.max(ppm, CALIBRATION.PPM_MIN), Math.max(max, CALIBRATION.PPM_MIN));
}

/** ค่าเริ่มของจอเทียบตอน G5: ppm เก่า × (dpr เก่า ÷ dpr ใหม่) — ซูมเข้า (dpr สูงขึ้น) → ppm ต่ำลง */
export function startPpmFromDpr(old: Pick<Calibration, "pxPerMm" | "dpr">, currentDpr: number): number {
  if (!isFiniteNumber(currentDpr) || currentDpr <= 0) return CALIBRATION.PPM_START;
  return old.pxPerMm * (old.dpr / currentDpr);
}

/** G5: ค่าที่จำไว้ไม่ตรงเครื่อง/การซูมตอนนี้ (หมุนจอไม่นับ — เทียบขนาดจอแบบเรียงน้อย/มาก) */
export function isStaleCalibration(c: Calibration, now: ScreenFingerprint): boolean {
  if (Math.abs(c.dpr - now.dpr) / c.dpr > 0.01) return true;
  if (Math.abs(c.screenShort - now.screenShort) > 2) return true;
  if (Math.abs(c.screenLong - now.screenLong) > 2) return true;
  // Safari aA / page zoom: dpr เท่าเดิมแต่ความกว้างหน้าเปลี่ยน (เทียบเฉพาะเมื่อทั้งสองครั้งถือแนวตั้ง)
  if (c.portraitWidth !== null && now.portraitWidth !== null && Math.abs(c.portraitWidth - now.portraitWidth) > 2) return true;
  return false;
}

/** อ่าน fingerprint ของจอตอนนี้ — เรียกจาก effect/handler เท่านั้น */
export function currentFingerprint(): ScreenFingerprint {
  const dpr = typeof window !== "undefined" && isFiniteNumber(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  let w = 0;
  let h = 0;
  try {
    w = window.screen.width;
    h = window.screen.height;
  } catch {
    // ไม่มี screen — ใช้ขนาดหน้าต่างแทน
  }
  if (!(w > 0) || !(h > 0)) {
    // ไม่รู้ขนาดจอจริง (webview บางตัว) → ใช้ค่าคงที่ ให้ไม่นับขนาดจอเป็นเหตุ stale
    // (ห้ามใช้ innerWidth/innerHeight แทน: เปลี่ยนตามแถบเบราว์เซอร์หด/ขยาย → G5 ขึ้นมั่ว)
    w = 1;
    h = 1;
  }
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const portrait = isFiniteNumber(iw) && isFiniteNumber(ih) && iw > 0 && ih >= iw;
  return { dpr, screenShort: Math.min(w, h), screenLong: Math.max(w, h), portraitWidth: portrait ? iw : null };
}
