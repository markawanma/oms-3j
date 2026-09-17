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

// 0117 (DB write-gate kill switch, analytics.crm_feature_flag) —
// deleteMissingOrders/restoreDeletedOrders' underlying RPCs (analytics.
// import_delete_orders / import_restore_orders) now raise a `write_gate_
// closed` DETAIL when the shop's flag row is missing/false; mapMissing
// OrdersRpcError below composes that into the exact Thai string starting
// with this prefix. getMissingOrdersWriteStatus() (reads the same flag row
// directly) is the PRIMARY way the UI knows this ahead of time — this
// string-match stays as a REACTIVE FALLBACK for the narrow race where the
// status was fetched as "enabled" but the flag flipped to disabled before
// the delete/restore call actually landed (or the status fetch itself
// failed and the button wasn't proactively disabled).
//
// Pre-0117 history: this used to be a byte-for-byte copy of a TS-side env-
// var gate's wording (lib/actions/import-missing-orders.ts's
// requireMissingOrdersWriteEnabled(), removed this migration — the DB flag
// is now the only gate, per security's standing condition that opening the
// delete button required a DB-level kill switch first). Kept as a SEPARATE
// literal from mapMissingOrdersRpcError's composed string (not re-derived
// from it) so a future edit to either side can't silently drift the two
// apart without a test catching it — same reasoning as before, just a new
// producer.
export const MISSING_ORDERS_WRITE_DISABLED_PREFIX = "ระบบลบ/กู้คืนถูกปิดอยู่";

export function isMissingOrdersWriteDisabledError(error: string): boolean {
  return error.startsWith(MISSING_ORDERS_WRITE_DISABLED_PREFIX);
}

// QA-1 (QA report 13 ก.ย. 69) — deleteMissingOrders/restoreDeletedOrders used
// to log the SAME generic Thai message for every possible failure from
// analytics.import_delete_orders / analytics.import_restore_orders (0115),
// so a "someone already restored this from another tab" race read on screen
// identically to a plain network hiccup, with no hint the user should
// refresh instead of retrying blindly.
//
// The RPC bodies raise distinct English messages per precondition (see
// 0115's `raise exception` calls) — this substring-matches the ones a real
// user can actually hit mid-session (races against another tab, or a fresh
// import/delete landing between "load candidates" and "click"), matched via
// `.includes()` rather than exact-equality because every RPC message has
// runtime values (%-formatted ids/counts) interpolated into it, so no fixed
// string ever equals the whole message.
//
// Deliberately NOT exhaustive — the remaining preconditions 0115 can raise
// are intentionally left unmapped and fall through to the caller's own
// `fallback` text: `reason is required` and `cannot delete/restore more than
// 200` are already caught by this app's OWN pre-RPC validation
// (deleteMissingOrders/restoreDeletedOrders check those before ever calling
// the RPC), so hitting them FROM the RPC is not a real user path; `expected
// ON DELETE CASCADE...` (and the basic required-field guards at the top of
// each function) are internal schema/programmer-error invariants, not
// something a Thai copy sentence should try to explain to a shop owner.
//
// Takes `fallback` as a second argument (not baked into this module as one
// generic string) for the same reason friendlyError(err, fallback) does in
// lib/actions/calendar.ts:52 — deleteMissingOrders and restoreDeletedOrders
// each already have their own distinct generic message for the unmatched
// case (batch may have moved on vs. Shipnity reused the number), and this
// keeps both call sites' existing copy exactly as-is.
const MISSING_ORDERS_RPC_ERROR_MAP: ReadonlyArray<readonly [needle: string, thai: string]> = [
  // restoreDeletedOrders — import_restore_orders (0115)
  [
    "not found (already restored, or belongs to another shop)",
    "กู้คืนไปแล้ว (อาจกดจากอีกแท็บ) — รีเฟรชหน้าแล้วดูรายการใหม่",
  ],
  [
    "a live order already exists for source_order_no",
    "มีออเดอร์เลขเดียวกันถูกสร้างใหม่แล้ว (Shipnity ใช้เลขซ้ำ) — กู้คืนไม่ได้ ตรวจในระบบขายก่อน",
  ],
  // deleteMissingOrders — import_delete_orders (0115)
  [
    "not in the current candidate set",
    "รายการที่เลือกบางใบไม่อยู่ในชุดใบหายแล้ว (อาจมีไฟล์ใหม่มาระหว่างนี้) — โหลดรายการใหม่แล้วเลือกอีกครั้ง",
  ],
  [
    "exceeds the safety cap",
    "ใบหายเกินเพดานความปลอดภัยของไฟล์นี้ — ตรวจไฟล์ต้นทางก่อน ระบบไม่ลบอะไร",
  ],
];

