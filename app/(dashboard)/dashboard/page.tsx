import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Coins,
  Gem,
  Megaphone,
  PackageX,
  Receipt,
  Repeat,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";
import { getDashboard, getDashboardCharts } from "@/lib/actions/dashboard";
import type { DashboardCharts, MixSlice } from "@/lib/dashboard/types";
import { ErrorState, ErrorBanner } from "@/components/ui/ErrorState";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/brand/Logo";
import { TrendChart } from "@/components/domain/dashboard/TrendChart";
import { HBarChart } from "@/components/domain/dashboard/HBarChart";
import { DonutChart } from "@/components/domain/dashboard/DonutChart";
import { WeekdayChart } from "@/components/domain/dashboard/WeekdayChart";
import { CrmDateRangeFilter } from "@/components/domain/crm/CrmDateRangeFilter";
import { CrmChannelFilter } from "@/components/domain/crm/CrmChannelFilter";
import { CHANNEL_COLOR } from "@/lib/dashboard/channel-colors";
import { formatTHBCompact, formatCount, formatThaiDateOnly, effectiveDateBangkok } from "@/lib/tiktok/format";
import type { BadgeTone } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

function fmtBaht(n: number): string {
  return `฿${Math.round(n).toLocaleString("en-US")}`;
}

function recoTone(severity: string): BadgeTone {
  if (severity === "blocker" || severity === "high") return "red";
  if (severity === "medium") return "amber";
  return "slate";
}

const RFM_LABEL: Record<string, string> = { champion: "ชั้นดี", loyal: "ประจำ", new: "ใหม่", at_risk: "เสี่ยงหาย" };

// Product-mix bucket colors (design §8 copy note: line-item revenue ≠ order
// revenue — these buckets are "มูลค่าสินค้า", never labeled "ยอดขาย").
const BUCKET_COLOR: Record<string, string> = {
  silver_bar: "#a2191d", // primary-600
  jewelry: "#d97706", // amber-600
  art_toy: "#7c3aed", // violet-600
  other: "#a1a1aa", // zinc-400
};

// The % is period-scoped (how many of THIS period's orders carry line items);
// the date range is the global line-item data-availability window (why recent
// periods can read < 100%) — two different scopes, so the copy states each.
function coverageNote(coverage: DashboardCharts["coverage"]): string {
  const pct = Math.round(coverage.itemsPct * 100);
  const window =
    coverage.rangeFrom && coverage.rangeTo
      ? `ข้อมูลสินค้ามีถึงช่วง ${formatThaiDateOnly(coverage.rangeFrom)} – ${formatThaiDateOnly(coverage.rangeTo)}`
      : "ยังไม่มีข้อมูลสินค้า";
  return `อิงออเดอร์ที่มีข้อมูลสินค้า ${pct}% ของช่วงนี้ · ${window}`;
}

function mixToSlices(mix: MixSlice[]) {
  return mix.map((m) => ({ label: m.label, value: m.revenue, color: BUCKET_COLOR[m.bucket] ?? BUCKET_COLOR.other }));
}

