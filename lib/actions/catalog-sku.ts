"use server";

// lib/actions/catalog-sku.ts — SKU-prefix config + "create new SKU" (Phase
// 1a of docs/3j-jewelry/oem/design-email-sku-phase1.md). Backed by
// analytics.sku_prefix / analytics.sku_counter / product_upsert (via
// catalog_sku_create) — migration 0089, landing in parallel with this file.
//
// Every write here calls requireOwnerAdmin() (same pattern as
// lib/actions/catalog.ts) — getServiceClient() uses the service role, which
// BYPASSES RLS and short-circuits crm_require_owner_admin() inside the RPCs
// (that DB-side check has zero effective layers under this client, it's NOT
// defense-in-depth), so requireOwnerAdmin() below is the ONLY thing gating
// writes in this app today. This matters concretely here: catalog_sku_create
// accepts a p_attrs bag that can write unit_cost/labor_cost straight onto the
// catalog row — the day the UI grows a cost-entry field, an ungated action
// here becomes a live hole, not a theoretical one.
//
// listSkuPrefixes (read-only) is NOT gated, matching getProducts in
// catalog.ts — reads stay open to "พนักงานหน้างาน" (frontline staff), only
// writes are locked down.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { CreateCatalogSkuInput, SkuPrefixRow, SkuWorkType, UpsertSkuPrefixInput } from "@/lib/catalog/sku-prefix";
import { humanizeSkuRpcError, isValidSkuPrefix, SKU_CONTROLLED_ERROR_CODES } from "@/lib/catalog/sku-prefix";

const SCHEMA = "analytics";

// Shared between previewSkuSeed and upsertSkuPrefix — was two slightly
// different strings that could drift apart; this is the fuller one (mentions
// the optional trailing dash, which the DB check constraint also allows).
const PREFIX_FORMAT_ERROR = "prefix ต้องเป็นตัวอักษร A-Z (พิมพ์ใหญ่) 1-5 ตัว ปิดท้ายด้วย - ได้หนึ่งตัว ไม่มีช่องว่าง";

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไข prefix/สินค้าได้" };
  }
  return null;
}

