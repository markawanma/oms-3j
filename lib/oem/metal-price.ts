// lib/oem/metal-price.ts — ค่าคงที่ + ฟังก์ชัน pure แปลง "ราคาที่ผู้ใช้กรอกหน้างานจริง" → บาท/กรัม ของโลหะ 100%
// (PM-A · migration 0186 · มติเจ้าของ 20 ต.ค. 69)
//
// 🔴 ไฟล์เดียวที่เก็บค่าคงที่การแปลง — ใช้ร่วมกันทั้ง preview ฝั่ง client (เช่น ช่องกรอกราคาทองบน /oem/rates)
//    และ server action (saveMetalPriceInput ตรวจก่อนยิง RPC) · ห้ามก๊อปตัวเลขไปไว้ที่อื่น
// 🔴 ผู้ตัดสินจริงคือ DB (analytics.oem_metal_price_convert + oem_metal_price_set_input — oem-quote-invariants ข้อ 2):
//    ฟังก์ชันในไฟล์นี้เป็น "สำเนา pure สำหรับ preview" เท่านั้น — หลังบันทึกต้องโชว์ค่าที่ server คืน ไม่ใช่ค่า preview ·
//    ไม่เพี้ยนจาก DB เพราะ (1) คิดด้วยจำนวนเต็ม BigInt ไม่ใช้ float (2) มีเวกเตอร์ทดสอบชุดเดียวกับ scripts/verify/verify-0186.sql (G3/G4) ·
//    (3) metal-price.test.ts อ่านไฟล์ migration 0186 แล้วเทียบค่าคงที่/ช่วงราคาว่าตรงกับไฟล์นี้
//
// หน่วย (ห้ามอนุมานซ้ำ — ผิดหน่วยทีเดียวต้นทุนเพี้ยน ×15 / ×1,000 เหมือนบั๊กเงิน 17 ก.ย.):
//   • DB เก็บราคาทุกโลหะเป็น "บาทต่อกรัม ของโลหะบริสุทธิ์ 100%" (ตรงสูตร น้ำหนัก × เนื้อ × ราคา ของ oem_cost_calc)
//   • ทอง   : ผู้ใช้กรอก "ราคาสมาคมฯ ทองคำแท่ง 96.5% ฝั่งขายออก (บาทละ)" → ÷ 15.244 กรัม/บาททอง ÷ 0.965
//   • ทองเหลือง: ผู้ใช้กรอก "บาทต่อกิโลกรัม" → ÷ 1,000
//   • เงิน  : กรอกบาท/กรัมตรงๆ (เดิม) — ไม่มีตัวแปลง
// ช่วง sanity (เจ้าของเคาะ 20 ต.ค. "ใช้ที่เสนอ"): ทอง 100% 2,000–8,000 บาท/กรัม · ทองเหลือง 100–1,000 บาท/กก. (= 0.10–1.00 บาท/กรัม) · เงิน 5–500 (เดิม)
// ด่านช่วงตรวจที่ "ค่าต่อกรัมที่แปลงแล้ว ก่อนปัด" (ทองเหลือง: 99.99 และ 1,000.01 บาท/กก. ปัด 4 ตำแหน่งแล้วจะหลุดเข้าช่วง จึงต้องตรวจก่อนปัด — ตรงกับ DB)

import { GRAMS_PER_BAHT_WEIGHT } from "@/lib/catalog/types";

export type MetalPriceInputMetal = "gold" | "brass";
export type MetalPriceMetal = "silver" | "gold" | "brass";
/** หน่วยของ "ค่าที่ผู้ใช้กรอก" ที่ DB เก็บคู่กับค่าต่อกรัม (oem_metal_price.input_unit) */
export type MetalPriceInputUnit = "assoc965_sell_per_baht" | "thb_per_kg";

/** 1 บาททองคำ = 15.244 กรัม — re-export ค่าเดียวกับที่ catalog ใช้ (ค่าเดียวในโค้ด) · BigInt สเกลด้านล่างผูกกับค่านี้ด้วยเทสต์ float + contract กับ SQL */
export const GOLD_GRAM_PER_BAHT = GRAMS_PER_BAHT_WEIGHT;
/** ทองคำแท่งสมาคม = 96.5% */
export const GOLD_ASSOC_PURITY = 0.965;

