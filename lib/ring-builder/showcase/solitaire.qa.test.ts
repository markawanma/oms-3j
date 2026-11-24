// QA (R2-D2) D1.3 — ทดสอบอิสระจาก Luke: ราคาข้าม 8 แบบ · parser c ผิดรูปแบบ · ลิงก์เดิม · รูปไม่มี metadata/ไม่อยู่ public · hub ไม่มีราคา
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { HUB_TOOLS } from "@/lib/tools-hub/config";
import { SHOWCASE_COPY, formatPriceThb, showcasePriceThb } from "./config";
import { DESIGNS, SHOWCASE_DESIGN_IDS, getShowcaseDesign, isSingleStone, ownSlotCount, type ShowcaseDesignId } from "./designs";
import { buildShowcaseLineMessage, type ShowcaseChoice } from "./line-message";
import { CZ_SLOT, parseOwnSlotsParam, readShowcaseParams, type SlotCode } from "./quiz-link";

const PRICE_RE = /\d[\d,]*\s*บาท/g;
const prices = (m: string) => m.match(PRICE_RE) ?? [];
const OLD = SHOWCASE_DESIGN_IDS.filter((id) => id !== "solitaire");

describe("QA ราคา — 8 แบบ x ทุกโหมด x ไซซ์", () => {
  it("ราคาต่อแบบ: 7 เดิม 890 · solitaire 790", () => {
    for (const id of OLD) expect(showcasePriceThb(id)).toBe(890);
    expect(showcasePriceThb("solitaire")).toBe(790);
  });
  it("LINE ของทุกแบบมีตัวเลขราคาตัวเดียว = ราคาของแบบนั้น", () => {
    for (const d of DESIGNS) {
      const n = ownSlotCount(d);
      const codes = (c: SlotCode) => Array.from({ length: n }, () => c);
      const choices: ShowcaseChoice[] = [
        { kind: "rec", index: 1, top: "garnet", bottom: "amethyst" },
        { kind: "direct" },
        { kind: "direct", unpicked: true },
        ...(d.layout.kind === "row" ? ([{ kind: "ownSlots", codes: codes("citrine") }, { kind: "ownSlots", codes: codes(CZ_SLOT) }] as ShowcaseChoice[]) : []),
      ];
      for (const choice of choices) {
        for (const size of [null, ...d.sizes]) {
          const m = buildShowcaseLineMessage({ designId: d.id, choice, size });
          expect(m, `${d.id} ${JSON.stringify(choice)} ${size}`).toBeTruthy();
          expect(prices(m as string), `${d.id}`).toEqual([formatPriceThb(d.id)]);
        }
      }
    }
  });
  it("ไซซ์นอกช่วง/ผิดชนิดถูกปฏิเสธทุกแบบ · ขอบ 50/60 ผ่านเฉพาะแบบแถว", () => {
    for (const d of DESIGNS) {
      for (const bad of [49, 61, 57.5, NaN, -1, 0, Infinity, "55", 1e9]) {
        expect(buildShowcaseLineMessage({ designId: d.id, choice: { kind: "direct" }, size: bad as never }), `${d.id} ${String(bad)}`).toBeNull();
      }
    }
    for (const id of SHOWCASE_DESIGN_IDS) {
      const isRow = getShowcaseDesign(id).layout.kind === "row";
      expect(!!buildShowcaseLineMessage({ designId: id, choice: { kind: "direct" }, size: 50 })).toBe(isRow);
      expect(!!buildShowcaseLineMessage({ designId: id, choice: { kind: "direct" }, size: 60 })).toBe(isRow);
    }
  });
  it("designId นอก whitelist ทำ LINE ไม่ได้ · showcasePriceThb throw", () => {
    for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty", "Solitaire", "solitaire ", "", "solitaire\u0000"]) {
      expect(() => showcasePriceThb(bad as ShowcaseDesignId), bad).toThrow();
      expect(buildShowcaseLineMessage({ designId: bad as never, choice: { kind: "direct" }, size: 55 }), bad).toBeNull();
    }
  });
  it("ไม่มี priceAllDesigns · hub ไม่มีราคา/ทุกแบบ", () => {
    expect(SHOWCASE_COPY).not.toHaveProperty("priceAllDesigns");
    for (const t of HUB_TOOLS.filter((x) => x.id === "ring-builder")) expect(`${t.title} ${t.description} ${t.meta} ${t.cta}`, t.id).not.toMatch(/\d[\d,]*\s*(บาท|฿)|ทุกแบบ|790|890/);
    expect(HUB_TOOLS.find((t) => t.id === "ring-builder")?.description).toContain("8 แบบ");
  });
});

