// lib/catalog/types.ts — types/const shared by the SKU cost catalog + shop
// pricing settings write layer (lib/actions/catalog.ts) and its client UI.
// Kept OUT of the "use server" actions file (which may only export async fns).
//
// Column shapes copied 1:1 from supabase/migrations/0028_sku_cost_margin.sql
// (public.product, analytics.v_dim_product, analytics.shop_setting,
// analytics.v_blended_margin_suggestion).

export type CostType = "fixed" | "spot";

/** One row of the SKU catalog — v_dim_product (computed effective cost +
 * margin) merged with the editable raw columns from public.product that the
 * view doesn't expose (barcode/supplier/note), so the edit form round-trips
 * every field instead of blanking the ones it can't see. */
export interface ProductRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  costType: CostType;
  /** raw manual cost — the source for costType='fixed'. */
  manualUnitCost: number | null;
  silverWeightG: number | null;
  silverPurity: number | null;
  laborCost: number | null;
  listPrice: number | null;
  /** cost the DB actually uses (fixed => manual; spot => weight×spot×purity+labor). */
  effectiveUnitCost: number | null;
  /** (listPrice − effectiveCost)/listPrice as a fraction 0..1, or null. */
  marginPct: number | null;
  barcode: string | null;
  supplier: string | null;
  note: string | null;
  isActive: boolean;
  /** storage_path (md variant) of the primary image — the product_image row
   * with the lowest (sort_order, created_at, id) for this product, or null
   * if the SKU has no images yet. Raw storage path, NOT a URL — pass through
   * lib/catalog/image-constants.ts's publicImageUrl() to render it (single
   * source of truth for that URL shape, see that function's doc comment). */
  primaryImagePath: string | null;
}

export interface UpsertProductInput {
  sku: string;
  name: string;
  category?: string | null;
  costType: CostType;
  /** used when costType='fixed'. */
  unitCost?: number | null;
  silverWeightG?: number | null;
  silverPurity?: number | null;
  laborCost?: number | null;
  listPrice?: number | null;
  barcode?: string | null;
  supplier?: string | null;
  note?: string | null;
  isActive: boolean;
}

/** analytics.shop_setting + the two ROAS targets the view computes from it. */
export interface ShopSettingData {
  silverSpotThbPerGram: number | null;
  silverSpotUpdatedAt: string | null;
  /** fraction 0..1 (e.g. 0.20 = 20%). */
  blendedMarginPct: number;
  /** fraction 0..1 — max share of gross profit spendable on ads. */
  targetAdGpShare: number;
  /** 1/margin. */
  breakEvenRoas: number;
  /** 1/(margin × adGpShare). */
  targetRoas: number;
}

export interface UpsertShopSettingInput {
  silverSpotThbPerGram?: number | null;
  /** fraction 0..1. */
  blendedMarginPct?: number | null;
  /** fraction 0..1. */
  targetAdGpShare?: number | null;
}

export interface BlendedMarginSuggestion {
  productsWithMargin: number;
  /** fraction 0..1, or null when no active priced product exists. */
  suggestedMarginPct: number | null;
}

// ============================================================================
// Bulk CSV import (0030 product_upsert_bulk). The RPC parses/validates raw
// string values per row, so the client sends rows as {column: string} maps
// (exactly the CSV headers) and gets a per-row result back.
// ============================================================================

/** Canonical CSV columns, in template order. Header matching is
 * case-insensitive + trimmed; unknown columns are ignored. `action`: A =
 * add+edit (upsert), D = delete; blank = upsert (delete must be explicit). */
export const PRODUCT_IMPORT_COLUMNS = [
  "action",
  "sku",
  "name",
  "category",
  "cost_type",
  "unit_cost",
  "silver_weight_g",
  "silver_purity",
  "labor_cost",
  "list_price",
  "barcode",
  "supplier",
  "note",
  "is_active",
] as const;

export type ProductImportRow = Record<string, string>;

export interface ProductImportResultRow {
  rowIndex: number;
  sku: string;
  status: "ok" | "deleted" | "error";
  error: string | null;
}

export interface ProductImportSummary {
  total: number;
  ok: number;
  deleted: number;
  error: number;
  results: ProductImportResultRow[];
}

// ============================================================================
// SKU product images (0104_product_images.sql) — public.product_image, up to
// MAX_IMAGES_PER_SKU rows per product (lib/catalog/image-constants.ts).
// Written/read by lib/actions/catalog-images.ts.
// ============================================================================

export interface ProductImageRow {
  id: string;
  productId: string;
  /** 'md' variant storage path (long edge <= MD_MAX_PX) — raw path, not a
   * URL; pass through publicImageUrl() (image-constants.ts) to render. */
  storagePath: string;
  /** 'sm' variant storage path (long edge <= SM_MAX_PX). */
  variantSmPath: string;
  /** Manual display-order override — the primary image is the row with the
   * lowest (sortOrder, createdAt, id), no separate is_primary flag exists. */
  sortOrder: number;
  /** Server-derived from the uploaded JPEG's own bytes — null if the parse
   * failed (informational metadata only, never a hard requirement). */
  width: number | null;
  height: number | null;
  /** Byte size of the md file as received server-side. */
  bytes: number | null;
  createdAt: string;
}

/** analytics.v_sku_order_alert — a SKU that was ordered while inactive, or has
 * no product master row (unknown). Dormant until fact_order_item has data. */
export interface SkuOrderAlert {
  sku: string;
  productId: string | null;
  reason: "unknown" | "inactive";
  lineCount: number;
  qtySold: number;
  lastOrderDate: string | null;
}

export const COST_TYPE_LABEL_TH: Record<CostType, string> = {
  fixed: "ต้นทุนคงที่",
  spot: "อิงราคาเงิน (spot)",
};

/** Suggested categories (free text still allowed via the datalist). */
export const CATEGORY_OPTIONS = [
  "แหวน",
  "สร้อยคอ",
  "สร้อยข้อมือ",
  "กำไล",
  "จี้",
  "ต่างหู",
  "เงินแท่ง",
  "อื่นๆ",
] as const;

/** Effective unit cost, mirroring v_dim_product's SQL — for the form's live
 * preview only (the DB is always the source of truth on save). Returns null
 * when a spot SKU has no weight or the shop has no silver spot price set yet. */
export function computeEffectiveCost(
  costType: CostType,
  unitCost: number | null,
  silverWeightG: number | null,
  silverPurity: number | null,
  laborCost: number | null,
  silverSpot: number | null
): number | null {
  if (costType === "fixed") return unitCost;
  if (silverWeightG == null || silverSpot == null) return null;
  const raw = silverWeightG * silverSpot * (silverPurity ?? 0.925) + (laborCost ?? 0);
  return Math.round(raw * 100) / 100;
}
