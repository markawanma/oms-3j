// X3 + Y2 + Y3 + Y7 + Z2/Z3/Z5/Z10 + รูปข้อความ LINE (D1.2): ไม่มีรหัส/ชื่อลูกค้า/เรื่องที่เลือก · ราคาจาก config · ไซซ์นอกช่วง "ของแบบนั้น"/designId นอก whitelist/โหมดไม่ตรงบรรทัดแบบ = ไม่สร้างข้อความ
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { lineOaMessageUrl } from "@/lib/shop/line";
import { SHOWCASE_PRICE_THB } from "./config";
import { DESIGNS, SHOWCASE_DESIGN_IDS, getShowcaseDesign, type ShowcaseDesignId } from "./designs";
import { buildShowcaseLineHref, buildShowcaseLineMessage, isShowcaseSize, resolveChoice, type ShowcaseChoice } from "./line-message";

const rec = (index: number, top = "citrine", bottom = "garnet") => ({ kind: "rec", index, top, bottom }) as unknown as ShowcaseChoice;
const own = (top = "citrine", bottom = "garnet") => ({ kind: "own", top, bottom }) as unknown as ShowcaseChoice;
const BYPASS = "bypass2" as const;
const base = { designId: BYPASS, choice: rec(1) };

describe("buildShowcaseLineMessage — แบบไขว้ (ลิงก์ D1/D1.1 เดิม)", () => {
  it("รูปข้อความตาม UX D1.2 §7 (ชุดแนะนำ · ไซซ์ที่เลือก)", () => {
    expect(buildShowcaseLineMessage({ ...base, size: 56 })).toBe(
      [
        "สวัสดี ขอสั่งทำแหวนตามแบบนี้",
        "แบบแหวน: แหวนไขว้พลอยไข่ 2 เม็ด",
        "พลอย: ชุด 1",
        "พลอยหลัก (เม็ดบน): ซิทริน · พลอยเสริม (เม็ดล่าง): โกเมน · CZ เล็ก 2 เม็ด",
        "ไซซ์: เบอร์ 56",
        "ราคา 890 บาท (พรีออเดอร์ ทำภายใน 21 วัน)",
        "รบกวนยืนยันราคาและขั้นตอนต่อไป",
      ].join("\n")
    );
  });
  it("Y7: เลือกพลอยเอง = 'พลอย: เลือกพลอยเอง' ไม่มี 'ชุด n' · ไม่มีเรื่องที่เลือก", () => {
    const m = buildShowcaseLineMessage({ designId: BYPASS, choice: own("amethyst", "peridot"), size: 57 }) as string;
    expect(m).toContain("พลอย: เลือกพลอยเอง\n");
    expect(m).not.toMatch(/ชุด \d/);
    expect(m).toContain("พลอยหลัก (เม็ดบน): อเมทิสต์ · พลอยเสริม (เม็ดล่าง): เพอริดอท");
    expect(m).not.toMatch(/เรื่อง|ความรัก|การเงิน|intention/);
  });
  it("Y7: ชุดแนะนำ = 'ชุด n' (1–3) ไม่มีคำว่าเลือกเอง · ไม่เรียกชุดพลอยว่า 'แบบ n'", () => {
    for (const i of [1, 2, 3]) {
      const m = buildShowcaseLineMessage({ designId: BYPASS, choice: rec(i), size: 55 }) as string;
      expect(m).toContain(`พลอย: ชุด ${i}\n`);
      expect(m).not.toContain("เลือกพลอยเอง");
      expect(m).not.toMatch(/แบบ \d/);
    }
  });
  it("Y7: ชุดแนะนำที่ไม่มีเลขชุด/เลขนอก 1–3 = null · own ไม่อ่าน index (ใส่มาก็ไม่โผล่ 'ชุด n')", () => {
    for (const idx of [0, 4, -1, 1.5, NaN, undefined, null, "1"]) {
      expect(buildShowcaseLineMessage({ designId: BYPASS, choice: { kind: "rec", index: idx, top: "citrine", bottom: "garnet" } as unknown as ShowcaseChoice, size: 56 })).toBeNull();
    }
    const m = buildShowcaseLineMessage({ designId: BYPASS, choice: { kind: "own", index: 2, top: "citrine", bottom: "garnet" } as unknown as ShowcaseChoice, size: 56 }) as string;
    expect(m).not.toMatch(/ชุด \d/);
  });
  it("ไม่เลือกไซซ์ = รอแอดมินช่วยเช็ก (ยังสร้างข้อความได้)", () => {
    const m = buildShowcaseLineMessage({ ...base, size: null });
    expect(m).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    expect(m).not.toContain("เบอร์");
  });
  it("เข้าตรง (direct) — พลอย = CZ ขาว · ไม่มี 'ชุด n'", () => {
    const m = buildShowcaseLineMessage({ designId: BYPASS, choice: { kind: "direct" }, size: 55 }) as string;
    expect(m).toContain("แบบแหวน: แหวนไขว้พลอยไข่ 2 เม็ด\n");
    expect(m).toContain("พลอย: CZ ขาว\n");
    expect(m).toContain("พลอยหลัก (เม็ดบน): CZ ขาว · พลอยเสริม (เม็ดล่าง): CZ ขาว");
    expect(m).not.toMatch(/ชุด \d/);
  });
  it("direct + unpicked (เลือกเองแต่ยังไม่เลือก) = 'ยังไม่ได้เลือกพลอยสี' ตรงกับจอ", () => {
    const m = buildShowcaseLineMessage({ designId: BYPASS, choice: { kind: "direct", unpicked: true }, size: null }) as string;
    expect(m).toContain("พลอย: CZ ขาว (ยังไม่ได้เลือกพลอยสี)");
    expect(m).not.toContain("พลอย: เลือกพลอยเอง");
  });
});

