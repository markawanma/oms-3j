// D1.2a — เลือกรายเม็ด (UX "D1.2a เลือกรายเม็ด" A5/A6/A7/A8) · pure: own-slots · param c ของแบบแถว · LINE ownSlots · describeOwnSlots · slotTints
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { CZ_TINT, slotTints, stoneTint } from "../viewer/gem-colors";
import { showcasePriceThb } from "./config";
import { DESIGNS, SHOWCASE_DESIGN_IDS, getShowcaseDesign, ownSlotCount, type ShowcaseDesignId } from "./designs";
import { buildShowcaseLineMessage, resolveChoice } from "./line-message";
import { fillAll, fitOwnToCount, formatOwnSlots, isOwnSlots, ownSlotLines } from "./own-slots";
import { buildShowcaseUrl, parseOwnSlotsParam, readShowcaseParams, STONE_LETTER, type SlotCode } from "./quiz-link";
import { describeOwnSlots } from "./sets";

const G: GemQuizStoneCode = "garnet";
const A: GemQuizStoneCode = "amethyst";
const C: GemQuizStoneCode = "citrine";
const P: GemQuizStoneCode = "peridot";
const B: GemQuizStoneCode = "blue_topaz";
const ROWS = DESIGNS.filter((d) => d.layout.kind === "row");
const L = (codes: GemQuizStoneCode[]) => codes.map((c) => STONE_LETTER[c]).join(".");

describe("fitOwnToCount (A5)", () => {
  it("จัดกึ่งกลาง: 7→3 เก็บเม็ด 3–5 · 7→4 เก็บเม็ด 2–5 · 3→7 = [1,1,1,2,3,3,3]", () => {
    const seven = [G, A, C, P, B, G, A];
    expect(fitOwnToCount(seven, 3)).toEqual([C, P, B]);
    expect(fitOwnToCount(seven, 4)).toEqual([A, C, P, B]);
    expect(fitOwnToCount([G, A, C], 7)).toEqual([G, G, G, A, C, C, C]);
  });
  it("จำนวนเท่าเดิม = ชุดเดิม (คนละอ็อบเจ็กต์) · ไขว้↔แถว: ไขว้→แถว กลาง=บน ที่เหลือ=ล่าง · แถว→ไขว้ บน=เม็ดกลาง ล่าง=เม็ดที่ 1", () => {
    const six = [G, A, C, P, B, G];
    expect(fitOwnToCount(six, 6)).toEqual(six);
    expect(fitOwnToCount([G, A], 7)).toEqual([A, A, A, G, A, A, A]);
    expect(fitOwnToCount([G, A], 6)).toEqual([A, A, G, G, A, A]);
    expect(fitOwnToCount([A, C, P, B, G, A, C], 2)).toEqual([B, A]);
    expect(fitOwnToCount([A, C, P, B], 2)).toEqual([C, A]); // 4 เม็ด: กลางตัวแรก = เม็ดที่ 2
  });
  it("ทุกคู่แบบ 7×7: ผลยาว = จำนวนเม็ดของแบบปลายทาง และทุกรหัสผ่าน whitelist (ห้ามมีเม็ดว่าง)", () => {
    for (const from of DESIGNS) {
      const src = Array.from({ length: ownSlotCount(from) }, (_, i) => GEM_QUIZ_STONE_CODES[i % 5]);
      for (const to of DESIGNS) {
        const out = fitOwnToCount(src, ownSlotCount(to));
        expect(isOwnSlots(out, ownSlotCount(to))).toBe(true);
      }
    }
  });
  it("7→4→7: สีเดิมกลับมาเมื่อ state เก็บต่อจำนวน (จำลองกลไกของ client: ไม่ fit ทับชุดที่มีอยู่)", () => {
    const byCount: Record<number, SlotCode[]> = { 7: [G, A, C, P, B, G, A] };
    byCount[4] = fitOwnToCount(byCount[7], 4)!;
    expect(byCount[7]).toEqual([G, A, C, P, B, G, A]);
  });
});

