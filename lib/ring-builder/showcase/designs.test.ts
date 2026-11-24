// D1.2/D1.3 — designs.ts (8 แบบ) + param `r` + URL ไขว้ byte เดิม + designTints + เชื่อม 3D↔ข้อมูลลูกค้า (Z1 · Z3 · Z7 · ต้องไม่พัง)
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { RING_BUILDER_SIZES } from "../config";
import { CZ_TINT, designTints, ringTints, stoneTint } from "../viewer/gem-colors";
import { ROW_PRESETS } from "../viewer/row-presets";
import { SHOWCASE_RING_IDS, getShowcaseRing } from "../viewer/showcase-rings";
import {
  DESIGNS,
  SHOWCASE_DESIGN_IDS,
  findShowcaseDesign,
  gemSlotCount,
  getShowcaseDesign,
  isShowcaseDesignId,
  isSingleStone,
  mainIndexes,
  placementNote,
  roleMainLabel,
  roleSubLabel,
  sizeRange,
} from "./designs";
import { INTENTION_CODES, buildShowcaseHref, buildShowcaseUrl, parseDesignIdParam, readShowcaseParams, type IntentionTable, type OwnGems } from "./quiz-link";

const GOOD_T = "gac.acp.cpb.bgc.pab.gpa";
const table = (): IntentionTable => {
  const groups = GOOD_T.split(".");
  const L: Record<string, string> = { g: "garnet", a: "amethyst", c: "citrine", p: "peridot", b: "blue_topaz" };
  return Object.fromEntries(INTENTION_CODES.map((c, i) => [c, groups[i].split("").map((l) => L[l])])) as unknown as IntentionTable;
};

