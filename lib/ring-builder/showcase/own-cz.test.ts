// own-cz — "CZ ขาว" เป็นตัวเลือกที่ 6 ต่อเม็ด (โหมดเลือกพลอยเอง · แบบแถว) · URL `c` รหัส z · ข้อความ/สี/คำอธิบาย
import { describe, expect, it } from "vitest";
import type { GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { CZ_WHITE } from "../config";
import { CZ_TINT, czIconColors, slotTints, stoneTint } from "../viewer/gem-colors";
import { showcasePriceThb, SHOWCASE_COPY } from "./config";
import { DESIGNS, ownSlotCount, isSingleStone } from "./designs";
import { buildShowcaseLineMessage, resolveChoice } from "./line-message";
import { fillAll, fitOwnToCount, formatOwnSlots, isAllCz, isOwnSlots, ownSlotLines, ownSlotsAria } from "./own-slots";
import { buildShowcaseUrl, CZ_SLOT, parseOwnParam, parseOwnSlotsParam, readShowcaseParams, type SlotCode } from "./quiz-link";
import { describeOwnSlots } from "./sets";

const G: GemQuizStoneCode = "garnet";
const A: GemQuizStoneCode = "amethyst";
const Z = CZ_SLOT;
// แบบแถวหลายเม็ด (≥3) — เม็ดเดี่ยวมีข้อความ/ข้อห้ามต่างออกไป (Z13) ทดสอบแยกใน solitaire.test.ts
const ROWS = DESIGNS.filter((d) => d.layout.kind === "row" && !isSingleStone(d));
const row = (n: number) => ROWS.find((d) => ownSlotCount(d) === n)!;
const rowOf = (n: number) => row(n).id;

describe("URL c — z = CZ ขาว", () => {
  it("ผ่าน: ผสม z / ทั้งหมด z · ตัวอักษรเดิมยังทำงาน", () => {
    const id = rowOf(3);
    expect(parseOwnSlotsParam("g.z.a", id)).toEqual([G, Z, A]);
    expect(parseOwnSlotsParam("z.z.z", id)).toEqual([Z, Z, Z]);
    expect(parseOwnSlotsParam("g.g.a", id)).toEqual([G, G, A]);
  });
  it("ไม่ผ่าน (null · ไม่ throw): ตัวพิมพ์ใหญ่ · cz เต็ม · จำนวนไม่ตรง · รหัสนอก whitelist · ไขว้", () => {
    const id = rowOf(3);
    for (const bad of ["g.Z.a", "g.cz.a", "g.z", "z.z", "g.z.a.z", "g.x.a", "", "z.z.z.", "__proto__"]) {
      expect(parseOwnSlotsParam(bad, id), bad).toBeNull();
    }
    expect(parseOwnSlotsParam("g.z.a", "cross")).toBeNull();
    expect(parseOwnSlotsParam(["g.z.a"], id)).toBeNull();
  });
  it("c ของไขว้ (รหัสเต็ม) รับ cz · ไม่รับตัวอักษร z · ลิงก์เดิมพลอยล้วนเหมือนเดิม", () => {
    expect(parseOwnParam("z.garnet")).toBeNull();
    expect(parseOwnParam("garnet.z")).toBeNull();
    expect(parseOwnParam("cz.garnet")).toEqual({ top: Z, bottom: G });
    expect(parseOwnParam("garnet.cz")).toEqual({ top: G, bottom: Z });
    expect(parseOwnParam("cz.cz")).toEqual({ top: Z, bottom: Z });
    expect(parseOwnParam("garnet.amethyst")).toEqual({ top: G, bottom: A });
    expect(parseOwnParam("CZ.garnet")).toBeNull();
    expect(parseOwnParam("cz")).toBeNull();
    expect(parseOwnParam("cz.cz.cz")).toBeNull();
    // round-trip: สร้าง URL → อ่านกลับ · พลอยล้วน = byte เดิม
    for (const own of [{ top: Z, bottom: G }, { top: G, bottom: Z }, { top: Z, bottom: Z }, { top: G, bottom: A }] as const) {
      const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own, active: "own", recIndex: 1 });
      expect(url).toBe(`/ring-builder?c=${own.top}.${own.bottom}&d=own`);
      expect(readShowcaseParams(Object.fromEntries(new URLSearchParams(url.split("?")[1]))).own).toEqual(own);
    }
  });
  it("round-trip สร้าง→อ่านทุกแบบแถว + เขียน z เฉพาะแบบแถว", () => {
    for (const d of ROWS) {
      const n = ownSlotCount(d);
      const codes: SlotCode[] = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? Z : G));
      const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: codes, active: "own", recIndex: 1, ring: d.id });
      const q = new URLSearchParams(url.split("?")[1]);
      expect(q.get("c")).toBe(codes.map((c) => (c === Z ? "z" : "g")).join("."));
      expect(readShowcaseParams(Object.fromEntries(q)).ownSlots).toEqual(codes);
    }
    // ownSlots มีรหัสนอก whitelist = ไม่เขียน c
    const bad = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: ["g", "x", "a"] as unknown as SlotCode[], active: "own", recIndex: 1, ring: rowOf(3) });
    expect(bad).not.toContain("c=");
  });
});

