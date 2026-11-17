// X1 + X2 + Y1/Y2: parser ของ 5 key (g · t · i · c · d) · ลิงก์จากหน้าผล quiz · buildShowcaseUrl · อ่าน key เดียว
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_QUESTIONS, GEM_QUIZ_STONE_CODES, type GemQuizIntention } from "@/lib/gem-quiz/config";
import {
  EMPTY_SHOWCASE_PARAMS,
  INTENTION_CODES,
  STONE_LETTER,
  buildShowcaseHref,
  buildShowcaseUrl,
  parseDesignParam,
  parseGemParam,
  parseIntentionParam,
  parseOwnParam,
  parseTableParam,
  readShowcaseParams,
  type GemTop3,
  type IntentionTable,
} from "./quiz-link";

const TABLE_RAW = "gac.acp.cpb.bgc.pab.gpa";
function table(): IntentionTable {
  const t = parseTableParam(TABLE_RAW);
  if (!t) throw new Error("fixture table ต้อง parse ได้");
  return t;
}

describe("parseGemParam (g — ลิงก์ D1 เดิม) — ค่าที่ถูกต้อง", () => {
  it("3 รหัสไม่ซ้ำใน 5 พลอย → top3 ตามลำดับ", () => {
    expect(parseGemParam("citrine.garnet.peridot")).toEqual(["citrine", "garnet", "peridot"]);
    expect(parseGemParam("blue_topaz.amethyst.garnet")).toEqual(["blue_topaz", "amethyst", "garnet"]);
  });
  it("ทุกการเรียง 3 จาก 5 (60 แบบ) ผ่านและกลับค่าเดิม", () => {
    let n = 0;
    for (const a of GEM_QUIZ_STONE_CODES)
      for (const b of GEM_QUIZ_STONE_CODES)
        for (const c of GEM_QUIZ_STONE_CODES) {
          if (a === b || b === c || a === c) continue;
          n++;
          expect(parseGemParam(`${a}.${b}.${c}`)).toEqual([a, b, c]);
        }
    expect(n).toBe(60);
  });
});

describe("X1: g ผิดรูป → null ไม่throw (ตกโหมดเข้าตรง)", () => {
  const bad: [string, unknown][] = [
    ["รหัสนอก 5 พลอย", "ruby.garnet.citrine"],
    ["รหัสพลอยเก่า v1", "diamond.garnet.citrine"],
    ["constructor", "constructor.garnet.citrine"],
    ["__proto__", "__proto__.garnet.citrine"],
    ["toString", "toString.garnet.citrine"],
    ["hasOwnProperty", "garnet.hasOwnProperty.citrine"],
    ["ซ้ำ", "garnet.garnet.citrine"],
    ["ซ้ำตัวท้าย", "garnet.citrine.garnet"],
    ["ไม่ครบ (2)", "garnet.citrine"],
    ["ไม่ครบ (1)", "garnet"],
    ["เกิน 3", "garnet.citrine.peridot.amethyst"],
    ["ว่าง", ""],
    ["ตัวคั่นผิด", "garnet,citrine,peridot"],
    ["จุดซ้อน", "garnet..citrine"],
    ["ตัวพิมพ์ใหญ่", "Garnet.Citrine.Peridot"],
    ["ช่องว่าง", "garnet. citrine.peridot"],
    ["ยาวเกิน 64", "a".repeat(65)],
    ["ยาวเกิน 64 แต่ขึ้นต้นถูก", "garnet.citrine.peridot" + "x".repeat(60)],
    ["HTML", "<script>alert(1)</script>.garnet.citrine"],
    ["HTML ในรหัส", "garnet.citrine.<b>peridot</b>"],
    ["array", ["garnet.citrine.peridot"]],
    ["array หลายตัว", ["garnet", "citrine", "peridot"]],
    ["undefined", undefined],
    ["null", null],
    ["number", 123],
    ["object", { toString: () => "garnet.citrine.peridot" }],
  ];
  for (const [name, raw] of bad) {
    it(`${name} → null`, () => {
      expect(() => parseGemParam(raw)).not.toThrow();
      expect(parseGemParam(raw)).toBeNull();
    });
  }
  it("ยาว 64 พอดีแต่ผิด ก็ null · ไม่ใช่ error", () => {
    expect(parseGemParam("g".repeat(64))).toBeNull();
  });
});