describe("designs.ts — ข้อมูลฝั่งลูกค้า", () => {
  it("8 แบบ ลำดับตาม UX (ไขว้ · TRINITY · ก้นหอย · ฝังล็อค 4 · ฝังล็อค 6 · เตย · แถวเล็ก · เม็ดเดี่ยว) และตรงกับโมเดล 3D ทีละ id", () => {
    expect(DESIGNS.map((d) => d.id)).toEqual(["bypass2", "trinity", "scroll6", "channel4", "channel6", "bar7", "small7", "solitaire"]);
    expect([...SHOWCASE_DESIGN_IDS]).toEqual([...SHOWCASE_RING_IDS]);
    expect(DESIGNS.map((d) => d.shortName)).toEqual(["ไขว้ 2 เม็ด", "TRINITY 3 เม็ด", "ก้นหอย 6 เม็ด", "ฝังล็อค 4 เม็ด", "ฝังล็อค 6 เม็ด", "เตย 7 เม็ด", "แถวเล็ก 7 เม็ด", "เม็ดเดี่ยว 6 เตย"]);
  });
  it("จำนวนเม็ด/เม็ดหลักตรงกับพารามิเตอร์ 3D และเรขาคณิตจริง (ไขว้ 4 เม็ดในโมเดล = พลอยไข่ 2 + CZ 2)", () => {
    for (const d of DESIGNS) {
      const ring = getShowcaseRing(d.id);
      expect(ring.gems.length).toBe(gemSlotCount(d));
      if (d.layout.kind === "row") {
        // เม็ดเดี่ยวไม่อยู่ใน ROW_PRESETS (generator แยก solitaire-ring.ts) — จำนวนเม็ดล็อกด้วย gems.length ข้างบนแล้ว
        if (d.id !== "solitaire") expect(d.layout.stoneCount).toBe(ROW_PRESETS[d.id as keyof typeof ROW_PRESETS].stoneCount);
        expect(d.mainCount).toBe(mainIndexes(d.layout.stoneCount).length);
        expect(d.extraCz).toBe(0); // มติ 9 พ.ย.: พลอยทุกเม็ดในวงขนาดเท่ากัน — ไม่มี CZ เล็กในแบบแถว
      } else {
        expect(d.mainCount).toBe(1);
        expect(d.extraCz).toBe(2);
      }
    }
  });
  it("ตำแหน่ง: ไขว้ บน/ล่าง · คี่ เม็ดกลาง · คู่ เม็ดกลาง 2 เม็ด · เสริม = เม็ดข้าง", () => {
    expect(getShowcaseDesign("bypass2").positions).toEqual({ main: "เม็ดบน", sub: "เม็ดล่าง" });
    for (const id of ["trinity", "bar7", "small7"] as const) expect(getShowcaseDesign(id).positions).toEqual({ main: "เม็ดกลาง", sub: "เม็ดข้าง" });
    for (const id of ["scroll6", "channel4", "channel6"] as const) expect(getShowcaseDesign(id).positions).toEqual({ main: "เม็ดกลาง 2 เม็ด", sub: "เม็ดข้าง" });
    expect(roleMainLabel(getShowcaseDesign("trinity"))).toBe("พลอยหลัก (เม็ดกลาง)");
    expect(roleSubLabel(getShowcaseDesign("bypass2"))).toBe("พลอยเสริม (เม็ดล่าง)");
  });
  it("placementNote: ไขว้ = ข้อความเดิม (เรียงคำใหม่) มี CZ เล็ก 2 เม็ด · แบบแถว ไม่มีประโยค CZ · ไม่มี บน/ล่าง กับแบบแถว", () => {
    expect(placementNote(getShowcaseDesign("bypass2"))).toBe("เม็ดบน = พลอยหลัก · เม็ดล่าง = พลอยเสริม · CZ เล็ก 2 เม็ดมาพร้อมแหวน");
    expect(placementNote(getShowcaseDesign("trinity"))).toBe("เม็ดกลาง = พลอยหลัก · เม็ดข้างที่เหลือ = พลอยเสริม");
    expect(placementNote(getShowcaseDesign("channel4"))).toBe("เม็ดกลาง 2 เม็ด = พลอยหลัก · เม็ดข้างที่เหลือ = พลอยเสริม");
    for (const d of DESIGNS.filter((x) => x.layout.kind === "row" && !isSingleStone(x))) {
      expect(placementNote(d)).not.toMatch(/บน|ล่าง|CZ/);
    }
    // เม็ดเดี่ยว: ไม่มีหลัก/เสริมให้อธิบาย → null (PlacementNote ไม่ render)
    expect(placementNote(getShowcaseDesign("solitaire"))).toBeNull();
  });
  it("ไซซ์: ไขว้ 55–58 · แบบแถว 50–60 · ต่อเนื่อง · อยู่ในช่วงร้าน", () => {
    for (const d of DESIGNS) {
      const { min, max } = sizeRange(d.id);
      expect([...d.sizes]).toEqual(Array.from({ length: max - min + 1 }, (_, i) => min + i));
      expect(min).toBeGreaterThanOrEqual(RING_BUILDER_SIZES.min);
      expect(max).toBeLessThanOrEqual(RING_BUILDER_SIZES.max);
    }
    expect(sizeRange("bypass2")).toEqual({ min: 55, max: 58 });
    expect(sizeRange("scroll6")).toEqual({ min: 50, max: 60 });
  });
  it("Z3/Z7: ไม่มีช่องราคา/lead days/มม./น้ำหนัก ในข้อมูลลูกค้า · ไม่มีคำว่าเพชร · ชื่อไม่ซ้ำ", () => {
    for (const d of DESIGNS) {
      expect(Object.keys(d).sort()).toEqual(["extraCz", "id", "layout", "mainCount", "name", "positions", "shortName", "sizes"]);
      expect(JSON.stringify(d)).not.toMatch(/เพชร|price|lead|mm|gram|กรัม|บาท/i);
    }
    expect(new Set(DESIGNS.map((d) => d.name)).size).toBe(8);
    expect(new Set(DESIGNS.map((d) => d.shortName)).size).toBe(8);
  });
  it("isShowcaseDesignId/findShowcaseDesign: whitelist เป๊ะ (proto/ตัวพิมพ์ใหญ่/ช่องว่าง = ไม่ผ่าน)", () => {
    for (const id of SHOWCASE_DESIGN_IDS) {
      expect(isShowcaseDesignId(id)).toBe(true);
      expect(findShowcaseDesign(id)?.id).toBe(id);
    }
    for (const bad of ["", "BYPASS2", " bypass2", "__proto__", "constructor", "toString", "bypass3", null, undefined, 1, {}, [], ["bypass2"]]) {
      expect(isShowcaseDesignId(bad)).toBe(false);
      expect(findShowcaseDesign(bad)).toBeUndefined();
    }
  });
});

