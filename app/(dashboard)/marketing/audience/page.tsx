import { Lock } from "lucide-react";
import { getAudience } from "@/lib/actions/marketing";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { AudiencePageClient } from "@/components/domain/marketing/AudiencePageClient";

export const dynamic = "force-dynamic";

// /marketing/audience (docs/3j-jewelry/marketing/campaign-plan-99-winback.md) —
// owner/admin only: a customer list for broadcast targeting is sensitive.
export default async function MarketingAudiencePage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูรายชื่อกลุ่มลูกค้าได้"
      />
    );
  }

  let result;
  try {
    result = await getAudience();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return <AudiencePageClient rows={result.data} />;
}
