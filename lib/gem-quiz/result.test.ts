// lib/gem-quiz/result.test.ts — buildResultView() พอร์ตจาก renderVals() ของ
// Quiz.dc.html (ดูหัวไฟล์ result.ts) ครอบ: hero/isAlternative/prefNote (3
// กรณี)/pairing+fallback/alternatives/how-to-wear (unknown/ring/อื่นๆ)/
// products ไม่มีราคา/disclaimer + ปฏิเสธ V13 (ห้าม fallback DEMO เงียบๆ)
import { describe, expect, it } from "vitest";
import { buildResultView } from "./result";
import { GEM_QUIZ_DISCLAIMER } from "./config";

describe("buildResultView — ปฏิเสธคำตอบไม่ครบ (V13: ห้าม fallback DEMO)", () => {
  it("answers ขาด field ⇒ throw", () => {
    expect(() =>
      buildResultView({
        answers: { birthDay: "sun", intention: "", feeling: "energy", jewelryType: "ring" },
        likedStoneCodes: ["garnet"],
      })
    ).toThrow();
  });

  it("likedStoneCodes ว่างเปล่า ⇒ throw", () => {
    expect(() =>
      buildResultView({
        answers: { birthDay: "sun", intention: "career", feeling: "energy", jewelryType: "ring" },
        likedStoneCodes: [],
      })
    ).toThrow();
  });
});

describe("buildResultView — demo case (CLAUDE.md ของแพ็กเกจ): garnet rank1, ไม่ alt", () => {
  const input = {
    answers: { birthDay: "sun", intention: "career", feeling: "energy", jewelryType: "ring" },
    likedStoneCodes: ["garnet", "citrine", "amethyst"],
  };

  it("hero = garnet, isAlternative=false, heroA='YOUR GEM'", () => {
    const result = buildResultView(input);
    expect(result.hero.stoneCode).toBe("garnet");
    expect(result.hero.isAlternative).toBe(false);
    expect(result.hero.heroA).toBe("YOUR GEM");
    expect(result.hero.heroSub).toBe("พลอยประจำวันของคุณ");
  });

  it("prefNote กรณี 1: fav === pid ('และ Garnet ก็เป็นพลอยที่คุณเลือกเป็นอันดับแรกด้วย')", () => {
    const result = buildResultView(input);
    expect(result.hero.prefNote).toBe("และ Garnet ก็เป็นพลอยที่คุณเลือกเป็นอันดับแรกด้วย");
  });

  it("line2 ไม่ใช่ข้อความแบบ alternative", () => {
    const result = buildResultView(input);
    expect(result.hero.line2.startsWith("3J จึงแนะนำ Garnet")).toBe(true);
  });

  it("pairing: garnet คู่กับ citrine (ทางเลือกตัวแรกใน top3 ที่เหลือ) = Power + Abundance", () => {
    const result = buildResultView(input);
    expect(result.pairing.heroStoneCode).toBe("garnet");
    expect(result.pairing.pairStoneCode).toBe("citrine");
    expect(result.pairing.title).toBe("Power + Abundance");
  });

  it("alternatives: top3 ที่เหลือ (citrine, blue_topaz) — citrine ไม่ใช่ rank1 ของตัวเอง", () => {
    const result = buildResultView(input);
    expect(result.alternatives.map((a) => a.stoneCode)).toEqual(["citrine", "blue_topaz"]);
    for (const alt of result.alternatives) {
      expect(alt.label.startsWith("ทางเลือกที่")).toBe(true);
    }
  });

  it("how-to-wear ring: place มาจาก GEM_QUIZ_RING_FINGER[garnet]", () => {
    const result = buildResultView(input);
    expect(result.howToWear.place).toBe("แหวนที่นิ้วชี้");
    expect(result.howToWear.note).toBe("ตามที่คุณเลือก");
    expect(result.howToWear.hand).toContain("มือ");
  });

  it("products: 2 รายการ [garnet, citrine] มีแค่ stoneCode/nameEn/nameTh ไม่มีราคา/ต้นทุน", () => {
    const result = buildResultView(input);
    expect(result.products).toHaveLength(2);
    expect(result.products.map((p) => p.stoneCode)).toEqual(["garnet", "citrine"]);
    for (const product of result.products) {
      expect(Object.keys(product).sort()).toEqual(["nameEn", "nameTh", "stoneCode"]);
      const serialized = JSON.stringify(product);
      expect(serialized).not.toMatch(/฿|price|cost|margin/i);
    }
  });

  it("disclaimer ตรงกับ GEM_QUIZ_DISCLAIMER", () => {
    const result = buildResultView(input);
    expect(result.disclaimer).toBe(GEM_QUIZ_DISCLAIMER);
  });
});