describe("D1.3 — แบบที่ 8 เม็ดเดี่ยว", () => {
  it("solitaire: row 1 เม็ด · เม็ดกลาง 1 · ไซซ์ 50–60 · ไม่มี CZ เล็ก · isSingleStone เฉพาะแบบนี้", () => {
    const d = getShowcaseDesign("solitaire");
    expect(d.layout).toEqual({ kind: "row", stoneCount: 1 });
    expect(d.mainCount).toBe(1);
    expect(d.extraCz).toBe(0);
    expect(sizeRange("solitaire")).toEqual({ min: 50, max: 60 });
    expect(gemSlotCount(d)).toBe(1);
    expect(mainIndexes(1)).toEqual([0]);
    expect(DESIGNS.filter(isSingleStone).map((x) => x.id)).toEqual(["solitaire"]);
    expect(d.name).toBe("แหวนเม็ดเดี่ยว 6 เตย"); // TODO_OWNER_DESIGN_NAME (ชั่วคราว)
  });
  it("designTints('solitaire') ยาว 1 · สลับแบบไปมา: tints ยาวเท่าเม็ดของแบบเสมอ", () => {
    expect(designTints("solitaire", "garnet", "citrine")).toHaveLength(1);
    expect(designTints("solitaire", null, null)).toEqual([CZ_TINT]);
    expect(designTints("solitaire", "garnet", "citrine")[0]).toEqual(stoneTint("garnet"));
  });
});

describe("Z1 — param `r`", () => {
  it("id ถูก 8 ตัว → ผ่าน", () => {
    for (const id of SHOWCASE_DESIGN_IDS) expect(parseDesignIdParam(id)).toBe(id);
  });
  it("นอก whitelist / ยาว > 64 / array (key ซ้ำ) / __proto__ / HTML / ตัวพิมพ์ใหญ่ → null ไม่ throw", () => {
    const bad: unknown[] = [
      undefined,
      "",
      "BYPASS2",
      "Trinity",
      " trinity",
      "trinity ",
      "trinity\n",
      "__proto__",
      "constructor",
      "toString",
      "<script>alert(1)</script>",
      "x".repeat(65),
      "x".repeat(10_000),
      ["trinity"],
      ["trinity", "bar7"],
      1,
      null,
      {},
    ];
    for (const raw of bad) expect(parseDesignIdParam(raw)).toBeNull();
  });
  it("readShowcaseParams: r ผิด/ไม่มี = ไขว้ · r ถูก = แบบนั้น · ไม่กระทบ key อื่น", () => {
    expect(readShowcaseParams({}).ring).toBe("bypass2");
    expect(readShowcaseParams({ r: "nope" }).ring).toBe("bypass2");
    expect(readShowcaseParams({ r: ["small7", "bar7"] }).ring).toBe("bypass2");
    expect(readShowcaseParams({ r: "small7" }).ring).toBe("small7");
    const p = readShowcaseParams({ t: GOOD_T, i: "love", q: "love", c: "garnet.citrine", d: "own", r: "scroll6" });
    expect(p).toMatchObject({ intention: "love", answered: "love", own: { top: "garnet", bottom: "citrine" }, design: "own", ring: "scroll6" });
  });
  it("?price= ?size= ?design= ไม่มีผล", () => {
    const p = readShowcaseParams({ price: "1", size: "50", design: "trinity" });
    expect(p.ring).toBe("bypass2");
  });
});