// เก็บเป็นจำนวนเต็มที่สเกลคงที่ — แปลงด้วย BigInt ไม่ให้ float ปัดเศษต่างจาก numeric ของ Postgres
// 15.244 × 0.965 = 14.71046 ⇒ (15244 × 965) / 10^6 = 14,710,460 / 10^6
const GRAM_PER_BAHT_E3 = 15244n;
const ASSOC_PURITY_E3 = 965n;
const GOLD_DIVISOR_E6 = GRAM_PER_BAHT_E3 * ASSOC_PURITY_E3; // = 14,710,460 (สเกล 10^6)

/** ช่วงที่รับได้ ต่อกรัมของโลหะ 100% (บาท/กรัม) — ตรงกับ analytics.oem_metal_price_range_ok */
export const METAL_PRICE_RANGE_PER_GRAM: Record<MetalPriceMetal, { min: number; max: number }> = {
  silver: { min: 5, max: 500 },
  gold: { min: 2000, max: 8000 },
  brass: { min: 0.1, max: 1 },
};
/** ช่วงที่ผู้ใช้เห็น/กรอก (ทองเหลือง = บาท/กก. · ทอง = ต่อกรัม 100% — ราคาสมาคมที่กรอกไม่มีช่วงของตัวเอง ตรวจที่ค่าที่แปลงแล้ว) */
export const BRASS_PRICE_RANGE_PER_KG = { min: 100, max: 1000 } as const;

const fmtThb = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const BRASS_KG_RANGE_TEXT = `${fmtThb(BRASS_PRICE_RANGE_PER_KG.min)}–${fmtThb(BRASS_PRICE_RANGE_PER_KG.max)}`;
const GOLD_MIN_TEXT = fmtThb(METAL_PRICE_RANGE_PER_GRAM.gold.min);
const GOLD_MAX_TEXT = fmtThb(METAL_PRICE_RANGE_PER_GRAM.gold.max);

/**
 * แสดงผลอย่างเดียว: ราคาทองเหลืองต่อกรัมที่ server คืนมา (สตริงทศนิยม เช่น "0.3506") → ข้อความ บาท/กก. (×1,000 ด้วยการเลื่อนจุดทศนิยมในสตริง ไม่ใช้ float)
 * ไม่ใช่การคำนวณราคา — ค่าที่ใช้คิดต้นทุนคือค่าต่อกรัมจาก server เท่านั้น · ไม่ใช่ตัวเลขที่ถูกต้อง → null
 */
export function brassPerGramToKgText(perGramText: string): string | null {
  const m = /^(\d{1,10})(?:\.(\d{1,4}))?$/.exec(perGramText.trim());
  if (!m) return null;
  const frac = ((m[2] ?? "") + "0000").slice(0, 4);
  const units4 = BigInt(m[1]) * 10_000n + BigInt(frac); // บาท/กรัม สเกล 10^4
  const kgUnits4 = units4 * 1000n; // บาท/กก. สเกล 10^4
  const s = kgUnits4.toString().padStart(5, "0");
  const whole = s.slice(0, -4);
  const fracKg = s.slice(-4).replace(/0+$/, "");
  const wholeFmt = BigInt(whole).toLocaleString("en-US");
  return fracKg ? `${wholeFmt}.${fracKg}` : wholeFmt;
}

export const METAL_PRICE_INPUT_UNIT: Record<MetalPriceInputMetal, MetalPriceInputUnit> = {
  gold: "assoc965_sell_per_baht",
  brass: "thb_per_kg",
};

export type MetalPriceConvertIssue = "invalid" | "decimals" | "range";

export type MetalPriceConvertResult =
  | {
      ok: true;
      /** บาท/กรัม ของโลหะ 100% ปัด 4 ตำแหน่งแล้ว — ค่าที่ DB จะเก็บ (numeric(14,4)) เป็นสตริงทศนิยมจริง */
      perGramText: string;
      perGram: number;
      inputValue: number;
      unit: MetalPriceInputUnit;
    }
  | {
      ok: false;
      issue: MetalPriceConvertIssue;
      /** มีเมื่อ issue = "range": ค่าต่อกรัมที่แปลงแล้ว (ปัด 4 ตำแหน่ง) ไว้แสดงในข้อความ error — ไม่ใช่ค่าที่เก็บ */
      perGramText?: string;
      unit: MetalPriceInputUnit;
    };

