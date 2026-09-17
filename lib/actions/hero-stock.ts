"use server";

// lib/actions/hero-stock.ts — /stock/hero Hero-SKU live stock counter
// (docs ops-plan-99 §1, supabase/migrations/0037_hero_stock_watch.sql).
//
// Same auth model as lib/actions/catalog.ts: getServiceClient() uses the
// service role, which BYPASSES RLS and short-circuits
// crm_require_owner_admin() inside the RPCs — so requireOwnerAdmin() below is
// the ONLY thing gating writes (and this read) in this app today.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import { requireWriteAccess } from "@/lib/auth/action-guard";
import type { ActionResult } from "@/lib/types";
import type { HeroStockRow } from "@/lib/stock/types";
import type { ProductPickerOption } from "@/lib/catalog/types";

const SCHEMA = "analytics";
const PAGE_PATH = "/stock/hero";

async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูจอสต็อก Hero SKU ได้" };
  }
  return null;
}

// Security review 2026-09-16 (H4): addHeroWatch/removeHeroWatch are real
// mutations, and /stock/hero is exempt from middleware.ts's AUTH_GATE
// (public wall-display screen — no browser session check runs for that
// route at all). requireOwnerAdmin() alone is just a TypeScript `if` on
// DEV_ROLE, not a real session check — requireWriteAccess(requireOwnerAdmin)
// below (lib/auth/action-guard.ts) adds requireSessionIfGateOn() first.

// Security review 2026-09-17 (H1): getHeroStock/getProductPickerOptions are
// deliberately NOT gated by requireOwnerAdmin — /stock/hero is a public,
// unauthenticated wall-display screen by design (no login at all, see the
// AUTH_GATE-exempt note above), and getEffectiveRole() now returns 'staff'
// for every unauthenticated request once AUTH_GATE=on. Gating these two
// reads would make the live-stock screen show "จำกัดสิทธิ์" for its only
// real audience. Confirmed safe to leave open: both selects are sku/name/
// is_active/qty columns only (analytics.v_hero_stock, public.product) — no
// cost, price, or PII anywhere in either query. Mutations stay fully gated
// below via requireWriteAccess(requireOwnerAdmin).

// ============================================================================
// read — analytics.v_hero_stock, ordered worst-first (out > low > available
// asc) so the SKU closest to selling out is always the first card the host
// sees while scrolling on a phone during a live.
// ============================================================================

export async function getHeroStock(): Promise<ActionResult<HeroStockRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_hero_stock")
      .select(
        "product_id, sku, name, is_active, qty_on_hand, qty_reserved, available, low_stock_threshold, is_out, is_low, note, stock_updated_at, added_at"
      )
      .eq("shop_id", shopId)
      .order("is_out", { ascending: false })
      .order("is_low", { ascending: false })
      .order("available", { ascending: true });
    if (error) throw error;

    const rows: HeroStockRow[] = (
      (data ?? []) as {
        product_id: string;
        sku: string;
        name: string;
        is_active: boolean;
        qty_on_hand: number;
        qty_reserved: number;
        available: number;
        low_stock_threshold: number;
        is_out: boolean;
        is_low: boolean;
        note: string | null;
        stock_updated_at: string | null;
        added_at: string;
      }[]
    ).map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      isActive: Boolean(r.is_active),
      qtyOnHand: Number(r.qty_on_hand) || 0,
      qtyReserved: Number(r.qty_reserved) || 0,
      available: Number(r.available) || 0,
      lowStockThreshold: Number(r.low_stock_threshold) || 0,
      isOut: Boolean(r.is_out),
      isLow: Boolean(r.is_low),
      note: r.note,
      stockUpdatedAt: r.stock_updated_at,
      addedAt: r.added_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getHeroStock failed", err);
    return { ok: false, error: "โหลดข้อมูลจอสต็อก Hero SKU ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// read — SKU picker for the "add hero watch" form. Deliberately separate
// from lib/actions/catalog.ts's getProducts(): that file is a single "use
// server" module that also exports upsertProduct/deleteProduct/
// importProducts/upsertShopSetting, and /stock/hero is exempt from the
// AUTH_GATE middleware (public wall-display screen — see middleware.ts's
// exempt-route comment). Importing catalog.ts from the hero page would pull
// those write actions (and their cost/margin data) into the client bundle
// for an unauthenticated route (security review 2026-09-16, C1). Selects
// straight from public.product — sku/name/is_active only, no cost/price
// columns at all, so there is nothing money-sensitive to leak even before
// considering who can reach it.
// ============================================================================

export async function getProductPickerOptions(): Promise<ActionResult<ProductPickerOption[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("product")
      .select("id, sku, name, is_active")
      .eq("shop_id", shopId)
      .order("sku", { ascending: true });
    if (error) throw error;

    const rows: ProductPickerOption[] = (
      (data ?? []) as { id: string; sku: string; name: string; is_active: boolean }[]
    ).map((r) => ({
      productId: r.id,
      sku: r.sku,
      name: r.name,
      isActive: Boolean(r.is_active),
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getProductPickerOptions failed", err);
    return { ok: false, error: "โหลดรายการสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// write — analytics.hero_watch_add / hero_watch_remove (0037 §3). add is an
// upsert (same product re-added = update threshold/note), matching the RPC's
// ON CONFLICT DO UPDATE.
// ============================================================================

export async function addHeroWatch(
  productId: string,
  lowStockThreshold: number,
  note?: string | null
): Promise<ActionResult> {
  const gateErr = await requireWriteAccess(requireOwnerAdmin);
  if (gateErr) return gateErr;

  const cleanProductId = productId?.trim();
  if (!cleanProductId) return { ok: false, error: "กรุณาเลือกสินค้า" };
  if (
    lowStockThreshold == null ||
    !Number.isFinite(lowStockThreshold) ||
    !Number.isInteger(lowStockThreshold) ||
    lowStockThreshold < 0
  ) {
    return { ok: false, error: "เกณฑ์เตือนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("hero_watch_add", {
      p_shop_id: shopId,
      p_product_id: cleanProductId,
      p_low_stock_threshold: lowStockThreshold,
      p_note: note?.trim() || null,
    });
    if (error) {
      // P0002 = IDOR guard "product not found in shop" — our own controlled
      // Thai-safe message from the RPC, surface a clean fallback instead.
      const code = (error as { code?: string }).code;
      if (code === "P0002") {
        return { ok: false, error: "ไม่พบสินค้านี้ในร้าน — เลือกสินค้าใหม่อีกครั้ง" };
      }
      throw error;
    }

    revalidatePath(PAGE_PATH);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("addHeroWatch failed", err);
    return { ok: false, error: "เพิ่ม SKU เฝ้าดูไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function removeHeroWatch(productId: string): Promise<ActionResult> {
  const gateErr = await requireWriteAccess(requireOwnerAdmin);
  if (gateErr) return gateErr;

  const cleanProductId = productId?.trim();
  if (!cleanProductId) return { ok: false, error: "ไม่พบสินค้าที่จะเลิกเฝ้าดู" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("hero_watch_remove", {
      p_shop_id: shopId,
      p_product_id: cleanProductId,
    });
    if (error) throw error;

    revalidatePath(PAGE_PATH);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("removeHeroWatch failed", err);
    return { ok: false, error: "เลิกเฝ้าดู SKU ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
