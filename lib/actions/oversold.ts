"use server";

// lib/actions/oversold.ts — /orders/oversold follow-up tracker (COO 9.9
// ops-plan-99.md §6), backed by supabase/migrations/0038_oversold_followup.sql.
// Same service-client + getDevShopId()/getDevRole() gate + ActionResult<T>
// shape as lib/actions/marketing.ts — see that file's header for the SHOP
// SCOPING NOTE (service_role bypasses RLS, so getDevRole() below is the ONLY
// thing gating writes in this app today, not the DB).
//
// This module is annotation-only: it reads analytics.v_oversold_hold_queue
// and upserts analytics.oversold_followup via RPC. It must never touch
// public.orders (status/stock) — that stays on the existing order flow
// (lib/actions/orders.ts or equivalent) at /orders/[id].

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { OversoldHoldRow, OversoldContactStatus, OversoldResolution, UpdateOversoldFollowupInput } from "@/lib/oversold/types";

const SCHEMA = "analytics";

const CONTACT_STATUSES: OversoldContactStatus[] = ["pending", "contacted", "resolved"];
const RESOLUTIONS: OversoldResolution[] = ["restock", "swap", "refund", "other"];

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานคิวของไม่พอได้" };
  }
  return null;
}

// ============================================================================
// analytics.v_oversold_hold_queue — sorted longest-held first (hours_held
// desc) so the case closest to (or already past) the 48h SLA surfaces on top.
// ============================================================================

export async function getOversoldQueue(): Promise<ActionResult<OversoldHoldRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_oversold_hold_queue")
      .select(
        "order_id, shop_id, external_order_id, buyer_name, buyer_phone, total_amount, live_session_id, placed_at, item_count, hours_held, contact_status, resolution, note, followup_updated_at"
      )
      .eq("shop_id", shopId)
      .order("hours_held", { ascending: false });
    if (error) throw error;

    const rows: OversoldHoldRow[] = (
      (data ?? []) as {
        order_id: string;
        shop_id: string;
        external_order_id: string;
        buyer_name: string | null;
        buyer_phone: string | null;
        total_amount: number;
        live_session_id: string | null;
        placed_at: string;
        item_count: number;
        hours_held: number;
        contact_status: string;
        resolution: string | null;
        note: string | null;
        followup_updated_at: string | null;
      }[]
    ).map((r) => ({
      orderId: r.order_id,
      shopId: r.shop_id,
      externalOrderId: r.external_order_id,
      buyerName: r.buyer_name,
      buyerPhone: r.buyer_phone,
      totalAmount: Number(r.total_amount) || 0,
      liveSessionId: r.live_session_id,
      placedAt: r.placed_at,
      itemCount: Number(r.item_count) || 0,
      hoursHeld: Number(r.hours_held) || 0,
      contactStatus: (CONTACT_STATUSES as string[]).includes(r.contact_status)
        ? (r.contact_status as OversoldContactStatus)
        : "pending",
      resolution: r.resolution && (RESOLUTIONS as string[]).includes(r.resolution) ? (r.resolution as OversoldResolution) : null,
      note: r.note,
      followupUpdatedAt: r.followup_updated_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getOversoldQueue failed", err);
    return { ok: false, error: "โหลดคิวของไม่พอไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// analytics.oversold_followup_upsert RPC — logs contact status/resolution/
// note for one held order. The RPC itself re-checks owner/admin AND that the
// order still belongs to this shop and is still oversold_hold (IDOR + sanity
// guard), so this action's own validation below is a fast-fail UX layer, not
// the security boundary.
// ============================================================================

export async function updateOversoldFollowup(input: UpdateOversoldFollowupInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.orderId) return { ok: false, error: "ไม่พบออเดอร์ที่จะบันทึก" };
  if (!CONTACT_STATUSES.includes(input.contactStatus)) {
    return { ok: false, error: "สถานะการติดต่อไม่ถูกต้อง" };
  }
  if (input.resolution !== null && !RESOLUTIONS.includes(input.resolution)) {
    return { ok: false, error: "ทางออกที่เลือกไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("oversold_followup_upsert", {
      p_order_id: input.orderId,
      p_shop_id: shopId,
      p_contact_status: input.contactStatus,
      p_resolution: input.resolution,
      p_note: input.note?.trim() || null,
    });
    if (error) throw error;

    revalidatePath("/orders/oversold");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("updateOversoldFollowup failed", err);
    return { ok: false, error: "บันทึกการติดตามไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
