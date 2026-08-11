"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3 } from "lucide-react";
import type { BreakdownRow, DailyDashboardData, DashboardBreakdownDimension } from "@/lib/tiktok/types";

const DIMENSIONS: { key: DashboardBreakdownDimension; label: string }[] = [
  { key: "channel", label: "ช่องทาง" },
  { key: "province", label: "จังหวัด" },
  { key: "addressType", label: "ประเภทที่อยู่" },
  { key: "topProducts", label: "สินค้าขายดี" },
];

function BreakdownPanel({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    // Per-dimension empty (design §4: "empty state เฉพาะจุด ไม่ทำให้ทั้งหน้าว่าง").
    return <EmptyState icon={BarChart3} title="ไม่มีออเดอร์ในช่วงนี้" />;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[96px_1fr_auto] items-center gap-2 sm:grid-cols-[130px_1fr_auto] sm:gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={`truncate text-sm ${row.isUnknown ? "text-slate-500" : "text-slate-700"}`}>{row.label}</span>
            {row.reviewBadge && (
              <Badge tone="amber" className="shrink-0">
                {row.reviewBadge}
              </Badge>
            )}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${row.isUnknown ? "bg-slate-400" : "bg-primary-600"}`}
              style={{ width: `${Math.min(Math.max(row.barPct, 0), 100)}%` }}
            />
          </div>
          <div className="min-w-[56px] text-right text-sm font-bold text-slate-900 tabular-nums">
            {row.displayValue}
            {row.subLabel && <span className="ml-1 text-xs font-normal text-slate-400">{row.subLabel}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * BreakdownTabs — mobile shows one dimension at a time via tabs (reduces
 * cognitive load, design §4). Desktop (md+) shows all 4 dimensions in a 2x2
 * grid simultaneously instead — same underlying `BreakdownPanel`, two
 * different shells swapped with `md:hidden` / `hidden md:grid` rather than
 * two separate components, since the row-rendering logic is identical
 * (design §4 called this "responsive variant เดียวกัน").
 */
export function BreakdownTabs({ breakdown }: { breakdown: DailyDashboardData["breakdown"] }) {
  const [active, setActive] = useState<DashboardBreakdownDimension>("channel");

  return (
    <div>
      <p className="mb-2.5 text-xs font-bold tracking-wide text-slate-400 uppercase">ดูแยกตาม</p>

      {/* Mobile: tabs + single panel */}
      <div className="md:hidden">
        <div role="tablist" aria-label="แยกตามมิติ" className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {DIMENSIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={active === d.key}
              onClick={() => setActive(d.key)}
              className={`min-h-9 flex-1 rounded-md px-2 text-xs font-semibold transition-colors ${
                active === d.key ? "bg-white text-primary-700 shadow-sm" : "text-slate-600"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="mt-3.5">
          <BreakdownPanel rows={breakdown[active]} />
        </div>
      </div>

      {/* Desktop: 2x2 grid, all dimensions visible at once — trade-off
          accepted in design §4 (loses tab-focus but gains at-a-glance
          overview on wide screens). */}
      <div className="hidden gap-5 md:grid md:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <div key={d.key} className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
            <p className="mb-2.5 text-xs font-bold text-slate-500">{d.label}</p>
            <BreakdownPanel rows={breakdown[d.key]} />
          </div>
        ))}
      </div>
    </div>
  );
}
