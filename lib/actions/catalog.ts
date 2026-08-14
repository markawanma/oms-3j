"use server";

// lib/actions/catalog.ts — Phase C1 SKU cost catalog + shop pricing/margin
// settings (docs/3j-jewelry/analytics/phase-c1-sku-cost-margin.md), backed by
// supabase/migrations/0028_sku_cost_margin.sql.
//
// Same auth model as lib/actions/marketing.ts / crm.ts: getServiceClient()
// uses the service role, which BYPASSES RLS and short-circuits
// crm_require_owner_admin() inside the RPCs — so requireOwnerAdmin() below is
// the ONLY thing gating writes in this app today. Every write action calls it
// first.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type {
  BlendedMarginSuggestion,
  CostType,
  ProductImportRow,
  ProductImportResultRow,
  ProductImportSummary,
  ProductRow,
  ShopSettingData,
  SkuOrderAlert,
  UpsertProductInput,
  UpsertShopSettingInput,
} from "@/lib/catalog/types";

const SCHEMA = "analytics";

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไขสินค้า/ต้นทุนได้" };
  }
  return null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// /catalog — read SKU list. v_dim_product carries the computed effective cost
// + margin; barcode/supplier/note come from public.product (the view doesn't
// expose them) so the edit form can round-trip every field.
// ============================================================================

