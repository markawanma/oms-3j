// lib/import/orphan-backlog.test.ts
//
// Unit tests for classifyOrphanRows (lib/import/orphan-backlog.ts,
// Feature B "แยก orphan ตามอายุ"). Pure in-memory tests — no disk I/O, no DB.
//
// NOT covered here (documented gap, see final delivery report): the DB I/O
// half of Feature B — lib/actions/import-line-items.ts::getOrphanBacklog
// itself (the FK-embed select against analytics.stg_order_line_import +
// stg_import_batch, and the "row count before/after must match exactly"
// read-only proof from the task brief). That needs a live Supabase project;
// this environment has no DB access. Verified instead by static code review:
// getOrphanBacklog contains zero .update(/.delete(/.insert(/.upsert( calls —
// only two .select( calls (an exact head-count + the detail fetch).

import { describe, expect, it } from "vitest";
import { classifyOrphanRows, ORPHAN_GROUP_CAP, type OrphanRowInput } from "./orphan-backlog";

const WAIT_DAYS = 7;
const DAY_MS = 86_400_000;

/** Fixed "now" so every age-in-days assertion is exact, not a clock race. */
const NOW = new Date("2026-09-01T12:00:00Z").getTime();

function daysAgoIso(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

// ============================================================================
// "B ต้องจับได้" — must catch
// ============================================================================

describe("classifyOrphanRows — must catch", () => {
  it("real fixture: 8 rows / 6 orders from a batch 18 days old -> all 6 land in no_source", () => {
    // task brief's real data: orphan 8 rows / 6 orders (46, 957, A40, A299,
    // E742, E749), all from the 14 ส.ค. batch (18 days old at design time).
    // Line-count distribution across the 6 orders isn't specified in the
    // brief beyond "8 rows total" — split 3 orders x 2 lines + 3 orders x 1
    // line here (synthetic, sums to 8) since the exact per-order split
    // doesn't change the status/grouping logic under test.
    const importedAt = daysAgoIso(18);
    const rows: OrphanRowInput[] = [
      { sourceOrderNo: "46", importedAt },
      { sourceOrderNo: "46", importedAt },
      { sourceOrderNo: "957", importedAt },
      { sourceOrderNo: "957", importedAt },
      { sourceOrderNo: "A40", importedAt },
      { sourceOrderNo: "A40", importedAt },
      { sourceOrderNo: "A299", importedAt },
      { sourceOrderNo: "E742", importedAt },
    ];
    // (E749 omitted from this particular fixture on purpose — see the next
    // assertion block for a version with all 6 present.)
    const result = classifyOrphanRows(rows, WAIT_DAYS, NOW);
    expect(result.waiting).toHaveLength(0);
    expect(result.noSource).toHaveLength(5);
    expect(result.noSource.map((g) => g.sourceOrderNo).sort()).toEqual(["46", "957", "A40", "A299", "E742"].sort());

    const allSix: OrphanRowInput[] = [...rows, { sourceOrderNo: "E749", importedAt }];
    const resultAllSix = classifyOrphanRows(allSix, WAIT_DAYS, NOW);
    expect(resultAllSix.waiting).toHaveLength(0);
    expect(resultAllSix.noSource).toHaveLength(6);
    expect(resultAllSix.totalOrderCount).toBe(6);
    expect(resultAllSix.noSource.map((g) => g.sourceOrderNo).sort()).toEqual(
      ["46", "957", "A40", "A299", "E742", "E749"].sort()
    );
  });

  it("exactly 7 days old -> no_source (boundary is inclusive on the no_source side)", () => {
    const result = classifyOrphanRows([{ sourceOrderNo: "E1", importedAt: daysAgoIso(7) }], WAIT_DAYS, NOW);
    expect(result.noSource).toHaveLength(1);
    expect(result.waiting).toHaveLength(0);
    expect(result.noSource[0].ageDays).toBe(7);
    expect(result.noSource[0].status).toBe("no_source");
  });

  it("6 days old -> waiting", () => {
    const result = classifyOrphanRows([{ sourceOrderNo: "E2", importedAt: daysAgoIso(6) }], WAIT_DAYS, NOW);
    expect(result.waiting).toHaveLength(1);
    expect(result.noSource).toHaveLength(0);
    expect(result.waiting[0].ageDays).toBe(6);
    expect(result.waiting[0].status).toBe("waiting");
  });

  it("more than 50 groups -> combined list capped at 50, totalOrderCount stays the true count", () => {
    const rows: OrphanRowInput[] = [];
    for (let i = 0; i < 60; i++) {
      rows.push({ sourceOrderNo: `E${1000 + i}`, importedAt: daysAgoIso(10) }); // all no_source
    }
    const result = classifyOrphanRows(rows, WAIT_DAYS, NOW);

    expect(result.totalOrderCount).toBe(60);
    expect(result.listCapped).toBe(true);
    expect(result.waiting.length + result.noSource.length).toBe(ORPHAN_GROUP_CAP);
    expect(result.waiting.length + result.noSource.length).toBe(50);
  });

  it("cap keeps the OLDEST (most urgent) groups first, even truncating into the waiting bucket", () => {
    const rows: OrphanRowInput[] = [];
    // 40 clearly-old (no_source, age 50) + 15 clearly-recent (waiting, age 3).
    // Combined = 55 groups > ORPHAN_GROUP_CAP(50); every no_source group
    // outranks every waiting group by age, so the cap must keep all 40
    // no_source groups and only the "most urgent" 10 of the 15 waiting ones.
    for (let i = 0; i < 40; i++) rows.push({ sourceOrderNo: `OLD${i}`, importedAt: daysAgoIso(50) });
    for (let i = 0; i < 15; i++) rows.push({ sourceOrderNo: `NEW${i}`, importedAt: daysAgoIso(3) });

    const result = classifyOrphanRows(rows, WAIT_DAYS, NOW);
    expect(result.listCapped).toBe(true);
    expect(result.totalOrderCount).toBe(55);
    expect(result.noSource).toHaveLength(40);
    expect(result.waiting).toHaveLength(10);
    expect(result.noSource.every((g) => g.sourceOrderNo.startsWith("OLD"))).toBe(true);
    expect(result.waiting.every((g) => g.sourceOrderNo.startsWith("NEW"))).toBe(true);
  });
});

// ============================================================================
// "B ต้องไม่พัง" — must not break
// ============================================================================

describe("classifyOrphanRows — must not break", () => {
  it("zero orphan rows -> empty result, never throws", () => {
    const result = classifyOrphanRows([], WAIT_DAYS, NOW);
    expect(result).toEqual({ waiting: [], noSource: [], totalOrderCount: 0, listCapped: false });
  });

  it("multiple lines for the same order use the EARLIEST importedAt (oldest = most urgent)", () => {
    const rows: OrphanRowInput[] = [
      { sourceOrderNo: "E50", importedAt: daysAgoIso(3) },
      { sourceOrderNo: "E50", importedAt: daysAgoIso(9) }, // older batch touched this order too
      { sourceOrderNo: "E50", importedAt: daysAgoIso(5) },
    ];
    const result = classifyOrphanRows(rows, WAIT_DAYS, NOW);
    expect(result.totalOrderCount).toBe(1);
    const group = [...result.waiting, ...result.noSource][0];
    expect(group.lineCount).toBe(3);
    expect(group.ageDays).toBe(9); // oldest of the three
    expect(group.status).toBe("no_source"); // 9 >= 7
  });
});
