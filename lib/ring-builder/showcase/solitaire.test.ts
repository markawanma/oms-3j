// D1.3 (design-ring-showcase-multi.md §15) — แบบที่ 8 เม็ดเดี่ยว: Z3-ใหม่ (ราคาต่อแบบ) · Z12 · Z13 (คำต้องห้าม) · Z14 (c ผิด) · Z18 (ไซซ์) · ต้องไม่พัง (ลิงก์/จำสีข้ามแบบ)
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { slotTints } from "../viewer/gem-colors";
import { SHOWCASE_COPY, formatPriceThb, showcasePriceThb } from "./config";
import { DESIGNS, SHOWCASE_DESIGN_IDS, getShowcaseDesign, type ShowcaseDesignId } from "./designs";
import { buildShowcaseLineHref, buildShowcaseLineMessage, resolveChoice, type ShowcaseChoice } from "./line-message";
import { fitOwnToCount, formatOwnSlots, ownSlotLines } from "./own-slots";
import { CZ_SLOT, buildShowcaseUrl, parseOwnSlotsParam, readShowcaseParams, type SlotCode } from "./quiz-link";

const SOL: ShowcaseDesignId = "solitaire";
const PRICE_RE = /(\d[\d,]*)\s*บาท/g;
const prices = (m: string) => [...m.matchAll(PRICE_RE)].map((x) => x[0]);
/** Z13: คำที่ห้ามมีในข้อความลูกค้าของเม็ดเดี่ยว */
const FORBIDDEN_SOLITAIRE = /พลอยเสริม|เม็ดข้าง|ทุกเม็ด|เม็ด 1|เม็ดที่ 1|ซ้ายไปขวา|พลอยหลัก|CZ เล็ก| \+ /;

const SLOT_CODES: SlotCode[] = [...GEM_QUIZ_STONE_CODES, CZ_SLOT];
const choicesFor = (): [string, ShowcaseChoice][] => [
  ["rec1", { kind: "rec", index: 1, top: "garnet", bottom: "amethyst" }],
  ["rec2", { kind: "rec", index: 2, top: "citrine", bottom: "peridot" }],
  ["rec3", { kind: "rec", index: 3, top: "blue_topaz", bottom: "garnet" }],
  ["direct", { kind: "direct" }],
  ["unpicked", { kind: "direct", unpicked: true }],
  ...SLOT_CODES.map((c): [string, ShowcaseChoice] => [`own-${c}`, { kind: "ownSlots", codes: [c] }]),
];

