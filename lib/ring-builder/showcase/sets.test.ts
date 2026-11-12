// top3 → 3 ชุดพลอย · พลอยเสริมต้องตรงกับหน้าผล quiz เสมอ (findPair ตัวเดียวกัน)
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_PAIRS, GEM_QUIZ_STONE_CODES, GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import { buildResultView } from "@/lib/gem-quiz/result";
import type { GemTop3 } from "./quiz-link";
import { buildShowcaseSets, stoneLabel } from "./sets";

function allTop3(): GemTop3[] {
  const out: GemTop3[] = [];
  for (const a of GEM_QUIZ_STONE_CODES)
    for (const b of GEM_QUIZ_STONE_CODES)
      for (const c of GEM_QUIZ_STONE_CODES) {
        if (a !== b && b !== c && a !== c) out.push([a, b, c]);
      }
  return out;
}

describe("buildShowcaseSets", () => {
  it("ทุกการเรียง top3: 3 ชุด · บน = พลอยอันดับ n · ล่างต่างจากบน · คู่ต้องเป็นของ GEM_QUIZ_PAIRS จริง (ปลอมคู่ไม่ได้)", () => {
    for (const top3 of allTop3()) {
      const sets = buildShowcaseSets(top3);
      expect(sets.map((s) => s.index)).toEqual([1, 2, 3]);
      sets.forEach((s, i) => {
        expect(s.top).toBe(top3[i]);
        expect(s.bottom).not.toBe(s.top);
        expect(GEM_QUIZ_PAIRS).toContain(s.pair);
        expect([...s.pair.gems].sort()).toEqual([s.top, s.bottom].sort());
      });
    }
  });

  it("parity กับหน้าผล quiz: เมื่อ focus พลอยอันดับ n พลอยเสริมของ quiz = เม็ดล่างของแบบ n", () => {
    const answerSets = [
      { birthDay: "sun", intention: "career", feeling: "energy", likedStoneCodes: ["garnet", "citrine", "amethyst"] },
      { birthDay: "mon", intention: "calm", feeling: "calm", likedStoneCodes: [] },
      { birthDay: "wed", intention: "renewal", feeling: "renew", likedStoneCodes: ["peridot"] },
      { birthDay: "fri", intention: "love", feeling: "open", likedStoneCodes: ["blue_topaz", "garnet"] },
      { birthDay: "sat", intention: "wealth", feeling: "advance", likedStoneCodes: ["amethyst", "citrine", "peridot"] },
    ];
    for (const a of answerSets) {
      const answers = { birthDay: a.birthDay, intention: a.intention, feeling: a.feeling, jewelryType: "ring" };
      const base = buildResultView({ answers, likedStoneCodes: a.likedStoneCodes });
      expect(base.top3).toHaveLength(3);
      const top3 = base.top3 as unknown as GemTop3;
      const sets = buildShowcaseSets(top3);
      sets.forEach((s, i) => {
        const focused = buildResultView({ answers, likedStoneCodes: a.likedStoneCodes, focusStoneCode: top3[i] });
        expect(focused.top3).toEqual(base.top3); // top3 ไม่ขึ้นกับ focus
        expect(focused.pairing.heroStoneCode).toBe(s.top);
        expect(focused.pairing.pairStoneCode).toBe(s.bottom);
        expect(focused.pairing.title).toBe(s.pair.title);
        expect(focused.pairing.th).toBe(s.pair.th);
        expect(focused.pairing.fit).toBe(s.pair.fit);
      });
    }
  });

  it("แบบ 1 กับ 2 เป็นคู่เดิมสลับบน/ล่างได้ → ใส่ sameAsIndex (garnet.citrine.peridot)", () => {
    const sets = buildShowcaseSets(["garnet", "citrine", "peridot"]);
    expect(sets[0]).toMatchObject({ top: "garnet", bottom: "citrine", sameAsIndex: null });
    expect(sets[1]).toMatchObject({ top: "citrine", bottom: "garnet", sameAsIndex: 1 });
    expect(sets[2].sameAsIndex).toBeNull();
  });

  it("ทุกพลอยมีชื่อไทย", () => {
    for (const s of GEM_QUIZ_STONES) expect(stoneLabel(s.code)).toBe(s.labelTh);
  });
});
