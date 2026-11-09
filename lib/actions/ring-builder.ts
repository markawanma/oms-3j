"use server";

// lib/actions/ring-builder.ts — หลังบ้าน "ออกแบบแหวนแถวเอง" (/catalog/ring-builder · owner/admin เท่านั้น) — ครอบทุกอย่างที่ 4 จอ (AdminGems · AdminDesigns · AdminVerify · AdminVerifyStates) ใช้
// ทุก action: `if (!isOwnerOrAdmin(await getEffectiveRole())) return …` เป็นบรรทัดแรก (allowlist) แล้วค่อยเช็ก session · p_shop_id/p_actor ใส่ที่ server (adminRpc) ไม่รับจาก client
// ตรวจรูปร่าง input ก่อนถึง DB · DB (migration 0196) เป็นด่านจริง — ตรวจ actor owner/admin ซ้ำที่ RPC ทุกตัว
// ราคา/ตัวเลขเงินคำนวณที่ DB — action ไม่คำนวณสูตรใดๆ · log เฉพาะรหัส (ห้าม log error ทั้งก้อน)
// ไฟล์ "use server": export ได้เฉพาะ async function (+ type) — ค่าคงที่อยู่ lib/ring-builder/config.ts
//
// สัญญาให้ frontend: ทุก action คืน ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string } (code = hint ของ DB เช่น name_dup · design_locked · price_required)

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getEffectiveRole } from "@/lib/auth/role";
import { isOwnerOrAdmin } from "@/lib/auth/owner-admin";
import { requireSessionIfGateOn } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase/server";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { MAX_BYTES, MD_MAX_PX, JOB_PHOTO_DIM_SLACK_PX } from "@/lib/images/constants";
import { cleanJpegForStorage, extractJpegDimensions, looksLikeJpeg } from "@/lib/images/server";
import { adminRpc, checkCodeText, mapAdminCatalog } from "@/lib/ring-builder/admin-server";
import type { AdminCatalog, CodeCheckResult } from "@/lib/ring-builder/admin-types";
import { RING_BUILDER_BUCKET } from "@/lib/ring-builder/config";
import { parseStoneSize } from "@/lib/ring-builder/mm";

export type RingActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

const NOT_ALLOWED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการแบบแหวนได้";
const LOGIN_FIRST = "ต้องเข้าสู่ระบบก่อน";
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHECK_TEXT = 4000;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const optStr = (v: unknown, max: number): string | null | undefined => (v === undefined || v === null ? null : typeof v === "string" && v.length <= max ? v : undefined);
const bad = (): { ok: false; error: string } => ({ ok: false, error: BAD_INPUT });

/** หลังเช็ก role แล้ว: ต้องมี session จริง (เมื่อเปิด gate) */
async function sessionOk(): Promise<boolean> {
  try {
    await requireSessionIfGateOn();
    return true;
  } catch {
    return false;
  }
}

function done(extra: "all" | "public" = "all"): void {
  revalidatePath("/ring-builder");
  if (extra === "all") revalidatePath("/catalog/ring-builder");
}

// ---------------------------------------------------------------------------
// อ่านทั้งชุด (shapes · designs · stones + coverage)
// ---------------------------------------------------------------------------
export async function getRingBuilderAdmin(): Promise<RingActionResult<AdminCatalog>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  const r = await adminRpc<unknown>("rb_admin_catalog", {});
  if (!r.ok) return r;
  const m = mapAdminCatalog(r.data, process.env.SUPABASE_URL);
  return m ? { ok: true, data: m } : { ok: false, error: "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" };
}

// ---------------------------------------------------------------------------
// ทรงพลอย (เพิ่มชื่อทรงได้เอง แต่ render_kind ต้องเป็นรูปร่างที่โค้ดรองรับ: round | oval)
// ---------------------------------------------------------------------------
export async function saveRingShape(input: { id?: string | null; name: string; renderKind?: "round" | "oval" | null; sort?: number | null }): Promise<RingActionResult<{ id: string; created: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || typeof input.name !== "string" || input.name.length > 100) return bad();
  if (input.id != null && !isUuid(input.id)) return bad();
  if (input.renderKind != null && input.renderKind !== "round" && input.renderKind !== "oval") return bad();
  if (input.sort != null && !isInt(input.sort, -1000, 100000)) return bad();
  const r = await adminRpc<Raw>("rb_shape_upsert", { p_id: input.id ?? null, p_name: input.name, p_render_kind: input.renderKind ?? null, p_sort: input.sort ?? null });
  if (!r.ok) return r;
  if (!isUuid(r.data.id)) return { ok: false, error: "ผลลัพธ์ไม่ถูกต้อง" };
  done();
  return { ok: true, data: { id: r.data.id, created: r.data.created === true } };
}

