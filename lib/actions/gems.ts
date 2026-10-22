"use server";

// lib/actions/gems.ts — พลอย G1a (ออฟฟิศ owner/admin): แคตตาล็อก · ราคา · รวมชื่อ · แม่แบบ SKU · พลอยต่อใบ
// guard() บรรทัดแรกทุก action · p_shop_id/p_actor ใส่ฝั่ง server หลัง spread (callOffice) · ตรวจรูปร่าง input ก่อนถึง DB · DB (migration 0190) เป็นด่านจริง — ตรวจ actor owner/admin ซ้ำที่ RPC ราคา/แคตตาล็อก
// 🔴 ราคาพลอย = ต้นทุน (ไม่ให้ role ฝั่งแอปอ่านตารางราคา/audit ตรง — role ระดับแพลตฟอร์มอ่านได้: postgres · supabase_admin · supabase_etl_admin · supabase_read_only_user — คุมที่องค์กร): อ่าน/เขียนผ่าน getGemCatalog · setGemPrice · getGemPriceHistory เท่านั้น — action อื่นไม่คืนราคา · หน้าช่าง (/w/) ห้าม import ไฟล์นี้ (worker-boundary.test)
// ข้อผิดพลาดของแถวพลอย/ตัวดักชื่อคล้ายพา gem {code,row,field,similar[]} กลับไปด้วย (result.gem) ให้หน้าจอพากลับแถวที่ผิด
// ไฟล์ "use server": export ได้เฉพาะ async function

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/jobs/input";
import { callOffice, fail, guard } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { GEM_KINDS, wireFailResult, mapGemCatalog, mapGemMergePlan, mapGemOptions, mapGemPriceHistory, mapGemSaveSummary, mapJobGems, mapGemBomLine, toWireGemLines } from "@/lib/jobs/gems";
import type { GemCatalog, GemKind, GemMergePlan, GemOptions, GemPriceHistory, GemSaveSummary, GemBomLine, JobGems } from "@/lib/jobs/gems";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง";

const catalogDone = () => revalidatePath("/oem/gems");
const jobDone = (jobId: string) => {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
};

function kindOf(v: unknown, allowed: readonly GemKind[] = GEM_KINDS): GemKind | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as GemKind) : null;
}

// ---------------------------------------------------------------------------
// รายการสำหรับฟอร์ม (ไม่มีราคา) · แคตตาล็อกเต็ม (มีราคา — owner/admin)
// ---------------------------------------------------------------------------
export async function getGemOptions(): Promise<JobResult<GemOptions>> {
  const g = await guard();
  if (g) return g;
  const r = await callOffice<unknown>("gem_options_list", {}, { noActor: true });
  if (!r.ok) return r;
  const m = mapGemOptions(r.data);
  return m ? { ok: true, data: m } : fail(GENERIC_JOB_ERROR);
}

export async function getGemCatalog(includeInactive = false): Promise<JobResult<GemCatalog>> {
  const g = await guard();
  if (g) return g;
  const r = await callOffice<unknown>("gem_catalog_list", { p_include_inactive: includeInactive === true });
  if (!r.ok) return r;
  const m = mapGemCatalog(r.data);
  return m ? { ok: true, data: m } : fail(GENERIC_JOB_ERROR);
}

// ---------------------------------------------------------------------------
// สร้าง/เปลี่ยนชื่อ/ปิด/ลบ/รวมชื่อ
// ---------------------------------------------------------------------------
export interface CreateGemNameInput {
  kind: "type" | "shape";
  name: string;
  /** เฉพาะรูปทรง: ขนาดกี่ค่า (true = กว้าง×ยาว) */
  hasLength?: boolean;
  force?: boolean;
}

export async function createGemName(input: CreateGemNameInput): Promise<JobResult<{ id: string; name: string }>> {
  const g = await guard();
  if (g) return g;
  const kind = isObj(input) ? kindOf(input.kind, ["type", "shape"]) : null;
  if (!kind || typeof input.name !== "string" || input.name.length > 200) return fail(BAD_INPUT);
  if (kind === "shape" && typeof input.hasLength !== "boolean") return fail("รูปทรงใหม่ต้องระบุจำนวนค่าขนาด (1 หรือ 2 ค่า)", "shape_new_invalid");
  const r = await callOffice<Raw>("gem_catalog_create", { p_kind: kind, p_name: input.name, p_has_length: kind === "shape" ? input.hasLength : null, p_force: input.force === true });
  if (!r.ok) return r;
  const id = r.data.id;
  const name = r.data.name;
  if (typeof id !== "string" || !isUuid(id) || typeof name !== "string") return fail(GENERIC_JOB_ERROR);
  catalogDone();
  return { ok: true, data: { id, name } };
}

