// QA (R2-D2) D1.1 — param ผสมกัน · ค่าขยะทุก key พร้อมกัน · URL ที่หน้าเขียนเองต้อง parse กลับได้เท่าเดิมและมีแต่ตัวอักษร whitelist
// เสริมจาก quiz-link.test.ts / line-message.test.ts (ไม่ซ้ำเคสเดิม)
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { getShowcaseDesign } from "./designs";
import { buildShowcaseLineHref, buildShowcaseLineMessage, type ShowcaseChoice } from "./line-message";
import {
  INTENTION_CODES,
  buildShowcaseUrl,
  parseTableParam,
  readShowcaseParams,
  type GemTop3,
  type IntentionTable,
  type OwnGems,
} from "./quiz-link";

const GOOD_T = "gac.acp.cpb.bgc.pab.gpa";
const GOOD_G = "garnet.citrine.peridot";
const HUGE = "x".repeat(10_000);

describe("readShowcaseParams — param ผสมกัน", () => {
  it("g + t พร้อมกัน: อ่านได้ทั้งคู่ (หน้าเลือกใช้ t เมื่อมี i · ไม่มี i ใช้ g) — ไม่ throw", () => {
    const withI = readShowcaseParams({ g: GOOD_G, t: GOOD_T, i: "love" });
    expect(withI.top3).toEqual(["garnet", "citrine", "peridot"]);
    expect(withI.table).not.toBeNull();
    expect(withI.intention).toBe("love");
    const noI = readShowcaseParams({ g: GOOD_G, t: GOOD_T });
    expect(noI.table).toBeNull(); // t ไม่มี i = ทิ้ง
    expect(noI.top3).not.toBeNull(); // g ยังใช้ได้
  });
  it("t ดีแต่ i เสีย → table ถูกทิ้ง (ไม่ใช้ตารางโดยไม่รู้เรื่อง)", () => {
    for (const i of ["", "LOVE", "love ", "constructor", "__proto__", ["love"], ["love", "calm"], HUGE, undefined, null, 1, {}]) {
      const p = readShowcaseParams({ t: GOOD_T, i });
      expect(p.intention, String(i).slice(0, 20)).toBeNull();
      expect(p.table).toBeNull();
    }
  });
  it("t เสียแต่ i ดี → intention เดี่ยว · key อื่นไม่ถูกลากไปด้วย", () => {
    for (const t of ["gac", "gac.acp.cpb.bgc.pab", "gaa.acp.cpb.bgc.pab.gpa", "gac.acp.cpb.bgc.pab.gpa.", "gac.acp.cpb.bgc.pab.gpa\n", HUGE, [GOOD_T], [GOOD_T, GOOD_T]]) {
      const p = readShowcaseParams({ t, i: "calm", c: "garnet.citrine", d: "2" });
      expect(p.intention).toBe("calm");
      expect(p.table).toBeNull();
      expect(p.own).toEqual({ top: "garnet", bottom: "citrine" });
      expect(p.design).toBe(2);
    }
  });
  it("c ดีแต่ d ไม่ใช่ own → own ยังอ่านได้ · design เป็นเลขหรือ null ตามที่ให้", () => {
    for (const d of ["1", "2", "3", "9", "", "OWN", ["own"], undefined]) {
      const p = readShowcaseParams({ c: "peridot.amethyst", d });
      expect(p.own).toEqual({ top: "peridot", bottom: "amethyst" });
      expect(p.design === "own").toBe(false);
    }
  });
  it("d=own ไม่มี c → design=own แต่ own=null (หน้าต้องตกแบบแนะนำ)", () => {
    const p = readShowcaseParams({ d: "own" });
    expect(p.design).toBe("own");
    expect(p.own).toBeNull();
  });
  it("key ซ้ำ (Next ส่งเป็น array) ทุก key → null ไม่ throw", () => {
    const p = readShowcaseParams({ g: [GOOD_G, GOOD_G], t: [GOOD_T], i: ["love", "love"], c: ["garnet.citrine", "garnet.citrine"], d: ["1", "1"] });
    expect(p.top3).toBeNull();
    expect(p.table).toBeNull();
    expect(p.intention).toBeNull();
    expect(p.own).toBeNull();
    expect(p.design).toBeNull();
  });
  it("ค่ายาว 10k ทุก key พร้อมกัน → ไม่ throw · ทุก key null · ผลลัพธ์ไม่มีสตริงดิบ", () => {
    const p = readShowcaseParams({ g: HUGE, t: HUGE, i: HUGE, q: HUGE, c: HUGE, d: HUGE, r: HUGE });
    expect(p).toEqual({ top3: null, table: null, intention: null, answered: null, own: null, ownSlots: null, design: null, ring: "bypass2" });
    expect(JSON.stringify(p)).not.toContain("xxx");
  });
  it("key เป็นชื่อ prototype ใน searchParams ไม่ทำให้ใครอ่านผิด (constructor/__proto__/toString)", () => {
    const sp = JSON.parse('{"__proto__":"garnet.citrine.peridot","constructor":"x","toString":"y","i":"love"}') as Record<string, unknown>;
    const p = readShowcaseParams(sp);
    expect(p.intention).toBe("love");
    expect(p.top3).toBeNull();
    expect(() => readShowcaseParams(Object.create(null))).not.toThrow();
  });
  it("ค่าที่ไม่ใช่ string (object/number/boolean/function/symbol) ไม่ throw", () => {
    for (const v of [{}, [], 0, 1, true, false, () => 1, Symbol("x"), NaN, 10n]) {
      expect(() => readShowcaseParams({ g: v, t: v, i: v, c: v, d: v })).not.toThrow();
    }
  });
  it("t: ตัวอักษรหลอกตา (fullwidth / Thai / emoji / NUL / newline กลาง) ไม่ผ่าน", () => {
    for (const t of ["ｇａｃ.acp.cpb.bgc.pab.gpa", "กขค.acp.cpb.bgc.pab.gpa", "😀😀😀.acp.cpb.bgc.pab.gpa", "gac\0.acp.cpb.bgc.pab.gpa", "gac.acp.cpb\n.bgc.pab.gpa", "GAC.ACP.CPB.BGC.PAB.GPA"]) {
      expect(parseTableParam(t)).toBeNull();
    }
  });
});