describe("Z3-ใหม่ / Z13 / Z18 — LINE ของ solitaire ทุกโหมด × ไซซ์", () => {
  it("ราคาเดียว = 790 · ไม่มี 890 · ไม่มีคำต้องห้าม · ไม่มีเพชร/http", () => {
    expect(formatPriceThb(SOL)).toBe("790 บาท");
    const d = getShowcaseDesign(SOL);
    for (const [name, choice] of choicesFor()) {
      for (const size of [null, ...d.sizes]) {
        const m = buildShowcaseLineMessage({ designId: SOL, choice, size }) as string;
        expect(m, `${name} ${size}`).toBeTruthy();
        expect(prices(m), `${name} ${size}`).toEqual([formatPriceThb(SOL)]);
        expect(m).not.toContain("890");
        expect(m).not.toMatch(FORBIDDEN_SOLITAIRE);
        expect(m).not.toMatch(/เพชร|https?:|undefined|NaN|\[object/);
        expect(m).toContain(`แบบแหวน: ${d.name}\n`);
        expect(m).toContain(size === null ? "รอแอดมินช่วยเช็ก" : `เบอร์ ${size}`);
      }
    }
  });
  it("โหมดเลือกเอง: บรรทัดพลอย = 'พลอยเม็ดเดี่ยว: <ชื่อ>' และ 'พลอย: เลือกพลอยเอง' (ไม่มี 'รายเม็ด')", () => {
    const m = buildShowcaseLineMessage({ designId: SOL, choice: { kind: "ownSlots", codes: ["garnet"] }, size: 55 }) as string;
    expect(m).toContain("พลอย: เลือกพลอยเอง\n");
    expect(m).toContain("พลอยเม็ดเดี่ยว: โกเมน");
    expect(m).not.toContain("รายเม็ด");
    const cz = buildShowcaseLineMessage({ designId: SOL, choice: { kind: "ownSlots", codes: [CZ_SLOT] }, size: 55 }) as string;
    expect(cz).toContain("พลอยเม็ดเดี่ยว: CZ ขาว");
    expect(cz).not.toContain("เพชร");
  });
  it("โหมดแนะนำ: ชุด n = พลอยอันดับ n ตัวเดียว (ไม่พิมพ์ bottom/ชื่อคู่)", () => {
    const m = buildShowcaseLineMessage({ designId: SOL, choice: { kind: "rec", index: 2, top: "citrine", bottom: "peridot" }, size: null }) as string;
    expect(m).toContain("พลอย: ชุด 2\n");
    expect(m).toContain("พลอยเม็ดเดี่ยว: ซิทริน");
    expect(m).not.toContain("เพอริดอต");
    expect(m).not.toContain("พีริดอต");
  });
  it("Z3-ใหม่ ข้ามแบบ: ทุกแบบเห็นราคาของตัวเองเท่านั้น (790 ไม่หลุดไปแบบอื่น)", () => {
    for (const d of DESIGNS) {
      const m = buildShowcaseLineMessage({ designId: d.id, choice: { kind: "direct" }, size: null }) as string;
      expect(prices(m)).toEqual([formatPriceThb(d.id)]);
      if (d.id !== SOL) expect(m).not.toContain("790");
    }
  });
  it("Z18: ไซซ์นอก 50–60 ของ solitaire = null ทั้งข้อความและลิงก์", () => {
    for (const size of [49, 61, 57.5, 0, -1, NaN, Infinity, "55", [55], {}, undefined, 1e9]) {
      expect(buildShowcaseLineMessage({ designId: SOL, choice: { kind: "direct" }, size: size as never }), String(size)).toBeNull();
      expect(buildShowcaseLineHref({ designId: SOL, choice: { kind: "direct" }, size: size as never })).toBeNull();
    }
    for (const size of [50, 55, 58, 60]) expect(buildShowcaseLineMessage({ designId: SOL, choice: { kind: "direct" }, size })).not.toBeNull();
  });
  it("ownSlots ที่ยาวไม่ใช่ 1 / รหัสนอก whitelist = null (ไม่ fallback)", () => {
    const d = getShowcaseDesign(SOL);
    for (const codes of [[], ["garnet", "garnet"], ["garnet", "garnet", "garnet"], ["ruby"], ["GARNET"], [null], [undefined], ["cz_white"], "g"] as unknown[]) {
      expect(resolveChoice({ kind: "ownSlots", codes }, d), JSON.stringify(codes)).toBeNull();
      expect(buildShowcaseLineMessage({ designId: SOL, choice: { kind: "ownSlots", codes } as never, size: null })).toBeNull();
    }
  });
});

describe("Z14 — c ของ solitaire", () => {
  it("ตัวอักษรเดียว [gacpbz] เท่านั้น → 1 รหัส", () => {
    const map: Record<string, SlotCode> = { g: "garnet", a: "amethyst", c: "citrine", p: "peridot", b: "blue_topaz", z: CZ_SLOT };
    for (const [l, code] of Object.entries(map)) expect(parseOwnSlotsParam(l, SOL), l).toEqual([code]);
  });
  it("ผิดทุกแบบ → null ไม่ throw", () => {
    const bad: unknown[] = ["g.a", "g.g", "garnet", "cz", "G", "gg", "g.", ".g", "", " g", "g ", "g\n", "x", "ก", "x".repeat(65), "g.".repeat(40), ["g"], ["g", "a"], 1, null, undefined, {}, "__proto__", "constructor"];
    for (const raw of bad) expect(parseOwnSlotsParam(raw, SOL), JSON.stringify(raw)).toBeNull();
  });
  it("readShowcaseParams: ?c=g.a&r=solitaire ไม่ถูกรับเป็น [g] (ช่องที่ไม่ได้ตั้งใจเปิด)", () => {
    expect(readShowcaseParams({ c: "g.a", d: "own", r: SOL }).ownSlots).toBeNull();
    expect(readShowcaseParams({ c: "g", d: "own", r: SOL }).ownSlots).toEqual(["garnet"]);
    expect(readShowcaseParams({ c: "g", d: "own", r: SOL }).own).toBeNull();
  });
  it("ต้องไม่พัง: ลิงก์ preview ยาว 2 ของแบบแถว ≥ 3 เม็ดยังขยายเหมือนเดิม · ยาว 1 ไม่ใช่ของแบบแถว ≥ 3", () => {
    expect(parseOwnSlotsParam("g.a", "trinity")).toEqual(["amethyst", "garnet", "amethyst"]);
    expect(parseOwnSlotsParam("garnet.amethyst", "bar7")).toEqual(["amethyst", "amethyst", "amethyst", "garnet", "amethyst", "amethyst", "amethyst"]);
    expect(parseOwnSlotsParam("g.a.c", "trinity")).toEqual(["garnet", "amethyst", "citrine"]);
    expect(parseOwnSlotsParam("g", "trinity")).toBeNull();
  });
  it("buildShowcaseUrl: solitaire เขียน c=<อักษรเดียว> · r ต่อท้าย · ยาวผิดไม่ถูกเขียน", () => {
    const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: ["garnet"], active: "own", recIndex: 1, ring: SOL });
    expect(url).toBe("/ring-builder?c=g&d=own&r=solitaire");
    expect(readShowcaseParams(Object.fromEntries(new URL(url, "https://x.test").searchParams))).toMatchObject({ ownSlots: ["garnet"], ring: SOL });
    const bad = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: ["garnet", "amethyst"], active: "own", recIndex: 1, ring: SOL });
    expect(bad).not.toContain("c=");
  });
});