describe("own-slots helpers", () => {
  it("isOwnSlots รับ cz · isAllCz · fillAll cz", () => {
    expect(isOwnSlots([G, Z, A], 3)).toBe(true);
    expect(isOwnSlots([G, "CZ", A], 3)).toBe(false);
    expect(isAllCz(fillAll(5, Z))).toBe(true);
    expect(isAllCz([Z, Z, G])).toBe(false);
  });
  it("formatOwnSlots: CZ จับช่วงเหมือนพลอยอื่น · ทุกเม็ด CZ = ข้อความเดียว · ไม่มีคำ เพชร/หลัก/เสริม", () => {
    expect(formatOwnSlots([G, G, Z, Z, A])).toEqual([
      { label: "เม็ด 1–2", value: "โกเมน" },
      { label: "เม็ด 3–4", value: CZ_WHITE.name },
      { label: "เม็ด 5", value: "อเมทิสต์" },
    ]);
    const all = formatOwnSlots(fillAll(7, Z))!;
    expect(all).toEqual([{ label: "เม็ด 1–7", value: "CZ ขาวทุกเม็ด" }]);
    const text = ownSlotLines(formatOwnSlots([G, Z, G, Z, G, Z, G])!).join("\n") + ownSlotsAria(all);
    expect(text).not.toMatch(/เพชร|หลัก|เสริม/);
  });
  it("fitOwnToCount: แถว↔ไขว้ ส่ง CZ ต่อได้ · แถว CZ ล้วน→ไขว้ CZ ล้วน · แถว↔แถวคง CZ", () => {
    expect(fitOwnToCount([G, Z, Z], 7)).toEqual([G, G, G, Z, Z, Z, Z].map((c, i) => [G, Z, Z][Math.min(Math.max(i + Math.floor((3 - 7) / 2), 0), 2)]));
    expect(fitOwnToCount([Z, G, Z, A, Z], 2)).toEqual([Z, Z]); // บน = เม็ดกลาง (เม็ด 3) · ล่าง = เม็ด 1
    expect(fitOwnToCount([G, A, Z, A, G], 2)).toEqual([Z, G]);
    expect(fitOwnToCount(fillAll(5, Z), 2)).toEqual([Z, Z]);
    expect(fitOwnToCount([Z, G], 7)![3]).toBe(Z);
    expect(fitOwnToCount([Z, G], 7)![0]).toBe(G);
    expect(fitOwnToCount([G, Z, A], 3)).toEqual([G, Z, A]);
  });
});