// Rolling 30-day window ending today (Bangkok), used as the landing default.
// NOT month-to-date: on the 1st of a month that window is a single day, so the
// owner opened /dashboard on 1 ก.ย. and every KPI read ฿0 with no hint that the
// range — not the data — was the reason. A rolling window always spans real
// selling days while still capping the daily trend chart at 30 bars (an
// all-time default would blow it up to hundreds). The "เดือนนี้" preset button
// still gives the month-to-date view in one click.
function last30DaysFromBangkokISO(): string {
  const d = new Date(`${effectiveDateBangkok(new Date().toISOString())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return d.toISOString().slice(0, 10);
}

// /dashboard — Home overview (docs/3j-jewelry/analytics/phase-dashboard-charts-
// design.md §4 IA). Not staff-blocked: staff see "action needed" + the count-
// only charts; every money section (KPI row, Top SKU, Product Mix, AOV by
// channel, and revenue/aov inside Trend/Weekday) is gated at the RPC level
// (getDashboard/getDashboardCharts pass p_include_money=false for staff) —
// this page only checks `d.kpi`/array-emptiness to decide what to render, it
// never strips money client-side.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; channel?: string }>;
}) {
  const sp = await searchParams;
  // Default = rolling last 30 days (Bangkok) — see last30DaysFromBangkokISO.
  const from = sp.from ?? last30DaysFromBangkokISO();
  const to = sp.to ?? effectiveDateBangkok(new Date().toISOString());
  const channel = sp.channel ?? null;

  const [dashboardResult, chartsResult] = await Promise.all([
    getDashboard({ from, to, channel }),
    getDashboardCharts({ from, to, channel }),
  ]);

  if (!dashboardResult.ok) return <ErrorState message={dashboardResult.error} />;
  const d = dashboardResult.data;
  const charts = chartsResult.ok ? chartsResult.data : null;
  const chartsError = chartsResult.ok ? null : chartsResult.error;

  // Effective range = what the RPC actually applied (validateRange may have
  // swapped a reversed from/to or clamped an over-wide span) — drive the date
  // inputs + label off this, not the raw URL values, so the UI never shows a
  // range that differs from the data below it. Never null for /dashboard
  // (from/to are always passed), but fall back defensively.
  const effFrom = d.scope.requestedFrom ?? from;
  const effTo = d.scope.requestedTo ?? to;

  const today = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hasAction = d.action.oversold > 0 || d.action.lowStock > 0;

  return (
    <div className="space-y-5">
      {/* header — brand-accented panel: deep-maroon ribbon (echoes the logo
          enso), white card, logo + title + date. Date-range + channel filter
          sits below (CRM's shared pattern), shown always — the count-only
          charts react to it too, so even staff need it. */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="h-1 bg-gradient-to-r from-primary-800 via-primary-600 to-primary-800" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
          <Logo markOnly />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">ภาพรวมร้าน</h1>
            <p className="mt-0.5 text-sm text-zinc-500">{today}</p>
          </div>
        </div>
        <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <CrmDateRangeFilter
                basePath="/dashboard"
                from={effFrom}
                to={effTo}
                minDate={d.scope.minOrderDate}
                maxDate={d.scope.maxOrderDate}
                channelCode={channel}
                allRange={
                  d.scope.minOrderDate && d.scope.maxOrderDate
                    ? { from: d.scope.minOrderDate, to: d.scope.maxOrderDate }
                    : null
                }
              />
              <CrmChannelFilter
                basePath="/dashboard"
                channels={d.scope.channels.map((c) => ({ id: c.code, code: c.code, name: c.name }))}
                requestedChannelCode={channel}
                from={effFrom}
                to={effTo}
              />
            </div>
            <p className="text-xs text-zinc-400">รูปแบบวันที่ในช่อง: เดือน/วัน/ปี (ค.ศ.)</p>
            <p className="text-sm font-semibold text-zinc-700">
              📅 กำลังดู: {formatThaiDateOnly(effFrom)} – {formatThaiDateOnly(effTo)}
              {channel ? ` · ${d.scope.channels.find((c) => c.code === channel)?.name ?? channel}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* action needed — most important, shown first when present */}
      {hasAction ? (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-zinc-800">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
            ต้องจัดการ
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {d.action.oversold > 0 && (
              <StatCard
                label="ออเดอร์ค้างของไม่พอ"
                value={d.action.oversold}
                sub={d.action.oversoldBreached > 0 ? `เกิน SLA ${d.action.oversoldBreached}` : "ในกรอบ SLA"}
                tone={d.action.oversoldBreached > 0 ? "danger" : "warning"}
                href="/orders/oversold"
                icon={PackageX}
              />
            )}
            {d.action.lowStock > 0 && (
              <StatCard
                label="SKU (hero) ใกล้หมด/หมด"
                value={d.action.lowStock}
                tone="warning"
                href="/stock/hero"
                icon={Boxes}
              />
            )}
          </div>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500">
          ✓ ไม่มีงานค้างเร่งด่วน (ออเดอร์ของไม่พอ / SKU ใกล้หมด)
        </p>
      )}

      {/* money KPIs — owner/admin only (kpi is null for staff) */}
      {d.kpi && (
        <section>
          {/* 6 KPIs as 2 rows of 3 (grid-cols-3) — wider cards read easier than
              a single tight 6-across row; 2-up on the smallest screens. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <StatCard label="ยอดขาย" value={fmtBaht(d.kpi.revenue)} tone="brand" icon={Coins} />
            <StatCard label="ออเดอร์" value={d.kpi.orders.toLocaleString("en-US")} tone="neutral" icon={Receipt} />
            <StatCard label="กำไร" value={fmtBaht(d.kpi.profit)} sub="ประมาณการ" tone="brand" icon={Wallet} />
            <StatCard label="AOV" value={fmtBaht(d.kpi.aov)} sub="ต่อออเดอร์" tone="neutral" />
            <StatCard label="ลูกค้า" value={d.kpi.customers.toLocaleString("en-US")} sub="ในช่วงนี้" tone="neutral" icon={Users} />
            <StatCard
              label="Repeat"
              value={`${Math.round(d.kpi.repeatRate * 100)}%`}
              sub="ขาประจำ"
              tone="neutral"
              icon={Repeat}
            />
          </div>
        </section>
      )}

      {/* charts — visible for every role; money-bearing sections (Top SKU /
          Product Mix / AOV by channel, revenue in Trend/Weekday) come back
          []/null from the RPC for staff, each chart's own empty-state handles
          that without a separate gate here. */}
      {charts ? (
        <section className="space-y-2.5">
          <TrendChart points={charts.salesTrend} />

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <div>
              <HBarChart
                title="Top SKU"
                subtitle="10 อันดับตามมูลค่าสินค้า"
                rows={charts.topSku}
                emptyMessage="ไม่มีข้อมูล (หรือไม่มีสิทธิ์ดูมูลค่าเงิน)"
              />
              <p className="mt-1.5 px-1 text-xs text-zinc-500">{coverageNote(charts.coverage)}</p>
            </div>
            <div>
              <DonutChart
                title="สัดส่วนตามสินค้า"
                subtitle="ตามมูลค่าสินค้า (ไม่รวมค่าส่ง/ส่วนลด)"
                slices={mixToSlices(charts.productMix)}
                formatValue={formatTHBCompact}
                emptyMessage="ไม่มีข้อมูล (หรือไม่มีสิทธิ์ดูมูลค่าเงิน)"
              />
              <p className="mt-1.5 px-1 text-xs text-zinc-500">{coverageNote(charts.coverage)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <DonutChart
              title="ลูกค้าใหม่ vs ลูกค้าเก่า"
              subtitle="ตามออเดอร์ในช่วงที่เลือก"
              slices={[
                { label: "ลูกค้าใหม่", value: charts.newReturning.new, color: "#a2191d" },
                { label: "ลูกค้าเก่า (ซื้อซ้ำ)", value: charts.newReturning.returning, color: "#0ea5e9" },
                { label: "ไม่ทราบ (มาสก์ข้อมูล)", value: charts.newReturning.unknown, color: "#a1a1aa" },
              ]}
              formatValue={formatCount}
            />
            <HBarChart
              title="AOV ตามช่องทาง"
              subtitle="มูลค่าเฉลี่ยต่อออเดอร์"
              rows={charts.aovByChannel}
              emptyMessage="ไม่มีข้อมูล (หรือไม่มีสิทธิ์ดูมูลค่าเงิน)"
            />
          </div>

          <DonutChart
            title="ยอดขายตามช่องทาง"
            subtitle="แยกตามช่องทาง (ทุกช่องทางเสมอ)"
            slices={charts.salesByChannel.map((c) => ({
              label: c.channelName,
              value: c.revenue,
              color: CHANNEL_COLOR[c.channelCode] ?? CHANNEL_COLOR.default,
            }))}
            formatValue={formatTHBCompact}
            showValue
            emptyMessage="ไม่มีข้อมูล (หรือไม่มีสิทธิ์ดูมูลค่าเงิน)"
          />

          <WeekdayChart points={charts.weekday} />
        </section>
      ) : (
        <ErrorBanner message={chartsError ?? "โหลดกราฟไม่สำเร็จ"} />
      )}

      {d.kpi && (
        <>
          {d.reco.length > 0 && (
            <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
                  <Megaphone className="h-4 w-4 text-primary-600" aria-hidden="true" />
                  แนะนำจาก Ad Copilot
                </h2>
                <Link href="/marketing/copilot" className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-700 hover:underline">
                  ดูทั้งหมด <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
              <ul className="space-y-1.5">
                {d.reco.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                    <Badge tone={recoTone(r.severity)}>{i + 1}</Badge>
                    <span className="min-w-0">{r.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
              <h2 className="text-sm font-bold text-zinc-800">ลูกค้า (RFM)</h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {Object.entries(d.rfm).length === 0 ? (
                  <span className="text-zinc-400">—</span>
                ) : (
                  Object.entries(d.rfm).map(([seg, n]) => (
                    <span key={seg} className="text-zinc-600">
                      {RFM_LABEL[seg] ?? seg} <span className="font-bold text-zinc-900">{n}</span>
                    </span>
                  ))
                )}
              </div>
              <Link href="/crm/customers" className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-primary-700 hover:underline">
                ดูลูกค้า <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
              <h2 className="text-sm font-bold text-zinc-800">ช่องทางเด่น (เดือนนี้)</h2>
              {d.topChannel ? (
                <p className="mt-2 text-sm text-zinc-700">
                  <span className="font-semibold text-zinc-900">{d.topChannel.channelName}</span> · {fmtBaht(d.topChannel.revenue)}
                  {d.topChannel.roas !== null && <span className="text-zinc-500"> · ROAS ×{d.topChannel.roas.toFixed(2)}</span>}
                </p>
              ) : (
                <p className="mt-2 text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
              )}
              <Link href="/marketing/copilot" className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-primary-700 hover:underline">
                ดู ROAS ต่อช่องทาง <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
          </section>

          {/* quick actions */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-zinc-800">ทางลัด</h2>
            <div className="flex flex-wrap gap-2">
              {[
                { href: "/marketing/ad-spend", label: "กรอกค่าแอด", icon: Wallet },
                { href: "/catalog", label: "สินค้า / ต้นทุน", icon: Gem },
                { href: "/stock/hero", label: "จอสต็อก Hero", icon: Boxes },
                { href: "/marketing/attribution", label: "วัดผลโค้ด", icon: Ticket },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-primary-300 hover:bg-primary-50"
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
