import { listOrders, getPrioritySummary } from "@/lib/actions/orders";
import { OrderDashboardClient } from "@/components/domain/OrderDashboardClient";
import { ErrorState } from "@/components/ui/ErrorState";

export const dynamic = "force-dynamic"; // always fresh — order queue changes constantly

export default async function DashboardPage() {
  let ordersResult;
  let summaryResult;
  try {
    [ordersResult, summaryResult] = await Promise.all([
      listOrders({ channel: "all", status: "all", search: "", cursor: null }),
      getPrioritySummary(),
    ]);
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured — surface it
    // as a clear setup error rather than a generic 500.
    return (
      <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />
    );
  }

  if (!ordersResult.ok) {
    return <ErrorState message={ordersResult.error} />;
  }

  return (
    <OrderDashboardClient
      initialOrders={ordersResult.data.rows}
      initialCursor={ordersResult.data.nextCursor}
      initialSummary={summaryResult.ok ? summaryResult.data : { newCount: 0, oversoldCount: 0, toShipCount: 0 }}
    />
  );
}
