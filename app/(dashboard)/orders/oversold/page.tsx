import { Lock } from "lucide-react";
import { getOversoldQueue } from "@/lib/actions/oversold";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OversoldQueueClient } from "@/components/domain/orders/OversoldQueueClient";

export const dynamic = "force-dynamic"; // held orders + follow-up change on live/save

// /orders/oversold (analytics.v_oversold_hold_queue) — owner/admin only: shows
// buyer name/phone (order PII) for the whole point of contacting them, and
// logging follow-up is an owner/admin action per the ops design.
export default async function OversoldQueuePage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและติดตามคิวของไม่พอได้"
      />
    );
  }

  let result;
  try {
    result = await getOversoldQueue();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return <OversoldQueueClient rows={result.data} />;
}
