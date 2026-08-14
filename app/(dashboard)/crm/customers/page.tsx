import { getCrmCustomers } from "@/lib/actions/crm";
import { CustomersPageClient } from "@/components/domain/crm/CustomersPageClient";
import { ErrorState } from "@/components/ui/ErrorState";

export const dynamic = "force-dynamic"; // customer list changes as orders import — never cache

// /crm/customers (design §1 B1) — server fetch, client-side search/segment
// filter (CustomersPageClient). `?segment=` (linked from SegmentBreakdown on
// /crm/overview) seeds the initial filter — Next.js 15 `searchParams` is a
// Promise, must be awaited.
export default async function CrmCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const { segment } = await searchParams;

  let result;
  try {
    result = await getCrmCustomers();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  return <CustomersPageClient rows={result.data} initialSegment={segment} />;
}
