// lib/ring-builder/admin-types.ts — type ที่หน้าหลังบ้าน (/catalog/ring-builder · 4 จอ) ใช้ร่วมกับ server action (pure · type อย่างเดียว · client import ได้)
// ⚠️ ไฟล์นี้ "ห้าม" ถูก import จากกราฟของหน้าสาธารณะ (boundary.test.ts ตรวจเฉพาะ admin-server.ts แต่ข้อมูลหลังบ้านไม่ควรไปถึง bundle ลูกค้าอยู่แล้ว)
import type { ShapeKind, StoneAxis } from "./types";

export interface AdminShape {
  id: string;
  nameTh: string;
  renderKind: ShapeKind;
  isActive: boolean;
  sort: number;
  /** แบบที่เปิดอยู่ที่ใช้ทรงนี้ — แสดงเตือน "ใช้ใน x แบบ" ก่อนปิด */
  usedByActiveDesigns: number;
  usedByDesigns: number;
  statusChangedAt: string;
}

export type HiddenReason = "draft" | "closed" | "shape_closed" | "no_price";

export interface AdminDesign {
  id: string;
  designNo: number;
  name: string;
  stoneCount: number;
  shapeId: string;
  shapeName: string;
  shapeKind: ShapeKind;
  shapeActive: boolean;
  stoneMm100: { major: number; minor: number };
  stoneLabel: string;
  stoneAxis: StoneAxis | null;
  sizeMin: number;
  sizeMax: number;
  bodyPriceThb: number | null;
  cardImageUrl: string | null;
  isActive: boolean;
  published: boolean;
  /** ล็อก จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศ ตั้งแต่เปิดขายครั้งแรก (ไม่ใช่ "มีรหัสแล้ว" — ระบบไม่นับรหัส) */
  locked: boolean;
  /** ลูกค้าเห็นแบบนี้อยู่จริง */
  visible: boolean;
  hiddenReason: HiddenReason | null;
  statusChangedAt: string;
  statusChangedLabel: string;
  sort: number;
  /** จำนวนพลอยสีที่ขายได้ในแบบนี้ ("4 ชนิด") */
  sellableStones: number;
}

export interface AdminOffer {
  id: string;
  shapeId: string;
  shapeName: string;
  stoneMm100: { major: number; minor: number };
  stoneLabel: string;
  isActive: boolean;
  /** ราคาปัจจุบัน (บาท/เม็ด) · null = ยังไม่มีราคา (ไม่ใช่ 0) */
  priceThb: number | null;
}

export type CoverageReason = "stone_closed" | "no_offer" | "offer_closed" | "no_price";

export interface AdminCoverageMissing {
  designNo: number;
  designName: string;
  stoneCount: number;
  shapeName: string;
  stoneLabel: string;
  reason: CoverageReason;
}

export interface AdminStone {
  id: string;
  stoneNo: number;
  nameTh: string;
  shortName: string;
  colorHex: string;
  isActive: boolean;
  sort: number;
  offers: AdminOffer[];
  /** "ขายได้ x/y แบบ · ขาดเพราะ…" */
  coverage: { visibleDesigns: number; sellableDesigns: number; missing: AdminCoverageMissing[] };
}

export interface AdminCatalog {
  catalogAt: string;
  sizes: { min: number; max: number };
  shapes: AdminShape[];
  designs: AdminDesign[];
  stones: AdminStone[];
}

// ---------------------------------------------------------------------------
// ตรวจรหัส (AdminVerify · AdminVerifyStates)
// ---------------------------------------------------------------------------
/** 8 สถานะตาม AdminVerifyStates (ยังมี "กำลังตรวจ" ซึ่งเป็นสถานะฝั่ง client) · unavailable = ระบบตรวจไม่ได้ ห้ามปนกับรหัสผิด */
export type CodeCheckStatus = "empty" | "not_found" | "bad_format" | "not_issued" | "design_closed" | "changed" | "ok" | "unavailable";

export interface CodeCheckRow {
  /** "ตัวเรือน" หรือชื่อพลอย */
  label: string;
  /** จำนวนเม็ด (ตัวเรือน = null) */
  count: number | null;
  /** CZ ขาว = รวมในตัวเรือน (ไม่มีราคา) */
  included: boolean;
  creationThb: number | null;
  currentThb: number | null;
  diffThb: number | null;
}

export interface CodeCheckLine {
  pos: number;
  stoneNo: number;
  name: string;
  /** พลอย/ออฟเฟอร์ที่ปิดไปแล้ว ณ ตอนนี้ */
  closedNow: boolean;
}

export interface CodeCheckView {
  code: string;
  designNo: number;
  designName: string;
  stoneCount: number;
  shapeName: string;
  stoneLabel: string;
  /** null = ให้แอดมินช่วยเช็กไซซ์ */
  size: number | null;
  sizeStatus: "ok" | "admin_check" | "out_of_range";
  sizeMin: number;
  sizeMax: number;
  pricedAt: string;
  pricedAtLabel: string;
  ageDays: number;
  designActive: boolean;
  designClosedLabel: string | null;
  /** ทรงพลอยของแบบนี้ยังเปิดอยู่ไหม (ทรงปิด = ขายแบบนี้ไม่ได้ แม้แบบเองยังเปิด) */
  shapeActive: boolean;
  /** วันที่ปิดของตัวที่ปิดจริง (แบบหรือทรง) · null = ขายได้อยู่ */
  closedLabel: string | null;
  closedBy: "design" | "shape" | null;
  lines: CodeCheckLine[];
  rows: CodeCheckRow[];
  creationTotalThb: number | null;
  currentTotalThb: number | null;
  diffTotalThb: number | null;
  /** ยอดที่เซ็นในรหัส = ยอดที่คิดย้อนจากประวัติราคาได้ (ไม่ตรง = ผิดปกติ ให้ดูประวัติราคา) */
  signedTotalThb: number;
  historyMatchesSignedTotal: boolean;
  closedStones: { stoneNo: number; name: string }[];
  /** ข้อความคัดลอกไปใบงาน / แจ้งราคาใหม่ — ประกอบที่ server */
  summaryText: string;
  priceNoticeText: string;
}

export interface CodeCheckResult {
  status: CodeCheckStatus;
  /** มีเมื่อ HMAC ผ่านและ DB ตอบ (ok · changed · design_closed) */
  view: CodeCheckView | null;
}
