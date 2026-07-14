"use server";

// lib/actions/orders.ts — server actions for the Unified Order Dashboard +
// Order Detail screens. All reads/writes go through the service-role client
// with an explicit `shop_id = getDevShopId()` filter (see
// lib/supabase/server.ts header for why — no auth in this batch).

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import {
  STATUS_PRIORITY,
  type ActionResult,
  type ChannelCode,
  type OrderDetail,
  type OrderItemRow,
  type OrderListRow,
  type OrderStatus,
  type PrioritySummary,
} from "@/lib/types";

const PAGE_SIZE = 20;

export interface ListOrdersParams {
  channel: ChannelCode | "all";
  status: OrderStatus | "all";
  search: string;
  /** opaque cursor returned by a previous call, or null for the first page */
  cursor: string | null;
}

export interface ListOrdersResult {
  rows: OrderListRow[];
  nextCursor: string | null;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf-8");
    const [createdAt, id] = raw.split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// PostgREST's .or()/.ilike() filter strings use `,`, `(`, `)`, `%`, `_` as
// syntax — strip them from free-text search input so a buyer name/order id
// containing one of these characters can't break or hijack the filter
// expression (defense-in-depth; worst case is a slightly less precise match,
// never a malformed/injected filter).
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_]/g, " ").trim().slice(0, 100);
}

/**
 * KNOWN LIMITATION (documented, not silently swallowed): priority sort
 * (oversold_hold first, per ux-ui design) is applied client-side to each
 * *fetched page* only — keyset pagination itself still walks rows in
 * (created_at desc, id desc) order. At MVP scale (hundreds/low-thousands of
 * orders per shop) every priority order surfaces near the top of page 1
 * anyway since oversold/new orders are recent by nature, but a true global
 * priority ordering across all pages would need either a DB view with a
 * computed priority column or an ORDER BY CASE expressed via a Postgres
 * function — left as follow-up, flagged in the handoff report.
 */
function sortByPriority(rows: OrderListRow[]): OrderListRow[] {
  return [...rows].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status];
    const pb = STATUS_PRIORITY[b.status];
    if (pa !== pb) return pa - pb;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function listOrders(params: ListOrdersParams): Promise<ActionResult<ListOrdersResult>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    let channelAccountIds: string[] | null = null;
    if (params.channel !== "all") {
      const { data: accounts, error: accountsErr } = await supabase
        .from("channel_account")
        .select("id, channel:channel_id(code)")
        .eq("shop_id", shopId);
      if (accountsErr) throw accountsErr;
      channelAccountIds = (accounts ?? [])
        .filter((a: any) => a.channel?.code === params.channel)
        .map((a: any) => a.id as string);
      if (channelAccountIds.length === 0) {
        // No channel_account of this channel exists for the shop at all —
        // valid empty result, not an error.
        return { ok: true, data: { rows: [], nextCursor: null } };
      }
    }

    // Small reference join used to label each row with its channel — fetched
    // once per request rather than relying on fragile nested-join filtering
    // across two hops (order -> channel_account -> channel).
    const { data: allAccounts, error: allAccountsErr } = await supabase
      .from("channel_account")
      .select("id, channel:channel_id(code, name)")
      .eq("shop_id", shopId);
    if (allAccountsErr) throw allAccountsErr;
    const accountMap = new Map<string, { code: ChannelCode; name: string }>(
      (allAccounts ?? []).map((a: any) => [a.id as string, { code: a.channel?.code, name: a.channel?.name }])
    );

    let query = supabase
      .from("orders")
      .select("id, external_order_id, status, buyer_name, total_amount, currency, placed_at, created_at, channel_account_id")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (channelAccountIds) {
      query = query.in("channel_account_id", channelAccountIds);
    }
    if (params.status !== "all") {
      query = query.eq("status", params.status);
    }
    const search = sanitizeSearchTerm(params.search);
    if (search) {
      query = query.or(`buyer_name.ilike.%${search}%,external_order_id.ilike.%${search}%`);
    }
    if (params.cursor) {
      const decoded = decodeCursor(params.cursor);
      if (decoded) {
        query = query.or(
          `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`
        );
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const rawRows = data ?? [];
    const hasMore = rawRows.length > PAGE_SIZE;
    const pageRows = hasMore ? rawRows.slice(0, PAGE_SIZE) : rawRows;

    const rows: OrderListRow[] = pageRows.map((r: any) => {
      const account = accountMap.get(r.channel_account_id);
      return {
        id: r.id,
        externalOrderId: r.external_order_id,
        status: r.status,
        buyerName: r.buyer_name,
        totalAmount: Number(r.total_amount),
        currency: r.currency,
        placedAt: r.placed_at,
        createdAt: r.created_at,
        channelCode: account?.code ?? "shopee",
        channelName: account?.name ?? "-",
      };
    });

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

    return { ok: true, data: { rows: sortByPriority(rows), nextCursor } };
  } catch (err) {
    console.error("listOrders failed", err);
    return { ok: false, error: "โหลดรายการออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getPrioritySummary(): Promise<ActionResult<PrioritySummary>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [newRes, oversoldRes, toShipRes] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("status", "new"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("status", "oversold_hold"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("status", "to_ship"),
    ]);
    if (newRes.error) throw newRes.error;
    if (oversoldRes.error) throw oversoldRes.error;
    if (toShipRes.error) throw toShipRes.error;

    return {
      ok: true,
      data: {
        newCount: newRes.count ?? 0,
        oversoldCount: oversoldRes.count ?? 0,
        toShipCount: toShipRes.count ?? 0,
      },
    };
  } catch (err) {
    console.error("getPrioritySummary failed", err);
    return { ok: false, error: "โหลดสรุปยอดไม่สำเร็จ" };
  }
}

