import { getCrmOrders } from "@/lib/actions/crm";
import { OrdersPageClient } from "@/components/domain/crm/OrdersPageClient";
import { ErrorState } from "@/components/ui/ErrorState";
import { TruncatedDataNotice } from "@/components/ui/TruncatedDataNotice";

export const dynamic = "force-dynamic"; // orders change as imports land — never cache

// /crm/orders (flat all-orders browse table, owner wants data on screen, not
// export) — server fetch, range comes from URL searchParams (?from=&to=,
// "YYYY-MM-DD") same bookmarkable-URL convention as /crm/overview
// (CrmDateRangeFilter's header comment). Search/channel-filter/sort all stay
// client-side (OrdersPageClient) over the already-fetched rows, same
// "334 rows fits fine in the browser" reasoning as CustomersPageClient.
//
// Unlike /crm/overview this page does NOT fetch a separate min/max-order-date
// "scope" query just to bound the date inputs — getCrmOrders already returns
// every row inside the requested range, so the date-input display bounds
// below are derived from THAT result set (full dataset when unfiltered,
// requested range when filtered) instead of a second round-trip. Trade-off:
// the date inputs' `min`/`max` attrs aren't hard-clamped to the shop's
// absolute earliest order the way /crm/overview's are — a user can still pick
// an out-of-data date and simply see the "empty" state, which is harmless.
export default async function CrmOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: fromParam, to: toParam } = await searchParams;

  let result;
  try {
    result = await getCrmOrders({ from: fromParam, to: toParam });
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  const { rows, totalCount, truncated } = result.data;

  let minOrderDate: string | null = null;
  let maxOrderDate: string | null = null;
  for (const r of rows) {
    if (minOrderDate === null || r.orderDate < minOrderDate) minOrderDate = r.orderDate;
    if (maxOrderDate === null || r.orderDate > maxOrderDate) maxOrderDate = r.orderDate;
  }

  const isFiltered = Boolean(fromParam || toParam);

  return (
    <>
      {truncated && <TruncatedDataNotice totalCount={totalCount} shownCount={rows.length} />}
      <OrdersPageClient
        rows={rows}
        requestedFrom={fromParam ?? null}
        requestedTo={toParam ?? null}
        minOrderDate={minOrderDate}
        maxOrderDate={maxOrderDate}
        isFiltered={isFiltered}
      />
    </>
  );
}
