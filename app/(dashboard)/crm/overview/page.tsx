import Link from "next/link";
import { LineChart, CalendarX } from "lucide-react";
import { getCrmOverview } from "@/lib/actions/crm";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/domain/crm/StatCard";
import { SegmentBreakdown } from "@/components/domain/crm/SegmentBreakdown";
import { ChannelPerfTable } from "@/components/domain/crm/ChannelPerfTable";
import { CrmDateRangeFilter } from "@/components/domain/crm/CrmDateRangeFilter";
import { formatCount, formatTHBCompact, formatThaiDateOnly } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic"; // orders/customers change daily — never cache

// CRM แบรนด์ overview (design §1 B1 + date-range filter follow-up) — server
// component, range comes from URL searchParams (?from=&to=, "YYYY-MM-DD")
// so it's bookmarkable/shareable, same reasoning as
// components/domain/crm/CrmDateRangeFilter.tsx's header comment. Next.js 15
// searchParams is a Promise, must be awaited (matches
// app/(dashboard)/crm/customers/page.tsx's ?segment= pattern).
//
// Validation happens server-side in getCrmOverview() itself (malformed
// values silently fall back to "no bound"/all-time) — this page just passes
// the raw query string values through, it never needs to reject/redirect on
// a bad param.
export default async function CrmOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: fromParam, to: toParam } = await searchParams;

  let result;
  try {
    result = await getCrmOverview({ from: fromParam, to: toParam });
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured.
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  const { totals, segmentCounts, channelPerf, scope } = result.data;

  // No orders for this shop at all (regardless of filter) — the "set up
  // data first" empty state, unrelated to date filtering.
  if (scope.minOrderDate === null) {
    return (
      <EmptyState
        icon={LineChart}
        title="ยังไม่มีข้อมูล CRM"
        description="นำเข้าออเดอร์ผ่านหน้าอัปโหลดก่อน ตัวเลขจะขึ้นที่นี่อัตโนมัติ"
      />
    );
  }

  // Inputs always show a concrete range: whatever was actually applied, or
  // the shop's full min–max when the URL had no ?from=/?to= (design's
  // "default = ทั้งหมด").
  const effectiveFrom = scope.requestedFrom ?? scope.minOrderDate;
  const effectiveTo = scope.requestedTo ?? scope.maxOrderDate ?? scope.minOrderDate;

  const dateRangeFilter = (
    <CrmDateRangeFilter from={effectiveFrom} to={effectiveTo} minDate={scope.minOrderDate} maxDate={scope.maxOrderDate} />
  );

  const rangeLabel =
    scope.requestedFrom || scope.requestedTo
      ? `แสดงออเดอร์ตั้งแต่ ${formatThaiDateOnly(effectiveFrom)} ถึง ${formatThaiDateOnly(effectiveTo)}`
      : `แสดงข้อมูลทั้งหมด — ${formatThaiDateOnly(scope.minOrderDate)} ถึง ${formatThaiDateOnly(scope.maxOrderDate)}`;

  // Data exists for this shop, but zero orders land inside the requested
  // range — different empty state than "no CRM data at all" above, with a
  // way back to the full range.
  if (totals.orders === 0) {
    return (
      <div className="space-y-4">
        {dateRangeFilter}
        <p className="text-xs text-zinc-500">{rangeLabel}</p>
        <EmptyState
          icon={CalendarX}
          title="ไม่มีออเดอร์ในช่วงที่เลือก"
          description="ลองขยายช่วงวันที่ หรือกลับไปดูข้อมูลทั้งหมด"
          action={
            <Link
              href="/crm/overview"
              className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
            >
              ดูข้อมูลทั้งหมด
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dateRangeFilter}
      <p className="text-xs text-zinc-500">{rangeLabel}</p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="ตัวชี้วัดภาพรวม CRM">
        <StatCard label="ยอดออเดอร์" value={formatCount(totals.orders)} hero />
        <StatCard label="รายได้รวม" value={formatTHBCompact(totals.revenue)} />
        <StatCard label="AOV" value={formatTHBCompact(totals.aov)} sub="ต่อออเดอร์" />
        <StatCard label="จำนวนลูกค้า" value={formatCount(totals.customers)} sub="ที่มีออเดอร์ในช่วงนี้" />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <span className="font-bold">กำไรสะสม (ประมาณการ 20%):</span>{" "}
        <span className="font-bold tabular-nums">{formatTHBCompact(totals.profitSumEstimated)}</span> — ยังไม่มีต้นทุนจริงต่อ SKU
        ตัวเลขนี้คือ 20% ของรายได้ ไม่ใช่กำไรจริง
      </div>

      <SegmentBreakdown counts={segmentCounts} rangeNote="กลุ่ม RFM = สถานะ ณ ปัจจุบันของลูกค้าที่ซื้อในช่วงนี้" />
      <ChannelPerfTable rows={channelPerf} />
    </div>
  );
}