describe("Z2 — ไซซ์ต้องอยู่ในช่วงของ 'แบบนั้น' (ชั้น 2 ของ line-message)", () => {
  it("ทุกแบบ × ไซซ์ 45–68: ได้ข้อความ ⇔ ไซซ์อยู่ใน sizes ของแบบ", () => {
    for (const d of DESIGNS) {
      for (let s = 45; s <= 68; s++) {
        const m = buildShowcaseLineMessage({ designId: d.id, choice: rec(1), size: s });
        expect(m === null).toBe(!d.sizes.includes(s));
        expect(isShowcaseSize(s, d.id)).toBe(d.sizes.includes(s));
        if (m) expect(m).toContain(`ไซซ์: เบอร์ ${s}`);
      }
    }
  });
  it("เลือก 50 บนแบบแถว แล้วใช้กับไขว้ = null (สลับแบบแล้วไซซ์หลุดช่วงต้องไม่ไปถึง LINE)", () => {
    expect(buildShowcaseLineMessage({ designId: "trinity", choice: rec(1), size: 50 })).not.toBeNull();
    expect(buildShowcaseLineMessage({ designId: BYPASS, choice: rec(1), size: 50 })).toBeNull();
    expect(buildShowcaseLineHref({ designId: BYPASS, choice: rec(1), size: 50 })).toBeNull();
  });
  it("ค่าแปลก: 49/61/57.5/NaN/Infinity/ไม่ใช่ number = null ทุกแบบ", () => {
    const bad: unknown[] = [49, 61, 57.5, 55.0001, NaN, Infinity, -Infinity, "56", "55", [], {}, true, 1e9, -1, 0];
    for (const d of DESIGNS) {
      for (const s of bad) {
        expect(buildShowcaseLineMessage({ designId: d.id, choice: rec(1), size: s as number })).toBeNull();
        expect(buildShowcaseLineHref({ designId: d.id, choice: rec(1), size: s as number })).toBeNull();
        expect(isShowcaseSize(s, d.id)).toBe(false);
      }
    }
  });
});

describe("Z5 — designId นอก whitelist = null (ฝั่ง LINE ไม่ fallback)", () => {
  const bad: unknown[] = ["", "nope", "BYPASS2", " bypass2", "bypass2 ", "__proto__", "constructor", "toString", "hasOwnProperty", "<b>", null, undefined, 1, {}, [], ["bypass2"]];
  it("ทุกค่าแปลก → ข้อความ/ลิงก์เป็น null · isShowcaseSize false", () => {
    for (const id of bad) {
      expect(buildShowcaseLineMessage({ designId: id as ShowcaseDesignId, choice: rec(1), size: 56 })).toBeNull();
      expect(buildShowcaseLineMessage({ designId: id as ShowcaseDesignId, choice: rec(1), size: null })).toBeNull();
      expect(buildShowcaseLineHref({ designId: id as ShowcaseDesignId, choice: rec(1), size: null })).toBeNull();
      expect(isShowcaseSize(56, id)).toBe(false);
    }
  });
  it("input ไม่มี designId เลย / input เป็น null = null ไม่ throw", () => {
    expect(buildShowcaseLineMessage({ choice: rec(1), size: 56 } as never)).toBeNull();
    expect(buildShowcaseLineMessage(null as never)).toBeNull();
  });
});

