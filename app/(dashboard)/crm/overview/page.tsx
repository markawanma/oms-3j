import { LineChart } from "lucide-react";
import { getCrmOverview } from "@/lib/actions/crm";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/domain/crm/StatCard";
import { SegmentBreakdown } from "@/components/domain/crm/SegmentBreakdown";
import { ChannelPerfTable } from "@/components/domain/crm/ChannelPerfTable";
import { formatCount, formatTHBCompact } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic"; // orders/customers change daily — never cache

// CRM แบรนด์ overview (design §1 B1) — pure Server Component (no filters in
// this sub-phase, so no client component / loading spinner needed; the
// "loading" state is covered by the sibling loading.tsx skeleton).
export default async function CrmOverviewPage() {
  let result;
  try {
    result = await getCrmOverview();
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured.
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  const { totals, segmentCounts, channelPerf } = result.data;
  const isEmpty = totals.customers === 0 && totals.orders === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={LineChart}
        title="ยังไม่มีข้อมูล CRM"
        description="นำเข้าออเดอร์ผ่านหน้าอัปโหลดก่อน ตัวเลขจะขึ้นที่นี่อัตโนมัติ"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="ตัวชี้วัดภาพรวม CRM">
        <StatCard label="ยอดออเดอร์" value={formatCount(totals.orders)} hero />
        <StatCard label="รายได้รวม" value={formatTHBCompact(totals.revenue)} />
        <StatCard label="AOV" value={formatTHBCompact(totals.aov)} sub="ต่อออเดอร์" />
        <StatCard label="จำนวนลูกค้า" value={formatCount(totals.customers)} />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <span className="font-bold">กำไรสะสม (ประมาณการ 20%):</span>{" "}
        <span className="font-bold tabular-nums">{formatTHBCompact(totals.profitSumEstimated)}</span> — ยังไม่มีต้นทุนจริงต่อ SKU
        ตัวเลขนี้คือ 20% ของรายได้ ไม่ใช่กำไรจริง
      </div>

      <SegmentBreakdown counts={segmentCounts} />
      <ChannelPerfTable rows={channelPerf} />
    </div>
  );
}
