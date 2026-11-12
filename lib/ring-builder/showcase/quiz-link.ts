// lib/ring-builder/showcase/quiz-link.ts — ลิงก์จากหน้าผล quiz → /ring-builder?g=a.b.c และตัว parse ฝั่งรับ (pure)
// 🔴 param g = รหัสพลอยอันดับ 1–3 เท่านั้น (ไม่มีคำตอบ quiz/PII) · ค่าที่ผิดรูปทุกแบบ = null → โหมดเข้าตรง (ไม่ throw · X1)
// 🔴 หน้าอ่านแค่ key `g` (X2) — ?price= ?size= ?design= ไม่มีผล
import { GEM_QUIZ_STONE_CODES, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { SHOWCASE_PARAM_KEY, SHOWCASE_PARAM_MAX_LEN, SHOWCASE_PATH, SHOWCASE_SET_COUNT } from "./config";

export type GemTop3 = readonly [GemQuizStoneCode, GemQuizStoneCode, GemQuizStoneCode];

function isStoneCode(code: string): code is GemQuizStoneCode {
  // GEM_QUIZ_STONE_CODES เป็น array — includes() เทียบค่าตรงๆ ไม่เดินโซ่ prototype ("constructor"/"__proto__" ไม่ผ่าน)
  return (GEM_QUIZ_STONE_CODES as readonly string[]).includes(code);
}

/** รับค่าดิบจาก searchParams (string | string[] | undefined | อะไรก็ได้) → top3 หรือ null · ไม่ throw */
export function parseGemParam(raw: unknown): GemTop3 | null {
  if (typeof raw !== "string") return null; // array / undefined / อื่นๆ
  if (raw.length === 0 || raw.length > SHOWCASE_PARAM_MAX_LEN) return null;
  const parts = raw.split(".");
  if (parts.length !== SHOWCASE_SET_COUNT) return null;
  const codes: GemQuizStoneCode[] = [];
  for (const part of parts) {
    if (!isStoneCode(part)) return null;
    if (codes.includes(part)) return null; // ซ้ำ
    codes.push(part);
  }
  return [codes[0], codes[1], codes[2]];
}

/** อ่านเฉพาะ key `g` ของ searchParams (ไม่แตะ key อื่นเลย) */
export function readShowcaseParams(searchParams: Readonly<Record<string, unknown>>): { top3: GemTop3 | null } {
  return { top3: parseGemParam(searchParams[SHOWCASE_PARAM_KEY]) };
}

/** href ไปหน้าแหวน — ประกอบจากรหัสพลอยที่ตรวจแล้วเท่านั้น (ไม่ต้อง encode เพราะ [a-z_.] ล้วน) */
export function buildShowcaseHref(top3: GemTop3 | readonly GemQuizStoneCode[]): string {
  return `${SHOWCASE_PATH}?${SHOWCASE_PARAM_KEY}=${top3.join(".")}`;
}
