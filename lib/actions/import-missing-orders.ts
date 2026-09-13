"use server";

// lib/actions/import-missing-orders.ts — server actions backing the
// cancel-detection panel on /crm/import (design: Yoda, 11 ก.ย. 69 —
// "ตรวจจับ + ลบออเดอร์ที่ถูกยกเลิก"). Wraps
// supabase/migrations/0113_import_missing_orders_read.sql (read) and
// supabase/migrations/0115_import_delete_restore.sql (write).
//
// Same auth model as lib/actions/import-orders.ts: getServiceClient() uses
// the service role (BYPASSES RLS) — requireOwnerAdmin() below is the only
// app-layer gate. Every RPC this file calls is ALSO gated server-side by
// analytics.crm_require_owner_admin(p_shop_id) (defense in depth, same
// reasoning as every other CRM write RPC in this project) — this file's own
// gate exists so a disabled/staff session never even reaches the network
// call, not because the DB gate is trusted alone.
//
// This module permanently deletes revenue-bearing rows (with a snapshot +
// restore path) — every export here revalidates the same page set
// commitOrderImport does, since a delete/restore changes the same
// aggregates a fresh import would.
//
// Known debt (tracked here, not in a separate doc — see docs/3j-jewelry/
// INDEX.md, checked 13 ก.ย. 69: no dedicated cancel-detection design/debt
// file exists yet for this to live in):
//   - deleted_by/restored_by (fact_order_deleted) are always null in
//     practice — both columns are set via auth.uid(), but every call here
//     goes through the service-role client (no JWT session), so auth.uid()
//     resolves to null until Auth A2 ships real per-user sessions.
//   - The write gate (requireMissingOrdersWriteEnabled, above) is a single
//     TypeScript `if` on an env var — no DB-level enforcement backs it.
//     Mace (security review 12 ก.ย. 69) proposed a follow-up migration
//     (0117, analytics.crm_feature_flag) so the real gate can live in the DB
//     once the owner is ready to open this up — not built yet.
//   - MissingOrdersPanel defaults every candidate to selected/ticked on load
//     (design decision, 11 ก.ย. 69) — a shop owner who doesn't notice this
//     and clicks delete without reviewing the list deletes everything shown.
//   - DeletedOrdersHistory renders `reason` as free-text with no sanitation
//     beyond what the delete form itself enforces — NOT an XSS risk (React
//     escapes it like any other text child), the real concern is that it's
//     visible to anyone who can load this page, fine today (owner/admin-
//     only, single internal user) but not once Auth A2 opens this page to
//     more than one trusted person.
//   - ImportBatchHistory.tsx only fetches `missingResult` when the "ตรวจ
//     ออเดอร์ที่หายไป" button is clicked (fetchMissing inside
//     toggleMissingPanel) — it does NOT refetch just because
//     `latestOrderBatchId` changes under an already-open panel (e.g. a new
//     batch becomes the latest transformed order batch while the panel is
//     open). MissingOrdersPanel would then be passed a new `batchId` prop
//     while still displaying `missingResult` computed for the OLD batch —
//     stale/confusing display, not a data-safety issue: deleteMissingOrders
//     re-derives the candidate set server-side for whatever `batchId` it
//     actually receives, so a delete against a stale-looking list still only
//     ever matches real candidates of the (new) batch id sent, or gets
//     rejected outright (surfaced via mapMissingOrdersRpcError's "not in the
//     current candidate set" case, added 13 ก.ย. 69) if the ids no longer
//     line up.
//   - ImportBatchHistory does not surface skipped/tombstoned row counts
//     anywhere in its table — a batch that fed into a later delete has no
//     visible trace of that in the history view itself (only in
//     DeletedOrdersHistory, a separate table).

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import {
  mapMissingOrdersRpcError,
  type DeleteMissingOrdersResult,
  type DeletedOrderRow,
  type MissingOrderCandidate,
  type MissingOrdersBlockedReason,
  type MissingOrdersChannel,
  type MissingOrdersGroup,
  type MissingOrdersResult,
  type MissingOrdersWriteStatus,
  type RestoreDeletedOrdersResult,
} from "@/lib/import/missing-orders-types";

const SCHEMA = "analytics";

// design §3 "cap: count(S) > greatest(20, 15% ของไฟล์)" — kept in sync with
// the SAME literal used in 0113/0115 (analytics.import_missing_orders /
// analytics.import_delete_orders). This constant is display-only here
// (e.g. "เลือกได้สูงสุด N รายการ" copy) — the DB is the one enforcing it.
const DELETE_IDS_MAX = 200;

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ตรวจ/ลบ/กู้คืนออเดอร์ที่หายไปได้" };
  }
  return null;
}

