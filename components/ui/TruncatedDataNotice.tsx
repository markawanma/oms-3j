import { AlertTriangle } from "lucide-react";

/**
 * Shown when a list action had to cap rows at MAX_UNBOUNDED_ROWS (see
 * lib/supabase/query-limits.ts) and the real row count on the server is
 * higher than what made it to this screen — e.g. PostgREST's implicit
 * 1000-row cap silently under-reported real revenue on /crm/orders on
 * 2026-08-27. Any page whose data can be capped must render this rather than
 * quietly showing a partial list/total as if it were complete.
 *
 * No interactivity — safe to render from a server component (page.tsx),
 * so this deliberately has no "use client" directive.
 */
export function TruncatedDataNotice({
  totalCount,
  shownCount,
}: {
  totalCount: number;
  shownCount: number;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        แสดง <span className="font-semibold">{shownCount.toLocaleString("en-US")}</span> จากทั้งหมด{" "}
        <span className="font-semibold">{totalCount.toLocaleString("en-US")}</span> รายการ — ข้อมูลบางส่วนยังไม่แสดงบนหน้านี้
        กรุณาแจ้งทีมพัฒนา
      </span>
    </div>
  );
}
