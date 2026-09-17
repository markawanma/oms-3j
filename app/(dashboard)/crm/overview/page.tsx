import Link from "next/link";
import { LineChart, CalendarX } from "lucide-react";
import { getCrmOverview, getCrmCustomerDimensions } from "@/lib/actions/crm";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/domain/crm/StatCard";
import { SegmentBreakdown } from "@/components/domain/crm/SegmentBreakdown";
import { SegmentLegend } from "@/components/domain/crm/SegmentLegend";
import { CustomerDimensionsPanel, type CrmCustomerDimensionsScoped } from "@/components/domain/crm/CustomerDimensionsPanel";
import { ChannelPerfTable } from "@/components/domain/crm/ChannelPerfTable";
import { CrmDateRangeFilter } from "@/components/domain/crm/CrmDateRangeFilter";
import { CrmChannelFilter } from "@/components/domain/crm/CrmChannelFilter";
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
  searchParams: Promise<{ from?: string; to?: string; channel?: string }>;
}) {
  const { from: fromParam, to: toParam, channel: channelParam } = await searchParams;

  // getCrmOverview() must resolve FIRST — it's the one that validates
  // from/to/channel (malformed/unknown values silently drop to "no bound" /
  // "every channel", see its own header comment). getCrmCustomerDimensions()
  // then runs AFTER, fed scope.requestedFrom/To/ChannelCode (the VALIDATED
  // values), not the raw searchParams. Running both in parallel off the raw
  // params was tried first and rejected: a bad ?channel= would make the KPIs
  // above fall back to "every channel" while this box's "range" bucket came
  // back empty for a channel code that matches nothing — two boxes on one
  // page disagreeing about what's being filtered. One extra sequential
  // round-trip is a fair trade for both boxes reading off the same validated
  // scope.
  let result: Awaited<ReturnType<typeof getCrmOverview>>;
  try {
    result = await getCrmOverview({ from: fromParam, to: toParam, channelCode: channelParam });
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured — same
    // defensive catch the old Promise.allSettled call used to provide.
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

  // rangeLabel is the human-readable (Thai, Buddhist-era) translation of
  // whatever the two <input type="date"> fields show — those inputs render
  // in the browser's locale format (typically US MM/DD/YYYY), which reads as
  // ambiguous next to Thai พ.ศ. labels elsewhere on the page (e.g. is
  // "06/01/2026" 1 มิ.ย. or 6 ม.ค.?). The native input's format can't be
  // changed directly (browser-controlled), so instead this label is made
  // prominent — right under the filter, calendar icon, bold — so the
  // trustworthy reading is always the Thai one, not the ambiguous input text.
  const rangeLabel =
    scope.requestedFrom || scope.requestedTo
      ? `กำลังดู: ${formatThaiDateOnly(effectiveFrom)} – ${formatThaiDateOnly(effectiveTo)}`
      : `กำลังดูข้อมูลทั้งหมด: ${formatThaiDateOnly(scope.minOrderDate)} – ${formatThaiDateOnly(scope.maxOrderDate)}`;

  const filters = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <CrmDateRangeFilter
          from={effectiveFrom}
          to={effectiveTo}
          minDate={scope.minOrderDate}
          maxDate={scope.maxOrderDate}
          channelCode={scope.requestedChannelCode}
        />
        <CrmChannelFilter
          channels={scope.channels}
          requestedChannelCode={scope.requestedChannelCode}
          from={scope.requestedFrom}
          to={scope.requestedTo}
        />
      </div>
      <p className="text-xs text-zinc-400">รูปแบบวันที่ในช่อง: เดือน/วัน/ปี (ค.ศ.)</p>
      <p className="text-sm font-semibold text-zinc-700">📅 {rangeLabel}</p>
    </div>
  );

  // Data exists for this shop, but zero orders land inside the requested
  // range — different empty state than "no CRM data at all" above, with a
  // way back to the full range.
  if (totals.orders === 0) {
    return (
      <div className="space-y-4">
        {filters}
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

  // Whether a real from/to/channel filter is actually applied — based on
  // the VALIDATED scope fields (not the raw searchParams), so a stale/bad
  // ?channel= that got silently dropped above doesn't register as "filter
  // active" here either (see the getCrmOverview call's comment). Gates the
  // "ตามตัวกรองด้านบน" toggle in CustomerDimensionsPanel: with no filter
  // applied, "range" would be identical to "all", so offering the toggle
  // would be a confusing no-op.
  const filterActive = scope.requestedFrom !== null || scope.requestedTo !== null || scope.requestedChannelCode !== null;

  // getCrmCustomerDimensions() runs AFTER getCrmOverview (sequential, see
  // above) and is wrapped in its own try/catch so a failure here — throw or
  // !ok — can never take down the whole page: it only means the
  // province/channel section below doesn't render, same "non-blocking"
  // contract the rest of this page uses for optional sections. Skipped
  // entirely on the two empty-state returns above since the panel never
  // renders there anyway — no point spending the round-trip.
  let dims: CrmCustomerDimensionsScoped | null = null;
  try {
    const dimsResult = await getCrmCustomerDimensions({
      from: scope.requestedFrom,
      to: scope.requestedTo,
      channelCode: scope.requestedChannelCode,
    });
    if (dimsResult.ok) {
      dims = dimsResult.data;
    } else {
      console.error("getCrmCustomerDimensions failed on /crm/overview:", dimsResult.error);
    }
  } catch (err) {
    console.error("getCrmCustomerDimensions threw on /crm/overview:", err);
  }

  // "all" mode's label is the shop's full min–max, all-time — unaffected by
  // any filter. "range" mode's label mirrors effectiveFrom/effectiveTo above
  // (same fallback-to-full-range-when-unset behavior as the top-of-page
  // filter) plus the resolved channel name, since dims' "range" bucket is
  // computed against those exact params.
  const dimsAllLabel = `${formatThaiDateOnly(scope.minOrderDate)} – ${formatThaiDateOnly(scope.maxOrderDate ?? scope.minOrderDate)}`;
  const dimsRangeLabel = `${formatThaiDateOnly(effectiveFrom)} – ${formatThaiDateOnly(effectiveTo)}`;
  const rangeChannelName = scope.requestedChannelCode
    ? scope.channels.find((c) => c.code === scope.requestedChannelCode)?.name ?? scope.requestedChannelCode
    : "ทุกช่องทาง";

  // profit is a real SUM either way (from v_fact_order.profit); only the
  // LABEL changes depending on how many of this range's orders still lack a
  // CONFIRMED cost (profit_status='estimated') — see CrmOverviewData.
  // totals doc comment in lib/actions/crm.ts for why this can't be captioned
  // as purely "จริง" or purely "ประมาณการ" in the mixed case.
  //
  // QA round 1 caught the old wording here claiming "estimated" always means
  // "20% ของรายได้, ยังไม่มีต้นทุนจริง" — false since migration 0095: an
  // order can be 'estimated' while carrying REAL per-SKU cost, just an
  // unproven SKU match (unknown SKU, or an inactive-product match tier 3
  // couldn't rule out a live twin for). Wording below no longer claims a
  // flat 20% or "no cost data" — only "ยังไม่ยืนยัน" (not yet confirmed),
  // which is true for both underlying cases.
  const { profitActualOrders, profitEstimatedOrders } = totals;
  let profitLabel: string;
  let profitNote: string;
  if (profitEstimatedOrders === 0) {
    profitLabel = " (กำไรจริงทุกออเดอร์)";
    profitNote = `คำนวณจากต้นทุนจริงต่อ SKU ครบทั้ง ${formatCount(profitActualOrders)} ออเดอร์ในช่วงนี้`;
  } else if (profitActualOrders === 0) {
    profitLabel = " (ประมาณการ)";
    profitNote = "ทุกออเดอร์ในช่วงนี้ยังไม่ยืนยันต้นทุน (ไม่มีข้อมูลต้นทุน หรือจับคู่ SKU ไม่ชัวร์) — ตัวเลขนี้เป็นค่าประมาณ ไม่ใช่กำไรจริง";
  } else {
    profitLabel = "";
    profitNote = `กำไรจริง ${formatCount(profitActualOrders)} ออเดอร์ (มีต้นทุนจริงต่อ SKU ยืนยันแล้ว) + ประมาณการอีก ${formatCount(profitEstimatedOrders)} ออเดอร์ (ยังไม่ยืนยันต้นทุน)`;
  }

  return (
    <div className="space-y-4">
      {filters}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="ตัวชี้วัดภาพรวม CRM">
        <StatCard label="ยอดออเดอร์" value={formatCount(totals.orders)} hero />
        <StatCard label="รายได้รวม" value={formatTHBCompact(totals.revenue)} />
        <StatCard label="AOV" value={formatTHBCompact(totals.aov)} sub="ต่อออเดอร์" />
        <StatCard label="จำนวนลูกค้า" value={formatCount(totals.customers)} sub="ที่มีออเดอร์ในช่วงนี้" />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <span className="font-bold">กำไรสะสม{profitLabel}:</span>{" "}
        <span className="font-bold tabular-nums">{formatTHBCompact(totals.profitSum)}</span> — {profitNote}
      </div>

      <SegmentBreakdown counts={segmentCounts} rangeNote="กลุ่ม RFM = สถานะ ณ ปัจจุบันของลูกค้าที่ซื้อในช่วงนี้" />
      <SegmentLegend />
      {dims !== null && dims.all && (
        <CustomerDimensionsPanel
          data={dims}
          filterActive={filterActive}
          allLabel={dimsAllLabel}
          rangeLabel={dimsRangeLabel}
          rangeChannelName={rangeChannelName}
        />
      )}
      <ChannelPerfTable rows={channelPerf} />
    </div>
  );
}
