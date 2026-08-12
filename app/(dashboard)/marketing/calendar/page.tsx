import { Lock } from "lucide-react";
import { getCampaignCalendar } from "@/lib/actions/marketing";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { CampaignCalendar } from "@/components/domain/marketing/CampaignCalendar";

export const dynamic = "force-dynamic";

// /marketing/calendar (analytics.v_campaign_calendar) — owner/admin only,
// same reasoning as /marketing/audience's page header comment: prep_note_th
// carries pricing/discount prep strategy, not something staff needs to see.
export default async function MarketingCalendarPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูปฏิทินแคมเปญได้"
      />
    );
  }

  let result;
  try {
    result = await getCampaignCalendar();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return <CampaignCalendar events={result.data} />;
}
