import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DashboardKpi } from "@/lib/tiktok/types";

const TREND_ICON: Record<DashboardKpi["trend"], LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

// Trend color deliberately does NOT use red for "down" (design system rule:
// red is reserved for danger/destructive only, see tech-design §7 semantic
// mapping) — a lower order count isn't an error state. The arrow icon
// direction carries the meaning instead of relying on color alone.
const TREND_CLASS: Record<DashboardKpi["trend"], string> = {
  up: "text-green-600",
  down: "text-zinc-600",
  flat: "text-zinc-400",
};

/**
 * KpiCard — per design §4: "ถ้ามี coveragePct < 100 ต้องโชว์ subtext เตือนเสมอ
 * (ผูก logic ไว้ใน component ไม่ใช่ทิ้งให้ผู้เรียกลืม)". The coverage-warning
 * subtext is computed here unconditionally from `kpi.coveragePct` — callers
 * never decide whether to show it.
 */
export function KpiCard({ kpi }: { kpi: DashboardKpi }) {
  const Icon = TREND_ICON[kpi.trend];
  const hasCoverageWarning = kpi.coveragePct !== undefined && kpi.coveragePct < 100;
  const deltaSign = kpi.deltaPct > 0 ? "+" : "";

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <span className="text-xs font-medium text-zinc-500">{kpi.label}</span>
      <span className="text-xl font-bold tracking-tight text-zinc-900 tabular-nums">{kpi.displayValue}</span>
      <div className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${TREND_CLASS[kpi.trend]}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="tabular-nums">
          {deltaSign}
          {kpi.deltaPct}%
        </span>
        <span className="font-normal text-zinc-400">vs เมื่อวาน</span>
      </div>
      {hasCoverageWarning && (
        <span className="mt-1.5 inline-block self-start rounded px-1.5 py-0.5 text-[0.65rem] font-bold text-amber-800 bg-amber-100">
          coverage {kpi.coveragePct}% — กรอกข้อมูลไม่ครบ
        </span>
      )}
    </div>
  );
}