/** สร้างรายการ (ชนิด+รูปทรง+ขนาด) ตรงๆ จากหน้าแคตตาล็อก — แถวรูปแบบเดียวกับ BOM (ไม่ต้องมีจำนวน) */
export async function createGemItem(line: unknown, force = false): Promise<JobResult<{ gemItemId: string; label: string; created: boolean }>> {
  const g = await guard();
  if (g) return g;
  if (!isObj(line)) return fail(BAD_INPUT);
  const w = toWireGemLines([{ ...line, qtyPerPiece: 1 }]);
  if (!w.ok) return wireFailResult(w);
  const { qty_per_piece: _q, ...wireLine } = w.value[0];
  void _q;
  const r = await callOffice<Raw>("gem_item_create", { p_line: wireLine, p_force: force === true });
  if (!r.ok) return r;
  const item = isObj(r.data.item) ? r.data.item : null;
  const id = item?.gem_item_id;
  const label = item?.label;
  if (typeof id !== "string" || !isUuid(id) || typeof label !== "string") return fail(GENERIC_JOB_ERROR);
  catalogDone();
  return { ok: true, data: { gemItemId: id, label, created: r.data.created === true } };
}

export async function renameGem(input: { kind: "type" | "shape"; id: string; name: string; force?: boolean }): Promise<JobResult<{ name: string }>> {
  const g = await guard();
  if (g) return g;
  const kind = isObj(input) ? kindOf(input.kind, ["type", "shape"]) : null;
  if (!kind || !isUuid(input.id) || typeof input.name !== "string" || input.name.length > 200) return fail(BAD_INPUT);
  const r = await callOffice<Raw>("gem_catalog_rename", { p_kind: kind, p_id: input.id, p_new_name: input.name, p_force: input.force === true });
  if (!r.ok) return r;
  catalogDone();
  return { ok: true, data: { name: typeof r.data.name === "string" ? r.data.name : input.name } };
}

export async function setGemShapeHasLength(input: { id: string; hasLength: boolean }): Promise<JobResult<{ hasLength: boolean }>> {
  const g = await guard();
  if (g) return g;
  if (!isObj(input) || !isUuid(input.id) || typeof input.hasLength !== "boolean") return fail(BAD_INPUT);
  const r = await callOffice<Raw>("gem_shape_set_has_length", { p_id: input.id, p_has_length: input.hasLength });
  if (!r.ok) return r;
  catalogDone();
  return { ok: true, data: { hasLength: input.hasLength } };
}

export async function setGemActive(input: { kind: GemKind; id: string; active: boolean }): Promise<JobResult<{ isActive: boolean }>> {
  const g = await guard();
  if (g) return g;
  const kind = isObj(input) ? kindOf(input.kind) : null;
  if (!kind || !isUuid(input.id) || typeof input.active !== "boolean") return fail(BAD_INPUT);
  const r = await callOffice<Raw>("gem_catalog_set_active", { p_kind: kind, p_id: input.id, p_active: input.active });
  if (!r.ok) return r;
  catalogDone();
  return { ok: true, data: { isActive: input.active } };
}

export async function removeGem(input: { kind: GemKind; id: string }): Promise<JobResult<{ removed: true }>> {
  const g = await guard();
  if (g) return g;
  const kind = isObj(input) ? kindOf(input.kind) : null;
  if (!kind || !isUuid(input.id)) return fail(BAD_INPUT);
  const r = await callOffice<Raw>("gem_catalog_remove", { p_kind: kind, p_id: input.id });
  if (!r.ok) return r;
  catalogDone();
  return { ok: true, data: { removed: true } };
}

export async function previewGemMerge(input: { kind: "type" | "shape"; fromId: string; intoId: string }): Promise<JobResult<GemMergePlan>> {
  const g = await guard();
  if (g) return g;
  const kind = isObj(input) ? kindOf(input.kind, ["type", "shape"]) : null;
  if (!kind || !isUuid(input.fromId) || !isUuid(input.intoId)) return fail(BAD_INPUT);
  const r = await callOffice<unknown>("gem_merge_preview", { p_kind: kind, p_from: input.fromId, p_into: input.intoId });
  if (!r.ok) return r;
  const m = mapGemMergePlan(r.data);
  return m ? { ok: true, data: m } : fail(GENERIC_JOB_ERROR);
}

