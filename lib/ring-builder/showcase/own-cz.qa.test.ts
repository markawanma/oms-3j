// QA ของ own-cz — เน้นเคส "ห้ามผ่าน" + เมทริกซ์ LINE 6 แบบแถว × รูปแบบ CZ × ไซซ์ + ค่าภายนอก
import { describe, expect, it } from "vitest";
import type { GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { slotTints } from "../viewer/gem-colors";
import { SHOWCASE_PRICE_THB } from "./config";
import { DESIGNS, ownSlotCount } from "./designs";
import { buildShowcaseLineHref, buildShowcaseLineMessage } from "./line-message";
import { fillAll, fitOwnToCount } from "./own-slots";
import { buildShowcaseUrl, CZ_SLOT, parseOwnSlotsParam, readShowcaseParams, type SlotCode } from "./quiz-link";
import { describeOwnSlots } from "./sets";

const G: GemQuizStoneCode = "garnet";
const A: GemQuizStoneCode = "amethyst";
const Z = CZ_SLOT;
const ROWS = DESIGNS.filter((d) => d.layout.kind === "row");
const cross = DESIGNS.find((d) => d.layout.kind !== "row")!;

describe("QA: c fuzz — ไม่ throw, ไม่ผ่านค่าเพี้ยน, ไม่เขียนค่าดิบกลับ URL", () => {
  const BAD = ["zzz", "Z.Z.Z", "z.z.Z", "z,z,z", "z z z", "z..z", ".z.z", "z.z.z\n", " z.z.z", "ｚ.ｚ.ｚ", "z.z.z\u0000", "z.z.ซ", "🙂.z.z", "z.z.z;c=g", "z.z.z&r=bar7", "cz.cz.cz", "g.z.constructor", "toString.z.g", "z".repeat(65), "z.".repeat(40) + "z"];
  for (const d of ROWS) {
    it(`${d.id}: ค่าเพี้ยนทั้งหมด = null`, () => {
      for (const b of BAD) expect(parseOwnSlotsParam(b, d.id), JSON.stringify(b)).toBeNull();
      for (const nb of [null, undefined, 0, 1, true, {}, [], ["z"], ["z", "z", "z"], Symbol.iterator] as unknown[]) expect(parseOwnSlotsParam(nb, d.id)).toBeNull();
    });
    it(`${d.id}: z ล้วน ครบจำนวน = ถูก · ขาด/เกิน 1 = null · round-trip ไม่เปลี่ยนค่า`, () => {
      const n = ownSlotCount(d);
      const ok = Array(n).fill("z").join(".");
      expect(parseOwnSlotsParam(ok, d.id)).toEqual(Array(n).fill(Z));
      if (n !== 3) expect(parseOwnSlotsParam(Array(n - 1).fill("z").join("."), d.id)).toBeNull();
      expect(parseOwnSlotsParam(Array(n + 1).fill("z").join("."), d.id)).toBeNull();
      const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: Array(n).fill(Z), active: "own", recIndex: 1, ring: d.id });
      expect(url).toContain(`c=${ok}`);
    });
    it(`${d.id}: ลิงก์เสีย → ownSlots=null → URL ที่สร้างใหม่ไม่มีค่าดิบ`, () => {
      const p = readShowcaseParams({ c: "z.Z.z", d: "own", r: d.id });
      expect(p.ownSlots).toBeNull();
      const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: p.ownSlots, active: "own", recIndex: 1, ring: p.ring });
      expect(url).not.toMatch(/Z|c=/);
    });
  }
  it("ไขว้: c ที่มี z ไม่กลายเป็น own · URL ไขว้ไม่มี z ไม่ว่า state ใด", () => {
    expect(readShowcaseParams({ c: "z.garnet", d: "own", r: cross.id }).own).toBeNull();
    expect(readShowcaseParams({ c: "z.g", d: "own" }).ownSlots).toBeNull();
    const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: null, ownSlots: [Z, Z] as SlotCode[], active: "own", recIndex: 1, ring: cross.id });
    expect(url).not.toMatch(/c=.*z|z\./);
  });
  it("URL ไขว้ byte เดิม (golden)", () => {
    const url = buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: { top: G, bottom: A }, active: "own", recIndex: 1, ring: cross.id });
    expect(url).toBe(buildShowcaseUrl({ table: null, intention: null, legacyTop3: null, own: { top: G, bottom: A }, ownSlots: null, active: "own", recIndex: 1 }));
    expect(url).toContain("c=garnet.amethyst");
    expect(url).not.toContain("r=");
  });
});