describe("formatOwnSlots (A7)", () => {
  it("จับกลุ่มช่วงติดกัน: 1 บรรทัดต่อช่วง (≤4 ช่วง)", () => {
    expect(formatOwnSlots([G, G, A, C, C, C, C])).toEqual([
      { label: "เม็ด 1–2", value: "โกเมน" },
      { label: "เม็ด 3", value: "อเมทิสต์" },
      { label: "เม็ด 4–7", value: "ซิทริน" },
    ]);
  });
  it("สีเดียวทั้งวง = '(ทุกเม็ด)' · สลับถี่ (>4 ช่วง) = บรรทัดเดียวเรียงทีละเม็ด", () => {
    expect(formatOwnSlots([G, G, G])).toEqual([{ label: "เม็ด 1–3", value: "โกเมน (ทุกเม็ด)" }]);
    const rows = formatOwnSlots([G, A, G, A, G, A, G]);
    expect(rows).toEqual([{ label: "เม็ด 1–7 (ซ้ายไปขวา)", value: "โกเมน · อเมทิสต์ · โกเมน · อเมทิสต์ · โกเมน · อเมทิสต์ · โกเมน" }]);
  });
  it("ไม่ถูกต้อง = null (ว่าง / รหัสนอก whitelist / ไม่ใช่ array)", () => {
    expect(formatOwnSlots([])).toBeNull();
    expect(formatOwnSlots(["garnet", "x"])).toBeNull();
    expect(formatOwnSlots("garnet")).toBeNull();
    expect(formatOwnSlots(null)).toBeNull();
  });
  it("ไม่มีคำหลัก/เสริม/เพชร/ตัวเลขบาท ในข้อความรายเม็ดทุกรูปแบบ", () => {
    for (const codes of [[G, G, G], [G, A, A], [G, A, G, A, G, A, G], [G, A, C, P, B, G]]) {
      const text = ownSlotLines(formatOwnSlots(codes) ?? []).join("\n");
      expect(text).not.toMatch(/หลัก|เสริม|เพชร|บาท|ชุด \d/);
    }
  });
});

describe("param c ของแบบแถว (A8)", () => {
  it("N ตัวอักษร ซ้าย→ขวา ตรงจำนวนเม็ดของแบบ → ได้รหัสพลอยครบ", () => {
    for (const d of ROWS) {
      const n = ownSlotCount(d);
      const codes = Array.from({ length: n }, (_, i) => GEM_QUIZ_STONE_CODES[(i * 2) % 5]);
      expect(parseOwnSlotsParam(L(codes), d.id)).toEqual(codes);
      expect(readShowcaseParams({ c: L(codes), r: d.id, d: "own" }).ownSlots).toEqual(codes);
    }
  });
  it("ลิงก์ preview D1.2 (2 รหัส · รหัสเต็มหรือตัวอักษร) ขยาย: เม็ดกลาง = ตัวแรก ที่เหลือ = ตัวที่สอง", () => {
    expect(parseOwnSlotsParam("garnet.amethyst", "bar7")).toEqual([A, A, A, G, A, A, A]);
    expect(parseOwnSlotsParam("g.a", "bar7")).toEqual([A, A, A, G, A, A, A]);
    expect(parseOwnSlotsParam("g.a", "channel6")).toEqual([A, A, G, G, A, A]);
    expect(parseOwnSlotsParam("g.a", "trinity")).toEqual([A, G, A]);
    expect(parseOwnSlotsParam("g.g", "channel4")).toEqual([G, G, G, G]);
  });
  it("c ปลอมทุกแบบ = null ไม่ crash: จำนวนผิด · ตัวใหญ่ · นอก whitelist · รหัสเต็มปนจำนวนอื่น · ว่าง · ยาวเกิน 64 · array · prototype", () => {
    const bad: unknown[] = [
      "g", "g.a.c", "g.a.c.p.b.g.a.c", "G.A.C.P.B.G.A", "g.a.c.p.b.g.x", "g.a.c.p.b.g.", ".g.a.c.p.b.g", "", "x".repeat(65),
      ("g.".repeat(40) + "g"), "garnet.amethyst.citrine.peridot.blue_topaz.garnet.amethyst", "g.a.c.p.b.g.__proto__", "g.a.c.p.b.g.constructor",
      ["g.a.c.p.b.g.a", "g.a.c.p.b.g.a"], undefined, null, 7, {},
    ];
    for (const raw of bad) {
      expect(() => parseOwnSlotsParam(raw, "bar7")).not.toThrow();
      expect(parseOwnSlotsParam(raw, "bar7")).toBeNull();
    }
    // 2 รหัสแต่ผิด
    for (const raw of ["g.x", "G.a", "garnet.cz", "g.__proto__", "garnet."]) expect(parseOwnSlotsParam(raw, "bar7")).toBeNull();
  });
  it("c ครบแต่ r ผิด/ไขว้/ไม่มี → ownSlots = null (ไขว้ไม่ใช้) · ไขว้ยังอ่าน own เดิม (รหัสเต็ม)", () => {
    expect(readShowcaseParams({ c: "g.a.c.p.b.g.a", r: "nope" }).ownSlots).toBeNull();
    expect(readShowcaseParams({ c: "g.a.c.p.b.g.a", r: "bypass2" }).ownSlots).toBeNull();
    expect(readShowcaseParams({ c: "g.a.c.p.b.g.a" }).ownSlots).toBeNull();
    const p = readShowcaseParams({ c: "garnet.citrine", d: "own" });
    expect(p.own).toEqual({ top: "garnet", bottom: "citrine" });
    expect(p.ownSlots).toBeNull();
  });
  it("buildShowcaseUrl: แถว → c=N ตัวอักษร (ก่อน d ก่อน r) · อ่านกลับได้เท่าเดิม · ไขว้ byte เดิม · จำนวนผิด = ไม่เขียน c", () => {
    const base = { table: null, intention: null, legacyTop3: null, own: null, active: "own", recIndex: 1 } as const;
    const codes = [G, A, C, P, B, G, A];
    const url = buildShowcaseUrl({ ...base, ownSlots: codes, ring: "bar7" });
    expect(url).toBe("/ring-builder?c=g.a.c.p.b.g.a&d=own&r=bar7");
    expect(readShowcaseParams(Object.fromEntries(new URL(url, "https://x.test").searchParams)).ownSlots).toEqual(codes);
    expect(buildShowcaseUrl({ ...base, own: { top: "garnet", bottom: "citrine" }, ring: "bypass2" })).toBe("/ring-builder?c=garnet.citrine&d=own");
    expect(buildShowcaseUrl({ ...base, ownSlots: codes.slice(0, 5), ring: "bar7" })).toBe("/ring-builder?d=own&r=bar7");
    expect(buildShowcaseUrl({ ...base, ownSlots: codes, ring: "bypass2" })).toBe("/ring-builder?d=own"); // ไขว้ไม่เขียนรายเม็ด
    expect(buildShowcaseUrl({ ...base, ownSlots: ["garnet", "nope"] as never, ring: "trinity" })).toBe("/ring-builder?d=own&r=trinity");
  });
});

