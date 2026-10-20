// lib/oem/metal-price.test.ts — ตัวแปลงราคาทอง/ทองเหลือง (PM-A · 0186)
// เวกเตอร์ชุดเดียวกับ scripts/verify/verify-0186.sql G1-G4 (DB เป็นผู้ตัดสิน — ไฟล์นี้พิสูจน์ว่าสำเนา pure ฝั่ง client ไม่เพี้ยนจาก DB)
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRASS_PRICE_RANGE_PER_KG,
  GOLD_ASSOC_PURITY,
  GOLD_GRAM_PER_BAHT,
  METAL_PRICE_INPUT_UNIT,
  METAL_PRICE_RANGE_PER_GRAM,
  brassKgToPerGram,
  brassPerGramToKgText,
  convertMetalPriceInput,
  goldAssocToPerGram100,
  isMetalPricePerGramInRange,
  metalPriceInputIssueMessage,
  metalPricePerGramRangeMessage,
} from "./metal-price";

describe("goldAssocToPerGram100 — ราคาสมาคม ทองคำแท่ง 96.5% ขายออก บาทละ → บาท/กรัม ทอง 100% (÷15.244 ÷0.965)", () => {
  it("ขอบล่าง/ขอบบน (2 จุดที่ผ่าน): 29,420.92 → 2000.0000 · 117,683.68 → 8000.0000", () => {
    const lo = goldAssocToPerGram100("29420.92");
    const hi = goldAssocToPerGram100("117683.68");
    expect(lo).toMatchObject({ ok: true, perGramText: "2000.0000", perGram: 2000 });
    expect(hi).toMatchObject({ ok: true, perGramText: "8000.0000", perGram: 8000 });
  });

  it("ขอบนอก 4 จุดที่ตก — ตรวจที่ค่าต่อกรัมก่อนปัด · ข้อความแสดงค่าที่แปลงแล้ว", () => {
    expect(goldAssocToPerGram100("29420.91")).toMatchObject({ ok: false, issue: "range", perGramText: "1999.9993" });
    expect(goldAssocToPerGram100("29420")).toMatchObject({ ok: false, issue: "range", perGramText: "1999.9375" });
    expect(goldAssocToPerGram100("117683.69")).toMatchObject({ ok: false, issue: "range", perGramText: "8000.0007" });
    expect(goldAssocToPerGram100("117684")).toMatchObject({ ok: false, issue: "range", perGramText: "8000.0218" });
  });

  it("เวกเตอร์เดียวกับ verify-0186 G3f/G3g (BigInt ปัดครึ่งขึ้นที่ 4 ตำแหน่ง ตรง numeric ของ Postgres)", () => {
    expect(goldAssocToPerGram100("41250")).toMatchObject({ ok: true, perGramText: "2804.1271" });
    expect(goldAssocToPerGram100("30000")).toMatchObject({ ok: true, perGramText: "2039.3652" });
    expect(goldAssocToPerGram100("50000")).toMatchObject({ ok: true, perGramText: "3398.9420" });
    expect(goldAssocToPerGram100("100000")).toMatchObject({ ok: true, perGramText: "6797.8840" });
  });

  it("รับตัวเลขกับข้อความ · ตัดคอมม่า/ช่องว่าง (ลอกจากเว็บสมาคม) · ทศนิยมส่วนเกินเป็นศูนย์ล้วนรับได้", () => {
    expect(goldAssocToPerGram100(41250)).toMatchObject({ ok: true, perGramText: "2804.1271", inputValue: 41250 });
    expect(goldAssocToPerGram100(" 41,250.00 ")).toMatchObject({ ok: true, perGramText: "2804.1271", inputValue: 41250 });
    expect(goldAssocToPerGram100("41250.000")).toMatchObject({ ok: true, perGramText: "2804.1271" });
    expect(goldAssocToPerGram100("41,250.5")).toMatchObject({ ok: true, inputValue: 41250.5 });
  });

  it("ปฏิเสธ: ว่าง/ตัวอักษร/ติดลบ/0/NaN/Infinity/e-notation = invalid · ทศนิยมเกิน 2 ตำแหน่ง = decimals (ไม่ปัดเงียบ)", () => {
    for (const bad of ["", "   ", "abc", "-41250", "0", "0.00", "NaN", "Infinity", "1e5", "4.1250e4", "41250,5x"]) {
      expect(goldAssocToPerGram100(bad)).toMatchObject({ ok: false, issue: "invalid" });
    }
    expect(goldAssocToPerGram100(Number.NaN)).toMatchObject({ ok: false, issue: "invalid" });
    expect(goldAssocToPerGram100(Number.POSITIVE_INFINITY)).toMatchObject({ ok: false, issue: "invalid" });
    expect(goldAssocToPerGram100("41250.123")).toMatchObject({ ok: false, issue: "decimals" });
    expect(goldAssocToPerGram100("999999999")).toMatchObject({ ok: false, issue: "invalid" }); // เกิน 8 หลักก่อนจุด
  });

  it('ราคา "ต่อกรัม" หลุดเข้าช่องราคาสมาคม (เช่น 2,800) ตกที่ต่ำกว่าช่วง ข้อความบอกให้ตรวจว่ากรอกบาทละ', () => {
    const r = goldAssocToPerGram100("2800");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toBe("range");
      expect(metalPriceInputIssueMessage("gold", r)).toContain("ต่ำกว่า 2,000");
      expect(metalPriceInputIssueMessage("gold", r)).toContain(r.perGramText ?? "?");
    }
  });

  it("สูงกว่าช่วง → ข้อความ 'สูงกว่า 8,000' พร้อมค่าที่แปลงแล้ว", () => {
    const r = goldAssocToPerGram100("200000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(metalPriceInputIssueMessage("gold", r)).toMatch(/สูงกว่า 8,000/);
  });

  it("ผูกกับค่าคงที่ที่ export: ผลต่างจากสูตร float (value ÷ (15.244×0.965)) < 0.00006 บนตัวอย่างหลายสิบค่า — ถ้า scale ของ BigInt เพี้ยนจากค่าคงที่ ตกตรงนี้", () => {
    for (let cents = 2_942_092; cents <= 11_768_368; cents += 98_317) {
      const r = goldAssocToPerGram100(cents / 100);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const exact = cents / 100 / (GOLD_GRAM_PER_BAHT * GOLD_ASSOC_PURITY);
        expect(Math.abs(r.perGram - exact)).toBeLessThan(0.00006);
      }
    }
  });
});

