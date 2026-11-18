// QA D1.2 (R2-D2) - adversarial, independent of dev tests: r param, LINE matrix, placement, URL back-compat
import { describe, expect, it } from "vitest";
import { SHOWCASE_PRICE_THB } from "./config";
import { DESIGNS, SHOWCASE_DESIGN_IDS, getShowcaseDesign, gemSlotCount, mainIndexes } from "./designs";
import { buildShowcaseLineHref, buildShowcaseLineMessage, isShowcaseSize, type ShowcaseChoice } from "./line-message";
import { buildShowcaseHref, buildShowcaseUrl, parseDesignIdParam, parseTableParam, readShowcaseParams, type IntentionTable } from "./quiz-link";
import { designTints } from "../viewer/gem-colors";

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;

describe("Case 1: r param hostile inputs never crash, always fall back to bypass2", () => {
  const hostile: unknown[] = [
    "", " ", "TRINITY", "Trinity", "bypass2 ", " bypass2", "trinity\n", "trinity\0", "trinity%00", "trınity", "ｔrinity",
    "__proto__", "constructor", "toString", "hasOwnProperty", "length", "0", "-1", "<script>alert(1)</script>", "../../etc/passwd",
    "\u{1F600}", "แหวน", "a".repeat(64), "a".repeat(65), "trinity".padEnd(65, " "), "trinity,scroll6", "trinity&r=scroll6",
    ["trinity", "scroll6"], ["trinity"], [], null, undefined, 1, true, {}, { toString: () => "trinity" },
  ];
  it.each(hostile.map((h, i) => [i, h]))("hostile #%i -> null / bypass2", (_i, raw) => {
    expect(() => parseDesignIdParam(raw)).not.toThrow();
    expect(parseDesignIdParam(raw)).toBeNull();
    expect(readShowcaseParams({ r: raw }).ring).toBe("bypass2");
  });
  it("valid ids parse; unrelated keys do not set ring", () => {
    for (const id of SHOWCASE_DESIGN_IDS) expect(readShowcaseParams({ r: id }).ring).toBe(id);
    expect(readShowcaseParams({ design: "trinity", d: "trinity", price: "1", size: "50" }).ring).toBe("bypass2");
    expect(readShowcaseParams(Object.create(null)).ring).toBe("bypass2");
  });
  it("buildShowcaseUrl never writes an invalid ring", () => {
    const base = { table: null, intention: null, legacyTop3: null, own: null, active: "rec" as const, recIndex: 1 as const };
    for (const bad of ["__proto__", "TRINITY", "x", 5, null]) {
      expect(buildShowcaseUrl({ ...base, ring: bad as never })).toBe("/ring-builder");
    }
  });
});

describe("must not break: legacy links + byte-identical bypass2 URLs", () => {
  it("D1 ?g= and D1.1 links (no r) -> bypass2 with same gem state", () => {
    const g = readShowcaseParams({ g: "garnet.amethyst.citrine" });
    expect(g.ring).toBe("bypass2");
    expect(g.top3).toEqual(["garnet", "amethyst", "citrine"]);
    const p = readShowcaseParams({ t: "gac.acp.cpb.bgc.pab.gpa", i: "love", q: "love", c: "garnet.citrine", d: "own" });
    expect(p.ring).toBe("bypass2");
    expect(p.intention).toBe("love");
    expect(p.answered).toBe("love");
    expect(p.own).toEqual({ top: "garnet", bottom: "citrine" });
    expect(p.design).toBe("own");
  });
  it("bypass2 URL identical with ring omitted / bypass2; r is last when present", () => {
    const base = { table: TABLE, intention: "love" as const, answered: "love" as const, legacyTop3: null, own: { top: "garnet" as const, bottom: "citrine" as const }, active: "own" as const, recIndex: 3 as const };
    const a = buildShowcaseUrl(base);
    expect(buildShowcaseUrl({ ...base, ring: "bypass2" })).toBe(a);
    expect(a).not.toMatch(/[?&]r=/);
    expect(buildShowcaseUrl({ ...base, ring: "small7" })).toBe(`${a}&r=small7`);
    expect(buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, active: "rec", recIndex: 1, ring: "bar7" })).toBe("/ring-builder?r=bar7");
  });
  it("quiz CTA href has no r and exact legacy shape", () => {
    const href = buildShowcaseHref({ intention: "love", table: TABLE });
    expect(href).toBe("/ring-builder?t=gac.acp.cpb.bgc.pab.gpa&i=love&q=love");
  });
});