describe("LINE + resolveChoice", () => {
  it("ผสม CZ: ราคาของแบบตัวเดียว · มี CZ ขาวในกลุ่มช่วง · ไม่มี เพชร", () => {
    const d = row(6);
    const msg = buildShowcaseLineMessage({ designId: d.id, choice: { kind: "ownSlots", codes: [G, G, Z, Z, A, A] }, size: null })!;
    expect(msg).toContain("เม็ด 3–4: CZ ขาว");
    expect(msg).not.toContain("เพชร");
    expect(msg.match(/ราคา [^\n]*/g)).toHaveLength(1);
    expect(msg).toContain(showcasePriceThb(d.id).toLocaleString("en-US"));
  });
  it("ทุกเม็ด CZ = ข้อความเดียว", () => {
    const d = row(7);
    const msg = buildShowcaseLineMessage({ designId: d.id, choice: { kind: "ownSlots", codes: fillAll(7, Z) }, size: null })!;
    expect(msg).toContain("เม็ด 1–7: CZ ขาวทุกเม็ด");
  });
  it("ผิด → null: รหัสนอก whitelist · จำนวนไม่ตรง · ไขว้", () => {
    const d = row(3);
    expect(resolveChoice({ kind: "ownSlots", codes: [G, "cz2", A] }, d)).toBeNull();
    expect(resolveChoice({ kind: "ownSlots", codes: [G, Z] }, d)).toBeNull();
    expect(resolveChoice({ kind: "ownSlots", codes: [Z, Z, Z] }, DESIGNS.find((x) => x.layout.kind !== "row"))).toBeNull();
  });
});

describe("describeOwnSlots — CZ ไม่นับเป็นชนิดพลอย", () => {
  it("โกเมน+CZ = คำอธิบายโกเมนตัวเดียว (withCz) · CZ ล้วน = null · ไม่มี CZ = ไม่ใช่ withCz", () => {
    const d = describeOwnSlots([G, Z, G, Z, Z]);
    expect(d?.kind).toBe("same");
    expect(d && d.kind === "same" && d.withCz).toBe(true);
    expect(describeOwnSlots(fillAll(5, Z))).toBeNull();
    const plain = describeOwnSlots([G, G, G]);
    expect(plain && plain.kind === "same" && plain.withCz).toBe(false);
  });
  it("2 ชนิด + CZ ยังเป็นคู่/รายการของ 2 ชนิดนั้น (ไม่มีรายการของ CZ)", () => {
    const d = describeOwnSlots([G, Z, A, Z, Z]);
    if (d?.kind === "list") expect(d.items).toHaveLength(2);
    else expect(d?.kind).toBe("pair");
  });
});

describe("3D tint", () => {
  it("cz = CZ_TINT เดิม (ไม่มีค่าสีใหม่) · เม็ดอื่นคงสีเดิม · ยาวเท่าจำนวนเม็ด", () => {
    const d = row(3);
    const t = slotTints(d.id, [G, Z, A]);
    expect(t).toHaveLength(3);
    expect(t[1]).toBe(CZ_TINT);
    expect(t[0]).toEqual(stoneTint(G));
    expect(t[1].cz).toBe(true);
    expect(slotTints(d.id, [Z, Z, Z]).every((x) => x === CZ_TINT)).toBe(true);
  });
  it("ไอคอน 2D ได้จาก CZ_TINT/CZ_WHITE (hex ถูกรูป)", () => {
    const c = czIconColors();
    for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    expect(c.light).toBe(CZ_WHITE.colorHex);
  });
});

describe("copy", () => {
  it("ข้อความที่มีชื่อ CZ เว้นวรรคถูก · ชื่อไทยไม่เปลี่ยน", () => {
    expect(SHOWCASE_COPY.ownFillAll("CZ ขาว")).toBe("ใส่ CZ ขาวทุกเม็ด");
    expect(SHOWCASE_COPY.ownFillAll("โกเมน")).toBe("ใส่โกเมนทุกเม็ด");
    expect(SHOWCASE_COPY.ownSlotsAnnounce(2, "CZ ขาว")).toBe("เม็ดที่ 2 เป็น CZ ขาวแล้ว");
  });
});