describe("LINE ownSlots — ทุกแบบแถว × รูปแบบสี", () => {
  const patterns = (n: number): SlotCode[][] => [
    fillAll(n, G),
    Array.from({ length: n }, (_, i) => (i < n / 2 ? G : B)),
    Array.from({ length: n }, (_, i) => GEM_QUIZ_STONE_CODES[i % 5]),
    Array.from({ length: n }, (_, i) => (i % 2 ? A : C)),
  ];
  it("ราคาของแบบตัวเดียว · ไม่มีหลัก/เสริม/ชุด n/เพชร · ไม่มีราคาต่อเม็ด · ส่วนรายเม็ดตรงกับ formatOwnSlots", () => {
    for (const d of ROWS) {
      for (const codes of patterns(ownSlotCount(d))) {
        const msg = buildShowcaseLineMessage({ designId: d.id, choice: { kind: "ownSlots", codes }, size: 55 });
        expect(msg).not.toBeNull();
        const text = msg as string;
        expect(text.match(/\d[\d,]*\s*บาท/g)).toEqual([`${showcasePriceThb(d.id)} บาท`]);
        expect(text).not.toMatch(/หลัก|เสริม|ชุด \d|เพชร|CZ เล็ก/);
        expect(text).toContain("พลอย: เลือกพลอยเอง (รายเม็ด · ซ้ายไปขวา มองตรงหน้าแหวน)");
        for (const line of ownSlotLines(formatOwnSlots(codes) ?? [])) expect(text).toContain(line);
      }
    }
  });
  it("ห้ามผ่าน: จำนวนไม่ตรง · นอก whitelist · ไขว้ · ไม่ใช่ array · id แบบผิด = null (ไม่ fallback)", () => {
    const six = fillAll(6, G);
    expect(buildShowcaseLineMessage({ designId: "bar7", choice: { kind: "ownSlots", codes: six }, size: null })).toBeNull();
    expect(buildShowcaseLineMessage({ designId: "bar7", choice: { kind: "ownSlots", codes: [...fillAll(6, G), "xx" as never] }, size: null })).toBeNull();
    expect(buildShowcaseLineMessage({ designId: "bypass2", choice: { kind: "ownSlots", codes: fillAll(2, G) }, size: null })).toBeNull();
    expect(buildShowcaseLineMessage({ designId: "bar7", choice: { kind: "ownSlots", codes: "garnet" as never }, size: null })).toBeNull();
    expect(buildShowcaseLineMessage({ designId: "bar7", choice: { kind: "ownSlots" } as never, size: null })).toBeNull();
    expect(buildShowcaseLineMessage({ designId: "nope" as never, choice: { kind: "ownSlots", codes: six }, size: null })).toBeNull();
    expect(resolveChoice({ kind: "ownSlots", codes: six })).toBeNull(); // ไม่รู้แบบ = ตรวจจำนวนไม่ได้ = null
  });
  it("ยังไม่เลือก (direct unpicked) บนแบบแถว: ไม่มีบรรทัดหลัก/เสริม · บนไขว้ยังมีเดิม · rec ทุกแบบเดิม", () => {
    const row = buildShowcaseLineMessage({ designId: "bar7", choice: { kind: "direct", unpicked: true }, size: null }) as string;
    expect(row).toContain("ยังไม่ได้เลือกพลอยสี");
    expect(row).not.toMatch(/หลัก|เสริม/);
    const bypass = buildShowcaseLineMessage({ designId: "bypass2", choice: { kind: "direct", unpicked: true }, size: null }) as string;
    expect(bypass).toMatch(/พลอยหลัก \(เม็ดบน\)/);
    const rec = buildShowcaseLineMessage({ designId: "bar7", choice: { kind: "rec", index: 1, top: G, bottom: A }, size: 55 }) as string;
    expect(rec).toContain("พลอยหลัก (เม็ดกลาง): โกเมน · พลอยเสริม (เม็ดข้าง): อเมทิสต์");
  });
  it("ไขว้ kind own: ข้อความเดิมเป๊ะ", () => {
    const msg = buildShowcaseLineMessage({ designId: "bypass2", choice: { kind: "own", top: G, bottom: A }, size: 56 }) as string;
    expect(msg).toContain("พลอย: เลือกพลอยเอง\nพลอยหลัก (เม็ดบน): โกเมน · พลอยเสริม (เม็ดล่าง): อเมทิสต์ · CZ เล็ก 2 เม็ด");
  });
});

