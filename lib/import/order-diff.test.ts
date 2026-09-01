// lib/import/order-diff.test.ts
//
// Unit tests for buildOrderImportDiff (lib/import/order-diff.ts, Feature A
// "diff ก่อน commit"). Pure in-memory tests — no disk I/O, no DB — same style
// as lib/import/sku-hygiene.test.ts.
//
// NOT covered here (documented gap, see final delivery report): the
// action-layer early exits in lib/actions/import-orders.ts::previewOrderImport
// — `diff: null` when shapeIssues.length > 0, and `diff: null` when distinct
// orders > DIFF_ORDER_CAP before ever touching the DB. Both are single-line
// guard clauses verified by code review; exercising them end-to-end would
// require mocking the Supabase client (no precedent for that in this repo's
// lib/actions/*.ts today), which is out of scope for this pass.

import { describe, expect, it } from "vitest";
import {
  buildOrderImportDiff,
  deriveDbOrderDate,
  DIFF_MISMATCH_CAP,
  type ExistingFactOrderForDiff,
} from "./order-diff";
import type { StgOrderInsertRow } from "./order-report";

function makeRow(overrides: Partial<StgOrderInsertRow> & { source_order_no: string }): StgOrderInsertRow {
  return {
    source_row_no: 1,
    raw: {},
    source_kind: "excel",
    marketplace_order_id: null,
    channel_raw: "Tiktok",
    customer_name_raw: "ลูกค้าทดสอบ",
    contact_display_name_raw: null,
    phone_raw: null,
    province_raw: null,
    carrier_raw: null,
    tracking_no: null,
    shipping_fee_customer: null,
    shipping_cost_shop: null,
    revenue: 500,
    discount_total: null,
    discount_code: null,
    item_count_total: 1,
    profit_raw: null,
    // Thai noon (+07:00) by default — nowhere near the UTC-day boundary, so
    // tests that don't care about dateMismatchCount can ignore it entirely.
    order_created_at: "2026-08-15T12:00:00+07:00",
    paid_at: null,
    printed_at: null,
    created_by_raw: null,
    note_raw: null,
    bank_raw: null,
    tags_raw: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingFactOrderForDiff> = {}): ExistingFactOrderForDiff {
  return {
    revenue: 500,
    profitStatus: "estimated",
    orderDate: "2026-08-15",
    ...overrides,
  };
}

// ============================================================================
// "A ต้องจับได้" — must catch
// ============================================================================

describe("buildOrderImportDiff — must catch", () => {
  it("revenue changed (500.00 -> 450.00) is a mismatch with correct old/new", () => {
    const rows = [makeRow({ source_order_no: "E100", revenue: 450 })];
    const map = new Map([["E100", existing({ revenue: 500, profitStatus: "actual" })]]);
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.mismatchCount).toBe(1);
    expect(diff.overwriteSameCount).toBe(0);
    expect(diff.newOrderCount).toBe(0);
    expect(diff.mismatches).toEqual([
      { sourceOrderNo: "E100", oldRevenue: 500, newRevenue: 450, profitStatus: "actual" },
    ]);
  });

  it("1-satang difference (500.00 vs 500.01) is still a mismatch — integer-cents compare, not float", () => {
    const rows = [makeRow({ source_order_no: "E101", revenue: 500.01 })];
    const map = new Map([["E101", existing({ revenue: 500.0 })]]);
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.mismatchCount).toBe(1);
    expect(diff.mismatches[0]).toEqual({
      sourceOrderNo: "E101",
      oldRevenue: 500.0,
      newRevenue: 500.01,
      profitStatus: "estimated",
    });
  });

  it("60 mismatches: returns 50 capped, mismatchListCapped=true, true mismatchCount=60", () => {
    const rows: StgOrderInsertRow[] = [];
    const map = new Map<string, ExistingFactOrderForDiff>();
    for (let i = 0; i < 60; i++) {
      const orderNo = `E${200 + i}`;
      rows.push(makeRow({ source_order_no: orderNo, revenue: 100 }));
      map.set(orderNo, existing({ revenue: 200 })); // every one is a mismatch
    }
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.mismatchCount).toBe(60);
    expect(diff.mismatches).toHaveLength(DIFF_MISMATCH_CAP);
    expect(diff.mismatches).toHaveLength(50);
    expect(diff.mismatchListCapped).toBe(true);
  });

  it("order_date differs -> dateMismatchCount rises but mismatchCount does NOT (separate buckets)", () => {
    const rows = [
      makeRow({ source_order_no: "E300", revenue: 500, order_created_at: "2026-08-16T12:00:00+07:00" }),
    ];
    const map = new Map([["E300", existing({ revenue: 500, orderDate: "2026-08-15" })]]);
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.dateMismatchCount).toBe(1);
    expect(diff.mismatchCount).toBe(0); // revenue matched — date drift alone must not count as a revenue mismatch
    expect(diff.overwriteSameCount).toBe(1);
  });

  it("both revenue AND order_date differ -> counted in BOTH buckets (independent, not exclusive)", () => {
    const rows = [
      makeRow({ source_order_no: "E301", revenue: 450, order_created_at: "2026-08-16T12:00:00+07:00" }),
    ];
    const map = new Map([["E301", existing({ revenue: 500, orderDate: "2026-08-15" })]]);
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.mismatchCount).toBe(1);
    expect(diff.dateMismatchCount).toBe(1);
  });
});

// ============================================================================
// "A ต้องไม่พัง" — must not break
// ============================================================================

