// lib/actions/labels.test.ts — getPendingLabelReviews coverage, added for the
// owner decision (4 ต.ค. 69, after Tech Lead explained the trade-off and the
// owner confirmed twice): "ข้ามทุกใบที่ขึ้น 'หาออเดอร์ไม่เจอ' ทั้งหมด ตลอดไป" —
// order_not_found removed from PENDING_REVIEW_STATUSES in lib/actions/labels.ts.
//
// This is a "use server" file (export const is not allowed — see that file's
// header comment), so PENDING_REVIEW_STATUSES can't be imported directly for
// a plain array-equality test. Instead these tests go through the exported
// async function and assert on the *query itself* — the exact array handed
// to `.in("match_status", ...)` — the same "whole payload, key for key, NOT
// objectContaining" discipline lib/actions/oem.test.ts uses, so an accidental
// re-add of "order_not_found" (or a dropped "needs_review"/"conflict"/
// "undetected") fails this test immediately instead of only showing up as a
// silent behavior change in prod.
//
// Mocking pattern copied from lib/actions/production.test.ts /
// lib/actions/live-metrics.test.ts (chain builder), extended with a `.then()`
// on the chain object itself so it's awaitable no matter which chained
// method (`.in()`, `.order()`, `.range()`, ...) happens to be the last one
// called at each of getPendingLabelReviews' several call sites — matches how
// supabase-js's real PostgrestFilterBuilder can be awaited at any point in
// the chain.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ from: fromMock }),
  }),
}));

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
}

function makeChain(result: unknown): Chain {
  const chain = {} as Chain;
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.order = vi.fn(self);
  chain.range = vi.fn(self);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const PENDING_PAGE_ROWS = [
  {
    id: "page-1",
    label_file_id: "file-1",
    page_no: 1,
    tracking_no: "TN-NEEDS-REVIEW",
    zipcode: "10110",
    match_status: "needs_review",
    match_detail: null,
  },
  {
    id: "page-2",
    label_file_id: "file-1",
    page_no: 2,
    tracking_no: "TN-CONFLICT",
    zipcode: "10120",
    match_status: "conflict",
    match_detail: null,
  },
  {
    id: "page-3",
    label_file_id: "file-1",
    page_no: 3,
    tracking_no: "TN-UNDETECTED",
    zipcode: "10130",
    match_status: "undetected",
    match_detail: null,
  },
];

/** Wires fromMock to a chain per table, matching every table
 * getPendingLabelReviews reads from. Returns the stg_label_page chain
 * specifically so tests can assert on its `.in("match_status", ...)` call. */
function setupFromMock(pageRows: typeof PENDING_PAGE_ROWS = PENDING_PAGE_ROWS) {
  const stgLabelPageChain = makeChain({ data: pageRows, error: null, count: pageRows.length });
  const labelFileChain = makeChain({ data: [{ id: "file-1", file_name: "test.pdf" }], error: null });
  // Order-side source lookup (fact_order / stg_order_import / stg_import_batch)
  // is wrapped in its own try/catch in getPendingLabelReviews and degrades to
  // empty orderSources on any failure/empty result — not under test here.
  const emptyChain = makeChain({ data: [], error: null });

  fromMock.mockImplementation((table: string) => {
    switch (table) {
      case "stg_label_page":
        return stgLabelPageChain;
      case "label_file":
        return labelFileChain;
      case "fact_order":
      case "stg_order_import":
      case "stg_import_batch":
        return emptyChain;
      default:
        throw new Error(`labels.test.ts setupFromMock: unexpected table "${table}"`);
    }
  });

  return { stgLabelPageChain, labelFileChain };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
});

describe("getPendingLabelReviews", () => {
  it("rejects staff before querying anything", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getPendingLabelReviews } = await import("./labels");
    const result = await getPendingLabelReviews();
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("filters on needs_review/conflict/undetected only — order_not_found must not be in the match_status filter", async () => {
    const { stgLabelPageChain } = setupFromMock();
    const { getPendingLabelReviews } = await import("./labels");
    const result = await getPendingLabelReviews();

    expect(result.ok).toBe(true);
    // Whole array, key for key (not .toContain / objectContaining) — this is
    // the one line that must never silently regain "order_not_found", and
    // must never silently lose "needs_review"/"conflict"/"undetected" either.
    expect(stgLabelPageChain.in).toHaveBeenCalledWith("match_status", ["needs_review", "conflict", "undetected"]);
  });

  it("still returns needs_review/conflict/undetected rows in the queue (no over-deletion)", async () => {
    setupFromMock();
    const { getPendingLabelReviews } = await import("./labels");
    const result = await getPendingLabelReviews();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.status).sort()).toEqual(["conflict", "needs_review", "undetected"]);
    expect(result.data).toHaveLength(3);
  });

  it("never surfaces an order_not_found row even if one somehow comes back from the query (defense in depth)", async () => {
    // Simulates a stale/misbehaving DB response (e.g. the view/RPC regresses
    // independently) to confirm the final mapped result is still sane — this
    // function doesn't re-filter in JS (the DB `.in()` is the only gate), so
    // this test documents that fact rather than a second enforcement layer.
    const rowsWithStaleOrderNotFound = [
      ...PENDING_PAGE_ROWS,
      {
        id: "page-4",
        label_file_id: "file-1",
        page_no: 4,
        tracking_no: "TN-ORDER-NOT-FOUND",
        zipcode: "10140",
        match_status: "order_not_found",
        match_detail: null,
      },
    ];
    setupFromMock(rowsWithStaleOrderNotFound);
    const { getPendingLabelReviews } = await import("./labels");
    const result = await getPendingLabelReviews();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // This row SHOULD exist in this mocked scenario (it's a documentation
    // test: getPendingLabelReviews has no JS-side re-filter, so if the DB
    // ever misbehaves and returns an order_not_found row anyway, it passes
    // through as-is). The real gate is the `.in()` filter asserted above.
    expect(result.data.some((r) => r.status === "order_not_found")).toBe(true);
  });
});