describe("buildResultView — focusStoneCode สลับ hero ไปยังพลอยทางเลือก", () => {
  const input = {
    answers: { birthDay: "sun", intention: "career", feeling: "energy", jewelryType: "ring" },
    likedStoneCodes: ["garnet", "citrine", "amethyst"],
    focusStoneCode: "citrine",
  };

  it("focus = citrine (อยู่ใน top3 แต่ไม่ใช่ rank1) ⇒ isAlternative=true, heroA='ANOTHER GEM'", () => {
    const result = buildResultView(input);
    expect(result.hero.stoneCode).toBe("citrine");
    expect(result.hero.isAlternative).toBe(true);
    expect(result.hero.heroA).toBe("ANOTHER GEM");
  });

  it("prefNote กรณี 2: fav อยู่ใน top3 แต่ไม่ใช่ pid ('...ก็เป็นหนึ่งในตัวเลือกที่เหมาะกับคุณเช่นกัน')", () => {
    const result = buildResultView(input);
    expect(result.hero.prefNote).toBe(
      "คุณชอบ Garnet เป็นพิเศษ และวันนี้ Garnet ก็เป็นหนึ่งในตัวเลือกที่เหมาะกับคุณเช่นกัน"
    );
  });

  it("alternatives ตอน focus=citrine: others=[garnet,blue_topaz], garnet เป็น rank1 ของจริง ⇒ label 'พลอยแนะนำอันดับ 1'", () => {
    const result = buildResultView(input);
    const garnetAlt = result.alternatives.find((a) => a.stoneCode === "garnet");
    expect(garnetAlt?.label).toBe("พลอยแนะนำอันดับ 1");
  });

  it("focusStoneCode ที่ไม่อยู่ใน top3 ⇒ ถูกเมิน ใช้ rank1 แทน (เหมือนไม่ส่ง focus มา)", () => {
    const withBadFocus = buildResultView({ ...input, focusStoneCode: "peridot" });
    const withoutFocus = buildResultView({ answers: input.answers, likedStoneCodes: input.likedStoneCodes });
    expect(withBadFocus.hero.stoneCode).toBe(withoutFocus.hero.stoneCode);
    expect(withBadFocus.hero.isAlternative).toBe(false);
  });
});

describe("buildResultView — prefNote กรณี 3: fav ไม่อยู่ใน top3 เลย", () => {
  // คำนวณด้วยมือไว้ก่อน (เทียบกับ oracle ใน recommend.test.ts แล้ว): day=mon
  // (amethyst3,blue_topaz2) + intention=career (primary garnet,citrine / secondary
  // blue_topaz) + feeling=clarity (match amethyst,blue_topaz) + liked=[peridot]
  // (pref 6 แต้มให้ peridot เท่านั้น) ⇒ totals: blue_topaz=2+5+7=14,
  // amethyst=3+0+7=10, garnet=0+8+0=8 (ชนะ citrine ด้วย gemOrder), citrine=8,
  // peridot=6 ⇒ top3=[blue_topaz,amethyst,garnet], peridot (fav) ไม่ติด top3
  const input = {
    answers: { birthDay: "mon", intention: "career", feeling: "clarity", jewelryType: "necklace" },
    likedStoneCodes: ["peridot"],
  };

  it("top3 ไม่มี peridot ⇒ hero เป็น blue_topaz (rank1 จริง)", () => {
    const result = buildResultView(input);
    expect(result.hero.stoneCode).toBe("blue_topaz");
    expect(result.hero.isAlternative).toBe(false);
  });

  it("prefNote: 'คุณชอบ Peridot เป็นพิเศษ — สามารถใส่คู่กับ Blue Topaz ได้ตามสไตล์ที่คุณชอบ'", () => {
    const result = buildResultView(input);
    expect(result.hero.prefNote).toBe("คุณชอบ Peridot เป็นพิเศษ — สามารถใส่คู่กับ Blue Topaz ได้ตามสไตล์ที่คุณชอบ");
  });

  it("how-to-wear necklace: place = GEM_QUIZ_OTHER_PLACEMENT.necklace, hand = ข้อความความยาว", () => {
    const result = buildResultView(input);
    expect(result.howToWear.place).toBe("สร้อยระดับอก ให้พลอยอยู่กลางลุค");
    expect(result.howToWear.hand).toBe("เลือกความยาวและขนาดที่ใส่สบายตลอดวัน");
  });
});

describe("buildResultView — jewelry_type = unknown ⇒ resolve ผ่าน GEM_QUIZ_DEFAULT_JEWELRY", () => {
  it("garnet default = ring ⇒ note = '3J เลือกให้ตามพลอย', place = นิ้วชี้", () => {
    const result = buildResultView({
      answers: { birthDay: "sun", intention: "career", feeling: "energy", jewelryType: "unknown" },
      likedStoneCodes: ["garnet"],
    });
    expect(result.hero.stoneCode).toBe("garnet");
    expect(result.howToWear.note).toBe("3J เลือกให้ตามพลอย");
    expect(result.howToWear.place).toBe("แหวนที่นิ้วชี้");
  });

  it("blue_topaz default = necklace (ตัวเดียวใน 5 พลอยที่ default ไม่ใช่ ring)", () => {
    // บังคับให้ blue_topaz ชนะด้วยวันเกิด+preference ตรง — ไม่ต้องสนใจ intention/feeling
    const result = buildResultView({
      answers: { birthDay: "wed", intention: "calm", feeling: "calm", jewelryType: "unknown" },
      likedStoneCodes: ["blue_topaz"],
    });
    expect(result.hero.stoneCode).toBe("blue_topaz");
    expect(result.howToWear.place).toBe("สร้อยระดับอก ให้พลอยอยู่กลางลุค");
  });
});
