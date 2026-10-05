// lib/gem-quiz/validate.test.ts — ครอบเคส R-6/R-7/R-8/R-13 ของ design doc §5.5
// และ N-8 ของ §5.6 (v2: liked บังคับ 1-3, answers ต้องครบ 4 key)
import { describe, expect, it } from "vitest";
import { validateGemQuizBody } from "./validate";
import { QUIZ_VERSION } from "./config";

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: QUIZ_VERSION,
    src: "card",
    token: "irrelevant-here",
    hp: "",
    liked: ["garnet", "citrine"],
    answers: { birth_day: "sun", intention: "career", feeling: "energy", jewelry_type: "ring" },
    retake: false,
    ...overrides,
  };
}

describe("validateGemQuizBody — happy path", () => {
  it("body ที่ถูกต้องครบ ⇒ ok:true พร้อม typed data", () => {
    const result = validateGemQuizBody(baseBody());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        quizVersion: QUIZ_VERSION,
        src: "card",
        likedStoneCodes: ["garnet", "citrine"],
        answers: { birth_day: "sun", intention: "career", feeling: "energy", jewelry_type: "ring" },
        isRetake: false,
      });
    }
  });

  it("liked มีแค่ 1 ตัว (ขั้นต่ำ MIN_LIKED_STONES) ⇒ ok", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["garnet"] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.likedStoneCodes).toEqual(["garnet"]);
  });

  it("liked มีครบ 3 ตัว (ขั้นสูงสุด MAX_LIKED_STONES) ⇒ ok", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["garnet", "citrine", "amethyst"] }));
    expect(result.ok).toBe(true);
  });

  it("retake:true ⇒ isRetake:true", () => {
    const result = validateGemQuizBody(baseBody({ retake: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.isRetake).toBe(true);
  });

  it("retake ไม่ส่งมาเลย ⇒ isRetake:false (default)", () => {
    const body = baseBody();
    delete body.retake;
    const result = validateGemQuizBody(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.isRetake).toBe(false);
  });

  it("retake เป็น string 'true' (ไม่ใช่ boolean จริง) ⇒ ถือเป็น false", () => {
    const result = validateGemQuizBody(baseBody({ retake: "true" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.isRetake).toBe(false);
  });
});

describe("validateGemQuizBody — body shape ทั่วไป", () => {
  it.each([null, undefined, "a string", 123, true, [1, 2, 3]])("body = %p ⇒ invalid", (bad) => {
    const result = validateGemQuizBody(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid");
  });
});

describe("validateGemQuizBody — R-13: quiz_version mismatch", () => {
  it("v ไม่ตรงกับ QUIZ_VERSION ปัจจุบัน ⇒ kind:version_mismatch (ไม่ใช่ invalid)", () => {
    const result = validateGemQuizBody(baseBody({ v: QUIZ_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("version_mismatch");
  });

  it.each([0, -1, 1.5, "1", null, undefined, 101])("v = %p (ผิดรูปแบบ ไม่ใช่แค่เลขเวอร์ชันผิด) ⇒ kind:invalid", (badV) => {
    const result = validateGemQuizBody(baseBody({ v: badV }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid");
  });
});

describe("validateGemQuizBody — N-8: src แปลก coerce เป็น direct ไม่ reject", () => {
  it.each(["not_a_real_src", "", 123, null, undefined, ["card"]])("src = %p ⇒ ok, coerced to 'direct'", (badSrc) => {
    const result = validateGemQuizBody(baseBody({ src: badSrc }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.src).toBe("direct");
  });

  it.each(["card", "share", "live", "direct"])("src = %p (ถูกต้องอยู่แล้ว) ⇒ ไม่ถูก coerce ทับ", (goodSrc) => {
    const result = validateGemQuizBody(baseBody({ src: goodSrc }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.src).toBe(goodSrc);
  });
});

describe("validateGemQuizBody — R-6: liked (v2: บังคับ 1-3, ไม่มี 'ยังไม่มีในใจ' อีกแล้ว)", () => {
  it("liked ไม่ใช่ array ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: "garnet" }));
    expect(result.ok).toBe(false);
  });

  it("liked ว่างเปล่า ⇒ invalid (v2 กลับมติ — v1 เดิมเคยอนุญาต)", () => {
    const result = validateGemQuizBody(baseBody({ liked: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid");
  });

  it("liked เกิน 3 ตัว ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["garnet", "citrine", "amethyst", "peridot"] }));
    expect(result.ok).toBe(false);
  });

  it("liked มีรหัสที่ไม่มีจริงใน config (เช่นพลอยที่ปิดแล้วใน v2: ruby) ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["ruby"] }));
    expect(result.ok).toBe(false);
  });

  it("liked มีรหัสที่ไม่มีจริงใน config เลย ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["not_a_real_stone"] }));
    expect(result.ok).toBe(false);
  });

  it("liked มีรหัสซ้ำ ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["garnet", "garnet"] }));
    expect(result.ok).toBe(false);
  });

  it("liked มี null element ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: ["garnet", null] }));
    expect(result.ok).toBe(false);
  });

  it("liked มี element ที่ไม่ใช่ string (number) ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ liked: [123] }));
    expect(result.ok).toBe(false);
  });
});

describe("validateGemQuizBody — R-7: answers (v2: 4 key บังคับ birth_day/intention/feeling/jewelry_type)", () => {
  it("answers ไม่ใช่ object (เป็น array) ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ answers: ["sun"] }));
    expect(result.ok).toBe(false);
  });

  it("answers ไม่ใช่ object (เป็น string) ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ answers: "sun" }));
    expect(result.ok).toBe(false);
  });

  it("answers ว่างเปล่า ⇒ invalid (v2 บังคับครบ 4 key — v1 เดิมยอมว่างได้)", () => {
    const result = validateGemQuizBody(baseBody({ answers: {} }));
    expect(result.ok).toBe(false);
  });

  it.each(["birth_day", "intention", "feeling", "jewelry_type"])("ขาดคำถาม %s ⇒ invalid", (missingKey) => {
    const answers: Record<string, string> = {
      birth_day: "sun",
      intention: "career",
      feeling: "energy",
      jewelry_type: "ring",
    };
    delete answers[missingKey];
    const result = validateGemQuizBody(baseBody({ answers }));
    expect(result.ok).toBe(false);
  });

  it("answers มี key ที่ config เวอร์ชันนี้ไม่มี ⇒ invalid", () => {
    const result = validateGemQuizBody(baseBody({ answers: { ...baseBody().answers as object, not_a_real_question: "x" } }));
    expect(result.ok).toBe(false);
  });

  it("answers.value ไม่อยู่ใน option ของคำถามนั้น ⇒ invalid", () => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: "not_a_real_option", feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers.value เป็นข้อความไทย ⇒ invalid (หลุด regex)", () => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: "อยากได้ความรัก", feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers.value เป็นเบอร์โทร (ตัวเลข+ขีด) ⇒ invalid (หลุด regex หรือไม่อยู่ใน whitelist)", () => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: "081-234-5678", feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers.value เป็น array ⇒ invalid", () => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: ["career"], feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers.value เป็น number ⇒ invalid", () => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: 1, feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers.value เป็น null ⇒ invalid", () => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: null, feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers มีมากกว่า 5 key ⇒ invalid (ชนด่าน MAX_ANSWER_KEYS ก่อนด่านอื่น)", () => {
    const result = validateGemQuizBody(
      baseBody({
        answers: {
          birth_day: "sun",
          intention: "career",
          feeling: "energy",
          jewelry_type: "ring",
          extra_a: "x",
          extra_b: "x",
        },
      })
    );
    expect(result.ok).toBe(false);
  });

  it("answers key มีตัวพิมพ์ใหญ่ ⇒ invalid (หลุด regex ซึ่งบังคับ a-z เท่านั้น)", () => {
    const result = validateGemQuizBody(baseBody({ answers: { Birth_day: "sun" } }));
    expect(result.ok).toBe(false);
  });
});

describe("validateGemQuizBody — QA เพิ่ม: unicode lookalike ใน answers.value (ASCII-only regex ต้องกันได้จริง ไม่ใช่แค่ภาษาไทยปกติ)", () => {
  it.each([
    ["cyrillic homoglyph (а ไม่ใช่ a ละติน)", "саreer"],
    ["fullwidth latin", "ｃａｒｅｅｒ"],
    ["zero-width space แอบแทรกกลางคำ", "car​eer"],
    ["เลขไทย ๑๒๓ (ไม่ใช่เลขอารบิก)", "๑๒๓"],
    ["combining diacritic", "careeŕ"],
    ["RTL override character", "career‮"],
    ["fullwidth digit (NFKC จะกลายเป็น 1 แต่เราไม่ normalize)", "１"],
  ])("answers.value = %s ⇒ invalid (หลุด ASCII-only regex แน่นอน ไม่ว่าจะ normalize หรือไม่)", (_label, value) => {
    const result = validateGemQuizBody(
      baseBody({ answers: { birth_day: "sun", intention: value, feeling: "energy", jewelry_type: "ring" } })
    );
    expect(result.ok).toBe(false);
  });

  it("answers key เป็น unicode lookalike (เช่น cyrillic 'i') ⇒ invalid เช่นกัน", () => {
    const result = validateGemQuizBody(baseBody({ answers: { ["іntention"]: "career" } }));
    expect(result.ok).toBe(false);
  });
});

describe("validateGemQuizBody — R-8: ฟิลด์เกินสัญญาถูกทิ้งเงียบๆ ไม่มีผล", () => {
  it("shop_id/recommended/created_at ที่ client แอบส่งมาไม่ปรากฏใน output เลย", () => {
    const result = validateGemQuizBody(
      baseBody({
        shop_id: "11111111-1111-1111-1111-111111111111",
        recommended: ["ruby"],
        created_at: "2020-01-01T00:00:00Z",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toHaveProperty("shop_id");
      expect(result.data).not.toHaveProperty("recommended");
      expect(result.data).not.toHaveProperty("created_at");
      expect(Object.keys(result.data).sort()).toEqual(["answers", "isRetake", "likedStoneCodes", "quizVersion", "src"]);
    }
  });
});
