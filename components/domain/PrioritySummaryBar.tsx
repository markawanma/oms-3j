import { AlertTriangle, PackageCheck, Sparkles } from "lucide-react";
import type { PrioritySummary } from "@/lib/types";

export function PrioritySummaryBar({ summary }: { summary: PrioritySummary }) {
  const chips = [
    { label: "ออเดอร์ใหม่", count: summary.newCount, icon: Sparkles, tone: "text-blue-700 bg-blue-50 border-blue-200" },
    {
      label: "ของไม่พอ",
      count: summary.oversoldCount,
      icon: AlertTriangle,
      tone: "text-red-700 bg-red-50 border-red-200",
    },
    {
      label: "รอจัดส่ง",
      count: summary.toShipCount,
      icon: PackageCheck,
      tone: "text-amber-700 bg-amber-50 border-amber-200",
    },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1" role="status" aria-label="สรุปออเดอร์ที่ต้องดำเนินการ">
      {chips.map(({ label, count, icon: Icon, tone }) => (
        <div key={label} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${tone}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
          <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-xs font-semibold">{count}</span>
        </div>
      ))}
    </div>
  );
}
