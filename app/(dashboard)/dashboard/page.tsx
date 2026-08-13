import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, Coins, Gem, Megaphone, PackageX, Receipt, Ticket, Wallet } from "lucide-react";
import { getDashboard } from "@/lib/actions/dashboard";
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABEL_TH,
  toDashboardPeriod,
} from "@/lib/dashboard/types";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
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

// /dashboard — Home overview (docs/3j-jewelry/design/ui-refresh-plan.md §1).
// Not staff-blocked: staff see the "action needed" section only (getDashboard
// strips money for staff → kpi is null, so the money sections below render
// nothing for them).
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const period = toDashboardPeriod(sp.period);

  const result = await getDashboard(period);
  if (!result.ok) return <ErrorState message={result.error} />;
  const d = result.data;

  const today = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hasAction = d.action.oversold > 0 || d.action.lowStock > 0;

  return (
    <div className="space-y-5">
      {/* header + brand */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {/* TODO: swap for the 3J logo asset when provided */}
            <span className="text-lg font-extrabold tracking-tight text-primary-700">3J</span>
            <h1 className="text-lg font-bold text-zinc-900">ภาพรวมร้าน</h1>
          </div>
          <p className="mt-0.5 text-sm text-zinc-500">{today}</p>
        </div>
        {d.kpi && (
          <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-xs">
            {DASHBOARD_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/dashboard?period=${p}`}
                className={`rounded px-2.5 py-1 font-medium ${
                  p === period ? "bg-primary-100 text-primary-700" : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                {DASHBOARD_PERIOD_LABEL_TH[p]}
              </Link>
            ))}
          </div>
        )}
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
        <>
          <section>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <StatCard label="ยอดขาย" value={fmtBaht(d.kpi.revenue)} tone="brand" icon={Coins} />
              <StatCard label="ออเดอร์" value={d.kpi.orders.toLocaleString("en-US")} tone="neutral" icon={Receipt} />
              <StatCard label="กำไร (ประมาณการ)" value={fmtBaht(d.kpi.profit)} tone="brand" icon={Wallet} />
              <StatCard label="AOV เฉลี่ย/ออเดอร์" value={fmtBaht(d.kpi.aov)} tone="neutral" />
            </div>
          </section>

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
