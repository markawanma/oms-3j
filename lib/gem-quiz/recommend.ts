// lib/gem-quiz/recommend.ts
//
// Pure scoring function — ใช้ร่วมกันทั้ง client (แสดงผลทันทีหลังตอบคำถาม,
// design §4.2 ขั้น 4) และ server (app/api/gem-quiz/submit/route.ts คำนวณซ้ำ
// ก่อนเก็บ DB, ไม่เชื่อค่าที่ client ส่งมา — design §7/R-8). ไม่มี import จาก
// "use server" หรือ lib/actions ใดๆ (กฎ §1.2, ดู config.ts หัวไฟล์).
//
// v2 (5 ต.ค. 69): พอร์ตจาก rank() ใน
// docs/3j-jewelry/analytics/gem-quiz-v2-handoff/design/Quiz.dc.html (ไฟล์เดียว
// กับที่ copy เก็บ provenance ไว้) — logic/ตัวเลขต้องตรงเป๊ะ พิสูจน์ด้วย oracle
// test ใน recommend.test.ts (21,420 combination เทียบกับ reference ที่พอร์ต
// แยกไว้คนละตัวในไฟล์เทสต์). ต่างจาก v1 เดิม: คำตอบ Q4 (ชอบพลอยอะไร, 1-3 ตัว
// เรียงอันดับ) **มีผลต่อคะแนนแล้ว** (v1 design §4.4 เดิมสั่งห้ามใช้ Q1 — มติ
// ถูกกลับใน v12/v10 ของ design doc v2 เพราะ config+rank() ของแพ็กเกจนับ
// preference เป็นมิติคะแนนจริง).
//
// Comparator (tie-break เมื่อ total เท่ากัน) ตรงกับ rank() ของแพ็กเกจเป๊ะ:
//   total ↓ → intention ↓ → feeling ↓ → preference ↓ → birth_day ↓ → gemOrder ↑
import {
  GEM_QUIZ_BIRTH_DAY_SCORES,
  GEM_QUIZ_FEELINGS,
  GEM_QUIZ_FEELING_MATCH_POINTS,
  GEM_QUIZ_INTENTIONS,
  GEM_QUIZ_INTENTION_POINTS,
  GEM_QUIZ_PREFERENCE_POINTS_BY_RANK,
  GEM_QUIZ_STONE_CODES,
  type GemQuizIntentionWeights,
  type GemQuizStoneCode,
} from "./config";

export interface GemQuizRankInput {
  /** ค่าที่คาดว่าจะมาจาก whitelist ของ GEM_QUIZ_QUESTIONS (validate.ts ตรวจ
   * มาก่อนแล้วเสมอในทางที่ใช้งานจริง) — ฟังก์ชันนี้ยัง defensive: ค่าที่ไม่รู้จัก
   * ให้คะแนน 0 เงียบๆ ไม่ throw (เหมือน recommend.ts เวอร์ชัน v1 เดิม) เพื่อให้
   * เรียกจาก client ที่ยังตอบไม่ครบได้โดยไม่ล้ม (ใช้ตอน preview ผลสด). */
  birthDay: string;
  intention: string;
  feeling: string;
  /** ลำดับมีความหมาย — index 0 คือพลอยที่ชอบ "อันดับ 1" (liked_stone_codes[0]) */
  likedStoneCodes: readonly string[];
}

export interface GemQuizScoreRow {
  code: GemQuizStoneCode;
  /** ตำแหน่งใน gemOrder (GEM_QUIZ_STONE_CODES) — ตัดเสมอสุดท้าย (ascending ชนะ) */
  index: number;
  birthDayScore: number;
  intentionScore: number;
  feelingScore: number;
  preferenceScore: number;
  total: number;
}

function scoreBirthDay(birthDay: string, code: GemQuizStoneCode): number {
  const dayScores = (GEM_QUIZ_BIRTH_DAY_SCORES as Readonly<Record<string, Readonly<Partial<Record<GemQuizStoneCode, number>>>>>)[
    birthDay
  ];
  return dayScores?.[code] ?? 0;
}

function scoreIntention(intention: string, code: GemQuizStoneCode): number {
  const weights = (GEM_QUIZ_INTENTIONS as Readonly<Record<string, GemQuizIntentionWeights>>)[intention];
  if (!weights) return 0;
  if (weights.primary.includes(code)) return GEM_QUIZ_INTENTION_POINTS.primary;
  if (weights.secondary.includes(code)) return GEM_QUIZ_INTENTION_POINTS.secondary;
  return 0;
}

function scoreFeeling(feeling: string, code: GemQuizStoneCode): number {
  const matches = (GEM_QUIZ_FEELINGS as Readonly<Record<string, readonly GemQuizStoneCode[]>>)[feeling];
  return matches && matches.includes(code) ? GEM_QUIZ_FEELING_MATCH_POINTS : 0;
}

function scorePreference(likedStoneCodes: readonly string[], code: GemQuizStoneCode): number {
  const rank = likedStoneCodes.indexOf(code);
  if (rank < 0 || rank >= GEM_QUIZ_PREFERENCE_POINTS_BY_RANK.length) return 0;
  return GEM_QUIZ_PREFERENCE_POINTS_BY_RANK[rank];
}

/** คำนวณคะแนนพลอยทั้ง 5 ตัวแล้วเรียงจากมากไปน้อย — คืน array ความยาว 5 เสมอ
 * (เทียบ 1:1 กับ rank() ของแพ็กเกจ — ดู oracle test). ไม่ throw ไม่ว่า input
 * จะมีค่าที่ไม่รู้จักแค่ไหน (ให้คะแนน 0 สำหรับมิตินั้น). */
export function rankGems(input: GemQuizRankInput): GemQuizScoreRow[] {
  const rows: GemQuizScoreRow[] = GEM_QUIZ_STONE_CODES.map((code, index) => {
    const birthDayScore = scoreBirthDay(input.birthDay, code);
    const intentionScore = scoreIntention(input.intention, code);
    const feelingScore = scoreFeeling(input.feeling, code);
    const preferenceScore = scorePreference(input.likedStoneCodes, code);
    return {
      code,
      index,
      birthDayScore,
      intentionScore,
      feelingScore,
      preferenceScore,
      total: birthDayScore + intentionScore + feelingScore + preferenceScore,
    };
  });

  rows.sort(
    (x, y) =>
      y.total - x.total ||
      y.intentionScore - x.intentionScore ||
      y.feelingScore - x.feelingScore ||
      y.preferenceScore - x.preferenceScore ||
      y.birthDayScore - x.birthDayScore ||
      x.index - y.index
  );

  return rows;
}

/** ผลแนะนำสุดท้าย — พลอยอันดับ 1 เท่านั้น (design doc §3.1: recommended_stone_codes
 * = [rank1], ไม่เก็บอันดับ 2-3 เพราะ derive ได้จาก rankGems() ซ้ำเมื่อต้องใช้). */
export function recommendStoneCodes(input: GemQuizRankInput): GemQuizStoneCode[] {
  return [rankGems(input)[0].code];
}
