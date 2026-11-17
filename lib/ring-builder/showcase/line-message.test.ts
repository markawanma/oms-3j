// X3 + Y2 + Y3 + Y7 + รูปข้อความ LINE: ไม่มีรหัส/ชื่อลูกค้า/เรื่องที่เลือก · ราคาจาก config · ไซซ์นอกช่วง/โหมดไม่ตรงบรรทัดแบบ = ไม่สร้างข้อความ
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { lineOaMessageUrl } from "@/lib/shop/line";
import { SHOWCASE_PRICE_THB, SHOWCASE_SIZES } from "./config";
import { buildShowcaseLineHref, buildShowcaseLineMessage, isShowcaseSize, resolveChoice, type ShowcaseChoice } from "./line-message";

const rec = (index: number, top = "citrine", bottom = "garnet") => ({ kind: "rec", index, top, bottom }) as unknown as ShowcaseChoice;
const own = (top = "citrine", bottom = "garnet") => ({ kind: "own", top, bottom }) as unknown as ShowcaseChoice;
const base = { choice: rec(1) };

describe("buildShowcaseLineMessage", () => {
  it("รูปข้อความตาม UX spec (แบบแนะนำ · ไซซ์ที่เลือก)", () => {
    expect(buildShowcaseLineMessage({ ...base, size: 56 })).toBe(
      [
        "สวัสดี ขอสั่งทำแหวนตามแบบนี้",
        "แบบ: แหวนไขว้พลอยไข่ 2 เม็ด · แบบ 1",
        "พลอยบน: ซิทริน · พลอยล่าง: โกเมน · CZ เล็ก 2 เม็ด",
        "ไซซ์: เบอร์ 56",
        "ราคา 800 บาท (พรีออเดอร์ ทำภายใน 21 วัน)",
        "รบกวนยืนยันราคาและขั้นตอนต่อไป",
      ].join("\n")
    );
  });
  it("Y7: เลือกพลอยเอง = '· เลือกพลอยเอง' ไม่มี 'แบบ n' · ไม่มีเรื่องที่เลือก", () => {
    const m = buildShowcaseLineMessage({ choice: own("amethyst", "peridot"), size: 57 }) as string;
    expect(m).toContain("แบบ: แหวนไขว้พลอยไข่ 2 เม็ด · เลือกพลอยเอง\n");
    expect(m).not.toMatch(/· แบบ \d/);
    expect(m).toContain("พลอยบน: อเมทิสต์ · พลอยล่าง: เพอริดอท");
    expect(m).not.toMatch(/เรื่อง|ความรัก|การเงิน|intention/);
  });
  it("Y7: แบบแนะนำ = 'แบบ n' (1–3) ไม่มีคำว่าเลือกเอง", () => {
    for (const i of [1, 2, 3]) {
      const m = buildShowcaseLineMessage({ choice: rec(i), size: 55 }) as string;
      expect(m).toContain(`· แบบ ${i}\n`);
      expect(m).not.toContain("เลือกพลอยเอง");
    }
  });
  it("Y7: แบบแนะนำที่ไม่มีเลขแบบ/เลขนอก 1–3 = null · own ไม่อ่าน index (ใส่มาก็ไม่โผล่ 'แบบ n')", () => {
    for (const idx of [0, 4, -1, 1.5, NaN, undefined, null, "1"]) {
      expect(buildShowcaseLineMessage({ choice: { kind: "rec", index: idx, top: "citrine", bottom: "garnet" } as unknown as ShowcaseChoice, size: 56 })).toBeNull();
    }
    const m = buildShowcaseLineMessage({ choice: { kind: "own", index: 2, top: "citrine", bottom: "garnet" } as unknown as ShowcaseChoice, size: 56 }) as string;
    expect(m).not.toMatch(/· แบบ \d/);
  });
  it("ไม่เลือกไซซ์ = รอแอดมินช่วยเช็ก (ยังสร้างข้อความได้)", () => {
    const m = buildShowcaseLineMessage({ ...base, size: null });
    expect(m).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    expect(m).not.toContain("เบอร์");
  });
  it("เข้าตรง (direct) — ไม่มี ' · แบบ n' และพลอย = CZ ขาว", () => {
    const m = buildShowcaseLineMessage({ choice: { kind: "direct" }, size: 55 }) as string;
    expect(m).toContain("แบบ: แหวนไขว้พลอยไข่ 2 เม็ด\n");
    expect(m).not.toMatch(/· แบบ \d/);
    expect(m).toContain("พลอยบน: CZ ขาว · พลอยล่าง: CZ ขาว");
  });
  it("Y3: ราคามาจากค่าคงที่ตัวเดียว ทุก 25 คู่ × เลือกเอง/แนะนำ · ไม่มีตัวเลขราคาอื่น", () => {
    let n = 0;
    for (const a of GEM_QUIZ_STONE_CODES)
      for (const b of GEM_QUIZ_STONE_CODES) {
        for (const choice of [own(a, b), rec(2, a, b)]) {
          const m = buildShowcaseLineMessage({ choice, size: 57 }) as string;
          expect(m).toContain(`${SHOWCASE_PRICE_THB} บาท`);
          expect([...m.matchAll(/(\d[\d,]*)\s*บาท/g)].map((x) => x[1])).toEqual([String(SHOWCASE_PRICE_THB)]);
          n++;
        }
      }
    expect(n).toBe(50);
  });
  it("ไม่มีสิ่งที่ดูเหมือนรหัสยืนยัน/QR/ข้อมูลส่วนบุคคล/คำว่าเพชร", () => {
    const m = buildShowcaseLineMessage({ ...base, size: 58 }) as string;
    expect(m).not.toMatch(/3JR|รหัส|QR|เบอร์โทร|ชื่อ-|เพชร|http/i);
  });
  it("X3: ไซซ์ที่ถูกทุกตัวสร้างได้ · ไซซ์นอก 55–58 / ไม่ใช่ integer / ไม่ใช่ number = null", () => {
    for (const s of SHOWCASE_SIZES) expect(buildShowcaseLineMessage({ ...base, size: s })).not.toBeNull();
    const bad: unknown[] = [54, 59, 0, -1, 45, 68, 55.5, 56.0001, NaN, Infinity, -Infinity, "56", "55", [], {}, true, 1e9];
    for (const s of bad) {
      expect(buildShowcaseLineMessage({ ...base, size: s as number })).toBeNull();
      expect(buildShowcaseLineHref({ ...base, size: s as number })).toBeNull();
      expect(isShowcaseSize(s)).toBe(false);
    }
  });
});