// 0117 — the DB write-gate's own rejection, raised by analytics.import_
// delete_orders / import_restore_orders as `using errcode = 'P0001', detail
// = 'write_gate_closed'` (supabase/migrations/0117_missing_orders_write_
// flag.sql), checked against the error's `details` field (postgrest-js's
// JSON shape, plural — see pgError() in this module's test file), NOT the
// `message` substring map below. Deliberately a separate, stable token
// instead of one more row in MISSING_ORDERS_RPC_ERROR_MAP: `message` is
// free-form human prose (%-formatted, can be reworded without thinking
// about this classifier) while `detail` is the machine-readable contract
// between the RPC and this function — same reasoning oem-quote-invariants
// gives for preferring errcode over message text elsewhere in this project.
// Composed (not hardcoded) from MISSING_ORDERS_WRITE_DISABLED_PREFIX so
// isMissingOrdersWriteDisabledError()'s startsWith check — the REACTIVE
// fallback MissingOrdersPanel/RestoreOrderButton use when a flag flips
// closed mid-session — keeps matching this path without those components
// needing any change.
const MISSING_ORDERS_WRITE_GATE_CLOSED_DETAIL = "write_gate_closed";
const MISSING_ORDERS_WRITE_GATE_CLOSED_THAI = `${MISSING_ORDERS_WRITE_DISABLED_PREFIX} ติดต่อผู้ดูแลเพื่อเปิด`;

// C-3PO (code review 13 ก.ย. 69, blocker) — takes `unknown`, NOT `Error`.
// supabase-js's `.rpc()` here is never chained with `.throwOnError()`, so the
// `error` these call sites `throw` is postgrest-js's raw parsed-JSON object
// (`JSON.parse(body)` in PostgrestBuilder.processResponse — a PostgrestError
// class instance is ONLY constructed when `shouldThrowOnError` is true,
// which this codebase never sets). An earlier version of this function
// required `err instanceof Error` at the call site before ever reaching
// here — for the one error shape these RPCs actually throw, that check is
// always false, so every substring match above was dead code (confirmed
// against postgrest-js 2.112.3's source, not just inferred).
export function mapMissingOrdersRpcError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : (err as { message?: unknown } | null)?.message;
  const message = typeof raw === "string" ? raw : "";

  // 0117 write-gate check FIRST, via `details` (not `message`) — an Error
  // instance never carries this field (matches the `raw`/`message`
  // extraction above's own `err instanceof Error` split), only the plain
  // postgrest-js error object shape does. L-2 (security review 14 ก.ย. 69):
  // EXACT match (trimmed), not substring — `detail` is a fixed machine
  // token this function itself controls end-to-end (the RPC only ever sets
  // it to exactly 'write_gate_closed', nothing else), so unlike the
  // `message` needle map below (matching runtime-interpolated prose it does
  // NOT control the exact shape of) there is no reason to accept a
  // decorated/prefixed value here — that would only widen what counts as
  // "gate closed" without a corresponding real case that produces it.
  const rawDetails = err instanceof Error ? undefined : (err as { details?: unknown } | null)?.details;
  const details = typeof rawDetails === "string" ? rawDetails.trim() : "";
  if (details === MISSING_ORDERS_WRITE_GATE_CLOSED_DETAIL) {
    return MISSING_ORDERS_WRITE_GATE_CLOSED_THAI;
  }

  for (const [needle, thai] of MISSING_ORDERS_RPC_ERROR_MAP) {
    if (message.includes(needle)) return thai;
  }
  return fallback;
}

/** C-2 (security review 12 ก.ย. 69) — frontend-requested read of the write
 * gate's current state, so the UI can disable the delete/restore buttons
 * from mount instead of relying on string-matching the error message
 * deleteMissingOrders/restoreDeletedOrders return when the gate is closed.
 * 0117: backed by a DB row (analytics.crm_feature_flag) now, not an env
 * var — shape is unchanged so getMissingOrdersWriteStatus()'s callers
 * (MissingOrdersPanel/DeletedOrdersHistory) needed no edits. */
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
