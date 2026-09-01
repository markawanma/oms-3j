// lib/import/orphan-backlog.ts — pure grouping/aging/capping logic for
// Feature B (task brief "แยก orphan ตามอายุ"). Takes a flat list of orphan
// staging rows (one entry per analytics.stg_order_line_import row with
// import_status='orphan') and groups them by source_order_no, ages each
// group by its EARLIEST batch import time, then splits into
// waiting/no_source and caps the combined list.
//
// No I/O here — the DB read (and the read-only guarantee: this whole feature
// must never write to staging) lives entirely in
// lib/actions/import-line-items.ts::getOrphanBacklog. This module is
// unit-testable in isolation, same split as lib/import/order-diff.ts
// (pure classification) vs lib/actions/import-orders.ts (DB glue).

export interface OrphanRowInput {
  sourceOrderNo: string;
  /** ISO timestamp of the stg_import_batch that brought this specific row
   * in (analytics.stg_import_batch.imported_at via FK embed). */
  importedAt: string;
}

export interface OrphanOrderGroup {
  sourceOrderNo: string;
  lineCount: number;
  /** Earliest importedAt among this order's orphan rows. */
  oldestImportedAt: string;
  ageDays: number;
  /** < waitDays old = "waiting" · >= waitDays = "no_source" (inclusive on
   * the no_source side — exactly waitDays days old lands in no_source). */
  status: "waiting" | "no_source";
}

export interface OrphanGroupResult {
  waiting: OrphanOrderGroup[];
  noSource: OrphanOrderGroup[];
  /** True distinct-order count — never truncated by groupCap. */
  totalOrderCount: number;
  /** true when (waiting.length + noSource.length) was capped at groupCap
   * (combined, not per-bucket). When capped, the oldest (most urgent)
   * groups survive — full set is sorted by ageDays descending before the
   * cut, so cheating either bucket never happens silently. */
  listCapped: boolean;
}

export const ORPHAN_GROUP_CAP = 50;

/**
 * @param rows flat orphan rows (already filtered to import_status='orphan'
 *   for one shop by the caller)
 * @param waitDays ORPHAN_WAIT_DAYS (lib/import/source-types.ts) — passed in
 *   rather than imported, so this module has zero dependencies and stays
 *   trivially unit-testable with any threshold a test wants to exercise.
 * @param nowMs defaults to Date.now() — overridable so tests can pin "now"
 *   instead of racing the clock for boundary-day assertions.
 */
export function classifyOrphanRows(
  rows: OrphanRowInput[],
  waitDays: number,
  nowMs: number = Date.now(),
  groupCap: number = ORPHAN_GROUP_CAP
): OrphanGroupResult {
  const groups = new Map<string, { lineCount: number; oldestImportedAt: string }>();
  for (const row of rows) {
    const existing = groups.get(row.sourceOrderNo);
    if (existing) {
      existing.lineCount += 1;
      if (row.importedAt < existing.oldestImportedAt) existing.oldestImportedAt = row.importedAt;
    } else {
      groups.set(row.sourceOrderNo, { lineCount: 1, oldestImportedAt: row.importedAt });
    }
  }

  const allGroups: OrphanOrderGroup[] = Array.from(groups.entries())
    .map(([sourceOrderNo, g]) => {
      const ageDays = Math.floor((nowMs - new Date(g.oldestImportedAt).getTime()) / 86_400_000);
      return {
        sourceOrderNo,
        lineCount: g.lineCount,
        oldestImportedAt: g.oldestImportedAt,
        ageDays,
        status: (ageDays >= waitDays ? "no_source" : "waiting") as OrphanOrderGroup["status"],
      };
    })
    // Oldest (most urgent) first — determines both display order and which
    // groups survive the combined cap below.
    .sort((a, b) => b.ageDays - a.ageDays);

  const totalOrderCount = allGroups.length;
  const listCapped = allGroups.length > groupCap;
  const capped = listCapped ? allGroups.slice(0, groupCap) : allGroups;

  return {
    waiting: capped.filter((g) => g.status === "waiting"),
    noSource: capped.filter((g) => g.status === "no_source"),
    totalOrderCount,
    listCapped,
  };
}