describe("รหัส/ลำดับ: INTENTION_CODES = ลำดับตัวเลือกใน GEM_QUIZ_QUESTIONS · STONE_LETTER ครบ 5 ชนิดไม่ซ้ำ", () => {
  it("ลำดับ intention ตรงกับ quiz", () => {
    const q = GEM_QUIZ_QUESTIONS.find((x) => x.code === "intention");
    expect(q?.options.map((o) => o.code)).toEqual([...INTENTION_CODES]);
  });
  it("ตัวอักษรพลอยเป็น gacpb ครบ 5 ชนิดไม่ซ้ำ ตรงตามสัญญา", () => {
    expect(Object.keys(STONE_LETTER).sort()).toEqual([...GEM_QUIZ_STONE_CODES].sort());
    expect(new Set(Object.values(STONE_LETTER)).size).toBe(5);
    expect(STONE_LETTER).toEqual({ garnet: "g", amethyst: "a", citrine: "c", peridot: "p", blue_topaz: "b" });
  });
});

describe("Y1: t (ตารางอันดับ 6 เรื่อง)", () => {
  it("ถูกต้อง → 6 เรื่องตามลำดับ INTENTION_CODES", () => {
    const t = table();
    expect(Object.keys(t)).toEqual([...INTENTION_CODES]);
    expect(t.love).toEqual(["garnet", "amethyst", "citrine"]);
    expect(t.wealth).toEqual(["amethyst", "citrine", "peridot"]);
    expect(t.career).toEqual(["citrine", "peridot", "blue_topaz"]);
    expect(t.confidence).toEqual(["blue_topaz", "garnet", "citrine"]);
    expect(t.calm).toEqual(["peridot", "amethyst", "blue_topaz"]);
    expect(t.renewal).toEqual(["garnet", "peridot", "amethyst"]);
  });
  const bad: [string, unknown][] = [
    ["ตัวอักษรนอก gacpb", "gac.acp.cpb.bgc.pab.gpx"],
    ["กลุ่มไม่ครบ 6", "gac.acp.cpb.bgc.pab"],
    ["กลุ่มเกิน 6", `${TABLE_RAW}.gac`],
    ["ซ้ำในกลุ่ม", "gac.acp.cpb.bgc.pab.gpp"],
    ["ซ้ำทั้งกลุ่ม", "ggg.acp.cpb.bgc.pab.gpa"],
    ["กลุ่มสั้น", "ga.acp.cpb.bgc.pab.gpa"],
    ["กลุ่มยาว", "gacp.acp.cpb.bgc.pab.gpa"],
    ["ตัวคั่นผิด", "gac,acp,cpb,bgc,pab,gpa"],
    ["ตัวพิมพ์ใหญ่", "GAC.acp.cpb.bgc.pab.gpa"],
    ["constructor", "constructor"],
    ["__proto__", "__proto__"],
    ["HTML", "<script>alert(1)</script>"],
    ["ยาวเกิน", "g".repeat(65)],
    ["ขึ้นบรรทัดใหม่ท้าย", `${TABLE_RAW}\n`],
    ["ว่าง", ""],
    ["array", [TABLE_RAW]],
    ["array หลายตัว", [TABLE_RAW, TABLE_RAW]],
    ["undefined", undefined],
    ["null", null],
    ["number", 1],
    ["object", { toString: () => TABLE_RAW }],
  ];
  for (const [name, raw] of bad) {
    it(`${name} → null ไม่ throw`, () => {
      expect(() => parseTableParam(raw)).not.toThrow();
      expect(parseTableParam(raw)).toBeNull();
    });
  }
});

