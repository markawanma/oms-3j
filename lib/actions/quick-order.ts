"use server";

// lib/actions/quick-order.ts — "จดออเดอร์เร็วตอน TikTok Live" order-taking.
// Reuses the existing ledgered stock RPCs (supabase/migrations/0003 +
// 0005/0006 hardening) — no new stock-mutation SQL is added here, per
// CLAUDE.md ("ห้ามเขียน stock deduction ใหม่").

import { randomUUID } from "crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getManualTiktokChannelAccountId } from "@/lib/actions/live";
import type {
  ActionResult,
  CreateQuickOrderInput,
  ProductSearchRow,
  QuickOrderResult,
} from "@/lib/types";

const MAX_ITEMS_PER_ORDER = 50;

// Same defense-in-depth as lib/actions/orders.ts sanitizeSearchTerm — strip
// PostgREST .or()/.ilike() filter syntax characters before building a filter
// string from free-text input.
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_]/g, " ").trim().slice(0, 100);
}

export async function searchProductsForLive(term: string): Promise<ActionResult<ProductSearchRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const search = sanitizeSearchTerm(term);

    let query = supabase
      .from("product")
      .select("id, sku, name, central_stock(qty_on_hand, qty_reserved)")
      .eq("shop_id", shopId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(20);

    if (search) {
      query = query.or(`sku.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows: ProductSearchRow[] = (data ?? []).map((r: any) => {
      const stock = Array.isArray(r.central_stock) ? r.central_stock[0] : r.central_stock;
      const onHand = stock?.qty_on_hand ?? 0;
      const reserved = stock?.qty_reserved ?? 0;
      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        available: onHand - reserved,
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    console.error("searchProductsForLive failed", err);
    return { ok: false, error: "ค้นหาสินค้าไม่สำเร็จ" };
  }
}

function buildExternalOrderId(): string {
  const now = new Date();
  const yyyymmdd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return `LIVE-${yyyymmdd}-${suffix}`;
}

function validateInput(input: CreateQuickOrderInput): string | null {
  if (!input.liveSessionId) return "ไม่พบไลฟ์นี้";
  if (!Array.isArray(input.items) || input.items.length === 0) return "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ";
  if (input.items.length > MAX_ITEMS_PER_ORDER) return `เพิ่มสินค้าได้สูงสุด ${MAX_ITEMS_PER_ORDER} รายการต่อออเดอร์`;
  if (input.buyerName != null && typeof input.buyerName !== "string") return "ชื่อผู้ซื้อไม่ถูกต้อง";
  if (typeof input.buyerName === "string" && input.buyerName.length > 200) {
    return "ชื่อผู้ซื้อยาวเกินไป (สูงสุด 200 ตัวอักษร)";
  }
  for (const item of input.items) {
    if (!item.productId) return "พบรายการสินค้าที่ไม่ถูกต้อง";
    if (!Number.isInteger(item.qty) || item.qty <= 0) return "จำนวนสินค้าต้องเป็นจำนวนเต็มมากกว่า 0";
    // Sanity cap — guards against fat-finger during a fast-paced live (e.g.
    // an extra zero typed in a hurry), not a real business limit.
    if (item.qty > 10000) return "จำนวนสินค้าต่อรายการสูงเกินไป (สูงสุด 10,000 ชิ้น)";
    if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return "ราคาต่อชิ้นต้องเป็นตัวเลขไม่ติดลบ";
    }
    if (item.unitPrice > 10_000_000) return "ราคาต่อชิ้นสูงเกินไป (สูงสุด 10,000,000)";
  }
  return null;
}

export async function createQuickOrder(input: CreateQuickOrderInput): Promise<ActionResult<QuickOrderResult>> {
  const validationError = validateInput(input);
  if (validationError) return { ok: false, error: validationError };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Aggregate duplicate productId entries (defense-in-depth mirroring the
    // reserve_stock RPC's own G2 aggregation) — two rows for the same
    // product in one submit must add up, not silently collide downstream.
    const aggregated = new Map<string, { qty: number; unitPrice: number }>();
    for (const item of input.items) {
      const existing = aggregated.get(item.productId);
      if (existing) {
        existing.qty += item.qty;
      } else {
        aggregated.set(item.productId, { qty: item.qty, unitPrice: item.unitPrice });
      }
    }

    const [channelAccountId, session, products] = await Promise.all([
      getManualTiktokChannelAccountId(shopId),
      supabase
        .from("live_session")
        .select("id, status")
        .eq("id", input.liveSessionId)
        .eq("shop_id", shopId)
        .maybeSingle()
        .then((r) => {
          if (r.error) throw r.error;
          return r.data;
        }),
      supabase
        .from("product")
        .select("id, sku")
        .eq("shop_id", shopId)
        .in("id", Array.from(aggregated.keys()))
        .then((r) => {
          if (r.error) throw r.error;
          return r.data ?? [];
        }),
    ]);

    if (!session) return { ok: false, error: "ไม่พบไลฟ์นี้" };
    if (session.status !== "open") return { ok: false, error: "ไลฟ์นี้ปิดไปแล้ว ไม่สามารถจดออเดอร์เพิ่มได้" };

    const productMap = new Map<string, { sku: string }>((products as any[]).map((p) => [p.id, { sku: p.sku }]));
    for (const productId of aggregated.keys()) {
      if (!productMap.has(productId)) {
        return { ok: false, error: "พบสินค้าที่ไม่อยู่ในร้านนี้ กรุณาเลือกสินค้าใหม่" };
      }
    }

    const totalAmount = Array.from(aggregated.values()).reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
    const externalOrderId = buildExternalOrderId();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        channel_account_id: channelAccountId,
        external_order_id: externalOrderId,
        status: "new",
        external_status: "MANUAL_LIVE",
        buyer_name: (input.buyerName ?? "").toString().trim() || null,
        total_amount: totalAmount,
        placed_at: new Date().toISOString(),
        live_session_id: input.liveSessionId,
      })
      .select("id, external_order_id")
      .single();
    if (orderErr) throw orderErr;

    const orderItemRows = Array.from(aggregated.entries()).map(([productId, it]) => ({
      order_id: order.id,
      product_id: productId,
      // external_item_id must be unique per order (uq_order_item_order_external,
      // 0001) — the SKU is a fine, human-readable value here since there is
      // no real marketplace item id for a manually-entered live order.
      external_item_id: productMap.get(productId)!.sku,
      external_sku: productMap.get(productId)!.sku,
      qty: it.qty,
      unit_price: it.unitPrice,
    }));

    const { error: itemsErr } = await supabase.from("order_item").insert(orderItemRows);
    if (itemsErr) {
      // Best-effort rollback — no cross-table transaction over PostgREST
      // (same tradeoff documented in lib/actions/products.ts createProduct).
      await supabase.from("orders").delete().eq("id", order.id);
      throw itemsErr;
    }

    // reserve_stock (0003/0005/0006, unchanged) — the ONLY stock-mutation
    // path used here. A failure (insufficient stock -> P0001, or a transient
    // RPC/network error) puts the order on hold instead of leaving it in an
    // ambiguous "new but nothing reserved" state.
    const { error: rpcErr } = await supabase.rpc("reserve_stock", {
      p_shop_id: shopId,
      p_order_id: order.id,
      p_idem_key: `ui:reserve:${order.id}`,
      p_items: orderItemRows.map((it) => ({ product_id: it.product_id, qty: it.qty })),
    });

    if (rpcErr) {
      const availableQty = await fetchAvailableQty(shopId, Array.from(aggregated.keys()));
      const { error: holdErr } = await supabase
        .from("orders")
        .update({ status: "oversold_hold" })
        .eq("id", order.id)
        .eq("shop_id", shopId)
        .eq("status", "new");
      if (holdErr) {
        // The order + items already exist but stock was NEVER reserved (the
        // reserve_stock call above failed) and we failed to flip it to
        // oversold_hold either — the order is now stuck at "new", which
        // falsely implies stock was reserved. Must not report ok:true here;
        // that would tell the person taking the live order stock is on hold
        // when it silently is not. Log loudly and surface a failure so it
        // gets manually checked instead.
        console.error("createQuickOrder: NEEDS MANUAL REVIEW order", order.id, holdErr);
        return { ok: false, error: "จดออเดอร์แล้วแต่กันสต็อกไม่สำเร็จ กรุณาตรวจออเดอร์นี้ในระบบ" };
      }
      return {
        ok: true,
        data: {
          orderId: order.id,
          externalOrderId: order.external_order_id,
          oversold: true,
          availableQty,
        },
      };
    }

    return {
      ok: true,
      data: {
        orderId: order.id,
        externalOrderId: order.external_order_id,
        oversold: false,
      },
    };
  } catch (err) {
    console.error("createQuickOrder failed", err);
    return { ok: false, error: "จดออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

async function fetchAvailableQty(shopId: string, productIds: string[]): Promise<Record<string, number>> {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("central_stock")
      .select("product_id, qty_on_hand, qty_reserved")
      .eq("shop_id", shopId)
      .in("product_id", productIds);
    if (error) throw error;

    const result: Record<string, number> = {};
    for (const row of data ?? []) {
      result[row.product_id] = row.qty_on_hand - row.qty_reserved;
    }
    return result;
  } catch (err) {
    console.error("fetchAvailableQty failed", err);
    return {};
  }
}