/** แปลงข้อความ/ตัวเลขที่กรอกเป็น "สตางค์" (จำนวนเต็ม) — รับ 41250 · "41,250.5" · " 41250.50 " · ปฏิเสธ e-notation/ทศนิยม > 2/ติดลบ/NaN/Infinity/ว่าง/เกิน 99,999,999.99 */
function parseCents(raw: string | number): { cents: bigint } | { issue: "invalid" | "decimals" } {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { issue: "invalid" };
    // String(1e21) = "1e+21" — e-notation ไม่ผ่าน regex ข้างล่าง = invalid (ตั้งใจ)
    text = String(raw);
  } else {
    text = String(raw ?? "");
  }
  text = text.replace(/,/g, "").trim();
  const m = /^(\d{1,8})(?:\.(\d+))?$/.exec(text);
  if (!m) return { issue: "invalid" };
  const frac = m[2] ?? "";
  if (frac.length > 2) {
    // "41250.00" ถือว่าไม่เกิน 2 ตำแหน่งเมื่อส่วนเกินเป็นศูนย์ล้วน? — ไม่: DB เทียบ value = round(value,2) ตรงกับ numeric ที่ส่งมา
    // ค่า 41250.000 ส่งเข้า numeric ได้เท่ากับ 41250.00 จึงรับเมื่อส่วนเกินเป็น 0 ล้วน
    if (/[1-9]/.test(frac.slice(2))) return { issue: "decimals" };
  }
  const cents = BigInt(m[1]) * 100n + BigInt((frac + "00").slice(0, 2));
  if (cents <= 0n) return { issue: "invalid" };
  return { cents };
}

