// lib/import/order-diff.ts — pure diff classification for the order-report
// import preview (Feature A, task brief "แจ้ง diff ก่อน commit"). Compares
// the file's parsed rows against a caller-supplied snapshot of matching
// analytics.fact_order rows and classifies every distinct order into
// new / overwrite_same / mismatch, plus a separate order_date-drift counter.
//
// Deliberately NOT "server-only" — same reasoning as lib/import/sku-hygiene.ts:
// pure in-memory classification, no I/O, so it's unit-testable directly and
// importable from a server action (lib/actions/import-orders.ts) without
// pulling in any Node-only APIs. The DB round-trip (chunked fact_order select)
// lives entirely in the caller; this module only classifies what it's given.
//
// 🔴 Replaces the old updateExistingCount check (staging-table dedup count)
// entirely — that counted rows in analytics.stg_order_import, which is a
// scratch table that can be larger than analytics.fact_order (measured gap:
// staging 6,237 vs fact_order 6,022 — up to 215 orders overcounted). This
// module compares against fact_order directly, the actual source of truth.

import type { StgOrderInsertRow } from "./order-report";

// ============================================================================
// Contract (task brief)
// ============================================================================

export interface RevenueMismatch {
  sourceOrderNo: string;
  oldRevenue: number;
  newRevenue: number;
  profitStatus: "actual" | "estimated";
}

export interface OrderImportDiff {
  newOrderCount: number;
  /** Σ revenue ของแถวใหม่ (บวกเลขจากไฟล์ตรงๆ — ไม่มีสูตรเงินใหม่ในนี้). */
  newRevenueTotal: number;
  overwriteSameCount: number;
  /** True count — never truncated by the mismatches[] cap below. */
  mismatchCount: number;
  /** Capped at DIFF_MISMATCH_CAP entries. */
  mismatches: RevenueMismatch[];
  mismatchListCapped: boolean;
  /** Orders whose order_date differs between file and DB — counted
   * separately from mismatchCount on purpose (task brief: order_date drift
   * moves revenue silently between months, which is a different kind of
   * risk than a wrong amount on the same day — must never be folded into the
   * revenue-mismatch bucket). Never negative, never overlaps mismatchCount:
   * an order can land in BOTH mismatchCount and dateMismatchCount (revenue
   * AND date both changed) — the two counters are independent, not
   * mutually exclusive buckets of the same total. */
  dateMismatchCount: number;
}

/** Distinct orders beyond this, the caller must skip diffing entirely and
 * return `diff: null` (task brief: DIFF_ORDER_CAP). Re-exported here so the
 * cap lives next to the logic it protects, not duplicated in the action. */
export const DIFF_ORDER_CAP = 5000;

/** mismatches[] is capped at this many entries — mismatchCount/dateMismatchCount
 * always carry the true totals regardless. */
export const DIFF_MISMATCH_CAP = 50;

/** Caller-supplied snapshot of one matching analytics.fact_order row —
 * exactly the 3 columns the task brief's SQL selects (source_order_no,
 * revenue, profit_status, order_date), keyed by source_order_no by the
 * caller before calling buildOrderImportDiff. */
export interface ExistingFactOrderForDiff {
  /** fact_order.revenue is NOT NULL in the schema (0010) — typed nullable
   * here only as defense-in-depth against an unexpected null slipping
   * through a future schema change; treated as 0 if it ever does. */
  revenue: number | null;
  /** Raw analytics.profit_status_t value ('missing' | 'estimated' | 'actual').
   * In practice this is always 'estimated' or 'actual' for a row that made it
   * into fact_order (both transform procs always set one of those on
   * insert — 'missing' is only ever the column DEFAULT, never written by any
   * transform path) — 'missing' is handled defensively below by falling back
   * to 'estimated' rather than crashing or lying about which one it saw. */
  profitStatus: string;
  /** fact_order.order_date as returned by PostgREST — a plain date string
   * "YYYY-MM-DD". NOT NULL in the schema; typed nullable here for the same
   * defense-in-depth reason as revenue above. */
  orderDate: string | null;
}

// ============================================================================
// Money comparison — integer cents only, never float. See
// .claude/skills/3j-migration-traps and oem-quote-invariants: comparing
// money as float lets rounding noise (e.g. 500.00 vs 500.00000000000006)
// either falsely flag a match as a mismatch or, worse, hide a real 1-satang
// difference the owner explicitly needs to see.
// ============================================================================

function toCents(revenue: number | null): number {
  // `?? 0` mirrors transform_pending_orders' `coalesce(v_row.revenue, 0)`
  // EXACTLY (0013_analytics_transform.sql:244) — a blank revenue cell in the
  // file must compare as equal to a DB row whose revenue is legitimately 0,
  // not show up as a false mismatch (task brief: "revenue ว่างในไฟล์ +
  // fact_order = 0 → overwrite_same ไม่ใช่ mismatch").
  return Math.round((revenue ?? 0) * 100);
}