describe("brassKgToPerGram — บาท/กก. → บาท/กรัม (÷1,000) · ช่วง 100–1,000 บาท/กก. (DB 0.10–1.00)", () => {
  it("ขอบ 4 จุด: 100 → 0.1000 ผ่าน · 1000 → 1.0000 ผ่าน · 99.99 ตก · 1000.01 ตก (ตรวจก่อนปัด 4 ตำแหน่ง)", () => {
    expect(brassKgToPerGram("100")).toMatchObject({ ok: true, perGramText: "0.1000", perGram: 0.1 });
    expect(brassKgToPerGram("1000")).toMatchObject({ ok: true, perGramText: "1.0000", perGram: 1 });
    // ปัด 4 ตำแหน่งแล้ว 99.99 จะเป็น 0.1000 และ 1000.01 จะเป็น 1.0000 (อยู่ในช่วง) — ด่านต้องไม่หลุดเพราะการปัด
    expect(brassKgToPerGram("99.99")).toMatchObject({ ok: false, issue: "range", perGramText: "0.1000" });
    expect(brassKgToPerGram("1000.01")).toMatchObject({ ok: false, issue: "range", perGramText: "1.0000" });
  });

  it("350.55 → 0.3506 (ปัดครึ่งขึ้น) · 350 → 0.3500 · เวกเตอร์เดียวกับ verify-0186 G4e/G4f", () => {
    expect(brassKgToPerGram("350.55")).toMatchObject({ ok: true, perGramText: "0.3506", inputValue: 350.55 });
    expect(brassKgToPerGram(350)).toMatchObject({ ok: true, perGramText: "0.3500" });
    expect(brassKgToPerGram("350.54")).toMatchObject({ ok: true, perGramText: "0.3505" });
  });

  it("ปฏิเสธ: 0 / ติดลบ / ตัวอักษร / ทศนิยมเกิน 2 ตำแหน่ง", () => {
    expect(brassKgToPerGram("0")).toMatchObject({ ok: false, issue: "invalid" });
    expect(brassKgToPerGram("-350")).toMatchObject({ ok: false, issue: "invalid" });
    expect(brassKgToPerGram("abc")).toMatchObject({ ok: false, issue: "invalid" });
    expect(brassKgToPerGram("350.555")).toMatchObject({ ok: false, issue: "decimals" });
  });

  it('ราคา "ต่อกรัม" หลุดเข้าช่องบาท/กก. (0.35) ตก — ข้อความบอกว่าต้องเป็นบาทต่อกิโลกรัม', () => {
    const r = brassKgToPerGram("0.35");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(metalPriceInputIssueMessage("brass", r)).toContain("100–1,000 บาท/กก.");
  });

  it("ค่าคงที่ช่วงที่ export สอดคล้องกัน: บาท/กก. ÷ 1,000 = บาท/กรัม", () => {
    expect(BRASS_PRICE_RANGE_PER_KG.min / 1000).toBe(METAL_PRICE_RANGE_PER_GRAM.brass.min);
    expect(BRASS_PRICE_RANGE_PER_KG.max / 1000).toBe(METAL_PRICE_RANGE_PER_GRAM.brass.max);
  });
});