export async function getProducts(): Promise<ActionResult<ProductRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [dimRes, rawRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_dim_product")
        .select(
          "product_id, sku, name, category, cost_type, manual_unit_cost, silver_weight_g, silver_purity, labor_cost, list_price, effective_unit_cost, margin_pct, is_active"
        )
        .eq("shop_id", shopId),
      // public.product is the DEFAULT schema (no .schema()) — raw editable cols
      supabase.from("product").select("id, barcode, supplier, note").eq("shop_id", shopId),
    ]);
    if (dimRes.error) throw dimRes.error;
    if (rawRes.error) throw rawRes.error;

    const rawMap = new Map<string, { barcode: string | null; supplier: string | null; note: string | null }>();
    for (const r of (rawRes.data ?? []) as { id: string; barcode: string | null; supplier: string | null; note: string | null }[]) {
      rawMap.set(r.id, { barcode: r.barcode, supplier: r.supplier, note: r.note });
    }

    const rows: ProductRow[] = (
      (dimRes.data ?? []) as {
        product_id: string;
        sku: string;
        name: string;
        category: string | null;
        cost_type: CostType;
        manual_unit_cost: number | null;
        silver_weight_g: number | null;
        silver_purity: number | null;
        labor_cost: number | null;
        list_price: number | null;
        effective_unit_cost: number | null;
        margin_pct: number | null;
        is_active: boolean;
      }[]
    ).map((r) => {
      const raw = rawMap.get(r.product_id);
      return {
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        costType: r.cost_type,
        manualUnitCost: r.manual_unit_cost === null ? null : Number(r.manual_unit_cost),
        silverWeightG: r.silver_weight_g === null ? null : Number(r.silver_weight_g),
        silverPurity: r.silver_purity === null ? null : Number(r.silver_purity),
        laborCost: r.labor_cost === null ? null : Number(r.labor_cost),
        listPrice: r.list_price === null ? null : Number(r.list_price),
        effectiveUnitCost: r.effective_unit_cost === null ? null : Number(r.effective_unit_cost),
        marginPct: r.margin_pct === null ? null : Number(r.margin_pct),
        barcode: raw?.barcode ?? null,
        supplier: raw?.supplier ?? null,
        note: raw?.note ?? null,
        isActive: Boolean(r.is_active),
      };
    });

    // active first, then by SKU
    rows.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sku.localeCompare(b.sku));
    return { ok: true, data: rows };
  } catch (err) {
    console.error("getProducts failed", err);
    return { ok: false, error: "โหลดรายการสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /catalog — write via analytics.product_upsert RPC (0028 §7).
// ============================================================================

export async function upsertProduct(input: UpsertProductInput): Promise<ActionResult<{ productId: string }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const sku = input.sku?.trim();
  const name = input.name?.trim();
  if (!sku) return { ok: false, error: "กรุณากรอก SKU" };
  if (!name) return { ok: false, error: "กรุณากรอกชื่อสินค้า" };
  if (input.costType !== "fixed" && input.costType !== "spot") {
    return { ok: false, error: "โหมดต้นทุนไม่ถูกต้อง" };
  }

  const unitCost = toNum(input.unitCost);
  const weight = toNum(input.silverWeightG);
  const purity = toNum(input.silverPurity);
  const labor = toNum(input.laborCost);
  const listPrice = toNum(input.listPrice);

  if (input.costType === "spot" && (weight == null || weight <= 0)) {
    return { ok: false, error: "โหมดอิงราคาเงินต้องกรอกน้ำหนักเงิน (กรัม) มากกว่า 0" };
  }
  if (input.costType === "fixed" && unitCost != null && unitCost < 0) {
    return { ok: false, error: "ต้นทุนต้องเป็นค่าตั้งแต่ 0 ขึ้นไป" };
  }
  if (purity != null && (purity <= 0 || purity > 1)) {
    return { ok: false, error: "ความบริสุทธิ์ต้องอยู่ระหว่าง 0–1 (เช่น 0.925 หรือ 0.999)" };
  }
  if (listPrice != null && listPrice < 0) {
    return { ok: false, error: "ราคาตั้งต้องเป็นค่าตั้งแต่ 0 ขึ้นไป" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("product_upsert", {
      p_shop_id: shopId,
      p_sku: sku,
      p_name: name,
      p_category: input.category?.trim() || null,
      p_cost_type: input.costType,
      p_unit_cost: input.costType === "fixed" ? unitCost : null,
      p_silver_weight_g: weight,
      p_silver_purity: purity,
      p_labor_cost: labor,
      p_list_price: listPrice,
      p_barcode: input.barcode?.trim() || null,
      p_supplier: input.supplier?.trim() || null,
      p_note: input.note?.trim() || null,
      p_is_active: input.isActive,
    });
    if (error) throw error;

    revalidatePath("/catalog");
    revalidatePath("/settings"); // blended-margin suggestion depends on products
    return { ok: true, data: { productId: String(data) } };
  } catch (err) {
    console.error("upsertProduct failed", err);
    return { ok: false, error: "บันทึกสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /catalog — bulk CSV import via analytics.product_upsert_bulk (0030). The RPC
// validates each row and skips bad ones (partial success), returning per-row
// status so the UI can show exactly which rows failed and why.
// ============================================================================

const IMPORT_MAX_ROWS = 2000;

export async function importProducts(
  rows: ProductImportRow[]
): Promise<ActionResult<ProductImportSummary>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "ไม่พบข้อมูลในไฟล์ — ตรวจว่าไฟล์มีอย่างน้อย 1 แถว (ไม่นับหัวคอลัมน์)" };
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `นำเข้าได้ครั้งละไม่เกิน ${IMPORT_MAX_ROWS} แถว (ไฟล์นี้มี ${rows.length}) — แบ่งไฟล์ก่อน` };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("product_upsert_bulk", {
      p_shop_id: shopId,
      p_rows: rows,
    });
    if (error) throw error;

    const results: ProductImportResultRow[] = (
      (data ?? []) as { row_index: number; sku: string; status: string; error: string | null }[]
    ).map((r) => ({
      rowIndex: Number(r.row_index) || 0,
      sku: r.sku ?? "",
      status: r.status === "ok" ? "ok" : r.status === "deleted" ? "deleted" : "error",
      error: r.error,
    }));

    const okCount = results.filter((r) => r.status === "ok").length;
    const deletedCount = results.filter((r) => r.status === "deleted").length;

    revalidatePath("/catalog");
    revalidatePath("/settings"); // blended-margin suggestion depends on products

    return {
      ok: true,
      data: {
        total: results.length,
        ok: okCount,
        deleted: deletedCount,
        error: results.length - okCount - deletedCount,
        results,
      },
    };
  } catch (err) {
    console.error("importProducts failed", err);
    return { ok: false, error: "นำเข้าไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /catalog — delete one SKU (analytics.product_delete, 0031). Hard delete only
// when the SKU has no order/stock references; the RPC raises a Thai P0001
// message otherwise, which we surface verbatim (owner-facing, safe).
// ============================================================================

export async function deleteProduct(sku: string): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const clean = sku?.trim();
  if (!clean) return { ok: false, error: "ไม่พบ SKU ที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("product_delete", {
      p_shop_id: shopId,
      p_sku: clean,
    });
    if (error) {
      // P0001 = "has order/stock links, disable instead"; P0002 = not found.
      // Both are our own controlled Thai messages — safe to show the owner.
      const code = (error as { code?: string }).code;
      if (code === "P0001" || code === "P0002") {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    revalidatePath("/catalog");
    revalidatePath("/settings");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("deleteProduct failed", err);
    return { ok: false, error: "ลบสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /catalog — dormant "SKU ordered while inactive/unknown" alert
// (analytics.v_sku_order_alert, 0031). Empty until fact_order_item has data.
// ============================================================================

export async function getSkuOrderAlerts(): Promise<ActionResult<SkuOrderAlert[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_sku_order_alert")
      .select("sku, product_id, reason, line_count, qty_sold, last_order_date")
      .eq("shop_id", shopId)
      .order("line_count", { ascending: false });
    if (error) throw error;

    const rows: SkuOrderAlert[] = (
      (data ?? []) as {
        sku: string;
        product_id: string | null;
        reason: string;
        line_count: number;
        qty_sold: number;
        last_order_date: string | null;
      }[]
    ).map((r) => ({
      sku: r.sku,
      productId: r.product_id,
      reason: r.reason === "unknown" ? "unknown" : "inactive",
      lineCount: Number(r.line_count) || 0,
      qtySold: Number(r.qty_sold) || 0,
      lastOrderDate: r.last_order_date,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getSkuOrderAlerts failed", err);
    return { ok: false, error: "โหลดการแจ้งเตือน SKU ไม่สำเร็จ" };
  }
}

// ============================================================================
// /settings — shop pricing/margin. Read shop_setting + the margin suggestion.
// ============================================================================

export async function getShopSetting(): Promise<ActionResult<ShopSettingData>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("shop_setting")
      .select("silver_spot_thb_per_gram, silver_spot_updated_at, blended_margin_pct, target_ad_gp_share")
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) throw error;

    // 0028 seeds a row per shop, but default sensibly if somehow missing.
    const margin = data ? Number(data.blended_margin_pct) : 0.2;
    const adShare = data ? Number(data.target_ad_gp_share) : 0.5;

    const result: ShopSettingData = {
      silverSpotThbPerGram:
        data?.silver_spot_thb_per_gram == null ? null : Number(data.silver_spot_thb_per_gram),
      silverSpotUpdatedAt: data?.silver_spot_updated_at ?? null,
      blendedMarginPct: margin,
      targetAdGpShare: adShare,
      breakEvenRoas: Math.round((1 / margin) * 100) / 100,
      targetRoas: Math.round((1 / (margin * adShare)) * 100) / 100,
    };
    return { ok: true, data: result };
  } catch (err) {
    console.error("getShopSetting failed", err);
    return { ok: false, error: "โหลดการตั้งค่าราคา/มาร์จิ้นไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getBlendedMarginSuggestion(): Promise<ActionResult<BlendedMarginSuggestion>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_blended_margin_suggestion")
      .select("products_with_margin, suggested_margin_pct")
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) throw error;

    return {
      ok: true,
      data: {
        productsWithMargin: data ? Number(data.products_with_margin) : 0,
        suggestedMarginPct:
          data?.suggested_margin_pct == null ? null : Number(data.suggested_margin_pct),
      },
    };
  } catch (err) {
    console.error("getBlendedMarginSuggestion failed", err);
    return { ok: false, error: "คำนวณมาร์จิ้นแนะนำไม่สำเร็จ" };
  }
}

export async function upsertShopSetting(input: UpsertShopSettingInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const spot = toNum(input.silverSpotThbPerGram);
  const margin = toNum(input.blendedMarginPct);
  const adShare = toNum(input.targetAdGpShare);

  if (spot != null && spot < 0) return { ok: false, error: "ราคาเงินสปอตต้องเป็นค่าตั้งแต่ 0 ขึ้นไป" };
  if (margin != null && (margin <= 0 || margin >= 1)) {
    return { ok: false, error: "มาร์จิ้นเฉลี่ยต้องอยู่ระหว่าง 0–100% (ไม่รวมขอบ)" };
  }
  if (adShare != null && (adShare <= 0 || adShare > 1)) {
    return { ok: false, error: "สัดส่วนแอด/กำไรต้องอยู่ระหว่าง 0–100%" };
  }
  if (spot == null && margin == null && adShare == null) {
    return { ok: false, error: "ไม่มีค่าที่จะบันทึก" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("shop_setting_upsert", {
      p_shop_id: shopId,
      p_silver_spot_thb_per_gram: spot,
      p_blended_margin_pct: margin,
      p_target_ad_gp_share: adShare,
    });
    if (error) throw error;

    // margin/spot changes ripple into profit, ROAS and the whole reco feed.
    revalidatePath("/settings");
    revalidatePath("/catalog");
    revalidatePath("/marketing/ad-spend");
    revalidatePath("/marketing/copilot");
    revalidatePath("/crm/overview");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("upsertShopSetting failed", err);
    return { ok: false, error: "บันทึกการตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
