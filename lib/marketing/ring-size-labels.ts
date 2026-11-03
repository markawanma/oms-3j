// lib/marketing/ring-size-labels.ts — ป้ายภาษาคนของหน้าสรุป /marketing/ring-size (ux-ring-size-stats.md §7.4/§7.5/§7.6/§10)
//
// ชุดคงที่ — key มาจาก lib/ring-size/track-schema.ts (ไม่ประกาศซ้ำ) · Record<..., string> บังคับให้ครบตอน compile
// ห้ามคำ PDPA / "ปลอดภัยตามกฎหมาย" · ห้ามศัพท์ session/RPC/stage · ห้ามรหัส G1–G5 บนจอ (label ทั้งหมดในไฟล์นี้เป็นภาษาคน)
import { RING_IN_APP, RING_STAGES, type RingInApp, type RingMethod, type RingRef } from "@/lib/ring-size/track-schema";

/** ป้ายขั้นที่ "ไปถึง" — index = stage 0..7 (เลขบนจอ = stage + 1 ผ่าน stageNumber เท่านั้น) */
export const STAGE_REACHED_LABELS: Readonly<Record<(typeof RING_STAGES)[number], string>> = {
  view: "เปิดหน้า",
  start: "กดเริ่มวัด",
  calib_pick: "เลือกเหรียญหรือบัตรไว้เทียบหน้าจอ",
  calib_adjust: "ปรับวงกลมให้เท่าของจริง",
  calib_done: "เทียบหน้าจอเสร็จ",
  method_pick: "เลือกวิธีวัด",
  measure: "เข้าหน้าวัด",
  result: "ถึงหน้าผลลัพธ์",
};

/** ความหมายของ "เลิกที่ขั้นนี้" (max_stage = k) — stage 7 ไม่มี (จบ ไม่นับเป็นเลิก) */
export const STAGE_ABANDON_LABELS: Readonly<Record<Exclude<(typeof RING_STAGES)[number], "result">, string>> = {
  view: "เปิดแล้วยังไม่กดเริ่ม",
  start: "กดเริ่มแล้วไม่เลือกของที่ใช้เทียบจอ",
  calib_pick: "เลือกแล้วไม่ปรับวงกลม",
  calib_adjust: "ปรับไม่เสร็จ",
  calib_done: "เทียบเสร็จแล้วไม่เลือกวิธีวัด",
  method_pick: "เลือกวิธีแล้วไม่เข้าหน้าวัด",
  measure: "อยู่หน้าวัดแล้วไม่ได้ผล",
};

export function stageNumber(stage: number): number {
  return stage + 1;
}

export function stageReachedLabel(stage: number): string {
  const key = RING_STAGES[stage];
  return key ? STAGE_REACHED_LABELS[key] : `ขั้นที่ ${stageNumber(stage)}`;
}

export function stageAbandonLabel(stage: number): string | null {
  const key = RING_STAGES[stage];
  if (!key || key === "result") return null;
  return STAGE_ABANDON_LABELS[key];
}

export const IN_APP_LABELS: Readonly<Record<RingInApp, string>> = {
  line: "LINE",
  tiktok: "TikTok",
  fb: "Facebook",
  ig: "Instagram",
  browser: "เบราว์เซอร์ทั่วไป",
  unknown: "ไม่ทราบ",
};

export function inAppLabel(code: string): string {
  return (RING_IN_APP as readonly string[]).includes(code) ? IN_APP_LABELS[code as RingInApp] : code;
}

export const METHOD_LABELS: Readonly<Record<RingMethod, string>> = { A: "แหวนวงเดิม", B: "พันกระดาษรอบนิ้ว" };
export const REF_LABELS: Readonly<Record<RingRef, string>> = { coin: "เหรียญ 10 บาท", card: "บัตร" };

export interface FrictionRowDef {
  key: "zoomBlocked" | "calibWarn" | "invalid" | "staleRecalib";
  title: string;
  hint: string;
}

/** แถวตาราง "จุดที่คนติด" — ลำดับตาม spec §7.6 (รหัส G1/G3/G4/G5 ไม่ขึ้นจอ) */
export const FRICTION_ROWS: readonly FrictionRowDef[] = [
  { key: "zoomBlocked", title: "ซูมหน้าจออยู่ เทียบขนาดไม่ได้", hint: "ต้องเลิกซูมก่อนถึงจะไปต่อได้" },
  { key: "calibWarn", title: "ค่าเทียบจอผิดปกติ", hint: "ขนาดที่ปรับไว้ไม่ตรงกับที่จอทั่วไปเป็น" },
  { key: "invalid", title: "ค่าวัดผิดปกติ", hint: "เล็กหรือใหญ่เกินช่วงที่เครื่องมือวัดได้" },
  { key: "staleRecalib", title: "ค่าเทียบเก่าอาจไม่ตรงเครื่องนี้", hint: "ใช้ค่าที่เคยเทียบไว้ แต่ขนาดจอเปลี่ยน" },
];