describe("ทุกแบบ × ทุก choice — ข้อความถูกแบบ (Z3 · Z10)", () => {
  const choices: [string, ShowcaseChoice][] = [
    ["rec", rec(2, "amethyst", "peridot")],
    ["own", own("blue_topaz", "citrine")],
    ["direct", { kind: "direct" }],
    ["direct-unpicked", { kind: "direct", unpicked: true }],
  ];
  for (const d of DESIGNS) {
    it(`${d.id}: ชื่อแบบ/ตำแหน่ง/CZ มาจาก designs.ts · ไม่มี "บน/ล่าง" กับแบบแถว · ไม่มี "ทั้ง 2 เม็ด"`, () => {
      for (const [, choice] of choices) {
        for (const size of [null, d.sizes[0], d.sizes[d.sizes.length - 1]]) {
          const m = buildShowcaseLineMessage({ designId: d.id, choice, size }) as string;
          expect(m).toContain(`แบบแหวน: ${d.name}\n`);
          expect(m).toContain(`พลอยหลัก (${d.positions.main})`);
          expect(m).toContain(`พลอยเสริม (${d.positions.sub})`);
          if (d.extraCz > 0) expect(m).toContain(`CZ เล็ก ${d.extraCz} เม็ด`);
          else expect(m).not.toContain("CZ เล็ก");
          if (d.layout.kind === "row") expect(m).not.toMatch(/เม็ดบน|เม็ดล่าง|พลอยบน|พลอยล่าง/);
          expect(m).not.toContain("ทั้ง 2 เม็ด");
          // Z3: ราคาตัวเดียว = 890
          expect([...m.matchAll(/(\d[\d,]*)\s*บาท/g)].map((x) => x[1])).toEqual([String(SHOWCASE_PRICE_THB)]);
          // Y7: ชุด n ⇔ ชุดแนะนำเท่านั้น
          const isRec = (choice as { kind: string }).kind === "rec";
          expect(/ชุด \d/.test(m)).toBe(isRec);
          expect(m.includes("พลอย: เลือกพลอยเอง")).toBe((choice as { kind: string }).kind === "own");
          expect(m).not.toMatch(/เพชร|http|3JR|QR/i);
        }
      }
    });
  }
  it("แบบแถว 2 เม็ดกลาง/1 เม็ดกลาง ตามจำนวนเม็ด", () => {
    expect(getShowcaseDesign("trinity").positions.main).toBe("เม็ดกลาง");
    expect(getShowcaseDesign("channel4").positions.main).toBe("เม็ดกลาง 2 เม็ด");
    expect(buildShowcaseLineMessage({ designId: "channel6", choice: rec(1), size: 55 })).toContain("พลอยหลัก (เม็ดกลาง 2 เม็ด)");
  });
  it("Y3: ราคามาจากค่าคงที่ตัวเดียว ทุก 25 คู่ × เลือกเอง/แนะนำ × 7 แบบ", () => {
    let n = 0;
    for (const d of DESIGNS)
      for (const a of GEM_QUIZ_STONE_CODES)
        for (const b of GEM_QUIZ_STONE_CODES) {
          for (const choice of [own(a, b), rec(2, a, b)]) {
            const m = buildShowcaseLineMessage({ designId: d.id, choice, size: d.sizes[1] }) as string;
            expect([...m.matchAll(/(\d[\d,]*)\s*บาท/g)].map((x) => x[1])).toEqual([String(SHOWCASE_PRICE_THB)]);
            n++;
          }
        }
    expect(n).toBe(7 * 50);
  });
});

describe("Y2: รหัสพลอยต้องอยู่ใน 5 ชนิด (ตรวจที่นี่เอง ไม่เชื่อ UI)", () => {
  const badCodes: unknown[] = ["cz_white", "CZ ขาว", "ruby", "diamond", "constructor", "__proto__", "toString", "", " garnet", "Garnet", "<b>", null, undefined, 1, {}, []];
  it("rec/own ที่ top หรือ bottom ผิด = null ทั้งข้อความและลิงก์ · ไม่มีค่าดิบหลุดลงข้อความ", () => {
    for (const designId of SHOWCASE_DESIGN_IDS) {
      for (const bad of badCodes) {
        for (const kind of ["rec", "own"] as const) {
          for (const choice of [
            { kind, index: 1, top: bad, bottom: "garnet" },
            { kind, index: 1, top: "garnet", bottom: bad },
          ] as unknown as ShowcaseChoice[]) {
            expect(buildShowcaseLineMessage({ designId, choice, size: null })).toBeNull();
            expect(buildShowcaseLineHref({ designId, choice, size: null })).toBeNull();
            expect(resolveChoice(choice)).toBeNull();
          }
        }
      }
    }
  });
  it("kind แปลก/choice ไม่ใช่ object = null", () => {
    for (const choice of [{ kind: "cz" }, { kind: "" }, { kind: "constructor" }, {}, null, undefined, "own", 1, []]) {
      expect(buildShowcaseLineMessage({ designId: BYPASS, choice: choice as unknown as ShowcaseChoice, size: 56 })).toBeNull();
    }
  });
  it("ทุกชนิดพลอย 5×5 ผ่านทุกแบบ", () => {
    for (const d of DESIGNS) for (const a of GEM_QUIZ_STONE_CODES) for (const b of GEM_QUIZ_STONE_CODES) expect(buildShowcaseLineMessage({ designId: d.id, choice: own(a, b), size: null })).not.toBeNull();
  });
});

describe("buildShowcaseLineHref", () => {
  it("ใช้ lineOaMessageUrl ตัวเดียวกับทั้งแอป (ไม่พิมพ์ LINE ID/URL เอง)", () => {
    const msg = buildShowcaseLineMessage({ ...base, size: 56 }) as string;
    expect(buildShowcaseLineHref({ ...base, size: 56 })).toBe(lineOaMessageUrl(msg));
  });
  it("source ของ showcase ไม่มี LINE ID/URL ฮาร์ดโค้ด", () => {
    const src = readFileSync(new URL("./line-message.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/line\.me|lin\.ee|@3j|3jjewelry/i);
  });
});