describe("Y1: i / c / d ผิดรูป → null ไม่ throw", () => {
  it("i: รับแค่ 6 รหัส", () => {
    for (const code of INTENTION_CODES) expect(parseIntentionParam(code)).toBe(code);
    for (const raw of ["Love", "love ", "constructor", "__proto__", "toString", "<b>", "", ["love"], undefined, null, 1, "love".repeat(30)]) {
      expect(() => parseIntentionParam(raw)).not.toThrow();
      expect(parseIntentionParam(raw)).toBeNull();
    }
  });
  it("c: <บน>.<ล่าง> 25 แบบผ่านหมด (ซ้ำกันได้)", () => {
    let n = 0;
    for (const a of GEM_QUIZ_STONE_CODES)
      for (const b of GEM_QUIZ_STONE_CODES) {
        n++;
        expect(parseOwnParam(`${a}.${b}`)).toEqual({ top: a, bottom: b });
      }
    expect(n).toBe(25);
  });
  it("Y2: c เม็ดเดียว/3 เม็ด/CZ/ชนิดนอก 5/ผิดรูป = null", () => {
    const bad: unknown[] = [
      "garnet",
      "garnet.citrine.peridot",
      "cz.garnet",
      "garnet.cz",
      "cz_white.cz_white",
      "ruby.garnet",
      "garnet.diamond",
      "constructor.garnet",
      "garnet.__proto__",
      "garnet..citrine",
      ".garnet",
      "garnet.",
      "Garnet.Citrine",
      "garnet.citrine ",
      "<b>.garnet",
      "garnet.citrine".repeat(10),
      "",
      ["garnet.citrine"],
      undefined,
      null,
      7,
    ];
    for (const raw of bad) {
      expect(() => parseOwnParam(raw)).not.toThrow();
      expect(parseOwnParam(raw)).toBeNull();
    }
  });
  it("d: 1/2/3/own เท่านั้น", () => {
    expect(parseDesignParam("1")).toBe(1);
    expect(parseDesignParam("2")).toBe(2);
    expect(parseDesignParam("3")).toBe(3);
    expect(parseDesignParam("own")).toBe("own");
    for (const raw of ["0", "4", "01", "OWN", "own ", "constructor", "", ["1"], undefined, null, 1, "<b>"]) {
      expect(parseDesignParam(raw)).toBeNull();
    }
  });
});

describe("readShowcaseParams — 5 key · แต่ละ key ตัดสินแยกกัน", () => {
  it("t ใช้ได้เมื่อ i ผ่านด้วย · ไม่งั้นทิ้ง (แต่ไม่ทำให้ key อื่นพัง)", () => {
    expect(readShowcaseParams({ t: TABLE_RAW, i: "love" })).toMatchObject({ table: table(), intention: "love" });
    expect(readShowcaseParams({ t: TABLE_RAW })).toEqual(EMPTY_SHOWCASE_PARAMS);
    expect(readShowcaseParams({ t: TABLE_RAW, i: "nope", g: "garnet.citrine.peridot" })).toEqual({
      ...EMPTY_SHOWCASE_PARAMS,
      top3: ["garnet", "citrine", "peridot"],
    });
  });
  it("t เสียแต่ i ดี → intention เดี่ยว (table null)", () => {
    expect(readShowcaseParams({ t: "bad", i: "calm" })).toEqual({ ...EMPTY_SHOWCASE_PARAMS, intention: "calm" });
  });
  it("ลิงก์ D1 เดิม ?g=a.b.c ยังเปิดได้", () => {
    expect(readShowcaseParams({ g: "garnet.citrine.peridot" })).toEqual({ ...EMPTY_SHOWCASE_PARAMS, top3: ["garnet", "citrine", "peridot"] });
  });
  it("c / d อ่านเป็นอิสระ", () => {
    expect(readShowcaseParams({ c: "citrine.amethyst", d: "own" })).toEqual({ ...EMPTY_SHOWCASE_PARAMS, own: { top: "citrine", bottom: "amethyst" }, design: "own" });
    expect(readShowcaseParams({ c: "x.y", d: "3" })).toEqual({ ...EMPTY_SHOWCASE_PARAMS, design: 3 });
  });
});

describe("X2: อ่านเฉพาะ 5 key (g t i c d)", () => {
  it("?price= ?size= ?design= ?src= ไม่มีผลต่อผลลัพธ์", () => {
    const base = readShowcaseParams({ g: "garnet.citrine.peridot" });
    const noisy = readShowcaseParams({ g: "garnet.citrine.peridot", price: "1", size: "99", design: "9", src: "x", PRICE: "1" });
    expect(noisy).toEqual(base);
    expect(readShowcaseParams({ price: "1", size: "99", design: "9" })).toEqual(EMPTY_SHOWCASE_PARAMS);
  });
  it("แตะ searchParams เฉพาะ 5 key (ตรวจด้วย Proxy)", () => {
    const touched: (string | symbol)[] = [];
    const proxy = new Proxy({ g: "garnet.citrine.peridot", price: "1", size: "2", design: "3" } as Record<string, unknown>, {
      get(t, k) {
        touched.push(k);
        return t[k as string];
      },
    });
    readShowcaseParams(proxy);
    expect([...touched].sort()).toEqual(["c", "d", "g", "i", "t"]);
  });
});

