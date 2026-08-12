import { Lock } from "lucide-react";
import { getPromoAttribution } from "@/lib/actions/marketing";
import { getCrmEditOptions } from "@/lib/actions/crm";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PromoAttributionPageClient } from "@/components/domain/marketing/PromoAttributionPageClient";

export const dynamic = "force-dynamic";

// /marketing/attribution (0036) — manual promo-code attribution log for LINE
// broadcasts (no automatic tracking link exists, so the owner logs each order
// whose buyer typed the code in chat). Owner/admin only, same reasoning as
// /marketing/audience.
export default async function MarketingAttributionPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานหน้าวัดผลโค้ดได้"
      />
    );
  }

  let attributionResult, optionsResult;
  try {
    [attributionResult, optionsResult] = await Promise.all([getPromoAttribution(), getCrmEditOptions()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!attributionResult.ok) return <ErrorState message={attributionResult.error} />;
  if (!optionsResult.ok) return <ErrorState message={optionsResult.error} />;

  return (
    <PromoAttributionPageClient
      summary={attributionResult.data.summary}
      entries={attributionResult.data.entries}
      channels={optionsResult.data.channels}
    />
  );
}
