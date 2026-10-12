// CalendarNotices — แถบข้อความย่อของปฏิทิน (server-safe): โควตา LINE บรรทัดเดียว · เตือนข้อมูลไม่ครบ (ชนเพดานแถว)

import { AlertTriangle } from "lucide-react";
import type { LineQuota } from "@/lib/marketing/piece-types";

/** โควตา LINE 28 วัน บรรทัดเดียว (ตัวเลขจาก v_line_quota_28d ตรงๆ) — ให้รายการวันโผล่เร็วบนมือถือ */
export function LineQuotaLine({ q }: { q: LineQuota }) {
  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-xs tabular-nums ${
        q.overQuotaPlanned ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900"
      }`}
    >
      LINE 28 วัน: ส่งแล้ว {q.used28d}/{q.quota} · วางแผนอีก {q.planned28d}
      {q.overQuotaPlanned && " · แผนรวมเกินโควตา"}
    </p>
  );
}

/** ถึงเพดานแถวต่อครั้ง → ข้อมูลอาจไม่ครบ ต้องบอก ไม่ตัดเงียบ */
export function TruncatedNotice({ what }: { what: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>แสดง{what}ไม่ครบ — แคบช่วงวัน (เปลี่ยนเป็นมุมมองสัปดาห์) หรือใช้ตัวกรอง</span>
    </p>
  );
}
