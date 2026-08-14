import { Lock } from "lucide-react";
import { getPromoAttribution } from "@/lib/actions/marketing";
import { getCrmEditOptions } from "@/lib/actions/crm";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PromoAttributionPageClient } from "@/components/domain/marketing/PromoAttributionPageClient";

export const dynamic = "force-dynamic";

// /marketing/attribution — TWO independent sources rendered as separate
// sections (0036 manual log + 0040 auto from Excel import, see design docs/
// 3j-jewelry/analytics/phase-auto-attribution-design.md §5/§D4):
//   - manual: owner-logged ledger for codes buyers typed in LINE chat (no
//     automatic tracking link exists for a broadcast).
//   - auto: read-only, derived from fact_order.discount_code (marketplace
//     voucher column in the Excel order report). No form/delete — it comes
//     from re-importing the file.
// Owner/admin only, same reasoning as /marketing/audience.
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
      auto={attributionResult.data.auto}
      channels={optionsResult.data.channels}
    />
  );
}
