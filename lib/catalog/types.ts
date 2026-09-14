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
  /** SIGNED URL (1hr TTL, lib/catalog/image-signing.ts) for the md variant of
   * the primary image — the product_image row with the lowest (sort_order,
   * created_at, id) for this product — or null if the SKU has no images yet
   * OR signing failed (never a hard error, see getProducts()). Render this
   * directly as `<img src>`; there is nothing left to construct client-side
   * — the bucket is PRIVATE (supabase/migrations/
   * 0105_product_images_private.sql), a raw storage path is not fetchable. */
  primaryImageUrl: string | null;
  /** Same image as primaryImageUrl, sm variant (480px cap), also a signed
   * URL. Use THIS for the catalog table's 40x40 thumbnail: at 303 rows,
   * serving md there downloads ~303 full-size pictures to paint 40px boxes.
   * md stays the right choice wherever the picture is actually looked at
   * (quote print, email, line sheet). */
  primaryImageSmUrl: string | null;
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
  /** SIGNED URL (1hr TTL, lib/catalog/image-signing.ts) for the 'md' variant
   * (long edge <= MD_MAX_PX) — render directly, e.g. `<img src={mdUrl}>`.
   * null only when signing failed server-side (never a hard error — see
   * getProductImages()); the bucket is PRIVATE (supabase/migrations/
   * 0105_product_images_private.sql) so a raw storage path is not
   * fetchable on its own anymore. */
  mdUrl: string | null;
  /** Same image as mdUrl, 'sm' variant (long edge <= SM_MAX_PX). */
  smUrl: string | null;
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
/** Suggested categories (free text still allowed via the datalist).
 *
 * 🔴 หมวดไม่ใช่แค่ป้ายจัดกลุ่ม — มันตัดสินว่าสินค้าไปอยู่แท่งไหนใน "สัดส่วน
 * ตามสินค้า" บนแดชบอร์ด ตรรกะอยู่ใน analytics.dashboard_charts (0054):
 *     'เงินแท่ง'                                   -> silver_bar
 *     'Art Toy เงิน'                               -> art_toy
 *     'ทองจีน' | 'น้ำยาล้างเงิน' | 'กล่อง/บรรจุภัณฑ์'  -> other
 *     null                                         -> other
 *     ทุกอย่างที่เหลือ                                -> jewelry (เครื่องเงิน 925)
 * ⇒ กล่อง/น้ำยา/ทองจีน ที่สะกดไม่ตรงสตริงพวกนี้ จะถูกนับเป็นเครื่องเงิน 925
 *   ทำให้กราฟสัดส่วนสินค้าเพี้ยน สะกดต้องตรงเป๊ะ
 *
 * รายการนี้อัปเดต 10 ก.ย. 69 ให้ตรงกับหมวดที่ใช้จริงในฐานข้อมูล (21 หมวด,
 * 303 SKU) — ของเดิมมีแค่ 8 หมวดและ **ไม่มีสักตัวที่ตรงกับ 4 สตริงพิเศษ
 * ข้างบนเลย** นอกจาก 'เงินแท่ง' คนกรอกจึงไม่มีทางเลือกให้ถูกจาก dropdown
 * ต้องเดาพิมพ์เอง (เจ้าของเจอเองตอนเพิ่ม SKU กล่อง BoxRR)
 *
 * เรียงตามกลุ่มเพื่อให้หาเจอเร็ว ไม่ได้เรียงตามความถี่ — ตัวที่ใช้บ่อยสุด
 * (สร้อยคอ 184 SKU) อยู่บนสุดของกลุ่มแรกอยู่แล้ว */
export const CATEGORY_OPTIONS = [
  // — เครื่องประดับ (นับเป็น jewelry / เครื่องเงิน 925) —
  "สร้อยคอ",
  "สร้อยข้อมือ/กำไล",
  "สร้อยข้อมือ",
  "สร้อยข้อเท้า",
  "แหวน",
  "ต่างหู",
  "จี้",
  "จี้อักษรมงคล",
  "จี้ปี่เซียะ",
  "เครื่องรางมงคล",
  // — ขายตามน้ำหนัก (ยังนับเป็น jewelry) —
  "Live (ตามกรัม)",
  "จี้/โซ่ (ตามกรัม)",
  // — ไม่ใช่เครื่องเงิน 925: แยกแท่งของตัวเองบนแดชบอร์ด —
  "เงินแท่ง",
  "Art Toy เงิน",
  // — ของใช้/บรรจุภัณฑ์: ตกแท่ง "อื่นๆ" ห้ามให้ปนกับเครื่องเงิน —
  "กล่อง/บรรจุภัณฑ์",
  "น้ำยาล้างเงิน",
  "ทองจีน",
  "น้ำหอม",
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