const CHOICES: ShowcaseChoice[] = [
  { kind: "direct" },
  { kind: "direct", unpicked: true },
  { kind: "rec", index: 1, top: "garnet", bottom: "amethyst" },
  { kind: "rec", index: 3, top: "blue_topaz", bottom: "peridot" },
  { kind: "own", top: "citrine", bottom: "citrine" },
  { kind: "own", top: "garnet", bottom: "blue_topaz" },
];

describe("Case 3: LINE message matrix = designs x choices x sizes", () => {
  it("unknown / hostile designId -> null (no fallback), incl. null input", () => {
    for (const id of ["", "BYPASS2", "__proto__", "constructor", "x", undefined, null, 1, ["trinity"], {}]) {
      expect(buildShowcaseLineMessage({ designId: id as never, choice: CHOICES[0], size: null })).toBeNull();
      expect(buildShowcaseLineHref({ designId: id as never, choice: CHOICES[0], size: 55 })).toBeNull();
    }
    expect(buildShowcaseLineMessage(null as never)).toBeNull();
    expect(buildShowcaseLineMessage(undefined as never)).toBeNull();
  });
  it("every design x choice x size: null iff size invalid; else one price 890, name, no diamond, no link", () => {
    const oddSizes: unknown[] = [NaN, Infinity, -Infinity, -1, 0, 49.5, 55.5, "55", undefined, 1e9];
    let sent = 0;
    for (const d of DESIGNS) {
      for (const choice of CHOICES) {
        const sizes: unknown[] = [...Array.from({ length: 31 }, (_, i) => 40 + i), null, ...oddSizes];
        for (const size of sizes) {
          const msg = buildShowcaseLineMessage({ designId: d.id, choice, size: size as never });
          const valid = size === null || (typeof size === "number" && d.sizes.includes(size));
          if (!valid) {
            expect(msg, `${d.id} size=${String(size)}`).toBeNull();
            continue;
          }
          expect(msg).not.toBeNull();
          sent++;
          const m = msg as string;
          expect(m).toContain(`แบบแหวน: ${d.name}`);
          const prices = [...m.matchAll(/(\d[\d,]*)\s*บาท/g)].map((x) => x[1]);
          expect(prices).toEqual([SHOWCASE_PRICE_THB.toLocaleString("en-US")]);
          expect(prices[0]).toBe("890");
          expect(m).not.toContain("เพชร");
          expect(m).not.toMatch(/https?:|lin\.ee|@\w/i);
          if (choice.kind === "own" || choice.kind === "direct") expect(m).not.toMatch(/ชุด \d/);
          if (choice.kind === "rec") expect(m).toContain(`ชุด ${choice.index}`);
          expect(/CZ เล็ก 2 เม็ด/.test(m)).toBe(d.id === "bypass2");
          // D1.2a: แบบแถว + เลือกเองที่ยังไม่เลือก = โหมดรายเม็ด → ไม่มีบรรทัดหลัก/เสริม (contract เปลี่ยน)
          const unpickedRow = d.layout.kind === "row" && choice.kind === "direct" && choice.unpicked === true;
          if (unpickedRow) expect(m).not.toMatch(/พลอยหลัก|พลอยเสริม/);
          else {
            expect(m).toContain(`พลอยหลัก (${d.positions.main})`);
            expect(m).toContain(`พลอยเสริม (${d.positions.sub})`);
          }
          if (d.id !== "bypass2") expect(m).not.toMatch(/เม็ดบน|เม็ดล่าง|ทั้ง 2 เม็ด/);
          expect(m).toContain(size === null ? "รอแอดมินช่วยเช็ก" : `เบอร์ ${size}`);
        }
      }
    }
    expect(sent).toBeGreaterThan(400);
  });
  it("bad choices -> null", () => {
    const bad: unknown[] = [
      { kind: "rec", index: 0, top: "garnet", bottom: "amethyst" },
      { kind: "rec", index: 4, top: "garnet", bottom: "amethyst" },
      { kind: "rec", index: 1.5, top: "garnet", bottom: "amethyst" },
      { kind: "rec", index: "1", top: "garnet", bottom: "amethyst" },
      { kind: "own", top: "diamond", bottom: "garnet" },
      { kind: "own", top: "constructor", bottom: "garnet" },
      { kind: "own", top: "garnet" },
      { kind: "__proto__" },
      { kind: "cz" },
      null,
      "own",
    ];
    for (const choice of bad) expect(buildShowcaseLineMessage({ designId: "trinity", choice: choice as never, size: 52 })).toBeNull();
  });
  it("isShowcaseSize is per-design", () => {
    expect(isShowcaseSize(52, "trinity")).toBe(true);
    expect(isShowcaseSize(52, "bypass2")).toBe(false);
    expect(isShowcaseSize(55, "bypass2")).toBe(true);
    expect(isShowcaseSize(59, "bypass2")).toBe(false);
    expect(isShowcaseSize(60, "bar7")).toBe(true);
    expect(isShowcaseSize(61, "bar7")).toBe(false);
    expect(isShowcaseSize("52", "trinity")).toBe(false);
    expect(isShowcaseSize(52, "__proto__")).toBe(false);
  });
});

