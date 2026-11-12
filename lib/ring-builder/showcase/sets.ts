// lib/ring-builder/showcase/sets.ts — top3 จาก quiz → 3 ชุดพลอยของแบบ (pure)
// เม็ดบน = พลอยหลักของแบบ · เม็ดล่าง = พลอยเสริมจาก findPair() ตัวเดียวกับหน้าผล quiz (ปลอมคู่ที่ quiz ไม่เคยให้ไม่ได้ เพราะไม่อยู่ใน URL)
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizPair, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { findPair } from "@/lib/gem-quiz/result";
import type { GemTop3 } from "./quiz-link";

export interface ShowcaseSet {
  /** 1..3 = อันดับพลอยจาก quiz */
  index: 1 | 2 | 3;
  top: GemQuizStoneCode;
  bottom: GemQuizStoneCode;
  /** คำอธิบายคู่พลอย (title/th/fit) — ข้อความเดิมของ quiz คำต่อคำ */
  pair: GemQuizPair;
  /** ชุดนี้เป็นคู่เดียวกับแบบอื่น (สลับบน/ล่าง) — เลขแบบที่เจอก่อน */
  sameAsIndex: 1 | 2 | 3 | null;
}

const INDEXES = [1, 2, 3] as const;

export function buildShowcaseSets(top3: GemTop3): ShowcaseSet[] {
  const sets: ShowcaseSet[] = [];
  INDEXES.forEach((index, i) => {
    const top = top3[i];
    const others = top3.filter((c) => c !== top);
    const pair = findPair(top, others);
    const bottom = pair.gems.find((c) => c !== top) ?? pair.gems[0];
    const twin = sets.find((s) => s.pair === pair);
    sets.push({ index, top, bottom, pair, sameAsIndex: twin ? twin.index : null });
  });
  return sets;
}

/** ชื่อไทยของพลอย (ใช้ทั้งหน้าจอและข้อความ LINE) */
export function stoneLabel(code: GemQuizStoneCode): string {
  return GEM_QUIZ_STONE_BY_CODE[code].labelTh;
}