/**
 * Derives the DATE analytics.transform_pending_orders would have written to
 * fact_order.order_date for a given parsed row, so the comparison here
 * matches what's actually in the DB rather than the Thai wall-clock date the
 * file "obviously" means.
 *
 * Why this isn't just `orderCreatedAtIso.slice(0, 10)`: the transform proc
 * does `v_order_date := v_row.order_created_at::date`, an unqualified
 * timestamptz->date cast that resolves under the DATABASE SESSION's
 * TimeZone setting — this project's Postgres session timezone is UTC (no
 * migration in this repo sets it otherwise; every OTHER "today"/date
 * derivation in supabase/migrations explicitly does
 * `(now() at time zone 'Asia/Bangkok')::date` specifically BECAUSE the bare
 * cast is UTC — see .claude/skills/3j-migration-traps #6). order_created_at
 * is stored as an ISO string with an explicit "+07:00" offset
 * (lib/import/order-report.ts parseThaiDateText), so for any order placed
 * 00:00–06:59 Thai time, the UTC calendar date is the PREVIOUS day — this
 * function reproduces that exact shift by reading UTC getters off a parsed
 * Date, instead of naively slicing the local (+07:00) date out of the ISO
 * string.
 *
 * ⚠️ FLAGGED ASSUMPTION (no DB access from this environment to confirm
 * directly): this assumes the Supabase project's session TimeZone is the
 * Postgres default 'UTC'. If that's ever wrong, dateMismatchCount would carry
 * a systematic false-positive/negative rate limited to orders placed
 * 00:00–06:59 Thai time — worth a `SHOW timezone;` check before trusting this
 * counter at the boundary hour. Everything else in this module (revenue
 * comparison) is unaffected either way.
 */
export function deriveDbOrderDate(orderCreatedAtIso: string | null): string | null {
  if (orderCreatedAtIso === null) return null;
  const d = new Date(orderCreatedAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Classifies every distinct order in `rows` (deduped by source_order_no,
 * LAST row wins — matches the staging UPSERT semantics in
 * commitOrderImport, so preview and commit agree on which row's numbers
 * "win" for a duplicated order number within one file) against
 * `existingByOrderNo` (a snapshot of matching analytics.fact_order rows,
 * fetched by the caller).
 *
 * Invariant the caller should test: newOrderCount + overwriteSameCount +
 * mismatchCount === (distinct non-null source_order_no in `rows`).
 */
export function buildOrderImportDiff(
  rows: StgOrderInsertRow[],
  existingByOrderNo: Map<string, ExistingFactOrderForDiff>
): OrderImportDiff {
  // De-dup by source_order_no, last row wins.
  const lastRowByOrderNo = new Map<string, StgOrderInsertRow>();
  for (const row of rows) {
    if (row.source_order_no === null) continue; // defensive — caller already filters these out upstream
    lastRowByOrderNo.set(row.source_order_no, row);
  }

  let newOrderCount = 0;
  let newRevenueTotalCents = 0; // integer cents throughout, converted back to money only at the end
  let overwriteSameCount = 0;
  let mismatchCount = 0;
  let dateMismatchCount = 0;
  const mismatches: RevenueMismatch[] = [];

  for (const [sourceOrderNo, row] of lastRowByOrderNo) {
    const existing = existingByOrderNo.get(sourceOrderNo);

    if (!existing) {
      newOrderCount += 1;
      newRevenueTotalCents += toCents(row.revenue);
      continue; // no DB row to compare order_date against either
    }

    const fileCents = toCents(row.revenue);
    const dbCents = toCents(existing.revenue);
    if (fileCents === dbCents) {
      overwriteSameCount += 1;
    } else {
      mismatchCount += 1;
      if (mismatches.length < DIFF_MISMATCH_CAP) {
        mismatches.push({
          sourceOrderNo,
          oldRevenue: existing.revenue ?? 0,
          newRevenue: row.revenue ?? 0,
          profitStatus: existing.profitStatus === "actual" ? "actual" : "estimated",
        });
      }
    }

    const fileOrderDate = deriveDbOrderDate(row.order_created_at);
    if (fileOrderDate !== null && existing.orderDate !== null && fileOrderDate !== existing.orderDate) {
      dateMismatchCount += 1;
    }
  }

  return {
    newOrderCount,
    newRevenueTotal: newRevenueTotalCents / 100,
    overwriteSameCount,
    mismatchCount,
    mismatches,
    mismatchListCapped: mismatches.length < mismatchCount,
    dateMismatchCount,
  };
}