/** รวมชื่อ A→B (ย้อนกลับไม่ได้) — จอต้องแสดง preview ก่อนเสมอ · ราคาของ A ไม่ถูกย้าย · ใบที่เปิดแล้วไม่เปลี่ยน */
export async function mergeGem(input: { kind: "type" | "shape"; fromId: string; intoId: string }): Promise<JobResult<GemMergePlan>> {
  const g = await guard();
  if (g) return g;
  const kind = isObj(input) ? kindOf(input.kind, ["type", "shape"]) : null;
  if (!kind || !isUuid(input.fromId) || !isUuid(input.intoId)) return fail(BAD_INPUT);
  const r = await callOffice<unknown>("gem_merge", { p_kind: kind, p_from: input.fromId, p_into: input.intoId });
  if (!r.ok) return r;
  const m = mapGemMergePlan(r.data);
  if (!m) return fail(GENERIC_JOB_ERROR);
  catalogDone();
  revalidatePath("/catalog");
  return { ok: true, data: m };
}

// ---------------------------------------------------------------------------
// ราคา (🔴 ต้นทุน — owner/admin เท่านั้น ทั้งชั้นแอปและ DB)
// ---------------------------------------------------------------------------
const PRICE_RE = /^\d{1,7}(?:\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SetGemPriceInput {
  itemId: string;
  /** บาทต่อเม็ด (ทศนิยม ≤ 4 · 0 < x ≤ 1,000,000) */
  price: number | string;
  /** วันที่มีผล YYYY-MM-DD (ว่าง = วันนี้ไทย) — ย้อนหลัง (ก่อนวันนี้ไทย) หรือแก้ทับวันเดิม ต้องมี note ที่มีตัวอักษรจริง (note_required) */
  effectiveFrom?: string | null;
  supplier?: string | null;
  note?: string | null;
}

export async function setGemPrice(input: SetGemPriceInput): Promise<JobResult<{ effectiveFrom: string; replaced: boolean }>> {
  const g = await guard();
  if (g) return g;
  if (!isObj(input) || !isUuid(input.itemId)) return fail(BAD_INPUT);
  const text = typeof input.price === "number" ? (Number.isFinite(input.price) ? String(input.price) : "") : typeof input.price === "string" ? input.price.trim().replace(",", ".") : "";
  const priceMsg = "ราคาต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท (ทศนิยมไม่เกิน 4 ตำแหน่ง)";
  if (!PRICE_RE.test(text)) return fail(priceMsg, "price_invalid");
  const price = Number(text);
  if (!(price > 0 && price <= 1_000_000)) return fail(priceMsg, "price_invalid");
  let eff: string | null = null;
  if (input.effectiveFrom !== undefined && input.effectiveFrom !== null && input.effectiveFrom !== "") {
    if (typeof input.effectiveFrom !== "string" || !DATE_RE.test(input.effectiveFrom) || Number.isNaN(Date.parse(input.effectiveFrom))) return fail("วันที่มีผลไม่ถูกต้อง", "date_invalid");
    eff = input.effectiveFrom;
  }
  for (const f of [input.supplier, input.note]) {
    if (f !== undefined && f !== null && (typeof f !== "string" || f.length > 300)) return fail(BAD_INPUT);
  }
  const r = await callOffice<Raw>("gem_price_set", {
    p_item_id: input.itemId,
    p_price: price,
    p_effective_from: eff,
    p_supplier: input.supplier ?? null,
    p_note: input.note ?? null,
  });
  if (!r.ok) return r;
  const d = r.data.effective_from;
  catalogDone();
  return { ok: true, data: { effectiveFrom: typeof d === "string" ? d.slice(0, 10) : (eff ?? ""), replaced: r.data.replaced === true } };
}

/** ประวัติราคา + audit การแก้ (old/new/note/actor) */
export async function getGemPriceHistory(itemId: string): Promise<JobResult<GemPriceHistory>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(itemId)) return fail(BAD_INPUT);
  const r = await callOffice<unknown>("gem_price_history", { p_item_id: itemId });
  if (!r.ok) return r;
  const m = mapGemPriceHistory(r.data);
  return m ? { ok: true, data: m } : fail(GENERIC_JOB_ERROR);
}

