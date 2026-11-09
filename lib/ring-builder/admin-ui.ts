// lib/ring-builder/admin-ui.ts — ตัวช่วงฝั่งหน้าจอหลังบ้านออกแบบแหวน (pure · ไม่มี import ของ server · client ใช้ได้)
// ห้ามคำนวณเงินที่นี่: ฟังก์ชันที่แตะตัวเลขเงินมีแค่ "จัดรูปแสดงผล" · ตัวเลขทุกตัวมาจาก action/DB
import type { CoverageReason, HiddenReason } from "./admin-types";

export type RingAdminTab = "gems" | "designs" | "verify";
export const RING_ADMIN_TABS: readonly { key: RingAdminTab; label: string }[] = [
  { key: "gems", label: "พลอย (ราคาขาย)" },
  { key: "designs", label: "แบบแหวน" },
  { key: "verify", label: "ตรวจรหัสสั่งทำ" },
];

export function parseRingTab(v: string | undefined): RingAdminTab {
  return v === "designs" || v === "verify" ? v : "gems";
}

/** รหัสผิดพลาดของ DB (hint) → ข้อความไทย · ครอบทั้งรหัสที่ server แปลแล้วและรหัสที่ server ยังไม่แปล (ไม่รู้จัก = ใช้ข้อความที่ action ส่งมา) */
export const RING_ERROR_MESSAGES: Record<string, string> = {
  name_invalid: "ชื่อไม่ถูกต้อง (ยาวเกิน/สั้นเกิน/มีอักขระซ่อน)",
  short_name_invalid: "ชื่อสั้น (แถบตำแหน่ง) ต้องยาว 1-6 ตัวอักษร",
  color_invalid: "สีต้องเป็นรหัส #RRGGBB",
  name_dup: "มีรายการชื่อนี้อยู่แล้ว",
  not_found: "ไม่พบรายการนี้ (อาจถูกเปลี่ยนไปแล้ว) — โหลดหน้าใหม่",
  shape_not_found: "ไม่พบทรงของรายการนี้",
  size_invalid: "ขนาดต้องอยู่ระหว่าง 0.50-20.00 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง ใช้จุด)",
  size_range_invalid: "ช่วงไซซ์ต้องอยู่ใน 45-68 และต่ำสุดไม่เกินสูงสุด",
  stone_count_invalid: "จำนวนเม็ดต้องเป็น 3-7",
  shape_dims_invalid: "ขนาดไม่ตรงกับทรง (ทรงกลมต้องกว้าง = ยาว · ทรงไข่ต้องยาวกว่ากว้าง)",
  axis_required: "ทรงไข่ต้องระบุทิศเม็ด",
  axis_not_allowed: "ทรงกลมไม่มีทิศเม็ด",
  design_locked: "แบบนี้เปิดขายแล้ว — แก้จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศเม็ดไม่ได้ ให้ทำสำเนาเป็นแบบใหม่",
  model_bound: "แบบนี้มีโมเดลผูกอยู่ — แก้จำนวนเม็ดไม่ได้",
  shape_kind_locked: "รูปร่างของทรงแก้ไม่ได้ (สร้างทรงใหม่)",
  render_kind_invalid: "ต้องเลือกรูปร่างที่ระบบรองรับ (กลม/ไข่)",
  price_invalid: "ราคาต้องเป็นจำนวนเต็มบาทในช่วงที่กำหนด",
  price_too_fast: "ตั้งราคาถี่เกินไป รอสักครู่แล้วลองใหม่",
  price_required: "ตั้งราคาตัวเรือนก่อนเปิดขาย",
  shape_inactive: "ทรงพลอยของแบบนี้ปิดอยู่ — เปิดทรงก่อน",
  not_published: "แบบนี้ยังไม่เคยเปิดขาย — ใช้ปุ่ม \"เปิดขาย\"",
  path_invalid: "รูปการ์ดไม่ถูกต้อง",
  design_no_exhausted: "เลขแบบเต็มแล้ว",
  stone_no_exhausted: "เลขพลอยเต็มแล้ว",
  actor_required: "ต้องเข้าสู่ระบบก่อนทำรายการ",
  rb_actor_forbidden: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้น",
  invalid: "ข้อมูลไม่ถูกต้อง",
  sort_invalid: "ลำดับไม่ถูกต้อง",
  count_mismatch: "จำนวนเม็ดไม่ตรงกับแบบ",
  immutable: "ค่านี้แก้ไม่ได้หลังสร้าง",
  no_delete: "ลบไม่ได้ (ใช้การปิดแทน)",
};

const GENERIC_ERROR = "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";

/** ข้อความแสดงผู้ใช้จากผลล้มเหลวของ action — เรียงลำดับ: code ที่รู้จัก → error ที่ action ส่งมา → ข้อความกลาง (ไม่ echo ข้อความดิบ) */
export function ringErrorText(res: { error?: string; code?: string } | null | undefined): string {
  if (res?.code && RING_ERROR_MESSAGES[res.code]) return RING_ERROR_MESSAGES[res.code];
  return res?.error && res.error.trim() !== "" ? res.error : GENERIC_ERROR;
}

export const HIDDEN_REASON_LABEL: Record<HiddenReason, string> = {
  draft: "ร่าง · ยังไม่เปิดขาย",
  closed: "ปิด",
  shape_closed: "ซ่อน · ทรงพลอยปิดอยู่",
  no_price: "ซ่อน · ยังไม่มีราคาตัวเรือน",
};

export const COVERAGE_REASON_LABEL: Record<CoverageReason, string> = {
  stone_closed: "พลอยปิดอยู่",
  no_offer: "ยังไม่มีราคาทรง/ขนาดนี้",
  offer_closed: "ราคาทรง/ขนาดนี้ปิดอยู่",
  no_price: "ยังไม่ตั้งราคา",
};

/** แสดงเงินบาทเต็มจำนวน "฿1,090" — จัดรูปอย่างเดียว ไม่คำนวณ */
export function fmtThb(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `฿${n.toLocaleString("en-US")}`;
}

/** ส่วนต่างที่ server คืนมา → "+฿20" / "-฿20" / "—" (0 หรือ null) */
export function fmtDiffThb(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0 || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : "-"}฿${Math.abs(n).toLocaleString("en-US")}`;
}

/** ตรวจรูปร่างราคาเต็มบาทก่อนส่ง (pre-check ฝั่งฟอร์ม · DB เป็นด่านจริง) — ไม่ใช้ parseFloat */
export function parseWholeThb(input: string, max: number): number | null {
  const t = input.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return n >= 1 && n <= max ? n : null;
}

/** ประกอบสตริงขนาด "กว้าง×ยาว" จาก 2 ช่อง — server แปลงเป็น mm100 เอง */
export function composeSize(w: string, h: string): string {
  return `${w.trim()}×${h.trim()}`;
}