describe("Z12 — ราคาเปลี่ยนจาก URL ไม่ได้", () => {
  it("?price= ?p= ?r=solitaire&price=1 ไม่มีผลกับ params และราคา", () => {
    const base = readShowcaseParams({ r: SOL });
    for (const extra of [{ price: "1" }, { p: "1" }, { price: ["1", "2"] }, { priceThb: "1" }]) {
      expect(readShowcaseParams({ r: SOL, ...extra })).toEqual(base);
    }
    expect(Object.keys(base).sort()).toEqual(["answered", "design", "intention", "own", "ownSlots", "ring", "table", "top3"]);
    expect(base.ring).toBe(SOL);
    expect(showcasePriceThb(base.ring)).toBe(790);
  });
});

describe("own-slots ของเม็ดเดี่ยว", () => {
  it("formatOwnSlots ยาว 1 = แถวเดียว 'พลอยเม็ดเดี่ยว' · ไม่มี เม็ด 1 / ทุกเม็ด · แถว ≥ 3 ไม่เปลี่ยน", () => {
    for (const c of SLOT_CODES) {
      const rows = formatOwnSlots([c]);
      expect(rows).toHaveLength(1);
      expect(rows?.[0].label).toBe(SHOWCASE_COPY.singleStoneLabel);
      expect(JSON.stringify(rows)).not.toMatch(/เม็ด 1|ทุกเม็ด|ซ้ายไปขวา/);
      expect(ownSlotLines(rows!)).toEqual([`พลอยเม็ดเดี่ยว: ${rows![0].value}`]);
    }
    expect(formatOwnSlots(["garnet", "garnet", "garnet"])).toEqual([{ label: "เม็ด 1–3", value: "โกเมน (ทุกเม็ด)" }]);
    expect(formatOwnSlots([])).toBeNull();
    expect(formatOwnSlots(["ruby"])).toBeNull();
  });
  it("fitOwnToCount ไป/กลับ: 7→1 = เม็ดกลาง · 4→1 = เม็ดกลางตัวแรก · 1→7 ทุกเม็ด · 1↔ไขว้ · 1→1 คงเดิม", () => {
    const seven: SlotCode[] = ["garnet", "amethyst", "citrine", "peridot", "blue_topaz", "garnet", "amethyst"];
    expect(fitOwnToCount(seven, 1)).toEqual(["peridot"]);
    expect(fitOwnToCount(["garnet", "amethyst", "citrine", "peridot"], 1)).toEqual(["amethyst"]);
    expect(fitOwnToCount(["garnet"], 7)).toEqual(Array(7).fill("garnet"));
    expect(fitOwnToCount(["garnet"], 2)).toEqual(["garnet", "garnet"]);
    expect(fitOwnToCount(["garnet", "amethyst"], 1)).toEqual(["garnet"]);
    expect(fitOwnToCount(["garnet"], 1)).toEqual(["garnet"]);
  });
  it("slotTints('solitaire') ยาว 1 · จำนวนรหัสไม่ตรง = CZ ขาว 1 เม็ด (ไม่ crash)", () => {
    expect(slotTints(SOL, ["garnet"])).toHaveLength(1);
    expect(slotTints(SOL, [CZ_SLOT])).toEqual(slotTints(SOL, ["garnet", "garnet"]));
  });
});

describe("ต้องไม่พัง — ราคาของ 7 แบบเดิม", () => {
  it("7 แบบเดิมยัง 890 · แบบเดียวที่ 790 คือ solitaire", () => {
    for (const id of SHOWCASE_DESIGN_IDS) expect(showcasePriceThb(id)).toBe(id === SOL ? 790 : 890);
  });
});