describe("QA parser c — Z14 fuzz", () => {
  const BAD = ["g.a", "garnet", "cz", "CZ", "Z", "G", "gg", "g.", ".g", "..", ".", "g..", " g", "g ", "g\n", "g​", "ก", "😀", "g%2Ea", "gz", "zz", "__proto__", "constructor", "toString", "g.g.g", "x", "1", "0", "", "a".repeat(65), "g".repeat(10000)];
  it("c ผิดของ solitaire → null ไม่ throw", () => {
    for (const raw of BAD) expect(parseOwnSlotsParam(raw, "solitaire"), JSON.stringify(raw.slice(0, 20))).toBeNull();
  });
  it("ไม่ใช่ string → null", () => {
    for (const raw of [["g"], ["g", "a"], { 0: "g" }, 1, null, undefined, true, { toString: () => "g" }]) expect(parseOwnSlotsParam(raw, "solitaire")).toBeNull();
  });
  it("ring ผิด → null", () => {
    for (const ring of ["__proto__", "constructor", ["solitaire"], "bypass2", undefined, null, "Solitaire"]) expect(parseOwnSlotsParam("g", ring)).toBeNull();
  });
  it("c=g/a/c/p/b/z ผ่าน (z = cz)", () => {
    const expected: Record<string, SlotCode> = { g: "garnet", a: "amethyst", c: "citrine", p: "peridot", b: "blue_topaz", z: "cz" };
    for (const [l, code] of Object.entries(expected)) expect(parseOwnSlotsParam(l, "solitaire")).toEqual([code]);
    expect(Object.keys(expected)).toHaveLength(GEM_QUIZ_STONE_CODES.length + 1);
  });
  it("readShowcaseParams: c ผิด + r=solitaire → ownSlots null · price/p ไม่มีผล", () => {
    for (const c of ["g.a", "garnet", ["g", "a"], "__proto__"]) {
      const p = readShowcaseParams({ r: "solitaire", c, d: "own" });
      expect(p.ownSlots, JSON.stringify(c)).toBeNull();
      expect(p.ring).toBe("solitaire");
    }
    expect(readShowcaseParams({ r: ["solitaire", "bar7"], c: "g" }).ring).not.toBe("solitaire");
    expect(readShowcaseParams({ r: "solitaire", price: "1", p: "1", cost: "1" })).toEqual(readShowcaseParams({ r: "solitaire" }));
  });
});

describe("QA ต้องไม่พัง — ลิงก์เดิมของ 7 แบบ", () => {
  it("แถว N ตัวอักษร / preview ยาว 2 ผลเดิม · ยาว 1 และ n+1 เป็น null", () => {
    expect(parseOwnSlotsParam("g.a.c", "trinity")).toEqual(["garnet", "amethyst", "citrine"]);
    expect(parseOwnSlotsParam("g.a.c.p", "channel4")).toEqual(["garnet", "amethyst", "citrine", "peridot"]);
    expect(parseOwnSlotsParam("g.a.c.p.b.z", "scroll6")).toEqual(["garnet", "amethyst", "citrine", "peridot", "blue_topaz", "cz"]);
    expect(parseOwnSlotsParam("z.z.z.z.z.z.z", "small7")).toEqual(Array(7).fill("cz"));
    for (const id of ["trinity", "scroll6", "channel4", "channel6", "bar7", "small7"] as ShowcaseDesignId[]) {
      const n = ownSlotCount(getShowcaseDesign(id));
      const preview = parseOwnSlotsParam("g.a", id);
      expect(preview, id).toHaveLength(n);
      expect(preview?.includes("garnet")).toBe(true);
      expect(parseOwnSlotsParam("garnet.amethyst", id), id).toHaveLength(n);
      expect(parseOwnSlotsParam("g", id), `${id} ยาว 1 ต้อง null`).toBeNull();
      expect(parseOwnSlotsParam(Array(n + 1).fill("g").join("."), id), id).toBeNull();
    }
  });
  it("ไขว้: parseOwnSlotsParam null · c=cz.<gem> ผ่าน readShowcaseParams", () => {
    for (const raw of ["g", "g.a", "garnet.amethyst"]) expect(parseOwnSlotsParam(raw, "bypass2")).toBeNull();
    expect(readShowcaseParams({ c: "cz.garnet", d: "own" }).own).toEqual({ top: "cz", bottom: "garnet" });
    expect(readShowcaseParams({ c: "garnet.cz", d: "own", r: "bypass2" }).own).toEqual({ top: "garnet", bottom: "cz" });
    expect(readShowcaseParams({ c: "garnet.amethyst" }).own).toEqual({ top: "garnet", bottom: "amethyst" });
  });
  it("isSingleStone จริงเฉพาะ solitaire", () => {
    expect(DESIGNS.filter(isSingleStone).map((d) => d.id)).toEqual(["solitaire"]);
  });
});

describe("QA รูป 4 ไฟล์ solitaire", () => {
  const assets = join(__dirname, "../../../app/(quiz)/ring-builder/_assets");
  const files = [1, 2, 3, 4].map((i) => join(assets, `solitaire-${i}.jpg`));
  function appSegments(buf: Buffer) {
    const out: { marker: number; head: string }[] = [];
    let i = 2;
    while (i < buf.length - 4 && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda) break;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xe0 && marker <= 0xef) out.push({ marker, head: buf.subarray(i + 4, i + 16).toString("latin1") });
      i += 2 + len;
    }
    return out;
  }
  it("JPEG จริง · ไม่มี APP1/APP13 (Exif/XMP/IPTC) · ไม่มี GPS · <= 60KB", () => {
    for (const f of files) {
      const b = readFileSync(f);
      expect(b[0]).toBe(0xff);
      expect(b[1]).toBe(0xd8);
      expect(b.length).toBeLessThanOrEqual(60 * 1024);
      for (const s of appSegments(b)) {
        expect(s.marker, `${f} APP${s.marker - 0xe0}`).not.toBe(0xe1);
        expect(s.marker, f).not.toBe(0xed);
      }
      expect(b.toString("latin1")).not.toMatch(/Exif|GPS|xmpmeta/);
    }
  });
  it("ไม่มีรูป solitaire/sketch/fb ใน public/ · _assets มี solitaire-1..4 พอดี", () => {
    const pub = join(__dirname, "../../../public");
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    expect(existsSync(pub)).toBe(true);
    expect(walk(pub).map((p) => p.slice(pub.length)).filter((p) => /solitaire|sketch|fb-/i.test(p))).toEqual([]);
    expect(readdirSync(assets).filter((f) => /solitaire/.test(f)).sort()).toEqual(["solitaire-1.jpg", "solitaire-2.jpg", "solitaire-3.jpg", "solitaire-4.jpg"]);
  });
});
