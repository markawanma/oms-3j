import { Lock } from "lucide-react";
import { getAdSpendWeekly } from "@/lib/actions/marketing";
import { getCrmEditOptions } from "@/lib/actions/crm";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdSpendForm } from "@/components/domain/marketing/AdSpendForm";
import { AdSpendTable } from "@/components/domain/marketing/AdSpendTable";

export const dynamic = "force-dynamic"; // spend entries change whenever an owner submits the form

// /marketing/ad-spend (docs/3j-jewelry/analytics/phase-b3-design.md §1) —
// owner/admin only per the task's explicit gate: "owner/admin เท่านั้นเห็น/
// กรอก". Gated HERE at the page (not silently-empty like /crm/merge) because
// unlike a merge queue, this page's core content (the form) is never
// naturally empty — a staff visitor needs to be told plainly why there's
// nothing to see, not shown what looks like a data-entry form with a broken
// submit button.
export default async function MarketingAdSpendPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและกรอกค่าแอดได้"
      />
    );
  }

  let weeklyResult, optionsResult;
  try {
    // getCrmEditOptions() reuses the CRM module's dim_channel lookup — global
    // reference data, not marketing-specific, no need for a duplicate action.
    [weeklyResult, optionsResult] = await Promise.all([getAdSpendWeekly(), getCrmEditOptions()]);
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured.
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!optionsResult.ok) return <ErrorState message={optionsResult.error} />;
  if (!weeklyResult.ok) return <ErrorState message={weeklyResult.error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ค่าแอด</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          กรอกยอดค่าแอดเป็นช่วงวันที่ต่อสัปดาห์/ช่องทาง ระบบหารเฉลี่ยลงรายวันให้อัตโนมัติ
        </p>
      </div>

      <AdSpendForm channels={optionsResult.data.channels} />
      <AdSpendTable rows={weeklyResult.data} />
    </div>
  );
}