describe("QA: LINE เมทริกซ์ 6 แบบแถว × (CZ ล้วน · ผสม · ไม่มี CZ) × ไซซ์", () => {
  it("มี 6 แบบแถว", () => expect(ROWS).toHaveLength(6));
  for (const d of ROWS) {
    const n = ownSlotCount(d);
    const patterns: Record<string, SlotCode[]> = {
      allCz: fillAll(n, Z),
      mixed: Array.from({ length: n }, (_, i) => (i % 2 ? Z : i % 3 === 0 ? G : A)),
      czEdgeRun: Array.from({ length: n }, (_, i) => (i < 2 || i >= n - 1 ? Z : G)),
      noCz: Array.from({ length: n }, (_, i) => (i < n / 2 ? G : A)),
    };
    for (const [pname, codes] of Object.entries(patterns)) {
      for (const size of [null, ...d.sizes]) {
        it(`${d.id} · ${pname} · size ${size}`, () => {
          const msg = buildShowcaseLineMessage({ designId: d.id, choice: { kind: "ownSlots", codes }, size })!;
          expect(msg).toBeTruthy();
          // ราคาตัวเดียว = 890
          expect(msg.match(/\d[\d,]*\s*บาท/g)).toEqual([`${SHOWCASE_PRICE_THB.toLocaleString("en-US")} บาท`]);
          expect(msg).not.toMatch(/เพชร|พลอยหลัก|พลอยเสริม|diamond/i);
          const czs = codes.filter((c) => c === Z).length;
          if (czs === n) expect(msg).toContain(`เม็ด 1–${n}: CZ ขาวทุกเม็ด`);
          else if (czs > 0) expect(msg).toContain("CZ ขาว");
          else expect(msg).not.toContain("CZ ขาว\n");
          // ลิงก์ภายนอก: เฉพาะ @3jjewelry (LINE_OA_URL เดิม) · ข้อความไม่มี URL อื่น
          expect(msg).not.toMatch(/https?:\/\//);
          const href = buildShowcaseLineHref({ designId: d.id, choice: { kind: "ownSlots", codes }, size })!;
          expect(href).toMatch(/^https:\/\/line\.me\/R\/oaMessage\/%403jjewelry\/\?/);
          expect(href.match(/https?:\/\//g)).toHaveLength(1);
        });
      }
    }
  }
});

describe("QA: คำอธิบายพลอย — CZ ไม่มีความหมาย", () => {
  it("CZ ล้วน → null · โกเมน+CZ = same ตัวเดียว (ไม่มีรายการ CZ) · keywords ตรง config", () => {
    expect(describeOwnSlots(fillAll(3, Z))).toBeNull();
    const d = describeOwnSlots([Z, G, Z]);
    expect(d).toMatchObject({ kind: "same", code: G, withCz: true });
    expect(JSON.stringify(describeOwnSlots([G, Z, A, Z, Z]))).not.toMatch(/CZ ขาว|"cz"/);
    for (const x of [[G, Z], [Z, A, G, Z, Z, G], [A, A, Z]] as SlotCode[][]) expect(JSON.stringify(describeOwnSlots(x))).not.toMatch(/CZ ขาว|"cz"/);
  });
  it("ไม่มี CZ = พฤติกรรมเดิม (withCz=false)", () => {
    expect(describeOwnSlots([G, G])).toMatchObject({ kind: "same", withCz: false });
    expect(describeOwnSlots([])).toBeNull();
  });
});

describe("QA: fitOwnToCount + tints ขอบเขต", () => {
  it("ทุกคู่จำนวน (2,3,4,6,7) × (CZ ล้วน/ผสม) ไม่ throw · ไป 2 เม็ดไม่มี z · แถว↔แถวคง z", () => {
    const counts = [2, 3, 4, 6, 7];
    for (const a of counts) for (const b of counts) {
      for (const mk of [() => fillAll(a, Z), () => Array.from({ length: a }, (_, i) => (i % 2 ? Z : G))] as (() => SlotCode[])[]) {
        const src = a === 2 ? ([G, A] as SlotCode[]) : mk();
        const out = fitOwnToCount(src, b);
        if (out === null) { expect(b === 2 || a === 2).toBe(true); continue; }
        expect(out).toHaveLength(b);
        if (b === 2) expect(out.includes(Z)).toBe(false);
      }
    }
    expect(fitOwnToCount([Z, Z, Z], 7)).toEqual(fillAll(7, Z));
  });
  it("2 เม็ดที่มี z (นอก type) → null ไม่ throw · tints จำนวนไม่ตรง = CZ ทั้งหมด", () => {
    expect(fitOwnToCount([Z, G] as SlotCode[], 5)).toBeNull();
    for (const d of ROWS) expect(slotTints(d.id, [Z])).toHaveLength(ownSlotCount(d));
  });
});
