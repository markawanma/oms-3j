// lib/gem-quiz/recommend.test.ts — design doc §4.4: "ไล่ทุก combination ของ
// คำถามแนะนำ 2 ข้อ (2 ข้อ x ~5-12 ตัวเลือก = ไม่เกินร้อย) → ต้องได้ผลเสมอ +
// รหัสอยู่ในรายชื่อ · รายงานด้วยว่าพลอยตัวไหน 'ไม่มีทางถูกแนะนำ' (เป็นคำถาม
// ธุรกิจ ไม่ใช่บั๊ก — print/comment ไม่ต้อง assert)".
import { describe, expect, it } from "vitest";
import { recommendStoneCodes } from "./recommend";
import { GEM_QUIZ_QUESTIONS, GEM_QUIZ_STONE_CODES } from "./config";

function allCombinations(): Record<string, string>[] {
  // cartesian product ของตัวเลือกทุกคำถามใน GEM_QUIZ_QUESTIONS (วันนี้คือ
  // 4 x 7 = 28 combo — ไม่ hardcode ตัวเลขนี้ไว้ เผื่อ config เปลี่ยนจำนวน
  // ตัวเลือกในอนาคต)
  let combos: Record<string, string>[] = [{}];
  for (const question of GEM_QUIZ_QUESTIONS) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const option of question.options) {
        next.push({ ...combo, [question.code]: option.code });
      }
    }
    combos = next;
  }
  return combos;
}

describe("recommendStoneCodes", () => {
  const combos = allCombinations();

  it("ไม่เกิน 100 combination (design §4.4 cap)", () => {
    expect(combos.length).toBeLessThanOrEqual(100);
    expect(combos.length).toBeGreaterThan(0);
  });

  it.each(combos.map((c) => [JSON.stringify(c), c] as const))(
    "ทุก combination (%s) ได้ผลเสมอ — array ความยาว 1, รหัสมีจริงใน config",
    (_label, answers) => {
      const result = recommendStoneCodes(answers);
      expect(result).toHaveLength(1);
      expect(GEM_QUIZ_STONE_CODES).toContain(result[0]);
    }
  );

  it("deterministic — เรียกซ้ำด้วยอินพุตเดียวกันได้ผลเดิมทุกครั้ง", () => {
    for (const combo of combos) {
      const first = recommendStoneCodes(combo);
      const second = recommendStoneCodes(combo);
      expect(second).toEqual(first);
    }
  });

  it("answers ว่างเปล่า ⇒ ยังคืนผล 1 ตัว (fallback = sortOrder ต่ำสุด, deterministic)", () => {
    const result = recommendStoneCodes({});
    expect(result).toHaveLength(1);
    expect(GEM_QUIZ_STONE_CODES).toContain(result[0]);
  });

  it("ไม่ใช้คำตอบ Q1 (ไม่มีอยู่ใน answers input เลย) — ผลไม่เปลี่ยนไม่ว่าจะมี key แปลกปลอมปนมา", () => {
    const base = { q_intent: "opt_a", q_birth_dow: "sun" };
    const withExtraKey = { ...base, liked_stone_codes_leaked_in: "should_be_ignored" };
    expect(recommendStoneCodes(withExtraKey)).toEqual(recommendStoneCodes(base));
  });

  it("ตัวเลือกที่ไม่รู้จัก (เวอร์ชันเก่า/ข้อมูลเพี้ยน) ไม่ทำให้ throw และยังได้ผล 1 ตัว", () => {
    const result = recommendStoneCodes({ q_intent: "not_a_real_option", q_birth_dow: "sun" });
    expect(result).toHaveLength(1);
    expect(GEM_QUIZ_STONE_CODES).toContain(result[0]);
  });

  it("answers ที่ไม่มี key ของคำถามไหนเลยตรงกับ config ⇒ ยัง fallback ได้ผลเสมอ", () => {
    const result = recommendStoneCodes({ some_unrelated_key: "x" });
    expect(result).toHaveLength(1);
  });

  // รายงาน (ไม่ assert — design §4.4 "เป็นคำถามธุรกิจ ไม่ใช่บั๊ก") ว่าพลอยตัวไหน
  // ไม่มีทางถูกแนะนำด้วยตารางคะแนน placeholder ปัจจุบันใน config.ts
  it("รายงาน: พลอยที่ไม่มีทางถูกแนะนำด้วยตารางคะแนนปัจจุบัน (ข้อมูลสำหรับทีมธุรกิจ ไม่ assert)", () => {
    const reachable = new Set<string>();
    for (const combo of combos) {
      for (const code of recommendStoneCodes(combo)) reachable.add(code);
    }
    const unreachable = GEM_QUIZ_STONE_CODES.filter((code) => !reachable.has(code));
    // eslint-disable-next-line no-console
    console.log(
      `[gem-quiz recommend] พลอยที่ไม่มีทางถูกแนะนำด้วย placeholder score table ปัจจุบัน (${unreachable.length}/${GEM_QUIZ_STONE_CODES.length}): ${unreachable.join(", ") || "(ไม่มี — ทุกตัวถูกแนะนำได้)"}`
    );
    expect(true).toBe(true); // ไม่ assert เนื้อหา — แค่ยืนยันว่ารันจบโดยไม่ throw
  });
});
