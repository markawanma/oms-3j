import { AlertTriangle } from "lucide-react";
import type { DashboardDataQuality } from "@/lib/tiktok/types";

/**
 * DataQualityBanner — persistent, no close button. Intentional (design §4):
 * "ต้องเห็นก่อนตัวเลข ไม่ใช่ทีหลัง" / "บังคับแสดงคู่กันเสมอ ปิดไม่ได้" — the
 * owner must see the coverage caveat before reading any KPI number, every
 * time. Design §7 flags this as worth re-validating after 1-2 weeks of real
 * use in case it becomes annoying; if so, the fix is a collapse toggle that
 * still defaults open — never a dismiss-forever control.
 */
export function DataQualityBanner({ dataQuality }: { dataQuality: DashboardDataQuality }) {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="text-sm leading-relaxed text-amber-900">
        <span className="font-bold">คุณภาพข้อมูล:</span> กำไรกรอกต้นทุนครบ{" "}
        <span className="font-bold tabular-nums">{dataQuality.costCoveragePct}%</span> · จังหวัด unknown{" "}
        <span className="font-bold tabular-nums">{dataQuality.provinceUnknownPct}%</span> · ที่อยู่รอตรวจสอบ{" "}
        <span className="font-bold tabular-nums">{dataQuality.addressPendingReviewCount} รายการ</span>
      </p>
    </div>
  );
}