// C-2 (security review 12 ก.ย. 69): production is intentionally open to the
// public (accepted risk, see memory/prod-exposure-accepted-risk — a Vercel
// Hobby plan can't gate the deployment itself) and requireOwnerAdmin() above
// reads an env var (getDevRole()), NOT a real auth session — there is no
// per-user login yet (pending Auth A2). (L-2, security review 12 ก.ย. 69:
// this env var is read at runtime, not baked in at build time — but on
// Vercel, changing its value still needs a redeploy to take effect, so it is
// not an instant kill switch either way.) analytics.crm_require_owner_
// admin() inside the RPCs is also effectively a no-op under service_role,
// which is what getServiceClient() always uses here. That stack of "gates"
// adds up to zero real access control on two RPCs that PERMANENTLY delete
// revenue-bearing rows. This flag is the actual gate until Auth A2 ships a
// real session check: unset (or any value other than "1") keeps both write
// paths refusing to run. getMissingOrders/getDeletedOrders (read-only) are
// deliberately NOT gated by this — they carry the same exposure risk every
// other read action in this app already has, accepted separately.
function requireMissingOrdersWriteEnabled(): ActionResult<never> | null {
  if (process.env.MISSING_ORDERS_WRITE_ENABLED !== "1") {
    return {
      ok: false,
      error: "ระบบลบ/กู้คืนออเดอร์ยังปิดอยู่ (เปิดได้หลัง Auth A2 หรือเจ้าของสั่งเปิด)",
    };
  }
  return null;
}

function revalidateOrderAffectedPaths(): void {
  revalidatePath("/crm/import");
  revalidatePath("/crm/overview");
  revalidatePath("/crm/orders");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/import-errors");
  revalidatePath("/dashboard");
}

function mapGroup(g: Record<string, unknown>): MissingOrdersGroup {
  return {
    prefix: String(g.prefix ?? ""),
    lo: Number(g.lo),
    hi: Number(g.hi),
    dateLo: String(g.date_lo),
    dateHi: String(g.date_hi),
    rowCount: Number(g.row_count),
  };
}

function mapChannel(c: Record<string, unknown>): MissingOrdersChannel {
  return {
    channelId: String(c.channel_id),
    code: String(c.code),
    name: String(c.name),
  };
}

function mapCandidate(c: Record<string, unknown>): MissingOrderCandidate {
  return {
    factOrderId: String(c.fact_order_id),
    sourceOrderNo: String(c.source_order_no),
    orderDate: String(c.order_date),
    channelId: String(c.channel_id),
    channelName: (c.channel_name as string | null) ?? null,
    revenueThb: Number(c.revenue_thb) || 0,
    trackingNo: (c.tracking_no as string | null) ?? null,
    customerId: (c.customer_id as string | null) ?? null,
    customerDisplayName: (c.customer_display_name as string | null) ?? null,
    lastSeenFile: (c.last_seen_file as string | null) ?? null,
    lastSeenAt: (c.last_seen_at as string | null) ?? null,
  };
}

/** Field-by-field mapping (not spread) from the RPC's raw jsonb — same
 * discipline oem-quote-invariants uses for money-adjacent payloads: an
 * unexpected future key on the jsonb response never silently rides along
 * into the UI's type unnoticed. */
function mapMissingOrdersResult(raw: Record<string, unknown>): MissingOrdersResult {
  const evidence = (raw.evidence ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(raw.ok),
    blockedReason: (raw.blocked_reason as MissingOrdersBlockedReason | null) ?? null,
    evidence: {
      fileName: (evidence.file_name as string | null) ?? null,
      importedAt: (evidence.imported_at as string | null) ?? null,
      fileOrderCount: Number(evidence.file_order_count) || 0,
      groups: ((evidence.groups ?? []) as Record<string, unknown>[]).map(mapGroup),
      channels: ((evidence.channels ?? []) as Record<string, unknown>[]).map(mapChannel),
      skippedRows: Number(evidence.skipped_rows) || 0,
    },
    monotonicWarnings: Number(raw.monotonic_warnings) || 0,
    candidateCount: Number(raw.candidate_count) || 0,
    candidateRevenueThb: Number(raw.candidate_revenue_thb) || 0,
    candidates: ((raw.candidates ?? []) as Record<string, unknown>[]).map(mapCandidate),
  };
}