describe("convertMetalPriceInput / METAL_PRICE_INPUT_UNIT", () => {
  it("เลือกตัวแปลงตามโลหะ และหน่วยที่ DB เก็บ (input_unit)", () => {
    expect(METAL_PRICE_INPUT_UNIT).toEqual({ gold: "assoc965_sell_per_baht", brass: "thb_per_kg" });
    expect(convertMetalPriceInput("gold", "41250")).toMatchObject({ ok: true, unit: "assoc965_sell_per_baht" });
    expect(convertMetalPriceInput("brass", "350")).toMatchObject({ ok: true, unit: "thb_per_kg" });
  });
});

describe("isMetalPricePerGramInRange — ปุ่มราคาต่อกรัมตรง (ด่านเดียวกับ analytics.oem_metal_price_range_ok)", () => {
  it("ทอง 100%: 2000/8000 ผ่าน · 1999.99/8000.01 ตก · ต่อบาทหลุดมา (41250) ตก", () => {
    expect(isMetalPricePerGramInRange("gold", 2000)).toBe(true);
    expect(isMetalPricePerGramInRange("gold", 8000)).toBe(true);
    expect(isMetalPricePerGramInRange("gold", 1999.99)).toBe(false);
    expect(isMetalPricePerGramInRange("gold", 8000.01)).toBe(false);
    expect(isMetalPricePerGramInRange("gold", 41250)).toBe(false);
  });
  it("ทองเหลือง: 0.1/1 ผ่าน · 0.0999/1.0001 ตก · 350 (บาท/กก. หลุดมาเป็นต่อกรัม) ตก", () => {
    expect(isMetalPricePerGramInRange("brass", 0.1)).toBe(true);
    expect(isMetalPricePerGramInRange("brass", 1)).toBe(true);
    expect(isMetalPricePerGramInRange("brass", 0.35)).toBe(true);
    expect(isMetalPricePerGramInRange("brass", 0.0999)).toBe(false);
    expect(isMetalPricePerGramInRange("brass", 1.0001)).toBe(false);
    expect(isMetalPricePerGramInRange("brass", 350)).toBe(false);
  });
  it("เงินช่วงเดิม 5–500 (ต้องไม่พัง) · NaN/Infinity/ติดลบ/ศูนย์ ตก · ทศนิยมเกิน 4 ตำแหน่งตก (ไม่ปัดเงียบ)", () => {
    expect(isMetalPricePerGramInRange("silver", 5)).toBe(true);
    expect(isMetalPricePerGramInRange("silver", 500)).toBe(true);
    expect(isMetalPricePerGramInRange("silver", 4.99)).toBe(false);
    expect(isMetalPricePerGramInRange("silver", 500.01)).toBe(false);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, 1e21]) expect(isMetalPricePerGramInRange("gold", bad)).toBe(false);
    expect(isMetalPricePerGramInRange("gold", 2000.00001)).toBe(false);
  });
  it("ข้อความ error ช่วงต่อกรัมบอกหน่วยชัด (ทองเหลืองบอก = 100–1,000 บาท/กก.)", () => {
    expect(metalPricePerGramRangeMessage("gold")).toContain("2,000–8,000 บาท/กรัม");
    expect(metalPricePerGramRangeMessage("brass")).toContain("0.10–1.00 บาท/กรัม");
    expect(metalPricePerGramRangeMessage("brass")).toContain("100–1,000 บาท/กก.");
    expect(metalPricePerGramRangeMessage("silver")).toContain("5–500 บาท/กรัม");
  });
});

describe("brassPerGramToKgText — แสดงผลบาท/กก. จากค่าต่อกรัมที่ server คืน (เลื่อนจุดทศนิยมด้วยสตริง/BigInt)", () => {
  it("0.3506 → 350.6 · 0.35 → 350 · 1 → 1,000 · 0.1 → 100 · 0.0001 → 0.1", () => {
    expect(brassPerGramToKgText("0.3506")).toBe("350.6");
    expect(brassPerGramToKgText("0.35")).toBe("350");
    expect(brassPerGramToKgText("1.0000")).toBe("1,000");
    expect(brassPerGramToKgText("0.1000")).toBe("100");
    expect(brassPerGramToKgText("0.0001")).toBe("0.1");
  });
  it("รูปแบบที่ไม่ใช่ทศนิยมปกติ (e-notation/ติดลบ/ตัวอักษร/ว่าง) → null ไม่เดา", () => {
    for (const bad of ["1e-5", "-0.35", "abc", "", "0.35.1"]) expect(brassPerGramToKgText(bad)).toBeNull();
  });
});

