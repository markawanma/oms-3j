import { Lock } from "lucide-react";
import { getProductionOrders } from "@/lib/actions/production";
import { getEffectiveRole } from "@/lib/auth/role";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { TruncatedDataNotice } from "@/components/ui/TruncatedDataNotice";
import { ProductionListClient } from "@/components/domain/production/ProductionListClient";

export const dynamic = "force-dynamic";

// /production — production-order (ใบผลิตเข้าสต็อก) registry. Owner/admin
// only: this module writes cost + stock in one transaction (0131 §12), same
// sensitivity class as /marketing/audience and the rest of /oem.
export default async function ProductionPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบผลิตเข้าสต็อกได้"
      />
    );
  }

  let result;
  try {
    result = await getProductionOrders();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!result.ok) return <ErrorState message={result.error} />;

  return (
    <>
      {result.data.truncated && (
        <TruncatedDataNotice totalCount={result.data.totalCount} shownCount={result.data.rows.length} />
      )}
      <ProductionListClient orders={result.data.rows} />
    </>
  );
}