// ============================================================================
// getMissingOrders — read-only, backs MissingOrdersPanel (frontend-dev,
// later phase). Never writes anything.
// ============================================================================

export async function getMissingOrders(batchId: string): Promise<ActionResult<MissingOrdersResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanBatchId = batchId?.trim();
  if (!cleanBatchId) return { ok: false, error: "ไม่พบ batch ที่จะตรวจ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .rpc("import_missing_orders", { p_shop_id: shopId, p_batch_id: cleanBatchId });
    if (error) throw error;

    return { ok: true, data: mapMissingOrdersResult(data as Record<string, unknown>) };
  } catch (err) {
    console.error("getMissingOrders failed", err);
    return { ok: false, error: "ตรวจออเดอร์ที่หายไปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// getMissingOrdersWriteStatus — frontend request (12 ก.ย. 69), backs
// MissingOrdersPanel's own disabled state. Read-only, no DB round-trip at
// all — lets the UI disable the delete/restore buttons from mount instead
// of discovering the gate is closed only after a user clicks and gets back
// deleteMissingOrders/restoreDeletedOrders' Thai error string. Calls
// requireMissingOrdersWriteEnabled() itself (not a second copy of the env
// check) so this can never drift from the real gate those two actions use.
// The Thai error string on an actual write attempt is still the real
// enforcement — this action is a convenience for the UI, not a second gate.
// ============================================================================

export async function getMissingOrdersWriteStatus(): Promise<ActionResult<MissingOrdersWriteStatus>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  return { ok: true, data: { enabled: requireMissingOrdersWriteEnabled() === null } };
}

// ============================================================================
// deleteMissingOrders — permanent delete + snapshot (analytics.
// fact_order_deleted). The DB re-validates ids ⊂ candidates and the cap
// itself (single source of truth lives in 0113/0115, not here) — this
// action's own validation below is a fast-fail for obviously-bad input,
// not the real gate.
// ============================================================================

export async function deleteMissingOrders(
  batchId: string,
  ids: string[],
  reason: string
): Promise<ActionResult<DeleteMissingOrdersResult>> {
  const writeGateErr = requireMissingOrdersWriteEnabled();
  if (writeGateErr) return writeGateErr;

  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanBatchId = batchId?.trim();
  if (!cleanBatchId) return { ok: false, error: "ไม่พบ batch ที่จะลบออเดอร์" };

  const cleanIds = Array.from(new Set((ids ?? []).map((id) => id?.trim()).filter((id): id is string => Boolean(id))));
  if (cleanIds.length === 0) return { ok: false, error: "กรุณาเลือกอย่างน้อย 1 ออเดอร์ที่จะลบ" };
  if (cleanIds.length > DELETE_IDS_MAX) {
    return { ok: false, error: `เลือกได้สูงสุด ${DELETE_IDS_MAX} รายการต่อครั้ง (เลือกอยู่ ${cleanIds.length} รายการ)` };
  }

  const cleanReason = reason?.trim();
  if (!cleanReason) return { ok: false, error: "กรุณาระบุเหตุผลก่อนลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("import_delete_orders", {
      p_shop_id: shopId,
      p_batch_id: cleanBatchId,
      p_ids: cleanIds,
      p_reason: cleanReason,
    });
    if (error) throw error;

    const result = data as Record<string, unknown>;
    revalidateOrderAffectedPaths();

    return {
      ok: true,
      data: {
        deletedCount: Number(result.deleted_count) || 0,
        deletedRevenueThb: Number(result.deleted_revenue_thb) || 0,
        deletedIds: ((result.deleted_ids ?? []) as string[]).map(String),
      },
    };
  } catch (err) {
    console.error("deleteMissingOrders failed", err);
    // QA-1 (13 ก.ย. 69): substring-match import_delete_orders' distinct raise
    // messages (0115) into their own actionable Thai copy — this generic
    // sentence is now only the fallback for an UNMATCHED RPC message (or a
    // non-Postgrest failure, e.g. network), not the answer for every cause.
    const fallback =
      "ลบออเดอร์ไม่สำเร็จ — รายการที่เลือกอาจไม่ตรงกับที่ระบบตรวจล่าสุดแล้ว (มีการนำเข้าไฟล์ใหม่ระหว่างนี้) ลองกดตรวจซ้ำแล้วลองใหม่";
    return { ok: false, error: mapMissingOrdersRpcError(err, fallback) };
  }
}

