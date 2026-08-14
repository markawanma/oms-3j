import { Lock } from "lucide-react";
import { getShopSetting, getBlendedMarginSuggestion } from "@/lib/actions/catalog";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsForm } from "@/components/domain/catalog/SettingsForm";

export const dynamic = "force-dynamic";

// /settings — pricing & margin (docs/3j-jewelry/analytics/phase-c1-sku-cost-
// margin.md §3.2). Owner/admin only — these numbers drive profit/ROAS/reco
// across the whole app.
export default async function SettingsPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ตั้งค่าราคา/มาร์จิ้นได้"
      />
    );
  }

  let settingResult, suggestionResult;
  try {
    [settingResult, suggestionResult] = await Promise.all([getShopSetting(), getBlendedMarginSuggestion()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!settingResult.ok) return <ErrorState message={settingResult.error} />;
  if (!suggestionResult.ok) return <ErrorState message={suggestionResult.error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ราคา &amp; มาร์จิ้น</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          ตั้งราคาเงินสปอต มาร์จิ้นเฉลี่ย และเป้า ROAS — ค่าพวกนี้ใช้คำนวณกำไรและ ROAS ทั้งระบบ
        </p>
      </div>
      <SettingsForm setting={settingResult.data} suggestion={suggestionResult.data} />
    </div>
  );
}