// ---------------------------------------------------------------------------
// พลอยต่อใบ + แม่แบบ SKU
// ---------------------------------------------------------------------------
export async function getJobGems(jobId: string): Promise<JobResult<JobGems>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const r = await callOffice<unknown>("job_gem_bom_get", { p_job_id: jobId }, { noActor: true });
  if (!r.ok) return r;
  const m = mapJobGems(r.data);
  return m ? { ok: true, data: m } : fail(GENERIC_JOB_ERROR);
}

export interface SaveJobGemsInput {
  jobId: string;
  /** แถวพลอยทั้งชุด (แทนที่ทั้งชุด) — [] = ไม่มีพลอย */
  lines: unknown;
  /** เหตุผล — บังคับเมื่อขั้นฝังพลอยถูกรับแล้ว (window = reason_required) · ต้องมีตัวอักษร/ตัวเลขจริง */
  reason?: string | null;
  force?: boolean;
}

export interface SaveGemsResult {
  summary: GemSaveSummary;
  lines: GemBomLine[];
  window: string | null;
}

function saveResult(data: Raw): SaveGemsResult | null {
  const summary = mapGemSaveSummary(data);
  if (!summary) return null;
  const lines = (Array.isArray(data.lines) ? data.lines : []).map(mapGemBomLine).filter((l): l is GemBomLine => l !== null);
  return { summary, lines, window: typeof data.window === "string" ? data.window : null };
}

export async function saveJobGems(input: SaveJobGemsInput): Promise<JobResult<SaveGemsResult>> {
  const g = await guard();
  if (g) return g;
  if (!isObj(input) || !isUuid(input.jobId)) return fail("ไม่พบใบงาน");
  const w = toWireGemLines(input.lines);
  if (!w.ok) return wireFailResult(w);
  if (input.reason !== undefined && input.reason !== null && (typeof input.reason !== "string" || input.reason.length > 300)) return fail("เหตุผลยาวเกิน 300 ตัวอักษร", "reason_invalid");
  const r = await callOffice<Raw>("job_gem_bom_set", { p_job_id: input.jobId, p_gem_lines: w.value, p_reason: input.reason ?? null, p_force: input.force === true });
  if (!r.ok) return r;
  const out = saveResult(r.data);
  if (!out) return fail(GENERIC_JOB_ERROR);
  jobDone(input.jobId);
  return { ok: true, data: out };
}

export async function getSkuGemTemplate(productId: string): Promise<JobResult<GemBomLine[]>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(productId)) return fail(BAD_INPUT);
  const r = await callOffice<Raw>("product_gem_bom_get", { p_product_id: productId }, { noActor: true });
  if (!r.ok) return r;
  return { ok: true, data: (Array.isArray(r.data.lines) ? r.data.lines : []).map(mapGemBomLine).filter((l): l is GemBomLine => l !== null) };
}

/** แทนที่แม่แบบพลอยของ SKU ทั้งชุด — มีผลกับใบที่เปิดใหม่เท่านั้น (ใบเดิมไม่เปลี่ยน) · [] = ล้างแม่แบบ */
export async function saveSkuGemTemplate(input: { productId: string; lines: unknown; force?: boolean }): Promise<JobResult<SaveGemsResult>> {
  const g = await guard();
  if (g) return g;
  if (!isObj(input) || !isUuid(input.productId)) return fail(BAD_INPUT);
  const w = toWireGemLines(input.lines);
  if (!w.ok) return wireFailResult(w);
  const r = await callOffice<Raw>("product_gem_bom_set", { p_product_id: input.productId, p_gem_lines: w.value, p_force: input.force === true });
  if (!r.ok) return r;
  const out = saveResult(r.data);
  if (!out) return fail(GENERIC_JOB_ERROR);
  revalidatePath("/catalog");
  return { ok: true, data: out };
}

/** "ตั้งเป็นแม่แบบ SKU" จากพลอยของใบนี้ (ใบต้องมี SKU) */
export async function makeSkuGemTemplateFromJob(jobId: string): Promise<JobResult<SaveGemsResult>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const r = await callOffice<Raw>("product_gem_bom_from_job", { p_job_id: jobId });
  if (!r.ok) return r;
  const out = saveResult(r.data);
  if (!out) return fail(GENERIC_JOB_ERROR);
  revalidatePath("/catalog");
  jobDone(jobId);
  return { ok: true, data: out };
}