describe("Case 4: stone placement (main vs secondary)", () => {
  it("mainIndexes: odd -> centre, even -> two centre", () => {
    expect(mainIndexes(3)).toEqual([1]);
    expect(mainIndexes(7)).toEqual([3]);
    expect(mainIndexes(4)).toEqual([1, 2]);
    expect(mainIndexes(6)).toEqual([2, 3]);
    for (const bad of [0, -3, 2.5, NaN, Infinity]) expect(mainIndexes(bad)).toEqual([]);
  });
  it("designs: main counts + wording per design; CZ only bypass2", () => {
    const want: Record<string, [number, string]> = {
      trinity: [1, "เม็ดกลาง"],
      bar7: [1, "เม็ดกลาง"],
      small7: [1, "เม็ดกลาง"],
      channel4: [2, "เม็ดกลาง 2 เม็ด"],
      channel6: [2, "เม็ดกลาง 2 เม็ด"],
      scroll6: [2, "เม็ดกลาง 2 เม็ด"],
    };
    for (const [id, [count, label]] of Object.entries(want)) {
      const d = getShowcaseDesign(id as never);
      expect(d.mainCount).toBe(count);
      expect(d.positions.main).toBe(label);
      expect(d.extraCz).toBe(0);
    }
    expect(DESIGNS.filter((d) => d.extraCz > 0).map((d) => d.id)).toEqual(["bypass2"]);
  });
  it("designTints: length = gem count; main tint exactly on mainIndexes", () => {
    for (const d of DESIGNS) {
      const n = gemSlotCount(d);
      const t = designTints(d.id, "garnet", "blue_topaz");
      expect(t).toHaveLength(n);
      expect(designTints(d.id, null, null)).toHaveLength(n);
      if (d.layout.kind === "row") {
        const mains = new Set(mainIndexes(n));
        expect(mains.size).toBe(d.mainCount);
        const mainTint = t[[...mains][0]];
        t.forEach((tint, i) => expect(tint === mainTint).toBe(mains.has(i)));
      }
    }
    expect(() => designTints("nope" as never, null, null)).toThrow();
  });
});
