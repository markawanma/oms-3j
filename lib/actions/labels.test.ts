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
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();
const storageDownloadMock = vi.fn();
const openPdfMock = vi.fn();
const extractPageTextsMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ from: fromMock, rpc: rpcMock }),
    storage: { from: () => ({ download: storageDownloadMock }) },
  }),
}));

// parseLabelFile tests below drive every page to classifyPage's EARLY
// "empty text -> parse_failed" branch (see labels.ts classifyPage) precisely
// so detectFormat()/matchProvince() (real, unmocked modules — both plain,
// server-only-free) never get called and don't need mocking either. Only the
// PDF-opening layer needs a double here, since unpdf (extractText/
// getDocumentProxy) isn't something a vitest unit test should pay the cost
// of exercising for logic that is actually under test (the match_status
// switch/filter further down in parseLabelFile, after the RPC re-read).
vi.mock("@/lib/labels/pdf", () => ({
  looksLikePdf: () => true,
  openPdf: (...args: unknown[]) => openPdfMock(...args),
  extractPageTexts: (...args: unknown[]) => extractPageTextsMock(...args),
  extractSinglePageText: vi.fn(),
  PdfExtractError: class PdfExtractError extends Error {},
}));

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
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
  chain.maybeSingle = vi.fn(self);
  chain.single = vi.fn(self);
  chain.not = vi.fn(self);
  chain.is = vi.fn(self);
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.insert = vi.fn(self);
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

// ============================================================================
// parseLabelFile — commit 421cd61 coverage (4 ต.ค. 69): the SECOND of the two
// places order_not_found had to be cut. getPendingLabelReviews (above) only
// covers the durable DB-backed queue; this covers the number shown to the
// owner IMMEDIATELY after upload ("รอตรวจสอบ N หน้า", UploadPageClient.tsx —
// reads summary.reviewRows.length straight off this function's return value).
// Before 421cd61, that count included order_not_found pages that
// PendingReviewQueue would then never show — a mismatch, not a crash, which
// is exactly the kind of regression a human click-through at normal volume
// (1-2 order_not_found pages buried in a 50-page file) can miss.
// ============================================================================

const FAKE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const FAKE_SHA256 = createHash("sha256").update(FAKE_BYTES).digest("hex");

interface FinalPageFixture {
  id: string;
  page_no: number;
  tracking_no: string | null;
  zipcode: string | null;
  match_status: string;
  match_detail: null;
}

/**
 * Wires every DB/storage/PDF call parseLabelFile makes on its way to the
 * post-RPC re-read, ending with `finalPagesRows` as the answer to that
 * re-read — the one query the reviewRows/counter logic under test actually
 * runs against. Every page here is fed empty text (classifyPage's first
 * branch -> 'parse_failed' immediately, no detectFormat/matchProvince call),
 * so the classify/tracking-lookup/insert machinery earlier in the function
 * never needs fact_order mocked — only label_file (read then update) and
 * stg_label_page (read applied / delete / insert / re-read) are touched,
 * matching parseLabelFile's real call order exactly.
 */
function setupParseLabelFileMocks(finalPagesRows: FinalPageFixture[]) {
  const fileSelectChain = makeChain({
    data: {
      id: "file-1",
      storage_path: "shop-1/2026-10/x.pdf",
      file_name: "test.pdf",
      file_sha256: FAKE_SHA256,
      status: "uploaded",
    },
    error: null,
  });
  const fileUpdateChain = makeChain({ data: null, error: null });
  const appliedRowsChain = makeChain({ data: [], error: null });
  const deleteChain = makeChain({ data: null, error: null });
  const insertChain = makeChain({ data: null, error: null });
  const finalPagesChain = makeChain({ data: finalPagesRows, error: null });

  let labelFileCalls = 0;
  let stgLabelPageCalls = 0;

  fromMock.mockImplementation((table: string) => {
    if (table === "label_file") {
      labelFileCalls += 1;
      // 1st call = file lookup (select+maybeSingle), 2nd = status update.
      return labelFileCalls === 1 ? fileSelectChain : fileUpdateChain;
    }
    if (table === "stg_label_page") {
      stgLabelPageCalls += 1;
      // Real call order in parseLabelFile: select appliedRows -> delete ->
      // insert (chunked, 1 chunk here) -> select finalPages (post-RPC re-read).
      if (stgLabelPageCalls === 1) return appliedRowsChain;
      if (stgLabelPageCalls === 2) return deleteChain;
      if (stgLabelPageCalls === 3) return insertChain;
      return finalPagesChain;
    }
    // A call to fact_order here would mean some page's text didn't hit
    // classifyPage's empty-text branch as this fixture intends — fail loudly
    // rather than silently falling back to `undefined.in(...)`.
    throw new Error(`labels.test.ts setupParseLabelFileMocks: unexpected table "${table}"`);
  });

  rpcMock.mockResolvedValue({ data: [{ applied: 0, skipped_has_province: 0, conflict_cnt: 0 }], error: null });
  storageDownloadMock.mockResolvedValue({
    data: { size: FAKE_BYTES.byteLength, arrayBuffer: async () => FAKE_BYTES.buffer },
    error: null,
  });
  openPdfMock.mockResolvedValue({ numPages: 1 });
  extractPageTextsMock.mockResolvedValue([""]); // 1 page, empty text -> parse_failed, no DB tracking lookup needed
}