// กัน TS กับ DB เพี้ยนจากกัน: กวาดทุก migration แล้วใช้ "ไฟล์เลขสูงสุดที่นิยามฟังก์ชันนั้นๆ" (ฟังก์ชันที่ถูก replace ทีหลังเป็นนิยามที่ใช้จริง — ไม่ผูกเลข 0186)
// เทียบค่าคงที่/ช่วงราคา/ชื่อหน่วยกับไฟล์นี้ (DB เป็นผู้ตัดสิน — ถ้ามีใครแก้ฝั่งเดียว ตกตรงนี้)
describe("contract กับนิยามล่าสุดใน supabase/migrations/*.sql", () => {
  const dir = resolve(__dirname, "../../supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  /** ไฟล์เลขสูงสุดที่มี `create [or replace] function analytics.<name>(` — คืนเฉพาะตัวฟังก์ชัน (จนถึง dollar-quote ปิด) */
  function latestDefinition(name: string): { file: string; body: string } {
    const re = new RegExp(`create (?:or replace )?function analytics\\.${name}\\s*\\(`, "i");
    for (const f of [...files].reverse()) {
      const sql = readFileSync(resolve(dir, f), "utf8");
      const m = re.exec(sql);
      if (!m) continue;
      const rest = sql.slice(m.index);
      const end = rest.search(/\n\$[a-z_0-9]*\$/i);
      // ข้ามชื่อ *_legacy… ไม่เข้าเงื่อนไข regexp (ต้องตามด้วย "(" ทันที) จึงไม่ปนกับ legacy
      return { file: f, body: end > 0 ? rest.slice(0, end) : rest };
    }
    throw new Error(`ไม่พบ analytics.${name} ใน migration ใดเลย`);
  }

  const convert = latestDefinition("oem_metal_price_convert");
  const rangeOk = latestDefinition("oem_metal_price_range_ok");

  it("กวาดเจอทั้งสองฟังก์ชัน และอยู่ในไฟล์ที่เลขไม่ต่ำกว่า 0186 (ไม่หลุดไปอ่านนิยามเก่า)", () => {
    expect(Number(convert.file.slice(0, 4))).toBeGreaterThanOrEqual(186);
    expect(Number(rangeOk.file.slice(0, 4))).toBeGreaterThanOrEqual(186);
  });

  it("ค่าคงที่การแปลงทอง 15.244 / 0.965 ตรงกับ oem_metal_price_convert", () => {
    expect(Number(/c_gram_per_baht constant numeric := ([0-9.]+);/.exec(convert.body)?.[1]), convert.file).toBe(GOLD_GRAM_PER_BAHT);
    expect(Number(/c_assoc_purity\s+constant numeric := ([0-9.]+);/.exec(convert.body)?.[1]), convert.file).toBe(GOLD_ASSOC_PURITY);
  });

  it("ช่วงราคาต่อกรัมของทั้ง 3 โลหะตรงกับ oem_metal_price_range_ok", () => {
    for (const metal of ["silver", "gold", "brass"] as const) {
      const m = new RegExp(`when '${metal}'\\s+then \\(p_price >= ([0-9.]+) and p_price <= ([0-9.]+)\\)`).exec(rangeOk.body);
      expect(m, `ไม่พบช่วงของ ${metal} ใน ${rangeOk.file}`).not.toBeNull();
      expect(Number(m?.[1])).toBe(METAL_PRICE_RANGE_PER_GRAM[metal].min);
      expect(Number(m?.[2])).toBe(METAL_PRICE_RANGE_PER_GRAM[metal].max);
    }
  });

  it("ชื่อหน่วยที่ DB เก็บ (input_unit) + สูตรหาร ตรงกับ METAL_PRICE_INPUT_UNIT", () => {
    expect(convert.body).toContain(`'${METAL_PRICE_INPUT_UNIT.gold}'`);
    expect(convert.body).toContain(`'${METAL_PRICE_INPUT_UNIT.brass}'`);
    expect(convert.body).toContain("p_input_value / (c_gram_per_baht * c_assoc_purity)");
    expect(convert.body).toContain("p_input_value / 1000");
  });
});
