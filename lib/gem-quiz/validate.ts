// lib/gem-quiz/validate.ts
//
// Parse body ของ POST /api/gem-quiz/submit (unknown ชนิด — มาจากเครือข่าย
// ห้ามเชื่ออะไรเลย) → typed input หรือ error, ตาม whitelist ของ config.ts
// เวอร์ชันปัจจุบัน (design §8, ครอบเคส R-6/R-7/R-8/R-13 ใน §5.5).
//
// ไม่ตรวจ token/honeypot ที่นี่ — นั่นคือ L1-L3 ของ route.ts (ผ่าน form-token.ts)
// ก่อนจะเรียกฟังก์ชันนี้แล้ว (design §2/§5.2) ไฟล์นี้ตรวจแค่ "shape ของคำตอบ"
// ไม่มี import จาก "use server"/lib/actions (กฎ §1.2, ดู config.ts หัวไฟล์).
import {
  GEM_QUIZ_QUESTIONS,
  GEM_QUIZ_SRC_VALUES,
  GEM_QUIZ_STONE_CODES,
  MAX_LIKED_STONES,
  QUIZ_VERSION,
  type GemQuizSrc,
} from "./config";

const MAX_ANSWER_KEYS = 5;
const ANSWER_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const ANSWER_VALUE_RE = /^[a-z0-9_]{1,32}$/;

export interface ValidatedGemQuizInput {
  quizVersion: number;
  src: GemQuizSrc;
  likedStoneCodes: string[];
  answers: Record<string, string>;
  isRetake: boolean;
}

export type ValidateGemQuizResult =
  | { ok: true; data: ValidatedGemQuizInput }
  // R-6/R-7/R-2(shape)/method ผิดรูปทั่วไป → route แมปเป็น 400
  | { ok: false; kind: "invalid"; message: string }
  // R-13: quiz_version ไม่ตรงกับ config ปัจจุบัน (deploy ระหว่างที่ผู้ใช้เปิด
  // หน้าทิ้งไว้ — ผู้ใช้ไม่ได้ทำอะไรผิด) → route แมปเป็น 409 ไม่บันทึก
  | { ok: false; kind: "version_mismatch"; message: string };

function isValidSrc(value: unknown): value is GemQuizSrc {
  return typeof value === "string" && (GEM_QUIZ_SRC_VALUES as readonly string[]).includes(value);
}

/** รับ body ที่ JSON.parse แล้ว คืน typed input หรือ error. ฟิลด์ใดๆ ที่ client
 * ส่งมาเกินสัญญา (เช่น shop_id, recommended, created_at — R-8) ถูกทิ้งเงียบๆ
 * โดยธรรมชาติ เพราะฟังก์ชันนี้ "หยิบ" เฉพาะ v/src/liked/answers/retake เข้า
 * output เท่านั้น ไม่มีการ spread ...body ที่ไหนเลย. */
export function validateGemQuizBody(raw: unknown): ValidateGemQuizResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, kind: "invalid", message: "body ต้องเป็น JSON object" };
  }
  const body = raw as Record<string, unknown>;

  // --- v (quiz_version) — เช็คก่อนทุกอย่างอื่น: ค้างเวอร์ชันเก่าไม่ใช่ความผิด
  // ของผู้ใช้ ต้องแยกออกจาก error ทั่วไปตั้งแต่ขั้นตรวจรูปแบบ (R-13) ---
  const v = body.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) {
    return { ok: false, kind: "invalid", message: "v (quiz_version) ไม่ถูกต้อง" };
  }
  if (v !== QUIZ_VERSION) {
    return { ok: false, kind: "version_mismatch", message: "แบบทดสอบมีการอัปเดต กรุณาโหลดหน้าใหม่" };
  }

  // --- src (N-8: ค่าแปลก ⇒ coerce เป็น direct ไม่ reject ทั้งคำขอ) ---
  const src: GemQuizSrc = isValidSrc(body.src) ? body.src : "direct";

  // --- liked (R-6) ---
  const rawLiked = body.liked;
  if (!Array.isArray(rawLiked)) {
    return { ok: false, kind: "invalid", message: "liked ต้องเป็น array" };
  }
  if (rawLiked.length > MAX_LIKED_STONES) {
    return { ok: false, kind: "invalid", message: `liked เลือกได้สูงสุด ${MAX_LIKED_STONES} ตัว` };
  }
  const likedStoneCodes: string[] = [];
  const seenLiked = new Set<string>();
  for (const item of rawLiked) {
    if (typeof item !== "string" || !GEM_QUIZ_STONE_CODES.includes(item)) {
      return { ok: false, kind: "invalid", message: "liked มีรหัสพลอยที่ไม่รู้จัก" };
    }
    if (seenLiked.has(item)) {
      return { ok: false, kind: "invalid", message: "liked มีรหัสพลอยซ้ำ" };
    }
    seenLiked.add(item);
    likedStoneCodes.push(item);
  }

  // --- answers (R-7) ---
  const rawAnswers = body.answers;
  if (typeof rawAnswers !== "object" || rawAnswers === null || Array.isArray(rawAnswers)) {
    return { ok: false, kind: "invalid", message: "answers ต้องเป็น JSON object" };
  }
  const answerEntries = Object.entries(rawAnswers as Record<string, unknown>);
  if (answerEntries.length > MAX_ANSWER_KEYS) {
    return { ok: false, kind: "invalid", message: `answers มีได้ไม่เกิน ${MAX_ANSWER_KEYS} คำถาม` };
  }
  const answers: Record<string, string> = {};
  for (const [key, value] of answerEntries) {
    if (!ANSWER_KEY_RE.test(key)) {
      return { ok: false, kind: "invalid", message: `answers มี key ไม่ถูกต้อง: ${key}` };
    }
    // ตรวจชนิด+regex ก่อนเทียบ whitelist ตัวเลือกจริง — ปฏิเสธ "ข้อความไทย/
    // เบอร์โทร/array/number/null" (R-7) ตั้งแต่ขั้นนี้ ไม่ต้องรอไปชนที่ DB
    if (typeof value !== "string" || !ANSWER_VALUE_RE.test(value)) {
      return { ok: false, kind: "invalid", message: `answers.${key} มีค่าไม่ถูกต้อง` };
    }
    const question = GEM_QUIZ_QUESTIONS.find((q) => q.code === key);
    if (!question || !question.options.some((o) => o.code === value)) {
      return { ok: false, kind: "invalid", message: `answers.${key} ไม่อยู่ในรายการตัวเลือกของคำถามนี้` };
    }
    answers[key] = value;
  }

  // --- retake — boolean เท่านั้นถือเป็น true, อย่างอื่น (undefined/"true"/1) = false ---
  const isRetake = body.retake === true;

  return { ok: true, data: { quizVersion: v, src, likedStoneCodes, answers, isRetake } };
}
