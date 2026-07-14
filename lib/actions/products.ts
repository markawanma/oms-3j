"use server";

// lib/actions/products.ts — server action for the "เพิ่มสินค้า" (manual add
// product) screen.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";

export interface CreateProductInput {
  sku: string;
  name: string;
  initialStock: number;
}

export async function createProduct(input: CreateProductInput): Promise<ActionResult<{ productId: string }>> {
  const sku = input.sku.trim();
  const name = input.name.trim();

  if (!sku) return { ok: false, error: "กรุณากรอก SKU" };
  if (!name) return { ok: false, error: "กรุณากรอกชื่อสินค้า" };
  if (!Number.isInteger(input.initialStock) || input.initialStock < 0) {
    return { ok: false, error: "สต็อกเริ่มต้นต้องเป็นจำนวนเต็มไม่ติดลบ" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: product, error: productErr } = await supabase
      .from("product")
      .insert({ shop_id: shopId, sku, name })
      .select("id")
      .single();

    if (productErr) {
      if ((productErr as any).code === "23505") {
        return { ok: false, error: `SKU "${sku}" มีอยู่แล้วในร้านนี้` };
      }
      throw productErr;
    }

    // central_stock.shop_id is derived by a BEFORE INSERT trigger
    // (sync_central_stock_shop_id, 0001) from product_id — not set directly.
    const { error: stockErr } = await supabase
      .from("central_stock")
      .insert({ product_id: product.id, qty_on_hand: input.initialStock, qty_reserved: 0 });

    if (stockErr) {
      // Best-effort rollback: the product row would otherwise exist with no
      // stock row, which the Central Stock screen can't render. Not a full
      // transaction (no cross-table transaction support over PostgREST), but
      // failing loudly + cleaning up beats a silently orphaned product.
      await supabase.from("product").delete().eq("id", product.id);
      throw stockErr;
    }

    return { ok: true, data: { productId: product.id } };
  } catch (err) {
    console.error("createProduct failed", err);
    return { ok: false, error: "เพิ่มสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