// ---------------------------------------------------------------------------
// พลอย (ชื่อจริง · ชื่อสั้น ≤ 6 · สี) — เลขพลอยออกที่ DB (ห้ามใช้ซ้ำ)
// ---------------------------------------------------------------------------
export async function saveRingStone(input: { id?: string | null; name: string; shortName: string; colorHex: string; sort?: number | null }): Promise<RingActionResult<{ id: string; stoneNo: number; created: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || typeof input.name !== "string" || input.name.length > 200 || typeof input.shortName !== "string" || input.shortName.length > 50 || typeof input.colorHex !== "string" || input.colorHex.length > 20) return bad();
  if (input.id != null && !isUuid(input.id)) return bad();
  if (input.sort != null && !isInt(input.sort, -1000, 100000)) return bad();
  const r = await adminRpc<Raw>("rb_stone_upsert", { p_id: input.id ?? null, p_name_th: input.name, p_short_name: input.shortName, p_color_hex: input.colorHex, p_sort: input.sort ?? null });
  if (!r.ok) return r;
  if (!isUuid(r.data.id) || !isInt(r.data.stone_no, 1, 1023)) return { ok: false, error: "ผลลัพธ์ไม่ถูกต้อง" };
  done();
  return { ok: true, data: { id: r.data.id, stoneNo: r.data.stone_no, created: r.data.created === true } };
}

/** เพิ่ม/เปิดราคาตามทรง×ขนาด — size = สตริง "กว้าง×ยาว" (รับ × x * หรือเลขเดียว) แปลงเป็น mm100 ที่นี่ (ไม่ใช้ parseFloat) · ราคาตั้งที่ setRingOfferPrice */
export async function saveRingOffer(input: { stoneId: string; shapeId: string; size: string }): Promise<RingActionResult<{ offerId: string; created: boolean; reactivated: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || !isUuid(input.stoneId) || !isUuid(input.shapeId)) return bad();
  const size = parseStoneSize(input.size);
  if (!size.ok) return { ok: false, error: size.reason === "range" ? "ขนาดต้องอยู่ระหว่าง 0.50-20.00 มม." : "ขนาดไม่ถูกต้อง (ตัวอย่าง 2×2 · 4×3 · ทศนิยมไม่เกิน 2 ตำแหน่ง ใช้จุด)", code: "size_invalid" };
  const r = await adminRpc<Raw>("rb_offer_upsert", { p_stone_id: input.stoneId, p_shape_id: input.shapeId, p_major_mm100: size.major, p_minor_mm100: size.minor });
  if (!r.ok) return r;
  if (!isUuid(r.data.id)) return { ok: false, error: "ผลลัพธ์ไม่ถูกต้อง" };
  done();
  return { ok: true, data: { offerId: r.data.id, created: r.data.created === true, reactivated: r.data.reactivated === true } };
}

/** ราคาพลอยต่อเม็ด (บาท จำนวนเต็ม) — มีผลกับการออกแบบหลังจากนี้ · รหัสเก่าคงราคาเดิม (insert-only) */
export async function setRingOfferPrice(input: { offerId: string; priceThb: number }): Promise<RingActionResult<{ unchanged: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || !isUuid(input.offerId) || !isInt(input.priceThb, 1, 100000)) return bad();
  const r = await adminRpc<Raw>("rb_offer_price_set", { p_offer_id: input.offerId, p_price_thb: input.priceThb });
  if (!r.ok) return r;
  done();
  return { ok: true, data: { unchanged: r.data.unchanged === true } };
}

// ---------------------------------------------------------------------------
// แบบแหวน — บันทึก (ร่าง/แก้) · ราคาตัวเรือนส่งมาพร้อมกันได้ (ตั้งเมื่อเปลี่ยนจากปัจจุบันเท่านั้น)
// ---------------------------------------------------------------------------
export interface SaveRingDesignInput {
  id?: string | null;
  name: string;
  stoneCount: number;
  shapeId: string;
  /** "กว้าง×ยาว" มม. */
  size: string;
  /** ทิศเม็ดไข่ (ทรงกลมต้องเป็น null) */
  stoneAxis: "along_row" | "across_row" | null;
  sizeMin: number;
  sizeMax: number;
  sort?: number | null;
  bodyPriceThb?: number | null;
}

