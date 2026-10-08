// lib/oem/productItem.ts — ด่าน "รูปร่าง" ของรายการสินค้า (metal='product', migration 0166) ที่ใช้ร่วมกันระหว่าง
// server action (lib/actions/oem.ts) กับฟอร์ม (lib/oem/quoteForm.ts) · ไม่มีการคิดเงินที่นี่ — ตรวจแค่ช่วง/รูปแบบ
// เพื่อให้ผู้ใช้ได้ข้อความไทยทันที ไม่ยิง RPC เปล่า. ด่านจริงคือ analytics.oem_price_calc (กฎเดียวกันเป๊ะ:
// ตัวเลข > 0 ไม่เกิน 1,000,000 ทศนิยมไม่เกิน 2 ตำแหน่ง · qty จำนวนเต็ม 1..100,000 · ชื่อผ่านด่านอักขระล่องหน/ยาว ≤200 ·
// มี productId แล้วห้ามส่งทุน). "ต่ำกว่าราคาแคตตาล็อกต้องมีเหตุผล" ตัดสินที่ DB เท่านั้น (ฝั่งฟอร์มมี pre-check จาก listPrice).

import type { OemPriceCalcInput } from "./types";
import { customerTextIssue, stripInvisibleText } from "./display";

export const OEM_PRODUCT_MONEY_MAX = 1_000_000;
export const OEM_PRODUCT_QTY_MAX = 100_000;
export const OEM_PRODUCT_TEXT_MAX = 200;

function moneyIssue(v: unknown, label: string): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > OEM_PRODUCT_MONEY_MAX) {
    return label + "ต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท";
  }
  if (Math.round(v * 100) / 100 !== v) return label + "ใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  return null;
}

/** null = รูปร่างใช้ได้ (หรือไม่ใช่ metal='product'). ข้อความเป็นภาษาไทย แสดงผู้ใช้ได้ตรงๆ */
export function productInputIssue(input: OemPriceCalcInput): string | null {
  if (input.metal !== "product") return null;

  const qty: unknown = input.qty;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > OEM_PRODUCT_QTY_MAX) {
    return "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง " + OEM_PRODUCT_QTY_MAX.toLocaleString("en-US");
  }
  const priceIssue = moneyIssue(input.unitPriceThb, "ราคาต่อชิ้น");
  if (priceIssue) return priceIssue;

  const rawReason: unknown = input.priceReason;
  if (rawReason != null && typeof rawReason !== "string") return "เหตุผลราคาต้องเป็นข้อความ";

  if (input.productId) {
    // catalog: ทุนอ่านจากแคตตาล็อก — ส่งมาเอง = ปฏิเสธ (กันทับทุน)
    if (input.unitCostThb != null) return "สินค้าจากแคตตาล็อกห้ามกรอกทุนเอง — ทุนอ่านจากแคตตาล็อก";
    return null;
  }

  // manual (ไม่มี SKU): ต้องมีชื่อ + ทุน
  const rawName: unknown = input.productName;
  if (rawName != null && typeof rawName !== "string") return "ชื่อรายการต้องเป็นข้อความ";
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return "รายการที่ไม่มี SKU ต้องระบุชื่อรายการ";
  const nameIssue = customerTextIssue(name, "ชื่อรายการ");
  if (nameIssue) return nameIssue;
  return moneyIssue(input.unitCostThb, "ทุนต่อชิ้น");
}

/** เหตุผลราคาที่จะส่งไป DB: ลบอักขระล่องหน + trim · ว่าง = null (ไม่ส่ง) */
export function cleanPriceReason(raw: string | null | undefined): string | null {
  const v = stripInvisibleText(raw ?? "").trim();
  return v ? v.slice(0, OEM_PRODUCT_TEXT_MAX) : null;
}
