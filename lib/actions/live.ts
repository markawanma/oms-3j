"use server";

// lib/actions/live.ts — server actions for "จดออเดอร์เร็วตอน TikTok Live"
// (Phase A backend). Manages the live_session lifecycle; order-taking itself
// lives in lib/actions/quick-order.ts. Same pattern as lib/actions/orders.ts:
// service-role client + explicit shop_id filter (see lib/supabase/server.ts),
// no auth in this MVP batch.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import type {
  ActionResult,
  LiveSession,
  LiveSessionStats,
  LiveSessionTopSku,
} from "@/lib/types";

const EXCLUDED_FROM_METRICS = ["cancelled", "oversold_hold"];

/**
 * Every live-order action needs the shop's manual TikTok "channel" —
 * seeded in docs/dev-seed.sql as channel_account(channel=tiktok,
 * external_shop_id='manual-live'). Shared here and in quick-order.ts.
 */
export async function getManualTiktokChannelAccountId(shopId: string): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("channel_account")
    .select("id, channel:channel_id!inner(code)")
    .eq("shop_id", shopId)
    .eq("external_shop_id", "manual-live")
    .eq("channel.code", "tiktok")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      "ไม่พบ channel_account สำหรับ TikTok Live แบบ manual — ต้อง seed ก่อน (ดู docs/dev-seed.sql)"
    );
  }
  return (data as any).id as string;
}

function mapSessionRow(r: any): LiveSession {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    notes: r.notes,
  };
}

export async function startLiveSession(input: { title?: string }): Promise<ActionResult<LiveSession>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const channelAccountId = await getManualTiktokChannelAccountId(shopId);

    const { data, error } = await supabase
      .from("live_session")
      .insert({
        channel_account_id: channelAccountId,
        title: (input.title ?? "").trim(),
      })
      .select("id, title, status, started_at, ended_at, notes")
      .single();

    if (error) {
      // uq_live_session_one_open_per_shop (partial unique index on shop_id
      // where status='open') — race-safe: a second concurrent "start live"
      // click loses here instead of silently opening two sessions.
      if ((error as any).code === "23505") {
        return { ok: false, error: "มีไลฟ์ที่เปิดอยู่แล้ว ปิดไลฟ์เดิมก่อนเริ่มไลฟ์ใหม่" };
      }
      throw error;
    }

    return { ok: true, data: mapSessionRow(data) };
  } catch (err) {
    console.error("startLiveSession failed", err);
    return { ok: false, error: "เริ่มไลฟ์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function closeLiveSession(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ไม่พบไลฟ์นี้" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("live_session")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("id", id)
      .eq("shop_id", shopId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "ไม่พบไลฟ์ที่เปิดอยู่ หรือปิดไปแล้ว" };

    return { ok: true, data: undefined };
  } catch (err) {
    console.error("closeLiveSession failed", err);
    return { ok: false, error: "ปิดไลฟ์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getOpenSession(): Promise<ActionResult<LiveSession | null>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("live_session")
      .select("id, title, status, started_at, ended_at, notes")
      .eq("shop_id", shopId)
      .eq("status", "open")
      .maybeSingle();
    if (error) throw error;

    return { ok: true, data: data ? mapSessionRow(data) : null };
  } catch (err) {
    console.error("getOpenSession failed", err);
    return { ok: false, error: "เช็คไลฟ์ที่เปิดอยู่ไม่สำเร็จ" };
  }
}

export async function listLiveSessions(): Promise<ActionResult<LiveSession[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("live_session")
      .select("id, title, status, started_at, ended_at, notes")
      .eq("shop_id", shopId)
      .order("started_at", { ascending: false });
    if (error) throw error;

    return { ok: true, data: (data ?? []).map(mapSessionRow) };
  } catch (err) {
    console.error("listLiveSessions failed", err);
    return { ok: false, error: "โหลดรายการไลฟ์ไม่สำเร็จ" };
  }
}

export async function getLiveSessionStats(id: string): Promise<ActionResult<LiveSessionStats>> {
  if (!id) return { ok: false, error: "ไม่พบไลฟ์นี้" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("v_live_session_stats")
      .select(
        "live_session_id, title, status, started_at, ended_at, order_count, oversold_count, gmv, units_sold, duration_hours"
      )
      .eq("shop_id", shopId)
      .eq("live_session_id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "ไม่พบไลฟ์นี้" };

    return {
      ok: true,
      data: {
        liveSessionId: data.live_session_id,
        title: data.title,
        status: data.status,
        startedAt: data.started_at,
        endedAt: data.ended_at,
        orderCount: Number(data.order_count),
        oversoldCount: Number(data.oversold_count),
        gmv: Number(data.gmv),
        unitsSold: Number(data.units_sold),
        durationHours: Number(data.duration_hours),
      },
    };
  } catch (err) {
    console.error("getLiveSessionStats failed", err);
    return { ok: false, error: "โหลดสรุปยอดไลฟ์ไม่สำเร็จ" };
  }
}

/**
 * Top 10 SKU by units sold in this live session. Aggregated client-side
 * (JS) rather than via SQL GROUP BY over PostgREST — there is no existing
 * aggregate-view precedent for this shape in the schema and adding one just
 * for a top-10 list isn't worth another migration surface; MVP order volume
 * per live session (dozens-hundreds of items) is small enough that this is
 * not a performance concern.
 */
export async function getTopSkus(id: string): Promise<ActionResult<LiveSessionTopSku[]>> {
  if (!id) return { ok: false, error: "ไม่พบไลฟ์นี้" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Confirm the session belongs to this shop before trusting the join filter.
    const { data: session, error: sessionErr } = await supabase
      .from("live_session")
      .select("id")
      .eq("id", id)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return { ok: false, error: "ไม่พบไลฟ์นี้" };

    const { data, error } = await supabase
      .from("order_item")
      .select("product_id, qty, product:product_id(sku, name), order:order_id!inner(live_session_id, status)")
      .eq("order.live_session_id", id)
      .not("order.status", "in", `(${EXCLUDED_FROM_METRICS.join(",")})`)
      .not("product_id", "is", null);
    if (error) throw error;

    const totals = new Map<string, { sku: string; name: string; qty: number }>();
    for (const row of data ?? []) {
      const r = row as any;
      if (!r.product_id) continue;
      const existing = totals.get(r.product_id);
      const sku = r.product?.sku ?? "-";
      const name = r.product?.name ?? "-";
      if (existing) {
        existing.qty += r.qty;
      } else {
        totals.set(r.product_id, { sku, name, qty: r.qty });
      }
    }

    const top: LiveSessionTopSku[] = Array.from(totals.entries())
      .map(([productId, v]) => ({ productId, sku: v.sku, name: v.name, qtySold: v.qty }))
      .sort((a, b) => b.qtySold - a.qtySold)
      .slice(0, 10);

    return { ok: true, data: top };
  } catch (err) {
    console.error("getTopSkus failed", err);
    return { ok: false, error: "โหลด SKU ขายดีไม่สำเร็จ" };
  }
}