export async function saveRingDesign(input: SaveRingDesignInput): Promise<RingActionResult<{ id: string; designNo: number; created: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || typeof input.name !== "string" || input.name.length > 200 || !isUuid(input.shapeId) || !isInt(input.stoneCount, 3, 7)) return bad();
  if (input.id != null && !isUuid(input.id)) return bad();
  if (input.stoneAxis !== null && input.stoneAxis !== "along_row" && input.stoneAxis !== "across_row") return bad();
  if (!isInt(input.sizeMin, 1, 200) || !isInt(input.sizeMax, 1, 200)) return bad();
  if (input.sort != null && !isInt(input.sort, -1000, 100000)) return bad();
  if (input.bodyPriceThb != null && !isInt(input.bodyPriceThb, 1, 1_000_000)) return bad();
  const size = parseStoneSize(input.size);
  if (!size.ok) return { ok: false, error: size.reason === "range" ? "ขนาดพลอยต้องอยู่ระหว่าง 0.50-20.00 มม." : "ขนาดพลอยไม่ถูกต้อง (ตัวอย่าง 2×2 · 4×3)", code: "size_invalid" };
  const r = await adminRpc<Raw>("rb_design_upsert", {
    p_id: input.id ?? null, p_name: input.name, p_stone_count: input.stoneCount, p_shape_id: input.shapeId, p_major_mm100: size.major, p_minor_mm100: size.minor,
    p_axis: input.stoneAxis, p_size_min: input.sizeMin, p_size_max: input.sizeMax, p_sort: input.sort ?? null,
  });
  if (!r.ok) return r;
  if (!isUuid(r.data.id) || !isInt(r.data.design_no, 1, 4095)) return { ok: false, error: "ผลลัพธ์ไม่ถูกต้อง" };
  if (input.bodyPriceThb != null) {
    const p = await adminRpc<Raw>("rb_design_price_set", { p_design_id: r.data.id, p_price_thb: input.bodyPriceThb });
    if (!p.ok) {
      done();
      return { ok: false, error: `บันทึกแบบแล้ว แต่ตั้งราคาตัวเรือนไม่สำเร็จ: ${p.error}`, code: p.code };
    }
  }
  done();
  return { ok: true, data: { id: r.data.id, designNo: r.data.design_no, created: r.data.created === true } };
}

export async function setRingDesignPrice(input: { designId: string; priceThb: number }): Promise<RingActionResult<{ unchanged: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || !isUuid(input.designId) || !isInt(input.priceThb, 1, 1_000_000)) return bad();
  const r = await adminRpc<Raw>("rb_design_price_set", { p_design_id: input.designId, p_price_thb: input.priceThb });
  if (!r.ok) return r;
  done();
  return { ok: true, data: { unchanged: r.data.unchanged === true } };
}

/** เปิดขายครั้งแรก — ล็อก จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศ ถาวร (ต้องมีราคาตัวเรือน + ทรงเปิดอยู่) */
export async function publishRingDesign(designId: string): Promise<RingActionResult<{ already: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isUuid(designId)) return bad();
  const r = await adminRpc<Raw>("rb_design_publish", { p_design_id: designId });
  if (!r.ok) return r;
  done();
  return { ok: true, data: { already: r.data.already === true } };
}

export async function duplicateRingDesign(designId: string): Promise<RingActionResult<{ id: string; designNo: number }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isUuid(designId)) return bad();
  const r = await adminRpc<Raw>("rb_design_duplicate", { p_design_id: designId });
  if (!r.ok) return r;
  if (!isUuid(r.data.id) || !isInt(r.data.design_no, 1, 4095)) return { ok: false, error: "ผลลัพธ์ไม่ถูกต้อง" };
  done();
  return { ok: true, data: { id: r.data.id, designNo: r.data.design_no } };
}

/** เปิด/ปิด: design | stone | offer | shape — ปิดทรง = affectedDesigns (จำนวนแบบที่เปิดอยู่ที่ใช้ทรงนั้น) ให้ UI เตือนก่อน */
export async function setRingActive(input: { kind: "design" | "stone" | "offer" | "shape"; id: string; active: boolean }): Promise<RingActionResult<{ changed: boolean; affectedDesigns: number }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isObj(input) || !["design", "stone", "offer", "shape"].includes(input.kind as string) || !isUuid(input.id) || typeof input.active !== "boolean") return bad();
  const r = await adminRpc<Raw>("rb_set_active", { p_kind: input.kind, p_id: input.id, p_active: input.active });
  if (!r.ok) return r;
  done();
  return { ok: true, data: { changed: r.data.changed === true, affectedDesigns: isInt(r.data.affected_designs, 0, 100000) ? r.data.affected_designs : 0 } };
}