describe("buildShowcaseHref (CTA ของ quiz) / buildShowcaseUrl (เขียน URL กลับ)", () => {
  it("CTA = ?t=<ตาราง>&i=<เรื่อง> เลิกส่ง g · parse กลับได้ครบ", () => {
    const href = buildShowcaseHref({ intention: "career", table: table() });
    expect(href).toBe(`/ring-builder?t=${TABLE_RAW}&i=career`);
    expect(href).not.toContain("g=");
    const sp = new URL(href, "https://x.test").searchParams;
    expect(readShowcaseParams(Object.fromEntries(sp))).toMatchObject({ table: table(), intention: "career" });
  });
  it("ความยาว t ไม่เกินเพดาน (23 ≤ 64) — parser ไม่ปฏิเสธลิงก์ที่ระบบสร้างเอง", () => {
    expect(TABLE_RAW.length).toBeLessThanOrEqual(64);
    const longestG = [...GEM_QUIZ_STONE_CODES].sort((a, b) => b.length - a.length).slice(0, 3);
    expect(parseGemParam(longestG.join("."))).not.toBeNull();
  });
  const base = { table: null, intention: null, legacyTop3: null, own: null, active: "rec", recIndex: 1 } as const;
  it("ไม่มีอะไรเลย = path เปล่า", () => {
    expect(buildShowcaseUrl(base)).toBe("/ring-builder");
  });
  it("ลำดับ key t,i,(g),c,d · d=1 ไม่ถูกเขียน · own เขียน d=own", () => {
    expect(buildShowcaseUrl({ ...base, table: table(), intention: "love", recIndex: 2 })).toBe(`/ring-builder?t=${TABLE_RAW}&i=love&d=2`);
    expect(buildShowcaseUrl({ ...base, legacyTop3: ["garnet", "citrine", "peridot"] as GemTop3 })).toBe("/ring-builder?g=garnet.citrine.peridot");
    expect(buildShowcaseUrl({ ...base, own: { top: "garnet", bottom: "garnet" }, active: "own" })).toBe("/ring-builder?c=garnet.garnet&d=own");
    expect(buildShowcaseUrl({ ...base, intention: "calm", own: { top: "citrine", bottom: "amethyst" } })).toBe("/ring-builder?i=calm&c=citrine.amethyst");
  });
  it("เลือกเรื่องแล้ว g ถูกถอด · ไม่มี table = เหลือแค่ i", () => {
    expect(buildShowcaseUrl({ ...base, intention: "wealth", legacyTop3: ["garnet", "citrine", "peridot"] as GemTop3 })).toBe("/ring-builder?i=wealth");
  });
  it("round-trip: URL ที่เขียน → อ่านกลับได้ state เดิม (ทุกเรื่อง × ทุก d)", () => {
    for (const intention of INTENTION_CODES) {
      for (const recIndex of [1, 2, 3] as const) {
        const url = buildShowcaseUrl({ ...base, table: table(), intention, recIndex, own: { top: "peridot", bottom: "blue_topaz" } });
        const parsed = readShowcaseParams(Object.fromEntries(new URL(url, "https://x.test").searchParams));
        expect(parsed.intention).toBe(intention);
        expect(parsed.table).toEqual(table());
        expect(parsed.own).toEqual({ top: "peridot", bottom: "blue_topaz" });
        expect(parsed.design).toBe(recIndex === 1 ? null : recIndex);
      }
    }
  });
  it("ค่าที่ไม่ผ่านการตรวจ (ปนมาจากภายนอก type system) ไม่ถูกเขียนลง URL", () => {
    const evil = buildShowcaseUrl({
      ...base,
      table: { love: ["garnet", "garnet", "garnet"] } as unknown as IntentionTable,
      intention: "love",
      own: { top: "<b>", bottom: "garnet" } as never,
      legacyTop3: ["x", "y", "z"] as never,
    });
    expect(evil).toBe("/ring-builder?i=love");
    expect(buildShowcaseUrl({ ...base, intention: "constructor" as GemQuizIntention })).toBe("/ring-builder");
    expect(buildShowcaseUrl({ ...base, legacyTop3: ["garnet", "garnet", "citrine"] as never })).toBe("/ring-builder");
  });
});