// ============================================================================
// getDeletedOrders — history table (DeletedOrdersHistory, frontend-dev,
// later phase). Reads analytics.fact_order_deleted directly (same "service
// client + explicit shop_id filter" shape as getImportBatches) — no RPC
// needed for a plain scoped SELECT, matching every other history/list
// action in this codebase (getImportBatches, etc). 50 most recent, newest
// first, per design §6.
// ============================================================================

const DELETED_ORDERS_HISTORY_LIMIT = 50;

export async function getDeletedOrders(): Promise<ActionResult<DeletedOrderRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("fact_order_deleted")
      .select(
        "id, fact_order_id, source_order_no, channel_id, order_date, revenue, customer_id, " +
          "detected_by_file_name, reason, deleted_at, deleted_by, restored_at, " +
          "channel:channel_id(name), customer:customer_id(display_name)"
      )
      .eq("shop_id", shopId)
      .order("deleted_at", { ascending: false })
      .limit(DELETED_ORDERS_HISTORY_LIMIT);
    if (error) throw error;

    // Untyped supabase-js client (no generated Database types in this
    // project, same as every other embedded-relationship select — see
    // lib/actions/orders.ts's accountMap) can't statically type the
    // channel:/customer: embed, so the row shape is asserted per-row rather
    // than cast on the whole array.
    const rows: DeletedOrderRow[] = (data ?? []).map((r: any) => {
      const channel = Array.isArray(r.channel) ? r.channel[0] : r.channel;
      const customer = Array.isArray(r.customer) ? r.customer[0] : r.customer;
      return {
        id: r.id as string,
        factOrderId: r.fact_order_id as string,
        sourceOrderNo: r.source_order_no as string,
        channelId: r.channel_id as string,
        channelName: (channel?.name as string | undefined) ?? null,
        orderDate: r.order_date as string,
        revenueThb: Number(r.revenue) || 0,
        customerId: (r.customer_id as string | null) ?? null,
        customerDisplayName: (customer?.display_name as string | null | undefined) ?? null,
        detectedByFileName: (r.detected_by_file_name as string | null) ?? null,
        reason: r.reason as string,
        deletedAt: r.deleted_at as string,
        deletedBy: (r.deleted_by as string | null) ?? null,
        restoredAt: (r.restored_at as string | null) ?? null,
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getDeletedOrders failed", err);
    return { ok: false, error: "โหลดประวัติออเดอร์ที่ลบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// restoreDeletedOrders — undo a delete. ids here are fact_order_deleted.id
// (the history row id), NOT fact_order_id — matches DeletedOrdersHistory's
// own "ปุ่มกู้คืน" per-row action, design §4.
// ============================================================================

export async function restoreDeletedOrders(ids: string[]): Promise<ActionResult<RestoreDeletedOrdersResult>> {
  const writeGateErr = requireMissingOrdersWriteEnabled();
  if (writeGateErr) return writeGateErr;

  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanIds = Array.from(new Set((ids ?? []).map((id) => id?.trim()).filter((id): id is string => Boolean(id))));
  if (cleanIds.length === 0) return { ok: false, error: "กรุณาเลือกอย่างน้อย 1 รายการที่จะกู้คืน" };
  if (cleanIds.length > DELETE_IDS_MAX) {
    return { ok: false, error: `กู้คืนได้สูงสุด ${DELETE_IDS_MAX} รายการต่อครั้ง (เลือกอยู่ ${cleanIds.length} รายการ)` };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .rpc("import_restore_orders", { p_shop_id: shopId, p_deleted_ids: cleanIds });
    if (error) throw error;

    const result = data as Record<string, unknown>;
    revalidateOrderAffectedPaths();

    return {
      ok: true,
      data: {
        restoredCount: Number(result.restored_count) || 0,
        restoredRevenueThb: Number(result.restored_revenue_thb) || 0,
        restoredIds: ((result.restored_ids ?? []) as string[]).map(String),
      },
    };
  } catch (err) {
    console.error("restoreDeletedOrders failed", err);
    // QA-1 (13 ก.ย. 69): substring-match import_restore_orders' distinct raise
    // messages (0115) into their own actionable Thai copy — this generic
    // sentence is now only the fallback for an UNMATCHED RPC message (or a
    // non-Postgrest failure, e.g. network), not the answer for every cause.
    const fallback =
      "กู้คืนออเดอร์ไม่สำเร็จ — อาจมีออเดอร์เลขที่เดียวกันถูกสร้างขึ้นใหม่แล้วหลังจากลบ (เช่น Shipnity ใช้เลขซ้ำ) ตรวจสอบก่อนลองใหม่";
    return { ok: false, error: mapMissingOrdersRpcError(err, fallback) };
  }
}