describe("URL — ไขว้ byte เดิม · r ต่อท้ายสุดเฉพาะที่ไม่ใช่ไขว้", () => {
  const owns: (OwnGems | null)[] = [null, { top: "garnet", bottom: "citrine" }];
  it("ทุกสถานะของไขว้: ไม่ส่ง ring / ส่ง ring=bypass2 → URL เท่ากันเป๊ะและไม่มี r=", () => {
    for (const withTable of [false, true])
      for (const own of owns)
        for (const active of ["rec", "own"] as const)
          for (const recIndex of [1, 2, 3] as const) {
            const s = { table: withTable ? table() : null, intention: withTable ? ("love" as const) : null, legacyTop3: null, own, active, recIndex };
            const a = buildShowcaseUrl(s);
            expect(buildShowcaseUrl({ ...s, ring: "bypass2" })).toBe(a);
            expect(a).not.toMatch(/[?&]r=/);
          }
  });
  it("CTA ของ quiz ไม่เปลี่ยน (ลงไขว้ · ไม่มี r)", () => {
    expect(buildShowcaseHref({ intention: "career", table: table() })).toBe(`/ring-builder?t=${GOOD_T}&i=career&q=career`);
  });
  it("แบบอื่น: r วาง 'ท้ายสุด' ต่อจาก d และ parse กลับได้ครบทุกแบบ × สถานะ", () => {
    for (const id of SHOWCASE_DESIGN_IDS.filter((x) => x !== "bypass2"))
      for (const own of owns)
        for (const active of ["rec", "own"] as const)
          for (const recIndex of [1, 2, 3] as const) {
            const url = buildShowcaseUrl({ table: table(), intention: "wealth", answered: "wealth", legacyTop3: null, own, active, recIndex, ring: id });
            expect(url.endsWith(`&r=${id}`)).toBe(true);
            expect(url).toMatch(/^\/ring-builder\?[a-z0-9_.=&-]+$/);
            const back = readShowcaseParams(Object.fromEntries(new URL(url, "https://x.test").searchParams));
            expect(back.ring).toBe(id);
            expect(back.own).toEqual(own);
          }
    expect(buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, active: "rec", recIndex: 1, ring: "trinity" })).toBe("/ring-builder?r=trinity");
  });
  it("ring ที่ไม่ผ่าน whitelist ไม่ถูกเขียนลง URL", () => {
    for (const bad of ["__proto__", "<b>", "BYPASS2", "x".repeat(500), 1, null, {}]) {
      expect(buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, active: "rec", recIndex: 1, ring: bad as never })).toBe("/ring-builder");
    }
  });
  it("ลิงก์เก่า (g / t,i,q,c,d โดยไม่มี r) เปิดแบบไขว้เหมือนเดิม", () => {
    for (const sp of [{ g: "garnet.citrine.peridot" }, { t: GOOD_T, i: "love", q: "love" }, { t: GOOD_T, i: "calm", q: "love", c: "garnet.citrine", d: "own" }, {}]) {
      expect(readShowcaseParams(sp).ring).toBe("bypass2");
    }
  });
});

describe("designTints — สีพลอยตามแบบ", () => {
  it("ไขว้ = ringTints เดิมเป๊ะ (ทุกชนิด × ทุกชนิด + null)", () => {
    const codes = [null, ...GEM_QUIZ_STONE_CODES];
    for (const a of codes) for (const b of codes) expect(designTints("bypass2", a, b)).toEqual(ringTints(a, b));
  });
  it("ทุกแบบ: ยาวเท่าจำนวนเม็ดของโมเดล · เม็ดกลาง = พลอยหลัก ที่เหลือ = พลอยเสริม", () => {
    for (const d of DESIGNS) {
      const t = designTints(d.id, "garnet", "peridot");
      expect(t).toHaveLength(getShowcaseRing(d.id).gems.length);
      if (d.layout.kind === "row") {
        const mains = new Set(mainIndexes(d.layout.stoneCount));
        t.forEach((tint, i) => expect(tint).toEqual(mains.has(i) ? stoneTint("garnet") : stoneTint("peridot")));
        expect(t.some((x) => x.cz)).toBe(false); // ไม่มี CZ เล็กในแบบแถว
      } else {
        expect(t.slice(2)).toEqual([CZ_TINT, CZ_TINT]);
      }
    }
  });
  it("null = CZ ขาวทุกเม็ดของแถว · id ผิด = throw", () => {
    expect(designTints("channel6", null, null).every((x) => x.cz)).toBe(true);
    expect(() => designTints("nope" as never, null, null)).toThrow();
    expect(() => designTints("__proto__" as never, null, null)).toThrow();
  });
});