export async function countNewOrdersSince(sinceIso: string): Promise<ActionResult<number>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { count, error } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .gt("created_at", sinceIso);
    if (error) throw error;
    return { ok: true, data: count ?? 0 };
  } catch (err) {
    console.error("countNewOrdersSince failed", err);
    return { ok: false, error: "เช็คออเดอร์ใหม่ไม่สำเร็จ" };
  }
}

export async function getOrderDetail(orderId: string): Promise<ActionResult<OrderDetail>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, external_order_id, status, external_status, buyer_name, buyer_phone, shipping_address, total_amount, currency, placed_at, created_at, cancel_reason, channel_account_id"
      )
      .eq("shop_id", shopId)
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) throw orderErr;
    if (!order) return { ok: false, error: "ไม่พบออเดอร์นี้" };

    const { data: account } = await supabase
      .from("channel_account")
      .select("channel:channel_id(code, name)")
      .eq("id", order.channel_account_id)
      .maybeSingle();

    const { data: items, error: itemsErr } = await supabase
      .from("order_item")
      .select("id, product_id, external_sku, qty, unit_price, product:product_id(name)")
      .eq("order_id", orderId);
    if (itemsErr) throw itemsErr;

    const itemRows: OrderItemRow[] = (items ?? []).map((it: any) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product?.name ?? null,
      externalSku: it.external_sku,
      qty: it.qty,
      unitPrice: Number(it.unit_price),
    }));

    const acc = account as any;
    return {
      ok: true,
      data: {
        id: order.id,
        externalOrderId: order.external_order_id,
        status: order.status,
        externalStatus: order.external_status,
        buyerName: order.buyer_name,
        buyerPhone: order.buyer_phone,
        shippingAddress: order.shipping_address,
        totalAmount: Number(order.total_amount),
        currency: order.currency,
        placedAt: order.placed_at,
        createdAt: order.created_at,
        cancelReason: order.cancel_reason,
        channelCode: acc?.channel?.code ?? "shopee",
        channelName: acc?.channel?.name ?? "-",
        items: itemRows,
      },
    };
  } catch (err) {
    console.error("getOrderDetail failed", err);
    return { ok: false, error: "โหลดรายละเอียดออเดอร์ไม่สำเร็จ" };
  }
}

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  new: "confirmed",
  confirmed: "to_ship",
  to_ship: "shipped",
  shipped: "completed",
};