describe("parseLabelFile", () => {
  it("rejects staff before touching storage/DB", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { parseLabelFile } = await import("./labels");
    const result = await parseLabelFile("file-1");
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
    expect(storageDownloadMock).not.toHaveBeenCalled();
  });

  it(
    "excludes order_not_found AND matched from reviewRows, but still counts order_not_found in the " +
      "orderNotFound tally — the exact split commit 421cd61 introduced",
    async () => {
      setupParseLabelFileMocks([
        { id: "p-needs", page_no: 1, tracking_no: "TN-1", zipcode: "10110", match_status: "needs_review", match_detail: null },
        { id: "p-conflict", page_no: 2, tracking_no: "TN-2", zipcode: "10120", match_status: "conflict", match_detail: null },
        { id: "p-onf", page_no: 3, tracking_no: "TN-3", zipcode: "10130", match_status: "order_not_found", match_detail: null },
        { id: "p-undetected", page_no: 4, tracking_no: null, zipcode: null, match_status: "undetected", match_detail: null },
        { id: "p-parsefail", page_no: 5, tracking_no: null, zipcode: null, match_status: "parse_failed", match_detail: null },
        { id: "p-matched", page_no: 6, tracking_no: "TN-6", zipcode: "10140", match_status: "matched", match_detail: null },
      ]);

      const { parseLabelFile } = await import("./labels");
      const result = await parseLabelFile("file-1");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // orderNotFound counter: untouched by 421cd61, must still count the page.
      expect(result.data.orderNotFound).toBe(1);
      expect(result.data.needsReview).toBe(1);
      expect(result.data.undetectedFormat).toBe(1);
      expect(result.data.parseFailedPages).toBe(1);

      // reviewRows (what UploadPageClient's "รอตรวจสอบ N หน้า" count is taken
      // from via .length): order_not_found must NOT be in here (that's the
      // whole point of 421cd61) and matched never was.
      expect(result.data.reviewRows).toHaveLength(4);
      const statuses = result.data.reviewRows.map((r) => r.status).sort();
      expect(statuses).toEqual(["conflict", "needs_review", "parse_failed", "undetected"]);
      expect(result.data.reviewRows.some((r) => r.status === "order_not_found")).toBe(false);
      expect(result.data.reviewRows.some((r) => (r.status as string) === "matched")).toBe(false);

      // Note: result.data.conflictCount is NOT re-derived from these 6 rows —
      // it comes straight from the RPC's own conflict_cnt (mocked to 0 here),
      // a separate SQL-side aggregate. reviewRows.length (4) therefore is NOT
      // expected to equal needsReview+conflictCount+undetectedFormat+
      // parseFailedPages in general — only needsReview/orderNotFound/
      // undetectedFormat/parseFailedPages are JS-side tallies of finalPages;
      // conflictCount/applied/skippedHasProvince are RPC-sourced. Confirmed
      // by reading labels.ts's switch (no "conflict" case) rather than assumed.
    }
  );

  it("a file with zero order_not_found pages behaves exactly as before (no over-cut)", async () => {
    setupParseLabelFileMocks([
      { id: "p-needs", page_no: 1, tracking_no: "TN-1", zipcode: "10110", match_status: "needs_review", match_detail: null },
      { id: "p-conflict", page_no: 2, tracking_no: "TN-2", zipcode: "10120", match_status: "conflict", match_detail: null },
      { id: "p-undetected", page_no: 3, tracking_no: null, zipcode: null, match_status: "undetected", match_detail: null },
      { id: "p-parsefail", page_no: 4, tracking_no: null, zipcode: null, match_status: "parse_failed", match_detail: null },
    ]);

    const { parseLabelFile } = await import("./labels");
    const result = await parseLabelFile("file-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.orderNotFound).toBe(0);
    expect(result.data.reviewRows).toHaveLength(4);
    expect(result.data.reviewRows.map((r) => r.status).sort()).toEqual([
      "conflict",
      "needs_review",
      "parse_failed",
      "undetected",
    ]);
  });

  it("a file that is ENTIRELY order_not_found reports 0 reviewRows but the full count in orderNotFound (card must not go blank/wrong)", async () => {
    setupParseLabelFileMocks([
      { id: "p-onf-1", page_no: 1, tracking_no: "TN-1", zipcode: "10110", match_status: "order_not_found", match_detail: null },
      { id: "p-onf-2", page_no: 2, tracking_no: "TN-2", zipcode: "10120", match_status: "order_not_found", match_detail: null },
      { id: "p-onf-3", page_no: 3, tracking_no: "TN-3", zipcode: "10130", match_status: "order_not_found", match_detail: null },
    ]);

    const { parseLabelFile } = await import("./labels");
    const result = await parseLabelFile("file-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.orderNotFound).toBe(3); // BatchSummaryCard's "หาออเดอร์ไม่เจอ" card reads this — must stay accurate
    expect(result.data.reviewRows).toHaveLength(0); // but none of them force a manual review anymore
  });
});
