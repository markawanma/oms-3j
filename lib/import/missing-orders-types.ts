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
  | "empty_batch"
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
// ENABLED != "1". getMissingOrdersWriteStatus() (below, 9d658b1) is now the
// PRIMARY way the UI knows this ahead of time — this string-match stays as a
// FALLBACK for the narrow race where the status was fetched as "enabled" but
// flips to disabled before the delete/restore call actually lands (or the
// status fetch itself failed and the button wasn't proactively disabled).
// Fragile by construction: if requireMissingOrdersWriteEnabled()'s wording
// ever changes without updating this constant too, this fallback silently
// stops matching (falls back to a normal red error — worse UX, still safe,
// no silent data risk either way).
export const MISSING_ORDERS_WRITE_DISABLED_PREFIX = "ระบบลบ/กู้คืนออเดอร์ยังปิดอยู่";

export function isMissingOrdersWriteDisabledError(error: string): boolean {
  return error.startsWith(MISSING_ORDERS_WRITE_DISABLED_PREFIX);
}

/** C-2 (security review 12 ก.ย. 69) — frontend-requested read of the
 * MISSING_ORDERS_WRITE_ENABLED env gate, so the UI can disable the delete/
 * restore buttons from mount instead of relying on string-matching the
 * error message deleteMissingOrders/restoreDeletedOrders return when the
 * gate is closed. */
export interface MissingOrdersWriteStatus {
  enabled: boolean;
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
