// top3 → 3 ชุดพลอย · พลอยเสริมต้องตรงกับหน้าผล quiz เสมอ (findPair ตัวเดียวกัน) · D1.1: findExactPair / describeOwn / intentionOnlyTop3
import { describe, expect, it } from "vitest";
import {
  GEM_QUIZ_INTENTIONS,
  GEM_QUIZ_PAIRS,
  GEM_QUIZ_STONE_BY_CODE,
  GEM_QUIZ_STONE_CODES,
  GEM_QUIZ_STONES,
  type GemQuizIntention,
} from "@/lib/gem-quiz/config";
import { rankGems } from "@/lib/gem-quiz/recommend";
import { buildResultView, findPair } from "@/lib/gem-quiz/result";
import type { GemTop3 } from "./quiz-link";
import { buildShowcaseSets, describeOwn, findExactPair, intentionOnlyTop3, stoneLabel } from "./sets";

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

describe("findExactPair (โหมดเลือกพลอยเอง · Y4)", () => {
  it("25 แบบ: มีข้อความคู่เฉพาะ 10 แบบ (5 คู่ × 2 ลำดับ) · ที่เหลือ 15 = null (รวมเม็ดซ้ำ 5)", () => {
    let withPair = 0;
    let nulls = 0;
    for (const a of GEM_QUIZ_STONE_CODES)
      for (const b of GEM_QUIZ_STONE_CODES) {
        const p = findExactPair(a, b);
        if (p) {
          withPair++;
          expect(GEM_QUIZ_PAIRS).toContain(p);
          expect([...p.gems].sort()).toEqual([a, b].sort()); // ต้องเป็นคู่ตรง ไม่ใช่ fallback ของ findPair
        } else nulls++;
      }
    expect(withPair).toBe(10);
    expect(nulls).toBe(15);
  });
  it("ไม่สนลำดับบน/ล่าง · พลอยซ้ำ = null · ไม่ใช่คู่ใน config = null", () => {
    expect(findExactPair("garnet", "citrine")).toBe(findExactPair("citrine", "garnet"));
    expect(findExactPair("garnet", "garnet")).toBeNull();
    expect(findExactPair("garnet", "amethyst")).toBeNull();
    expect(findExactPair("blue_topaz", "citrine")).toBeNull();
  });
  it("ต่างจาก findPair: คู่ที่ไม่มีใน config ห้ามได้ข้อความคู่อื่นมาแทน", () => {
    // findPair(garnet, [amethyst]) ตกไป fallback = คู่แรกที่มี garnet ซึ่งไม่มี amethyst — เหตุผลที่โหมดเลือกเองห้ามใช้ findPair
    expect(findPair("garnet", ["amethyst"]).gems).not.toContain("amethyst");
    expect(findExactPair("garnet", "amethyst")).toBeNull();
  });
});

describe("describeOwn — ข้อความมาจาก config เท่านั้น", () => {
  it("คู่ตรง → pair · เม็ดซ้ำ → same + keywords ครั้งเดียว · ไม่มีคู่ → singles จาก labelTh/keywords", () => {
    expect(describeOwn("garnet", "citrine")).toMatchObject({ kind: "pair" });
    expect(describeOwn("citrine", "garnet")).toMatchObject({ kind: "pair" });
    expect(describeOwn("peridot", "peridot")).toEqual({ kind: "same", code: "peridot", label: "เพอริดอท", keywords: GEM_QUIZ_STONE_BY_CODE.peridot.keywords });
    expect(describeOwn("garnet", "amethyst")).toEqual({
      kind: "singles",
      top: { label: GEM_QUIZ_STONE_BY_CODE.garnet.labelTh, keywords: GEM_QUIZ_STONE_BY_CODE.garnet.keywords },
      bottom: { label: GEM_QUIZ_STONE_BY_CODE.amethyst.labelTh, keywords: GEM_QUIZ_STONE_BY_CODE.amethyst.keywords },
    });
  });
  it("ทั้ง 25 แบบคืนค่าได้ ไม่ throw", () => {
    for (const a of GEM_QUIZ_STONE_CODES) for (const b of GEM_QUIZ_STONE_CODES) expect(() => describeOwn(a, b)).not.toThrow();
  });
});

describe("intentionOnlyTop3", () => {
  it("ทุกเรื่อง: 3 อันดับไม่ซ้ำ ใน 5 พลอย · ตรงกับ rankGems ที่คำตอบอื่นว่าง", () => {
    for (const intention of Object.keys(GEM_QUIZ_INTENTIONS) as GemQuizIntention[]) {
      const t = intentionOnlyTop3(intention);
      expect(new Set(t).size).toBe(3);
      const r = rankGems({ birthDay: "", intention, feeling: "", likedStoneCodes: [] });
      expect([...t]).toEqual(r.slice(0, 3).map((x) => x.code));
    }
  });
});