async function updateOrderStatus(orderId: string, shopId: string, from: OrderStatus, to: OrderStatus) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .eq("status", from); // optimistic guard — also re-checked by the DB trigger regardless
  if (error) throw error;
}

/** Advances an order to the next status in the happy path (no stock effect). */
export async function advanceOrder(orderId: string, currentStatus: OrderStatus): Promise<ActionResult> {
  const nextStatus = NEXT_STATUS[currentStatus];
  if (!nextStatus || nextStatus === "shipped") {
    // "shipped" transition needs commit_stock — routed through markShipped() instead.
    return { ok: false, error: "การเปลี่ยนสถานะนี้ไม่รองรับผ่านฟังก์ชันนี้" };
  }
  try {
    const shopId = getDevShopId();
    await updateOrderStatus(orderId, shopId, currentStatus, nextStatus);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("advanceOrder failed", err);
    return { ok: false, error: "อัพเดทสถานะไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** to_ship -> shipped: commits reserved stock (on_hand -n, reserved -n) per design §3. */
export async function markShipped(orderId: string): Promise<ActionResult> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: items, error: itemsErr } = await supabase
      .from("order_item")
      .select("product_id, qty")
      .eq("order_id", orderId)
      .not("product_id", "is", null);
    if (itemsErr) throw itemsErr;

    if (!items || items.length === 0) {
      return { ok: false, error: "ออเดอร์นี้ไม่มีสินค้าที่ map กับสต็อก ไม่สามารถยืนยันจัดส่งได้" };
    }

    const { error: rpcErr } = await supabase.rpc("commit_stock", {
      p_shop_id: shopId,
      p_order_id: orderId,
      p_idem_key: `ui:commit:${orderId}`,
      p_items: items.map((it: any) => ({ product_id: it.product_id, qty: it.qty })),
    });
    if (rpcErr) throw rpcErr;

    await updateOrderStatus(orderId, shopId, "to_ship", "shipped");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("markShipped failed", err);
    return { ok: false, error: "ยืนยันจัดส่งไม่สำเร็จ (อาจเป็นเพราะสต็อกไม่พอ) ลองใหม่อีกครั้ง" };
  }
}

const CANCELLABLE_STATUSES: OrderStatus[] = ["new", "confirmed", "to_ship", "oversold_hold"];

/**
 * Cancels an order. Releases reserved stock unless the order is
 * oversold_hold (reservation never succeeded for that order — design §3
 * "new -> oversold_hold: reserve fail ... Stock effect: —").
 */
export async function cancelOrder(orderId: string, reason: string): Promise<ActionResult> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "กรุณาระบุเหตุผลการยกเลิก" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (orderErr) throw orderErr;
    if (!order) return { ok: false, error: "ไม่พบออเดอร์นี้" };
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return { ok: false, error: "ออเดอร์นี้ไม่สามารถยกเลิกได้ (จัดส่งแล้วหรือยกเลิกไปแล้ว)" };
    }

    if (order.status !== "oversold_hold") {
      const { data: items, error: itemsErr } = await supabase
        .from("order_item")
        .select("product_id, qty")
        .eq("order_id", orderId)
        .not("product_id", "is", null);
      if (itemsErr) throw itemsErr;

      if (items && items.length > 0) {
        const { error: rpcErr } = await supabase.rpc("release_stock", {
          p_shop_id: shopId,
          p_order_id: orderId,
          p_idem_key: `ui:cancel:${orderId}`,
          p_items: items.map((it: any) => ({ product_id: it.product_id, qty: it.qty })),
        });
        if (rpcErr) throw rpcErr;
      }
    }

    const { error: updateErr } = await supabase
      .from("orders")
      .update({ status: "cancelled", cancel_reason: reason.trim() })
      .eq("id", orderId)
      .eq("shop_id", shopId);
    if (updateErr) throw updateErr;

    return { ok: true, data: undefined };
  } catch (err) {
    console.error("cancelOrder failed", err);
    return { ok: false, error: "ยกเลิกออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