describe("buildOrderImportDiff — must not break", () => {
  it("all-new-month file: everything is new, newRevenueTotal sums the file exactly", () => {
    const rows = [
      makeRow({ source_order_no: "E400", revenue: 100.5 }),
      makeRow({ source_order_no: "E401", revenue: 200.25 }),
      makeRow({ source_order_no: "E402", revenue: 300.25 }),
    ];
    const diff = buildOrderImportDiff(rows, new Map());

    expect(diff.newOrderCount).toBe(3);
    expect(diff.overwriteSameCount).toBe(0);
    expect(diff.mismatchCount).toBe(0);
    expect(diff.newRevenueTotal).toBe(601);
  });

  it("blank revenue in file + fact_order revenue=0 -> overwrite_same, not mismatch", () => {
    const rows = [makeRow({ source_order_no: "E500", revenue: null })];
    const map = new Map([["E500", existing({ revenue: 0 })]]);
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.overwriteSameCount).toBe(1);
    expect(diff.mismatchCount).toBe(0);
  });

  it("duplicate order number within the file: last row wins (200 then 300, DB=300 -> overwrite_same)", () => {
    const rows = [
      makeRow({ source_order_no: "E600", revenue: 200, source_row_no: 1 }),
      makeRow({ source_order_no: "E600", revenue: 300, source_row_no: 2 }),
    ];
    const map = new Map([["E600", existing({ revenue: 300 })]]);
    const diff = buildOrderImportDiff(rows, map);

    expect(diff.overwriteSameCount).toBe(1);
    expect(diff.mismatchCount).toBe(0);
    expect(diff.newOrderCount).toBe(0);
    // 3-bucket sum must equal distinct order count in the file (1 distinct order, not 2 rows).
    expect(diff.newOrderCount + diff.overwriteSameCount + diff.mismatchCount).toBe(1);
  });

  it("invariant: newOrderCount + overwriteSameCount + mismatchCount === distinct orders in file", () => {
    const rows = [
      makeRow({ source_order_no: "E700", revenue: 100 }), // new
      makeRow({ source_order_no: "E701", revenue: 200 }), // overwrite_same
      makeRow({ source_order_no: "E702", revenue: 250 }), // mismatch (DB=200)
      makeRow({ source_order_no: "E702", revenue: 260 }), // dup, last wins, still mismatch (DB=200)
      makeRow({ source_order_no: "E703", revenue: 300 }), // overwrite_same, dup source_order_no
      makeRow({ source_order_no: "E703", revenue: 300 }),
    ];
    const map = new Map([
      ["E701", existing({ revenue: 200 })],
      ["E702", existing({ revenue: 200 })],
      ["E703", existing({ revenue: 300 })],
    ]);
    const diff = buildOrderImportDiff(rows, map);

    const distinctOrders = new Set(rows.map((r) => r.source_order_no)).size;
    expect(distinctOrders).toBe(4); // E700, E701, E702, E703
    expect(diff.newOrderCount + diff.overwriteSameCount + diff.mismatchCount).toBe(distinctOrders);
    expect(diff.newOrderCount).toBe(1);
    expect(diff.overwriteSameCount).toBe(2);
    expect(diff.mismatchCount).toBe(1);
  });

  it("rows with source_order_no=null are ignored (defensive — caller should already filter these)", () => {
    const rows = [
      makeRow({ source_order_no: "E800", revenue: 100 }),
      { ...makeRow({ source_order_no: "E999", revenue: 999 }), source_order_no: null },
    ];
    const diff = buildOrderImportDiff(rows, new Map());
    expect(diff.newOrderCount).toBe(1);
  });

  it("empty input never throws and returns an all-zero diff", () => {
    const diff = buildOrderImportDiff([], new Map());
    expect(diff).toEqual({
      newOrderCount: 0,
      newRevenueTotal: 0,
      overwriteSameCount: 0,
      mismatchCount: 0,
      mismatches: [],
      mismatchListCapped: false,
      dateMismatchCount: 0,
    });
  });

  it("fact_order.profit_status='missing' (unexpected/defensive) falls back to 'estimated', never crashes", () => {
    const rows = [makeRow({ source_order_no: "E900", revenue: 999 })];
    const map = new Map([["E900", existing({ revenue: 500, profitStatus: "missing" })]]);
    const diff = buildOrderImportDiff(rows, map);
    expect(diff.mismatches[0].profitStatus).toBe("estimated");
  });
});

// ============================================================================
// deriveDbOrderDate — UTC-cast mirror of transform_pending_orders'
// `order_created_at::date` (see the function's own doc comment for why).
// ============================================================================

describe("deriveDbOrderDate", () => {
  it("Thai daytime stays the same calendar date under a UTC cast", () => {
    expect(deriveDbOrderDate("2026-08-15T12:00:00+07:00")).toBe("2026-08-15");
  });

  it("Thai early-morning (00:00-06:59) shifts BACK a day under a UTC cast", () => {
    // 02:00 Thai = 19:00 UTC the PREVIOUS day.
    expect(deriveDbOrderDate("2026-08-15T02:00:00+07:00")).toBe("2026-08-14");
  });

  it("exactly 07:00 Thai (the boundary) stays same-day", () => {
    // 07:00 Thai = 00:00 UTC same day.
    expect(deriveDbOrderDate("2026-08-15T07:00:00+07:00")).toBe("2026-08-15");
  });

  it("null in, null out", () => {
    expect(deriveDbOrderDate(null)).toBeNull();
  });
});