describe("buildShowcaseUrl — URL ที่หน้าเขียนเองต้องปลอดภัยและอ่านกลับได้", () => {
  const table = parseTableParam(GOOD_T) as IntentionTable;
  const owns: (OwnGems | null)[] = [null];
  for (const a of GEM_QUIZ_STONE_CODES) for (const b of GEM_QUIZ_STONE_CODES) owns.push({ top: a, bottom: b });

  it("ทุกชุด: 6 เรื่อง × (มี/ไม่มี t) × 26 own × active × 3 recIndex → ตัวอักษร [a-z0-9_.=&?/-] เท่านั้น · parse กลับได้ state เดิม", () => {
    let n = 0;
    for (const intention of INTENTION_CODES) {
      for (const withTable of [true, false]) {
        for (const own of owns) {
          for (const active of ["rec", "own"] as const) {
            for (const recIndex of [1, 2, 3] as const) {
              const url = buildShowcaseUrl({ table: withTable ? table : null, intention, legacyTop3: null, own, active, recIndex });
              expect(url).toMatch(/^\/ring-builder(\?[a-z0-9_.=&-]+)?$/);
              const sp = Object.fromEntries(new URL(url, "https://x.test").searchParams);
              const back = readShowcaseParams(sp);
              expect(back.intention).toBe(intention);
              expect(back.table !== null).toBe(withTable);
              expect(back.own).toEqual(own);
              if (active === "own") expect(back.design).toBe("own");
              else expect(back.design).toBe(recIndex === 1 ? null : recIndex);
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(6 * 2 * 26 * 2 * 3);
  });
  it("legacyTop3 (g) ถูกเขียนเฉพาะตอนไม่มี intention · มี intention แล้ว g ไม่โผล่", () => {
    const g: GemTop3 = ["garnet", "citrine", "peridot"];
    expect(buildShowcaseUrl({ table: null, intention: null, legacyTop3: g, own: null, active: "rec", recIndex: 1 })).toBe("/ring-builder?g=garnet.citrine.peridot");
    expect(buildShowcaseUrl({ table: null, intention: "love", legacyTop3: g, own: null, active: "rec", recIndex: 1 })).toBe("/ring-builder?i=love");
  });
  it("ค่าที่ผิดรูปปนมา (HTML/proto/array/ยาว) ไม่ถูกเขียนลง URL แม้ทุก field เสียพร้อมกัน", () => {
    const url = buildShowcaseUrl({
      table: { love: ["<b>"] } as never,
      intention: "<script>" as never,
      legacyTop3: ["constructor", "__proto__", "x"] as never,
      own: { top: "<img>", bottom: HUGE } as never,
      active: "own",
      recIndex: 9 as never,
    });
    expect(url).toBe("/ring-builder?d=own");
  });
});

describe("LINE — ไซซ์นอก 55–58 ไม่สร้างข้อความ · ราคา 890 ทุกสถานะ", () => {
  const choices: ShowcaseChoice[] = [{ kind: "direct" }, { kind: "rec", index: 1, top: "garnet", bottom: "citrine" }, { kind: "own", top: "peridot", bottom: "peridot" }];
  it("ไซซ์ขอบเขต 54/59/0/-1/55.5/NaN/Infinity/'56'/null-ish ที่ไม่ใช่ null → null ทั้งข้อความและลิงก์ ทุกสถานะ", () => {
    for (const choice of choices) {
      for (const size of [54, 59, 0, -56, 55.5, 56.0001, NaN, Infinity, -Infinity, "56", [56], {}, undefined, 1e9, Number.MAX_SAFE_INTEGER]) {
        expect(buildShowcaseLineMessage({ designId: "bypass2", choice, size: size as never })).toBeNull();
        expect(buildShowcaseLineHref({ designId: "bypass2", choice, size: size as never })).toBeNull();
      }
    }
  });
  it("ราคาในข้อความมีตัวเดียว = 890 ทุก choice × (ไม่เลือกไซซ์ + 4 ไซซ์)", () => {
    for (const choice of choices) {
      for (const size of [null, ...getShowcaseDesign("bypass2").sizes]) {
        const msg = buildShowcaseLineMessage({ designId: "bypass2", choice, size }) as string;
        expect([...msg.matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => m[1])).toEqual(["890"]);
        expect(msg).not.toMatch(/เพชร|undefined|NaN|\[object/);
      }
    }
  });
  it("ข้อความ LINE ไม่มีค่าดิบที่ฝังมาใน choice (field แปลกปลอมถูกเมิน)", () => {
    const evil = { kind: "own", top: "garnet", bottom: "citrine", note: "<script>alert(1)</script>", price: 1, intention: "love" } as unknown as ShowcaseChoice;
    const msg = buildShowcaseLineMessage({ designId: "bypass2", choice: evil, size: null }) as string;
    expect(msg).not.toContain("alert");
    expect(msg).not.toContain("love");
    expect(msg).toContain("ราคา 890 บาท");
  });
});
