// lib/supabase/query-limits.ts — shared row cap + pagination helper for
// lib/actions/*.ts reads that select an unbounded, shop-scoped table/view
// (orders, customers, quotes, receipts, catalog, ...) with no natural
// per-request bound.
//
// WHY THIS EXISTS (real incident, 2026-08-27): PostgREST silently caps any
// `.select()` at its configured max-rows (1000 on this Supabase project)
// even when the query has no explicit `.limit()`/`.range()` — no error, no
// warning, just fewer rows than actually exist. lib/actions/crm.ts
// getCrmOrders hit this exactly: /crm/orders reported "1,000 ออเดอร์ ·
// ฿486,459" for a 13–27 ส.ค. window that actually had 1,003 orders and
// ฿495,882.22 — ฿9,423 of real revenue silently missing from the owner's
// screen. lib/actions/import-line-items.ts's getLineImportWarnings hit the
// same cap earlier (its own header comment references the even older
// getCrmCustomerDimensions incident: ~3k customers under-counted to ~333).
//
// ⚠️ CORRECTION (2026-08-27, same day): the first version of this file
// claimed `.range()` alone "reliably returns more than 1000 rows on this
// project" — THAT WAS WRONG, verified wrong by direct testing against
// PostgREST with a service key:
//
//   Range: 0-999    -> Content-Range: 0-999/1003
//   Range: 0-1999   -> Content-Range: 0-999/1003   (NOT 0-1999/1003)
//   Range: 0-19999  -> Content-Range: 0-999/1003   (NOT 0-19999/1003)
//
// max-rows is a SERVER-SIDE ceiling, not a client request size. `.range(a, b)`
// only ever controls the START offset `a` — asking for a wider window than
// max-rows (`b - a + 1 > max-rows`) does NOT get you more rows per call, it
// just gets silently clamped back down to max-rows rows starting at `a`. The
// only way to get more than max-rows total is to PAGE: call `.range()`
// repeatedly with successive offsets and concatenate the results. There is
// no way to get PostgREST to hand back more than one page's worth of rows in
// a single response, ever, on this project.
//
// THE FIX, applied consistently wherever a query's row count grows with real
// business data (orders/customers/quotes/receipts/catalog — NOT small fixed
// reference tables like dim_channel/dim_geo, which stay far under any cap by
// construction):
//   1. Add `{ count: "exact" }` to the `.select()` call — gives the TRUE
//      total regardless of how many pages get fetched.
//   2. Use fetchAllRows() below instead of a bare `.range()` call — it pages
//      through `.range()` calls itself, reading the real per-page size off
//      the FIRST response (never assumes 1000 — if Supabase's max-rows
//      config ever changes, this adapts instead of silently under-fetching
//      or looping forever).
//   3. fetchAllRows() returns `truncated: true` only when it had to give up
//      before reaching the real `count` (hit MAX_UNBOUNDED_ROWS or the
//      MAX_PAGE_ITERATIONS safety guard) — never just because the data
//      spanned more than one page. The caller MUST surface `truncated` to
//      the UI (a banner + the real `totalCount`) — never silently render a
//      partial list/sum as complete.
//
// ⚠️ SECOND BUG THIS FILE'S PATTERN DEPENDS ON FIXING AT EVERY CALL SITE:
// paging only produces a correct, non-overlapping, non-skipping result if
// the underlying query has a FULLY DETERMINISTIC `ORDER BY` — i.e. the last
// column ordered on must be unique (typically the primary key `id`).
// Ordering by e.g. `order_date` alone ties on every row sharing a date, and
// Postgres is free to return tied rows in a different order on each
// separate `.range()` call — two page fetches for the SAME query can come
// back with duplicate rows in one page and missing rows in the next. This
// was caught for real: reloading /crm/orders with the exact same filters
// twice returned ฿486,459 the first time and ฿492,132 the second. Every
// caller of fetchAllRows() MUST end its `.order()` chain with a column that
// is unique per row (usually `.order("id", { ascending: false })` as the
// last call) — see lib/actions/crm.ts / marketing.ts / oem.ts / catalog.ts
// for the applied examples.
//
// 20,000 gives generous headroom over the biggest table this app reads today
// (analytics.fact_order, ~5,777 rows total across all time as of this
// incident) — if a shop-scoped table ever legitimately needs more than that
// in one screen, that's a pagination redesign, not a bigger constant.
export const MAX_UNBOUNDED_ROWS = 20000;

