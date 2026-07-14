"use server";

// lib/actions/stock.ts — server actions for the Central Stock screen.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import type { ActionResult, StockRow } from "@/lib/types";

export async function listStock(search: string): Promise<ActionResult<StockRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    let query = supabase
      .from("central_stock")
      .select("product_id, qty_on_hand, qty_reserved, product:product_id(sku, name)")
      .eq("shop_id", shopId)
      .order("updated_at", { ascending: false });

    const term = search.replace(/[,()%_]/g, " ").trim().slice(0, 100);
    if (term) {
      // Filter client-side after fetch is not viable for large catalogs, but
      // PostgREST can't ilike a joined table's column directly without
      // !inner — use !inner here since we only need matching rows.
      query = supabase
        .from("central_stock")
        .select("product_id, qty_on_hand, qty_reserved, product:product_id!inner(sku, name)")
        .eq("shop_id", shopId)
        .or(`sku.ilike.%${term}%,name.ilike.%${term}%`, { referencedTable: "product" })
        .order("updated_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows: StockRow[] = (data ?? []).map((r: any) => ({
      productId: r.product_id,
      sku: r.product?.sku ?? "-",
      name: r.product?.name ?? "-",
      qtyOnHand: r.qty_on_hand,
      qtyReserved: r.qty_reserved,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("listStock failed", err);
    return { ok: false, error: "โหลดข้อมูลสต็อกไม่สำเร็จ" };
  }
}

/**
 * Adjusts on_hand stock via the ledgered adjust_stock RPC (reserved is
 * read-only from the UI per ux-ui design — AdjustStockSheet only edits
 * on_hand). `newOnHand` is what the user typed (a physical recount value);
 * the delta sent to the RPC is derived from the current DB value at call
 * time to avoid a stale-read race with whatever the sheet loaded earlier.
 */
export async function adjustStock(productId: string, newOnHand: number): Promise<ActionResult<StockRow>> {
  if (!Number.isInteger(newOnHand) || newOnHand < 0) {
    return { ok: false, error: "จำนวนสต็อกต้องเป็นจำนวนเต็มไม่ติดลบ" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: current, error: currentErr } = await supabase
      .from("central_stock")
      .select("qty_on_hand, qty_reserved, product:product_id(sku, name)")
      .eq("shop_id", shopId)
      .eq("product_id", productId)
      .maybeSingle();
    if (currentErr) throw currentErr;
    if (!current) return { ok: false, error: "ไม่พบสินค้านี้ในสต็อก" };

    const delta = newOnHand - current.qty_on_hand;
    if (delta === 0) {
      return {
        ok: true,
        data: {
          productId,
          sku: (current as any).product?.sku ?? "-",
          name: (current as any).product?.name ?? "-",
          qtyOnHand: current.qty_on_hand,
          qtyReserved: current.qty_reserved,
        },
      };
    }

    const { data: rpcData, error: rpcErr } = await supabase
      .rpc("adjust_stock", {
        p_shop_id: shopId,
        p_product_id: productId,
        p_qty_delta: delta,
        p_idem_key: `ui:adjust:${productId}:${Date.now()}`,
      })
      .maybeSingle();
    if (rpcErr) throw rpcErr;
    if (!rpcData) throw new Error("adjust_stock returned no row");

    return {
      ok: true,
      data: {
        productId,
        sku: (current as any).product?.sku ?? "-",
        name: (current as any).product?.name ?? "-",
        qtyOnHand: (rpcData as any).qty_on_hand,
        qtyReserved: (rpcData as any).qty_reserved,
      },
    };
  } catch (err) {
    console.error("adjustStock failed", err);
    return { ok: false, error: "ปรับสต็อกไม่สำเร็จ (ค่าที่ตั้งอาจทำให้ on_hand ต่ำกว่าจำนวนที่จองไว้)" };
  }
}