/** หาร a/b ปัดครึ่งขึ้น (จำนวนเต็มบวก) — ตรงกับ round() ของ numeric (half away from zero) */
function divRoundHalfUp(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

function units4ToText(units4: bigint): string {
  const s = units4.toString().padStart(5, "0");
  return `${s.slice(0, -4)}.${s.slice(-4)}`;
}

function toResult(unit: MetalPriceInputUnit, issue: MetalPriceConvertIssue, perGramUnits4?: bigint): MetalPriceConvertResult {
  return { ok: false, issue, unit, ...(perGramUnits4 === undefined ? {} : { perGramText: units4ToText(perGramUnits4) }) };
}

/** ราคาสมาคม ทองคำแท่ง 96.5% ขายออก (บาทละ) → บาท/กรัม ทอง 100% — สำเนา pure ของ analytics.oem_metal_price_convert (ทอง) */
export function goldAssocToPerGram100(input: string | number): MetalPriceConvertResult {
  const unit = METAL_PRICE_INPUT_UNIT.gold;
  const parsed = parseCents(input);
  if ("issue" in parsed) return toResult(unit, parsed.issue);
  const cents = parsed.cents;
  // บาท/กรัม (สเกล 10^4) = (cents/100) / (14,710,460/10^6) × 10^4 = cents × 10^8 / 14,710,460
  const num = cents * 100_000_000n;
  const rounded = divRoundHalfUp(num, GOLD_DIVISOR_E6);
  // ช่วง ตรวจที่ค่าก่อนปัด: num/GOLD_DIVISOR_E6 ∈ [min×10^4, max×10^4]
  const lo = BigInt(METAL_PRICE_RANGE_PER_GRAM.gold.min) * 10_000n * GOLD_DIVISOR_E6;
  const hi = BigInt(METAL_PRICE_RANGE_PER_GRAM.gold.max) * 10_000n * GOLD_DIVISOR_E6;
  if (num < lo || num > hi) return toResult(unit, "range", rounded);
  const perGramText = units4ToText(rounded);
  return { ok: true, perGramText, perGram: Number(perGramText), inputValue: Number(cents) / 100, unit };
}

/** ราคาทองเหลือง บาท/กก. → บาท/กรัม (÷ 1,000) — สำเนา pure ของ analytics.oem_metal_price_convert (ทองเหลือง) */
export function brassKgToPerGram(input: string | number): MetalPriceConvertResult {
  const unit = METAL_PRICE_INPUT_UNIT.brass;
  const parsed = parseCents(input);
  if ("issue" in parsed) return toResult(unit, parsed.issue);
  const cents = parsed.cents;
  // บาท/กรัม (สเกล 10^4) = (cents/100)/1000 × 10^4 = cents / 10
  const rounded = divRoundHalfUp(cents, 10n);
  // ช่วง ตรวจที่ค่าก่อนปัด: cents/10^5 ∈ [0.10, 1.00] ⇔ cents ∈ [10,000, 100,000] (= 100–1,000 บาท/กก.)
  if (cents < 10_000n || cents > 100_000n) return toResult(unit, "range", rounded);
  const perGramText = units4ToText(rounded);
  return { ok: true, perGramText, perGram: Number(perGramText), inputValue: Number(cents) / 100, unit };
}

export function convertMetalPriceInput(metal: MetalPriceInputMetal, input: string | number): MetalPriceConvertResult {
  return metal === "gold" ? goldAssocToPerGram100(input) : brassKgToPerGram(input);
}

/** ราคาต่อกรัมตรง (เช่น ปุ่มเดิมของ /oem/rates) อยู่ในช่วงที่รับไหม — เทียบด้วยจำนวนเต็มสเกล 10^4 (ทศนิยมเกิน 4 ตำแหน่ง = ไม่ผ่าน เหมือนไม่ปัดเงียบ) */
export function isMetalPricePerGramInRange(metal: MetalPriceMetal, perGram: number): boolean {
  if (!Number.isFinite(perGram) || perGram <= 0) return false;
  const text = String(perGram);
  const m = /^(\d{1,10})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return false;
  const units4 = BigInt(m[1]) * 10_000n + BigInt(((m[2] ?? "") + "0000").slice(0, 4));
  const { min, max } = METAL_PRICE_RANGE_PER_GRAM[metal];
  // min/max ของทองเหลืองเป็นทศนิยม (0.1) — แปลงเป็นสเกล 10^4 ด้วย toFixed(4) ไม่ใช่ float multiply
  const lo = BigInt(min.toFixed(4).replace(".", ""));
  const hi = BigInt(max.toFixed(4).replace(".", ""));
  return units4 >= lo && units4 <= hi;
}

const METAL_LABEL_TH: Record<MetalPriceMetal, string> = { silver: "เงิน", gold: "ทอง", brass: "ทองเหลือง" };

/** ข้อความ error ภาษาไทยของด่านช่วงราคา "ต่อกรัม" (RPC ต่อกรัมเดิม) — บอกช่วงพร้อมหน่วยชัด (ห้ามให้ผู้ใช้เดาหน่วย) */
export function metalPricePerGramRangeMessage(metal: MetalPriceMetal): string {
  const { min, max } = METAL_PRICE_RANGE_PER_GRAM[metal];
  const fmt = (n: number) => (metal === "brass" ? n.toFixed(2) : n.toLocaleString("en-US"));
  const extra =
    metal === "brass"
      ? ` (= ${BRASS_KG_RANGE_TEXT} บาท/กก. — ทองเหลืองกรอกเป็นบาทต่อกิโลกรัมแล้วให้ระบบแปลง)`
      : metal === "gold"
        ? " (ทอง 100% — ถ้าเป็นราคาสมาคมบาทละ ให้กรอกด้วยช่องราคาสมาคม ระบบแปลงให้)"
        : "";
  return `ราคา${METAL_LABEL_TH[metal]}ต่อกรัมต้องอยู่ระหว่าง ${fmt(min)}–${fmt(max)} บาท/กรัม${extra}`;
}

/** ข้อความ error ของด่านราคาที่กรอกหน้างานจริง (ทอง = ราคาสมาคมบาทละ · ทองเหลือง = บาท/กก.) — แสดงค่าที่แปลงแล้วเสมอ (UX §A.8.1 / P4) */
export function metalPriceInputIssueMessage(metal: MetalPriceInputMetal, result: Extract<MetalPriceConvertResult, { ok: false }>): string {
  if (result.issue === "invalid") {
    return metal === "gold" ? "กรอกราคาเป็นตัวเลข เช่น 41,250.00" : "กรอกราคาเป็นตัวเลข เช่น 350.00";
  }
  if (result.issue === "decimals") return "ทศนิยมไม่เกิน 2 ตำแหน่ง";
  if (metal === "gold") {
    const below = result.perGramText !== undefined && Number(result.perGramText) < METAL_PRICE_RANGE_PER_GRAM.gold.min;
    return below
      ? `แปลงแล้วได้ ${result.perGramText} บาท/กรัม (ทอง 100%) ต่ำกว่า ${GOLD_MIN_TEXT} ที่ระบบรับ — ตรวจว่ากรอก "ราคาบาทละ" ของทองคำแท่ง ${(GOLD_ASSOC_PURITY * 100).toFixed(1)}% ไม่ใช่ราคาต่อกรัม`
      : `แปลงแล้วได้ ${result.perGramText} บาท/กรัม (ทอง 100%) สูงกว่า ${GOLD_MAX_TEXT} ที่ระบบรับ — ตรวจว่าตัวเลขไม่เกินหลัก`;
  }
  return `ราคาทองเหลืองต้องอยู่ระหว่าง ${BRASS_KG_RANGE_TEXT} บาท/กก. (กรอกเป็นบาทต่อกิโลกรัม ไม่ใช่ต่อกรัม)`;
}