// Safety guard against an infinite/runaway loop in fetchAllRows() — NOT the
// expected path. With MAX_UNBOUNDED_ROWS=20000 and a real per-page size of
// 1000 (this project's current max-rows), a full scan takes 20 iterations.
// 50 leaves headroom for max-rows being lower than 1000 without ever
// spinning forever: if this guard trips, fetchAllRows() stops and reports
// `truncated: true` rather than looping without end.
const MAX_PAGE_ITERATIONS = 50;

export interface PagedFetchResult<T> {
  rows: T[];
  /** True count from the DB (`count: "exact"` on the underlying query) —
   * trustworthy even when `rows.length` was capped by MAX_UNBOUNDED_ROWS or
   * MAX_PAGE_ITERATIONS. */
  totalCount: number;
  /** true only when fetchAllRows() gave up before reaching `totalCount`
   * (hit MAX_UNBOUNDED_ROWS or MAX_PAGE_ITERATIONS) — NOT true just because
   * the data spanned more than one page (that's the normal, complete path).
   * Callers MUST surface this to the UI, never render a partial list/sum as
   * complete. */
  truncated: boolean;
}

/** Minimal structural shape of an awaited PostgREST query response — matches
 * what `supabase-js` returns from `.select(cols, { count: "exact" })...range(a,b)`
 * without importing its (heavier, version-coupled) types here. */
interface RangeResponse<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

/**
 * Pages through a PostgREST query using repeated `.range()` calls to get
 * past the server's max-rows cap — see this file's header for why a single
 * `.range()` call cannot do this on its own.
 *
 * `fetchPage(from, to)` must return a FRESH query for that exact page — same
 * `.eq()`/`.order()`/etc. filters every call, just a different `.range(from, to)`
 * — with `{ count: "exact" }` on its `.select()`. The `.order()` chain on
 * that query MUST end in a column unique per row (e.g. `id`) or paging can
 * silently duplicate/skip rows — see this file's header, second bug.
 *
 * Stops when: the latest page came back empty · `rows.length` reached the
 * real `count` · the next page would start at/past MAX_UNBOUNDED_ROWS · or
 * MAX_PAGE_ITERATIONS is hit (safety guard, should never trigger in
 * practice at current data volumes).
 */
export async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<RangeResponse<T>>): Promise<PagedFetchResult<T>> {
  const rows: T[] = [];
  let totalCount = 0;
  let pageSize: number | null = null; // read from round 1's real response — never assumed
  let offset = 0;

  for (let iteration = 0; iteration < MAX_PAGE_ITERATIONS; iteration++) {
    if (offset >= MAX_UNBOUNDED_ROWS) {
      return { rows, totalCount, truncated: true };
    }

    const windowSize = pageSize ?? MAX_UNBOUNDED_ROWS; // first call: ask wide, real size comes back clamped
    const to = Math.min(offset + windowSize - 1, MAX_UNBOUNDED_ROWS - 1);
    const { data, error, count } = await fetchPage(offset, to);
    if (error) throw error;

    const page = data ?? [];
    if (count !== null) totalCount = count;
    if (pageSize === null) pageSize = page.length; // the server's real max-rows, whatever it actually is

    rows.push(...page);

    if (page.length === 0) break; // nothing more — also covers pageSize===0 (empty result set)
    if (rows.length >= totalCount) break; // got everything the server says exists
    if (page.length < pageSize) break; // short page = last page

    offset += pageSize;

    if (iteration === MAX_PAGE_ITERATIONS - 1) {
      // Guard tripped: log loudly, this should never happen at current
      // volumes (see MAX_PAGE_ITERATIONS comment above) — if it does, it
      // means either a real server-side max-rows far below 1000, or an
      // actual dataset bigger than MAX_UNBOUNDED_ROWS/pageSize implies.
      console.error("fetchAllRows: hit MAX_PAGE_ITERATIONS guard", {
        rowsFetched: rows.length,
        totalCount,
        pageSize,
      });
    }
  }

  return { rows, totalCount, truncated: rows.length < totalCount };
}
