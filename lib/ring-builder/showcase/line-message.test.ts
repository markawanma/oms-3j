// X3 + รูปข้อความ LINE: ไม่มีรหัส/ชื่อลูกค้า · ราคาจาก config · ไซซ์นอกช่วง = ไม่สร้างข้อความ
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lineOaMessageUrl } from "@/lib/shop/line";
import { SHOWCASE_PRICE_THB, SHOWCASE_SIZES } from "./config";
import { buildShowcaseLineHref, buildShowcaseLineMessage, isShowcaseSize } from "./line-message";

const base = { setIndex: 1, topLabel: "ซิทริน", bottomLabel: "โกเมน" };

describe("buildShowcaseLineMessage", () => {
  it("รูปข้อความตาม UX spec (ไซซ์ที่เลือก)", () => {
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
  it("ไม่เลือกไซซ์ = รอแอดมินช่วยเช็ก (ยังสร้างข้อความได้)", () => {
    const m = buildShowcaseLineMessage({ ...base, size: null });
    expect(m).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    expect(m).not.toContain("เบอร์");
  });
  it("เข้าตรง (setIndex null) — ไม่มี ' · แบบ n' และพลอย = CZ ขาว", () => {
    const m = buildShowcaseLineMessage({ setIndex: null, topLabel: "CZ ขาว", bottomLabel: "CZ ขาว", size: 55 }) as string;
    expect(m).toContain("แบบ: แหวนไขว้พลอยไข่ 2 เม็ด\n");
    expect(m).not.toMatch(/· แบบ \d/);
    expect(m).toContain("พลอยบน: CZ ขาว · พลอยล่าง: CZ ขาว");
  });
  it("ราคามาจากค่าคงที่ตัวเดียว · ไม่มีตัวเลขราคาอื่น", () => {
    const m = buildShowcaseLineMessage({ ...base, size: 57 }) as string;
    expect(m).toContain(`${SHOWCASE_PRICE_THB} บาท`);
    expect([...m.matchAll(/(\d[\d,]*)\s*บาท/g)].map((x) => x[1])).toEqual([String(SHOWCASE_PRICE_THB)]);
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