function toInt(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

// sku_prefix_preview_seed (0091) changed from `returns int` to `returns
// table(suggested_seed int, suggested_pad_width int)` — supabase-js now
// hands back an ARRAY of rows, not a bare number. Both callers below
// (previewSkuSeed, listSkuPrefixes's lastNo fan-out) go through this one
// parser so the "array might be null/empty" fallback lives in exactly one
// place. Falls back to 0/0 — same "0 is a valid default" reasoning
// previewSkuSeed already used for the seed half before this migration.
function parsePreviewSeedRow(data: unknown): { suggestedSeed: number; suggestedPadWidth: number } {
  const row = Array.isArray(data)
    ? (data[0] as { suggested_seed?: number | string | null; suggested_pad_width?: number | string | null } | undefined)
    : undefined;
  return {
    suggestedSeed: toInt(row?.suggested_seed ?? null) ?? 0,
    suggestedPadWidth: toInt(row?.suggested_pad_width ?? null) ?? 0,
  };
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
// So "เลขสูงสุดใน catalog" here is populated via sku_prefix_preview_seed
// instead — the highest number actually found on an existing
// public.product.sku for that prefix (same RPC previewSkuSeed calls, already
// granted to service_role, reads public.product not sku_counter). This can
// read HIGHER or LOWER than the true sku_counter.last_no — it's a SKU-table
// scan, not the counter — acceptable for a display-only column;
// catalog_sku_create is the only thing that must be exactly right, and it
// reads sku_counter from inside its own security-definer body, not through
// this action.
//
// `withLastNo` gates that N+1 preview fan-out: /catalog/sku-prefix's table
// shows the column so it passes true; QuoteCalculatorClient's fetch (for
// CreateSkuDialog's prefix picker) never reads lastNo at all, so it passes
// false (the default) and skips N extra RPC round trips on every /oem/quote
// page load.
// ============================================================================

export async function listSkuPrefixes({ withLastNo = false }: { withLastNo?: boolean } = {}): Promise<
  ActionResult<SkuPrefixRow[]>
> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const prefixRes = await supabase
      .schema(SCHEMA)
      .from("sku_prefix")
      .select("id, kind_label, work_type, prefix, pad_width, created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true });
    if (prefixRes.error) throw prefixRes.error;

    const prefixRows = (prefixRes.data ?? []) as {
      id: string;
      kind_label: string;
      work_type: SkuWorkType;
      prefix: string;
      pad_width: number | string | null;
      created_at: string;
    }[];

    // sku_prefix_preview_seed now returns table(suggested_seed, suggested_pad_width)
    // — an array of rows, see parsePreviewSeedRow above. Only suggested_seed is
    // used here (for the "เลขสูงสุดใน catalog" display column); pad_width for
    // the table's own column comes straight off sku_prefix, not this RPC.
    const lastNoResults = withLastNo
      ? await Promise.all(
          prefixRows.map((r) => supabase.schema(SCHEMA).rpc("sku_prefix_preview_seed", { p_shop_id: shopId, p_prefix: r.prefix }))
        )
      : null;

    const rows: SkuPrefixRow[] = prefixRows.map((r, i) => ({
      id: r.id,
      kindLabel: r.kind_label,
      workType: r.work_type,
      prefix: r.prefix,
      lastNo: lastNoResults ? (lastNoResults[i].error ? null : parsePreviewSeedRow(lastNoResults[i].data).suggestedSeed) : null,
      padWidth: toInt(r.pad_width) ?? 0,
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

export async function previewSkuSeed({
  prefix,
}: {
  prefix: string;
}): Promise<ActionResult<{ suggestedSeed: number; suggestedPadWidth: number }>> {
  // Gated even though this only reads: previewSkuSeed exists to feed the
  // seed BEFORE upsertSkuPrefix (also gated below), so a staff user could
  // otherwise see a live preview for a save that will always be rejected —
  // confusing UI, no real access opened up.
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  // 0089: the RPC rejects lowercase/whitespace/Thai OUTRIGHT (no silent
  // trim/uppercase on its side) — matched here rather than "fixing" the
  // input before validating, so this action never accepts something the RPC
  // would reject. The UI (SkuPrefixDialog) already sanitizes on every
  // keystroke via sanitizeSkuPrefixInput, so in practice `prefix` always
  // arrives clean; this is the same belt-and-braces re-validation every
  // other write action in this app does.
  const trimmed = prefix ?? "";
  if (!isValidSkuPrefix(trimmed)) {
    return { ok: false, error: PREFIX_FORMAT_ERROR };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("sku_prefix_preview_seed", {
      p_shop_id: shopId,
      p_prefix: trimmed,
    });
    if (error) throw error;

    return { ok: true, data: parsePreviewSeedRow(data) };
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
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const kindLabel = input.kindLabel?.trim();
  if (!kindLabel) return { ok: false, error: "กรุณากรอกประเภทงาน" };
  if (input.workType !== "plain" && input.workType !== "gem") {
    return { ok: false, error: "กรุณาเลือกลักษณะงาน" };
  }
  const prefix = input.prefix ?? "";
  if (!isValidSkuPrefix(prefix)) {
    return { ok: false, error: PREFIX_FORMAT_ERROR };
  }
  const seedLastNo = toInt(input.seedLastNo);
  // Create (no id): 0 is a valid seed (next SKU will be prefix+1) — only
  // reject null/negative, same as before. Edit (id set): null IS the valid
  // signal for "ไม่แตะตัวนับ" (SkuPrefixDialog's edit mode never shows/sends a
  // seed field at all) — only reject an explicit negative if one somehow
  // arrives, never reject null there.
  if (!input.id) {
    if (seedLastNo === null || seedLastNo < 0) {
      return { ok: false, error: "เลขตั้งต้นต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
    }
  } else if (seedLastNo !== null && seedLastNo < 0) {
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
      p_pad_width: input.padWidth ?? null,
    });
    if (error) {
      // 22023 = controlled Thai validation message from the RPC (e.g.
      // required field missing). 23505 = "prefix/kind_label+work_type ถูกใช้
      // ในร้านนี้แล้ว" (unique_violation, raised since 0091 — QA round 1
      // caught this being silently swallowed into the generic message
      // below). See SKU_CONTROLLED_ERROR_CODES for the full set + why each
      // is safe to show verbatim.
      if (SKU_CONTROLLED_ERROR_CODES.has((error as { code?: string }).code ?? "")) {
        return { ok: false, error: humanizeSkuRpcError(error.message) };
      }
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
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

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
      // the form in that case, see CreateSkuDialog) and "ชนเกิน 20 รอบ". 40001
      // = "ตัวนับ SKU ถูกลบ/แก้พร้อมกันระหว่างออกเลข — ลองใหม่อีกครั้ง"
      // (serialization_failure, new in 0096 — QA round 1 caught this being
      // silently swallowed into the generic message below). See
      // SKU_CONTROLLED_ERROR_CODES for the full set + why each is safe to
      // show verbatim.
      if (SKU_CONTROLLED_ERROR_CODES.has((error as { code?: string }).code ?? "")) {
        return { ok: false, error: humanizeSkuRpcError(error.message) };
      }
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

// ============================================================================
// ลบ prefix — analytics.sku_prefix_delete (Han, คู่ขนาน). ปฏิเสธ (22023, Thai
// message ตรงๆ) ถ้ามี SKU ใช้ prefix นี้แล้ว — ไม่มี soft-delete/disable เหมือน
// product_delete เพราะ prefix ที่ยังไม่เคยออก SKU ไม่มีอะไรให้รักษาไว้
// (ต่างจาก deleteProduct ที่แนะนำ "ปิดการใช้งาน" แทน — ที่นี่ทางออกเดียวคือ
// สร้าง prefix ใหม่ให้ถูกต้อง). เกิดจาก UAT จริง: work_type ล็อกแก้ไม่ได้
// หลังสร้าง แต่เดิมไม่มีทางแก้กับดักตั้งใจผิด prefix ตั้งแต่ตัวแรกเลย.
// ============================================================================

export async function deleteSkuPrefix({ id }: { id: string }): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const clean = id?.trim();
  if (!clean) return { ok: false, error: "ไม่พบ prefix ที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("sku_prefix_delete", {
      p_shop_id: shopId,
      p_id: clean,
    });
    if (error) {
      // 22023 = controlled Thai message from the RPC (e.g. "มี N SKU ใช้ prefix
      // นี้แล้ว ลบไม่ได้") — same convention as upsertSkuPrefix above.
      // sku_prefix_delete doesn't raise 23505/40001 today, but this action
      // checks the full SKU_CONTROLLED_ERROR_CODES set anyway for
      // consistency with the other two RPCs on this same domain (QA round
      // 1 asked for this explicitly) — harmless if unused, and future-proof
      // if the RPC ever grows a unique-violation path.
      if (SKU_CONTROLLED_ERROR_CODES.has((error as { code?: string }).code ?? "")) {
        return { ok: false, error: humanizeSkuRpcError(error.message) };
      }
      throw error;
    }

    revalidatePath("/catalog/sku-prefix");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("deleteSkuPrefix failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "ลบ prefix ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
