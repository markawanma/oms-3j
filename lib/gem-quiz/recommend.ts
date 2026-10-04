// lib/gem-quiz/recommend.ts
//
// Pure scoring function — ใช้ร่วมกันทั้ง client (แสดงผลทันทีหลังตอบคำถาม,
// design §4.2 ขั้น 4) และ server (app/api/gem-quiz/submit/route.ts คำนวณซ้ำ
// ก่อนเก็บ DB, ไม่เชื่อค่าที่ client ส่งมา — design §4.4/R-8). ไม่มี import
// จาก "use server" หรือ lib/actions ใดๆ (กฎ §1.2, ดู config.ts หัวไฟล์).
//
// B4 เคาะแล้ว (4 ต.ค. 69): ผลแนะนำ 1 พลอยเท่านั้น (ไม่ใช่ 1 ต่อกลุ่มราคา) —
// ฟังก์ชันนี้คืน array ความยาว 1 เสมอ (ยังคืนเป็น array ไม่ใช่ string เดี่ยว
// เพื่อให้ตรงกับ contract ของ gem_quiz_submit ที่ยอมรับ 1-2 ตัว โดยไม่ต้องแก้
// signature ถ้า B4 กลับมติในอนาคต).
//
// 🔴 ไม่ใช้คำตอบ Q1 ("ชอบพลอยอะไร") ในการคำนวณคะแนนเลย (design §4.4) — เพื่อให้
// ตัวชี้วัด "ระบบแนะนำตรงกับที่ชอบกี่ %" (agreement.recommended_in_liked ใน
// gem_quiz_stats) มีความหมายจริง ถ้าเอา Q1 มาเป็นอินพุตของ Q1 เองตัวเลขนี้จะ
// โกหกเป็น 100% เสมอ
import { GEM_QUIZ_SCORE_TABLE, GEM_QUIZ_STONES, GEM_QUIZ_QUESTIONS, type GemQuizAnswers } from "./config";

/** คำนวณพลอยที่ระบบแนะนำจากคำตอบคำถามแนะนำ (ไม่รวม Q1) — คืน array ความยาว 1
 * เสมอ (B4) ไม่มีทางคืน array ว่าง แม้ answers จะว่างเปล่าทั้งหมด (fallback คือ
 * พลอยที่ sort_order ต่ำสุด — deterministic, design §4.4 "เสมอกันตัดด้วย
 * sort_order"). */
export function recommendStoneCodes(answers: GemQuizAnswers): string[] {
  const scoreByStone = new Map<string, number>();
  for (const stone of GEM_QUIZ_STONES) scoreByStone.set(stone.code, 0);

  for (const question of GEM_QUIZ_QUESTIONS) {
    const selectedOption = answers[question.code];
    if (!selectedOption) continue;

    const optionScores = GEM_QUIZ_SCORE_TABLE[question.code]?.[selectedOption];
    if (!optionScores) continue; // ตัวเลือกที่ไม่รู้จัก (เวอร์ชันเก่า/ข้อมูลเพี้ยน) — ไม่ให้คะแนนเงียบๆ ไม่ throw

    for (const [stoneCode, weight] of Object.entries(optionScores)) {
      if (!scoreByStone.has(stoneCode)) continue; // กันคะแนนลอยไปให้โค้ดพลอยที่ไม่มีใน config ปัจจุบัน
      scoreByStone.set(stoneCode, (scoreByStone.get(stoneCode) ?? 0) + weight);
    }
  }

  // เลือกตัวที่คะแนนสูงสุด — เสมอกันตัดด้วย sortOrder (ยิ่งน้อยยิ่งชนะ) ให้
  // ผลลัพธ์ deterministic เสมอไม่ว่าจะเรียกกี่ครั้งด้วยอินพุตเดียวกัน
  let bestCode: string | null = null;
  let bestScore = -Infinity;
  let bestSortOrder = Infinity;

  for (const stone of GEM_QUIZ_STONES) {
    const score = scoreByStone.get(stone.code) ?? 0;
    const winsOnScore = score > bestScore;
    const tiesOnScoreWinsOnOrder = score === bestScore && stone.sortOrder < bestSortOrder;
    if (bestCode === null || winsOnScore || tiesOnScoreWinsOnOrder) {
      bestCode = stone.code;
      bestScore = score;
      bestSortOrder = stone.sortOrder;
    }
  }

  // bestCode เป็น null ได้ทางทฤษฎีเดียวคือ GEM_QUIZ_STONES ว่าง (ไม่เกิดจริง —
  // config.ts seed ไว้ 12 ตัวเสมอ) — ยัง guard ไว้เพื่อไม่ให้ caller ได้ array
  // ว่างแบบเงียบๆ ถ้าใครลบ seed ทิ้งหมดในอนาคต
  return bestCode === null ? [] : [bestCode];
}
