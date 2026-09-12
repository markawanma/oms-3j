// lib/import/missing-orders-types.ts — TS shapes of the jsonb RPC responses
// from supabase/migrations/0113/0115 (cancel-detection Phase 1, design:
// Yoda 11 ก.ย. 69). No "use server" here (mirrors lib/import/source-types.ts):
// these types are imported by both the server actions
// (lib/actions/import-missing-orders.ts) AND client components
// (MissingOrdersPanel/DeletedOrdersHistory, frontend-dev phase) — a
// "use server" file may only export async functions (27 ส.ค. 69 lesson,
// see source-types.ts), so plain type/interface exports must live outside
// any "use server" module.

/** analytics.import_missing_orders_candidates' P1-P4 hard-block codes,
 * surfaced by analytics.import_missing_orders as `blocked_reason` — plus
 * 'too_many', which is the read RPC's own count-based cap (not a
 * precondition on the candidates helper itself). Keep in sync with the
 * `detail` values raised in 0113/0115. */
export type MissingOrdersBlockedReason =
  | "shop_or_source_mismatch"
  | "batch_not_transformed"
  | "batch_has_unresolved_rows"
  | "unparseable_order_no"
  | "channels_unresolved"
  | "file_rows_skipped"
  | "too_many";

export interface MissingOrdersGroup {
  prefix: string;
  lo: number;
  hi: number;
  dateLo: string;
  dateHi: string;
  rowCount: number;
}

export interface MissingOrdersChannel {
  channelId: string;
  code: string;
  name: string;
}

export interface MissingOrdersEvidence {
  fileName: string | null;
  importedAt: string | null;
  fileOrderCount: number;
  groups: MissingOrdersGroup[];
  channels: MissingOrdersChannel[];
  /** H-2 (security review 12 ก.ย. 69): rows the source file had that never
   * reached staging at all (blank source_order_no — see order-report.ts).
   * > 0 means this batch is ALSO blocked with blocked_reason=
   * 'file_rows_skipped' — surfaced here too so the UI can show the count
   * even outside the blocked state. */
  skippedRows: number;
}

export interface MissingOrderCandidate {
  factOrderId: string;
  sourceOrderNo: string;
  orderDate: string;
  channelId: string;
  channelName: string | null;
  revenueThb: number;
  trackingNo: string | null;
  customerId: string | null;
  customerDisplayName: string | null;
  lastSeenFile: string | null;
  lastSeenAt: string | null;
}

export interface MissingOrdersResult {
  ok: boolean;
  blockedReason: MissingOrdersBlockedReason | null;
  evidence: MissingOrdersEvidence;
  /** P5, day-granularity (Asia/Bangkok) — WARN only, never blocks (owner
   * decision 11 ก.ย. 69: the 3 real inversions found were UTC-vs-Bangkok
   * timestamp artifacts, not real out-of-order numbering). */
  monotonicWarnings: number;
  candidateCount: number;
  candidateRevenueThb: number;
  candidates: MissingOrderCandidate[];
}

export interface DeleteMissingOrdersResult {
  deletedCount: number;
  deletedRevenueThb: number;
  deletedIds: string[];
}

export interface RestoreDeletedOrdersResult {
  restoredCount: number;
  restoredRevenueThb: number;
  restoredIds: string[];
}

// C-2 (security review 12 ก.ย. 69, lib/actions/import-missing-orders.ts's
// requireMissingOrdersWriteEnabled) — deleteMissingOrders/restoreDeletedOrders
// return this EXACT ActionResult error string when MISSING_ORDERS_WRITE_
// ENABLED != "1". There is no dedicated status action (no
// getMissingOrdersWriteStatus()) the UI can call ahead of time to know the
// switch is off before the user even clicks delete/restore — see this
// project's frontend delivery notes (12 ก.ย. 69) for that ask. Until one
// exists, string-matching this prefix is the ONLY way the UI can tell
// "write disabled on purpose" apart from a genuine failure, so it can show
// an info box instead of a scary red error. Fragile by construction: if the
// wording of requireMissingOrdersWriteEnabled()'s error ever changes without
// updating this constant too, this stops matching and the UI just falls
// back to treating it as a normal error (worse UX, still safe — no
// silent data risk either way).
export const MISSING_ORDERS_WRITE_DISABLED_PREFIX = "ระบบลบ/กู้คืนออเดอร์ยังปิดอยู่";

export function isMissingOrdersWriteDisabledError(error: string): boolean {
  return error.startsWith(MISSING_ORDERS_WRITE_DISABLED_PREFIX);
}

/** One row of analytics.fact_order_deleted, shaped for DeletedOrdersHistory
 * (frontend-dev, later phase) — NOT the full snapshot (order_row/item_rows/
 * evidence stay server-side only, never sent to the client: they exist for
 * import_restore_orders to reconstruct the row, not for display). */
export interface DeletedOrderRow {
  id: string;
  factOrderId: string;
  sourceOrderNo: string;
  channelId: string;
  channelName: string | null;
  orderDate: string;
  revenueThb: number;
  customerId: string | null;
  customerDisplayName: string | null;
  detectedByFileName: string | null;
  reason: string;
  deletedAt: string;
  deletedBy: string | null;
  restoredAt: string | null;
}
