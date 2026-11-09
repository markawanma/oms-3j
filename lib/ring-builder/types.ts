// lib/ring-builder/types.ts — type ของข้อมูลสาธารณะ (allowlist) · pure · ไม่มี runtime import นอก config
// 🔴 PublicCatalog และ response ของ POST /api/ring-builder/quote = รายชื่อ key ด้านล่างเป๊ะ (boundary.test.ts เทียบกับ mapper ที่ประกอบจริง)
//    เพิ่ม key ได้ก็ต่อเมื่อแก้ type + รายชื่อ key + test พร้อมกัน — ห้ามมี id ภายใน · ต้นทุน · margin · flag ของหลังบ้าน (is_active/published_at)
import type { QuoteReason } from "./config";

export type ShapeKind = "round" | "oval";
export type StoneAxis = "along_row" | "across_row";

export interface PublicStone {
  no: number;
  name: string;
  shortName: string;
  colorHex: string;
}

export interface PublicOffer {
  stoneNo: number;
  priceThb: number;
}

export interface PublicDesign {
  no: number;
  stoneCount: 3 | 4 | 5 | 6 | 7;
  name: string;
  shape: { kind: ShapeKind; name: string };
  stoneMm100: { major: number; minor: number };
  /** "4×3" — ประกอบที่ server */
  stoneLabel: string;
  stoneAxis: StoneAxis | null;
  sizeMin: number;
  sizeMax: number;
  bodyPriceThb: number;
  cardImageUrl: string | null;
  /** P1 = none เสมอ (P2 เพิ่ม glb) */
  model: { kind: "none" };
  /** พลอยที่เลือกได้ในแบบนี้ = รายการนี้เท่านั้น (ห้าม UI สร้างตัวเลือกจาก stones ทั้งหมด) */
  offers: PublicOffer[];
}

export interface PublicCatalog {
  catalogAt: string;
  sizes: { min: number; max: number };
  stones: PublicStone[];
  designs: PublicDesign[];
}

export const PUBLIC_CATALOG_KEYS = ["catalogAt", "designs", "sizes", "stones"] as const;
export const PUBLIC_DESIGN_KEYS = [
  "bodyPriceThb", "cardImageUrl", "model", "name", "no", "offers", "shape", "sizeMax", "sizeMin", "stoneAxis", "stoneCount", "stoneLabel", "stoneMm100",
] as const;
export const PUBLIC_STONE_KEYS = ["colorHex", "name", "no", "shortName"] as const;
export const PUBLIC_OFFER_KEYS = ["priceThb", "stoneNo"] as const;

// ---------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------
export interface QuoteLine {
  pos: number;
  stoneNo: number;
  name: string;
  priceThb: number;
}
export interface QuoteGroup {
  stoneNo: number;
  name: string;
  count: number;
  unitPriceThb: number;
  subtotalThb: number;
}
export interface QuoteDesign {
  name: string;
  shapeName: string;
  stoneLabel: string;
}

export interface QuoteOk {
  ok: true;
  code: string;
  total: number;
  body: number;
  design: QuoteDesign;
  lines: QuoteLine[];
  groups: QuoteGroup[];
  pricedAt: string;
  pricedAtLabel: string;
  /** รหัสล้วน (ไม่ใช่ URL — กันพาออกนอกแพลตฟอร์ม) */
  qrText: string;
  lineText: string;
}
export interface QuoteConflict {
  ok: false;
  reason: "price_changed";
  total: number;
  body: number;
  design: QuoteDesign;
  lines: QuoteLine[];
  groups: QuoteGroup[];
}
export interface QuoteRejected {
  ok: false;
  reason: QuoteReason;
  /** เฉพาะ stone_unavailable */
  stoneNos?: number[];
}
export interface QuoteFailure {
  ok: false;
  reason: "forbidden" | "too_large" | "timeout" | "bad_body" | "unavailable" | "server";
}
export type QuoteResponse = QuoteOk | QuoteConflict | QuoteRejected | QuoteFailure;

export const QUOTE_OK_KEYS = ["body", "code", "design", "groups", "lineText", "lines", "ok", "pricedAt", "pricedAtLabel", "qrText", "total"] as const;
export const QUOTE_CONFLICT_KEYS = ["body", "design", "groups", "lines", "ok", "reason", "total"] as const;
export const QUOTE_REJECTED_KEYS = ["ok", "reason", "stoneNos"] as const;
export const QUOTE_FAILURE_KEYS = ["ok", "reason"] as const;
export const QUOTE_LINE_KEYS = ["name", "pos", "priceThb", "stoneNo"] as const;
export const QUOTE_GROUP_KEYS = ["count", "name", "stoneNo", "subtotalThb", "unitPriceThb"] as const;
export const QUOTE_DESIGN_KEYS = ["name", "shapeName", "stoneLabel"] as const;

/** body ที่ route รับ (strict — ไม่รับ key อื่น · ไม่รับ shop_id/ราคา/pricedAt) */
export interface QuoteRequest {
  v: 1;
  design: number;
  size: number | null;
  positions: number[];
  expectedTotal: number;
}