describe("describeOwnSlots (A6) + slotTints", () => {
  it("1 ชนิด = same · 2 ชนิดที่มีคู่ = pair (ไม่สนลำดับ/จำนวน) · ≥3 ชนิด = list ลำดับซ้าย→ขวาที่เจอก่อน", () => {
    expect(describeOwnSlots([G, G, G])?.kind).toBe("same");
    const ab = describeOwnSlots([G, G, C, C, C]);
    const ba = describeOwnSlots([C, G, G]);
    expect(ab?.kind).toBe("pair");
    expect(ba?.kind).toBe("pair");
    if (ab?.kind === "pair" && ba?.kind === "pair") expect(ab.pair).toBe(ba.pair);
    const l = describeOwnSlots([C, G, A, G, C]);
    expect(l?.kind).toBe("list");
    if (l?.kind === "list") expect(l.items.map((i) => i.label)).toEqual(["ซิทริน", "โกเมน", "อเมทิสต์"]);
    expect(describeOwnSlots([])).toBeNull();
  });
  it("slotTints: แถว = สีรายเม็ดซ้าย→ขวา · จำนวนไม่ตรง/ไขว้ = CZ ขาวยาวเท่าโมเดล · id ผิด throw", () => {
    const t = slotTints("bar7", [G, A, C, P, B, G, A]);
    expect(t).toHaveLength(7);
    expect(t[1]).toEqual(stoneTint(A));
    expect(slotTints("bar7", [G, A])).toEqual(Array.from({ length: 7 }, () => CZ_TINT));
    expect(slotTints("bypass2", [G, A])).toHaveLength(4);
    expect(slotTints("bypass2", [G, A]).every((x) => x === CZ_TINT)).toBe(true);
    expect(() => slotTints("nope" as ShowcaseDesignId, [])).toThrow();
    for (const id of SHOWCASE_DESIGN_IDS) expect(() => slotTints(id, [])).not.toThrow();
    expect(getShowcaseDesign("scroll6").layout).toEqual({ kind: "row", stoneCount: 6 });
  });
});
