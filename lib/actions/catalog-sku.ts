"use server";

// lib/actions/catalog-sku.ts — SKU-prefix config + "create new SKU" (Phase
// 1a of docs/3j-jewelry/oem/design-email-sku-phase1.md). Backed by
// analytics.sku_prefix / analytics.sku_counter / product_upsert (via
// catalog_sku_create) — migration 0089, landing in parallel with this file.
//
// NOT gated behind requireOwnerAdmin() unlike lib/actions/catalog.ts and
// lib/actions/oem.ts. Two reasons:
//   1. The design brief frames /catalog/sku-prefix as a screen "พนักงาน
//      หน้างาน" (frontline staff) fill in themselves — unlike the cost/
//      margin catalog it sits next to, neither table here (sku_prefix,
//      sku_counter) nor catalog_sku_create's output (product_id + a bare
//      SKU string) carries any cost/margin/price figure.
//   2. MEMORY "Role: สิทธิ์เดียว" — rules that must actually hold belong in
//      the DB, not behind an app-level button. The RPCs are still specced
//      as security-definer + crm_require_owner_admin (defense in depth for
//      when real auth/RLS replaces the service-role client) — this file
//      just doesn't ALSO duplicate that gate the way catalog.ts/oem.ts do,
//      since here it would contradict the brief instead of reinforcing it.
//   -> flagged back to Tech Lead in the handoff; trivial to add if wrong.
//
// The one place this domain DOES stay locked down: the "+ สินค้าใหม่" dialog
// is only reachable from /oem/quote, which is already owner/admin-only at
// the page level (unrelated to this file).

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { CreateCatalogSkuInput, SkuPrefixRow, SkuWorkType, UpsertSkuPrefixInput } from "@/lib/catalog/sku-prefix";
import { isValidSkuPrefix } from "@/lib/catalog/sku-prefix";

const SCHEMA = "analytics";