// ---------------------------------------------------------------------------
// รูปการ์ดแบบ (ไม่บังคับ) — FormData { designId, md: File } · md = JPEG ที่ resize ฝั่ง client ด้วย lib/images/client.ts (long edge ≤ MD_MAX_PX)
// ด่านฝั่ง server: magic bytes JPEG · ขนาด ≤ 1 MB · มิติ · ตัด Exif/XMP (cleanJpegForStorage) · path = designs/<uuid สุ่ม>.jpg (ไม่ผูกเลขแบบ) · ผูก DB ไม่สำเร็จ = ลบไฟล์ที่เพิ่งอัป
// ---------------------------------------------------------------------------
export async function uploadRingCardImage(fd: FormData): Promise<RingActionResult<{ path: string }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  const designId = fd instanceof FormData ? fd.get("designId") : null;
  const file = fd instanceof FormData ? fd.get("md") : null;
  if (!isUuid(designId) || !(file instanceof File)) return bad();
  if (file.size === 0 || file.size > MAX_BYTES) return { ok: false, error: "ไฟล์รูปว่างหรือใหญ่เกิน 1 MB" };
  const raw = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeJpeg(raw)) return { ok: false, error: "ไฟล์ไม่ใช่ JPEG" };
  const dims = extractJpegDimensions(raw);
  if (!dims || Math.max(dims.width, dims.height) > MD_MAX_PX + JOB_PHOTO_DIM_SLACK_PX) return { ok: false, error: "รูปใหญ่เกินกำหนด — ย่อรูปก่อนอัปโหลด" };
  const clean = cleanJpegForStorage(raw, MAX_BYTES);
  if (!clean.ok) return { ok: false, error: "รูปไม่ผ่านการตรวจ (ไฟล์เสีย/มีข้อมูลกล้อง/ใหญ่เกิน)" };

  const path = `designs/${randomUUID()}.jpg`;
  const bucket = getServiceClient().storage.from(RING_BUILDER_BUCKET);
  try {
    const up = await bucket.upload(path, clean.bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "86400" });
    if (up.error) throw up.error;
  } catch (err) {
    console.error("ring-builder card upload failed", { code: readErrorCode(err) ?? "(none)" });
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  const r = await adminRpc<Raw>("rb_design_card_set", { p_design_id: designId, p_path: path });
  if (!r.ok) {
    await bucket.remove([path]).catch(() => undefined);
    return r;
  }
  if (typeof r.data.previous_path === "string" && r.data.previous_path !== "") {
    await bucket.remove([r.data.previous_path]).catch(() => undefined); // best-effort — ค้างเป็นไฟล์เก่าไม่ใช่ปัญหาความถูกต้อง
  }
  done();
  return { ok: true, data: { path } };
}

export async function clearRingCardImage(designId: string): Promise<RingActionResult<{ cleared: boolean }>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (!isUuid(designId)) return bad();
  const r = await adminRpc<Raw>("rb_design_card_set", { p_design_id: designId, p_path: null });
  if (!r.ok) return r;
  if (typeof r.data.previous_path === "string" && r.data.previous_path !== "") {
    await getServiceClient().storage.from(RING_BUILDER_BUCKET).remove([r.data.previous_path]).catch(() => undefined);
  }
  done();
  return { ok: true, data: { cleared: true } };
}

// ---------------------------------------------------------------------------
// ตรวจรหัส — วางรหัสหรือข้อความทั้งก้อนจากแชท (ไม่เก็บประวัติการตรวจ)
// ผล 8 สถานะ: empty · not_found · bad_format · not_issued · design_closed · changed · ok · unavailable (ระบบตรวจไม่ได้ ≠ รหัสผิด)
// ---------------------------------------------------------------------------
export async function checkRingCode(text: string): Promise<RingActionResult<CodeCheckResult>> {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!(await sessionOk())) return { ok: false, error: LOGIN_FIRST };
  if (typeof text !== "string" || text.length > MAX_CHECK_TEXT) return bad();
  return { ok: true, data: await checkCodeText(text) };
}

