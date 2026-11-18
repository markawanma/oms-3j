// lib/ring-builder/showcase/sets.ts — top3 → 3 ชุดพลอยของแบบแนะนำ · คู่ที่เลือกเอง · อันดับตามเรื่อง (pure)
// แบบแนะนำ: เม็ดบน = พลอยหลักของแบบ · เม็ดล่าง = พลอยเสริมจาก findPair() ตัวเดียวกับหน้าผล quiz
// เลือกเอง: findExactPair() — คู่ตรงใน GEM_QUIZ_PAIRS เท่านั้น · 🔴 ห้ามใช้ findPair ในโหมดเลือกเอง (fallback คืนคู่ที่ไม่มีเม็ดล่าง = สรรพคุณผิดคู่ · Y4)
import { GEM_QUIZ_PAIRS, GEM_QUIZ_STONE_BY_CODE, type GemQuizIntention, type GemQuizPair, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { rankGems } from "@/lib/gem-quiz/recommend";
import { findPair } from "@/lib/gem-quiz/result";
import type { GemTop3 } from "./quiz-link";

export interface ShowcaseSet {
  /** 1..3 = อันดับพลอย (จาก quiz หรือจากเรื่องที่เลือก) */
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

/** คู่ตรงใน GEM_QUIZ_PAIRS (ไม่สนลำดับบน/ล่าง) · ไม่เจอ / พลอยเดียวกัน = null */
export function findExactPair(a: GemQuizStoneCode, b: GemQuizStoneCode): GemQuizPair | null {
  if (a === b) return null;
  return GEM_QUIZ_PAIRS.find((p) => p.gems.includes(a) && p.gems.includes(b)) ?? null;
}

export type OwnDescription =
  | { kind: "pair"; pair: GemQuizPair }
  | { kind: "same"; code: GemQuizStoneCode; label: string; keywords: string }
  | { kind: "singles"; top: { label: string; keywords: string }; bottom: { label: string; keywords: string } };

/** ข้อความอธิบายของคู่ที่เลือกเอง — ทุกข้อความมาจาก config (GEM_QUIZ_PAIRS / GEM_QUIZ_STONES) ไม่แต่งความหมายคู่ */
export function describeOwn(top: GemQuizStoneCode, bottom: GemQuizStoneCode): OwnDescription {
  const t = GEM_QUIZ_STONE_BY_CODE[top];
  const b = GEM_QUIZ_STONE_BY_CODE[bottom];
  if (top === bottom) return { kind: "same", code: top, label: t.labelTh, keywords: t.keywords };
  const pair = findExactPair(top, bottom);
  if (pair) return { kind: "pair", pair };
  return { kind: "singles", top: { label: t.labelTh, keywords: t.keywords }, bottom: { label: b.labelTh, keywords: b.keywords } };
}

/** อันดับ 1–3 ตามเรื่องที่เลือกล้วน (คำตอบอื่นว่าง) — ใช้เมื่อไม่มีตาราง t (ลิงก์ `i` เดี่ยว / ลิงก์ g เดิมที่กดเปลี่ยนเรื่อง) */
export function intentionOnlyTop3(intention: GemQuizIntention): GemTop3 {
  const ranked = rankGems({ birthDay: "", intention, feeling: "", likedStoneCodes: [] });
  return [ranked[0].code, ranked[1].code, ranked[2].code];
}

/** ชื่อไทยของพลอย (ใช้ทั้งหน้าจอและข้อความ LINE) */
export function stoneLabel(code: GemQuizStoneCode): string {
  return GEM_QUIZ_STONE_BY_CODE[code].labelTh;
}