function toInt(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

// ============================================================================
// /catalog/sku-prefix — list. analytics.sku_counter is DELIBERATELY not
// queried directly here — 0089_sku_prefix.sql's own comment says so
// outright: "RLS เปิดแต่ไม่มี policy/grant — เข้าถึงได้เฉพาะภายใน
// sku_prefix_upsert / catalog_sku_create (security definer)", the same
// no-direct-read posture as analytics.oem_doc_counter (0084) — nothing in
// this app's lib/actions/oem.ts ever selects that table either, only RPCs
// touch it. A raw `.from("sku_counter").select(...)` here would hit
// "permission denied for table sku_counter" even under the service-role
// client — BYPASSRLS skips row-level security, not the separate table-ACL
// grant, and 0018's schema-wide `alter default privileges ... grant all on
// tables to service_role` has proven NOT to reliably cover later-created
// tables in this project (see 0041's own note on the same gotcha).
//
// So "เลขล่าสุด" here is populated via sku_prefix_preview_seed instead — the
// highest number actually found on an existing public.product.sku for that
// prefix (same RPC previewSkuSeed calls, already granted to service_role,
// reads public.product not sku_counter). This can read slightly LOWER than
// the true sku_counter.last_no if a seed was set above any real SKU still
// in use — acceptable for a display-only column; catalog_sku_create is the
// only thing that must be exactly right, and it reads sku_counter from
// inside its own security-definer body, not through this action.
// ============================================================================

export async function listSkuPrefixes(): Promise<ActionResult<SkuPrefixRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const prefixRes = await supabase
      .schema(SCHEMA)
      .from("sku_prefix")
      .select("id, kind_label, work_type, prefix, created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true });
    if (prefixRes.error) throw prefixRes.error;

    const prefixRows = (prefixRes.data ?? []) as {
      id: string;
      kind_label: string;
      work_type: SkuWorkType;
      prefix: string;
      created_at: string;
    }[];

    const lastNoResults = await Promise.all(
      prefixRows.map((r) => supabase.schema(SCHEMA).rpc("sku_prefix_preview_seed", { p_shop_id: shopId, p_prefix: r.prefix }))
    );

    const rows: SkuPrefixRow[] = prefixRows.map((r, i) => ({
      id: r.id,
      kindLabel: r.kind_label,
      workType: r.work_type,
      prefix: r.prefix,
      lastNo: lastNoResults[i].error ? null : toInt(lastNoResults[i].data as number | string | null),
      createdAt: r.created_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("listSkuPrefixes failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "โหลดรายการ prefix ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// เลขตั้งต้นแนะนำ — คนต้องยืนยัน/แก้ก่อนบันทึกเสมอ (design: "ระบบไม่เดาเงียบๆ")
// ============================================================================

export async function previewSkuSeed({ prefix }: { prefix: string }): Promise<ActionResult<{ suggestedSeed: number }>> {
  // 0089: the RPC rejects lowercase/whitespace/Thai OUTRIGHT (no silent
  // trim/uppercase on its side) — matched here rather than "fixing" the
  // input before validating, so this action never accepts something the RPC
  // would reject. The UI (SkuPrefixDialog) already sanitizes on every
  // keystroke via sanitizeSkuPrefixInput, so in practice `prefix` always
  // arrives clean; this is the same belt-and-braces re-validation every
  // other write action in this app does.
  const trimmed = prefix ?? "";
  if (!isValidSkuPrefix(trimmed)) {
    return { ok: false, error: "prefix ต้องเป็นตัวอักษร A-Z (พิมพ์ใหญ่) 1-5 ตัว ไม่มีช่องว่าง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("sku_prefix_preview_seed", {
      p_shop_id: shopId,
      p_prefix: trimmed,
    });
    if (error) throw error;

    const suggested = toInt(data as number | string | null) ?? 0;
    return { ok: true, data: { suggestedSeed: suggested } };
  } catch (err) {
    console.error("previewSkuSeed failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "คำนวณเลขตั้งต้นแนะนำไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// บันทึก prefix config
// ============================================================================

// sku_prefix_upsert (แก้รอบสองของ 0089) ระบุแถวด้วย p_id ตรงๆ: null = insert
// ใหม่ (บังคับ seed), มีค่า = update แถวนั้น (kind_label แก้ได้เสมอ, prefix แก้ได้
// เฉพาะยังไม่มี SKU ใช้, work_type แก้ไม่ได้เลย) — เวอร์ชัน natural-key matching
// ถูกตัดทิ้งไปแล้วก่อน apply. The dialog this app ships today (SkuPrefixDialog)
// only ever creates new rows (id undefined → p_id null → insert path ซึ่ง
// ทดสอบบน DB จริงแล้ว) — the edit path (p_id มีค่า) has DB-level tests but no
// UI exercising it yet; test by hand before building an "แก้ไข" button.
export async function upsertSkuPrefix(input: UpsertSkuPrefixInput): Promise<ActionResult<{ id: string }>> {
  const kindLabel = input.kindLabel?.trim();
  if (!kindLabel) return { ok: false, error: "กรุณากรอกประเภทงาน" };
  if (input.workType !== "plain" && input.workType !== "gem") {
    return { ok: false, error: "กรุณาเลือกลักษณะงาน" };
  }
  const prefix = input.prefix ?? "";
  if (!isValidSkuPrefix(prefix)) {
    return { ok: false, error: "prefix ต้องเป็นตัวอักษร A-Z (พิมพ์ใหญ่) 1-5 ตัว ปิดท้ายด้วย - ได้หนึ่งตัว ไม่มีช่องว่าง" };
  }
  const seedLastNo = toInt(input.seedLastNo);
  // 0 is a valid seed (next SKU will be prefix+1) — only reject null/negative.
  if (seedLastNo === null || seedLastNo < 0) {
    return { ok: false, error: "เลขตั้งต้นต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("sku_prefix_upsert", {
      p_shop_id: shopId,
      p_kind_label: kindLabel,
      p_work_type: input.workType,
      p_prefix: prefix,
      p_id: input.id ?? null,
      p_seed_last_no: seedLastNo,
    });
    if (error) {
      // 22023 = controlled Thai validation message from the RPC (e.g. prefix
      // already used, kind+work_type already used) — same convention as
      // saveRate/upsertProduct/saveQuote in the sibling actions files.
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidatePath("/catalog/sku-prefix");
    return { ok: true, data: { id: String(data) } };
  } catch (err) {
    console.error("upsertSkuPrefix failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "บันทึก prefix ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// สร้าง SKU ใหม่จาก prefix ที่ตั้งไว้ — เรียกจาก dialog "สินค้าใหม่" ใน
// QuoteCalculatorClient. catalog_sku_create เรียก product_upsert เดิมภายใน
// (validation + catalog_audit_log ได้ฟรี) แล้วคืน product_id + sku ที่ได้จริง.
// ============================================================================

export async function createCatalogSku(input: CreateCatalogSkuInput): Promise<ActionResult<{ productId: string; sku: string }>> {
  const prefixId = input.prefixId?.trim();
  if (!prefixId) return { ok: false, error: "กรุณาเลือก prefix" };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อสินค้า" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("catalog_sku_create", {
      p_shop_id: shopId,
      p_prefix_id: prefixId,
      p_name: name,
      p_attrs: {},
    });
    if (error) {
      // 22023 covers both "ไม่มี config" (shouldn't reach here — dialog hides
      // the form in that case, see CreateSkuDialog) and "ชนเกิน 20 รอบ".
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    const row = (Array.isArray(data) ? data[0] : data) as { product_id?: string; sku?: string } | null;
    if (!row?.product_id || !row?.sku) {
      throw new Error("catalog_sku_create returned an unexpected shape");
    }

    revalidatePath("/catalog");
    revalidatePath("/catalog/sku-prefix"); // "เลขล่าสุด" preview shifts once this SKU exists
    return { ok: true, data: { productId: String(row.product_id), sku: String(row.sku) } };
  } catch (err) {
    console.error("createCatalogSku failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "สร้างสินค้าใหม่ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
