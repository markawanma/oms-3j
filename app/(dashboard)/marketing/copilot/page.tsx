import { Lock } from "lucide-react";
import { getCampaignBoard, getChannelRoas, getMarketingReco } from "@/lib/actions/marketing";
import { getShopSetting } from "@/lib/actions/catalog";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { CampaignBoard } from "@/components/domain/marketing/CampaignBoard";
import { RecoList } from "@/components/domain/marketing/RecoList";
import { ChannelRoasFilter } from "@/components/domain/marketing/ChannelRoasFilter";

export const dynamic = "force-dynamic"; // recommendations recompute live from marts on every load

// /marketing/copilot (docs/3j-jewelry/analytics/phase-b3-design.md §4) —
// owner/admin only, same gate + same reasoning as /marketing/ad-spend's page
// header comment (not silently-empty: a staff visitor gets told plainly).
export default async function MarketingCopilotPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูคำแนะนำการตลาดได้"
      />
    );
  }

  let recoResult, roasResult, settingResult, boardResult;
  try {
    [recoResult, roasResult, settingResult, boardResult] = await Promise.all([
      getMarketingReco(),
      getChannelRoas(),
      getShopSetting(),
      getCampaignBoard(),
    ]);
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured.
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!recoResult.ok) return <ErrorState message={recoResult.error} />;
  if (!roasResult.ok) return <ErrorState message={roasResult.error} />;
  if (!settingResult.ok) return <ErrorState message={settingResult.error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">Ad Copilot</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          คำแนะนำอิงข้อมูลจริงจาก CRM/ยอดขาย · human-in-the-loop ทุกการ์ด — ไม่มีอะไรยิงอัตโนมัติ
        </p>
      </div>

      {boardResult?.ok && <CampaignBoard initialSteps={boardResult.data} />}
      <RecoList initialRows={recoResult.data} />
      <ChannelRoasFilter rows={roasResult.data} blendedMarginPct={settingResult.data.blendedMarginPct} />
    </div>
  );
}
