// lib/ring-size/flow.ts — ตรรกะลำดับจอ (pure · ทดสอบได้) ของ /ring-size
//
// ลำดับ (build spec ข้อ 1):
//   R0 ─▶ R1Pick ─┬─▶ R2Coin ─┐
//                 └─▶ R1 ─▶ R2 ┴─▶ R3 ─┬─▶ R4A ─▶ R5A ─┐
//                                      └─▶ R4B ─▶ R5B ─┴─▶ R6 / G4
//   R0 (มีค่าเทียบที่ใช้ได้) ─▶ R3 ข้ามขั้น 1 · G5 (ค่าเก่าไม่ตรงเครื่อง) ─▶ จอเทียบของ ref เดิม ข้าม R1Pick
// ปลายทางย้อน/วัดใหม่ = คำนวณจาก state { ref, method, hasCalibration } ไม่ผูกตายตัว
import type { Method, RefKind } from "./config";

export type ScreenId = "R0" | "R1Pick" | "R1" | "R2" | "R2Coin" | "R3" | "R4A" | "R4B" | "R5A" | "R5B" | "R6" | "G4";

export const SCREEN_IDS: readonly ScreenId[] = ["R0", "R1Pick", "R1", "R2", "R2Coin", "R3", "R4A", "R4B", "R5A", "R5B", "R6", "G4"];

export function isScreenId(x: unknown): x is ScreenId {
  return typeof x === "string" && (SCREEN_IDS as readonly string[]).includes(x);
}

/** จอวัด (ต้องมีค่าเทียบจอที่ใช้ได้) */
export const MEASURE_SCREENS: readonly ScreenId[] = ["R3", "R4A", "R4B", "R5A", "R5B"];

/** จอเทียบของ ref ที่เก็บไว้ (G5 / เปลี่ยนวิธี) */
export function calibrationScreenFor(ref: RefKind): "R2" | "R2Coin" {
  return ref === "coin" ? "R2Coin" : "R2";
}

/** จอสอนที่อยู่ก่อนจอเทียบ — เหรียญไม่มีจอสอน (ยุบเข้า R2Coin) */
export function teachScreenFor(ref: RefKind): "R1" | "R2Coin" {
  return ref === "coin" ? "R2Coin" : "R1";
}

export interface StartInput {
  /** มีค่าเทียบที่ validate แล้ว */
  calibration: { ref: RefKind } | null;
  /** ค่าเก่าไม่ตรงเครื่อง/การซูมตอนนี้ (G5) */
  stale: boolean;
}

export type StartDestination =
  | { screen: "R1Pick"; g5: false; skipped: false }
  | { screen: "R2" | "R2Coin"; g5: true; skipped: false }
  | { screen: "R3"; g5: false; skipped: true };

/** กด "เริ่มวัดไซส์" ที่ R0 → ไปไหน */
export function startDestination({ calibration, stale }: StartInput): StartDestination {
  if (!calibration) return { screen: "R1Pick", g5: false, skipped: false };
  if (stale) return { screen: calibrationScreenFor(calibration.ref), g5: true, skipped: false };
  return { screen: "R3", g5: false, skipped: true };
}

/**
 * ตัวนับขั้น: คนใหม่ 01/03 (เทียบจอ) → 02/03 (วัด) → 03/03 (ผล)
 * คนกลับมา (ข้ามขั้น 1 ด้วยค่าเทียบที่ใช้ได้) 01/02 ที่ R3–R5 → 02/02 ที่ R6 · R0 ไม่มีตัวนับ
 */
export function stepCounter(screen: ScreenId, skippedCalibration: boolean): { current: number; total: number } | null {
  switch (screen) {
    case "R0":
      return null;
    case "R1Pick":
    case "R1":
    case "R2":
    case "R2Coin":
      return { current: 1, total: 3 };
    case "R3":
    case "R4A":
    case "R4B":
    case "R5A":
    case "R5B":
    case "G4":
      return skippedCalibration ? { current: 1, total: 2 } : { current: 2, total: 3 };
    case "R6":
      return skippedCalibration ? { current: 2, total: 2 } : { current: 3, total: 3 };
  }
}

export interface GuardContext {
  hasCalibration: boolean;
  hasResult: boolean;
  hasInvalid: boolean;
}

/**
 * ด่านกันเข้าจอโดยไม่มีของที่จอนั้นต้องใช้ (Back ไปจอเก่าหลังรีโหลด · เปิดลิงก์ตรง)
 *   - จอวัดโดยไม่มีค่าเทียบ → R1Pick พร้อมข้อความ "ยังไม่ได้เทียบหน้าจอ ต้องเทียบก่อนวัด"
 *   - R6 โดยไม่มีผลวัด → R0 · G4 โดยไม่มีค่าที่ผิดปกติ → R0
 */
export function resolveScreen(screen: ScreenId, ctx: GuardContext): { screen: ScreenId; missingCalibration: boolean } {
  if ((MEASURE_SCREENS as readonly string[]).includes(screen) && !ctx.hasCalibration) {
    return { screen: "R1Pick", missingCalibration: true };
  }
  if (screen === "R6" && !ctx.hasResult) return { screen: "R0", missingCalibration: false };
  if (screen === "G4" && !ctx.hasInvalid) return { screen: "R0", missingCalibration: false };
  return { screen, missingCalibration: false };
}

export interface BackContext {
  ref: RefKind | null;
  method: Method | null;
  /** เพิ่งเทียบจอใน flow นี้ (ไม่ได้ข้ามขั้น 1) */
  calibratedThisFlow: boolean;
  /** เปิด R6 จากการ์ด "ผลล่าสุด" ที่หน้าแรก (ไม่ได้เพิ่งวัด) → ย้อนกลับไปหน้าแรก */
  resultFromHome?: boolean;
}

/** ปุ่มย้อนบนจอ → ปลายทางที่ถูกต้องตามจุดที่ผู้ใช้อยู่ (ไม่ผูกตายตัว) */
export function backDestination(screen: ScreenId, ctx: BackContext): ScreenId {
  switch (screen) {
    case "R0":
      return "R0";
    case "R1Pick":
      return "R0";
    case "R1":
      return "R1Pick";
    case "R2Coin":
      return "R1Pick";
    case "R2":
      return "R1";
    case "R3":
      // เพิ่งเทียบ → จอเทียบของ ref ปัจจุบัน · ข้ามขั้น 1 → หน้าแรก (R0 แสดงแบบคนกลับมา)
      return ctx.calibratedThisFlow && ctx.ref ? calibrationScreenFor(ctx.ref) : "R0";
    case "R4A":
    case "R4B":
      return "R3";
    case "R5A":
      return "R4A";
    case "R5B":
      return "R4B";
    case "R6":
      if (ctx.resultFromHome) return "R0";
      return ctx.method === "B" ? "R5B" : "R5A";
    case "G4":
      return ctx.method === "B" ? "R5B" : "R5A";
  }
}

/** G4 "วัดใหม่" → จอวัดตาม method */
export function remeasureDestination(method: Method): "R5A" | "R5B" {
  return method === "B" ? "R5B" : "R5A";
}

/** ใช้ ref ไหนเป็นตัวสลับ ("ใช้บัตรแทน" ↔ "ใช้เหรียญแทน") */
export function otherRef(ref: RefKind): RefKind {
  return ref === "coin" ? "card" : "coin";
}