describe("Y2: รหัสพลอยต้องอยู่ใน 5 ชนิด (ตรวจที่นี่เอง ไม่เชื่อ UI)", () => {
  const badCodes: unknown[] = ["cz_white", "CZ ขาว", "ruby", "diamond", "constructor", "__proto__", "toString", "", " garnet", "Garnet", "<b>", null, undefined, 1, {}, []];
  it("rec/own ที่ top หรือ bottom ผิด = null ทั้งข้อความและลิงก์ · ไม่มีค่าดิบหลุดลงข้อความ", () => {
    for (const bad of badCodes) {
      for (const kind of ["rec", "own"] as const) {
        for (const choice of [
          { kind, index: 1, top: bad, bottom: "garnet" },
          { kind, index: 1, top: "garnet", bottom: bad },
        ] as unknown as ShowcaseChoice[]) {
          expect(buildShowcaseLineMessage({ choice, size: 56 })).toBeNull();
          expect(buildShowcaseLineHref({ choice, size: 56 })).toBeNull();
          expect(resolveChoice(choice)).toBeNull();
        }
      }
    }
  });
  it("kind แปลก/choice ไม่ใช่ object = null", () => {
    for (const choice of [{ kind: "cz" }, { kind: "" }, { kind: "constructor" }, {}, null, undefined, "own", 1, []]) {
      expect(buildShowcaseLineMessage({ choice: choice as unknown as ShowcaseChoice, size: 56 })).toBeNull();
    }
  });
  it("ทุกชนิดพลอย 5×5 ผ่าน", () => {
    for (const a of GEM_QUIZ_STONE_CODES) for (const b of GEM_QUIZ_STONE_CODES) expect(buildShowcaseLineMessage({ choice: own(a, b), size: null })).not.toBeNull();
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
