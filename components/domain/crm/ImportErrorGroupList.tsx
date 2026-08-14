import type { CrmImportErrorRow } from "@/lib/actions/crm";
import { formatCount, formatThaiDateOnly } from "@/lib/tiktok/format";

// error_code values set by analytics.transform_pending_orders (see
// supabase/migrations/0020_crm_b1_views.sql comment on stg_order_import.error_code):
// channel_alias_missing, order_date_missing, exception. "phone_invalid" has no
// dedicated branch in the proc yet — label kept here anyway so an unmapped
// code (falls to the `?? code` fallback below) still reads sensibly if it
// ever appears.
const ERROR_CODE_LABEL_TH: Record<string, string> = {
  channel_alias_missing: "ไม่รู้จักชื่อช่องทาง",
  order_date_missing: "ไม่มีวันที่ออเดอร์",
  phone_invalid: "เบอร์โทรไม่ถูกต้อง",
  exception: "ข้อผิดพลาดอื่นๆ (ระบบ)",
};

interface ErrorGroup {
  errorCode: string;
  totalCount: number;
  files: { batchId: string; fileName: string | null; importedAt: string; count: number }[];
}

function groupByErrorCode(rows: CrmImportErrorRow[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const g = map.get(r.errorCode) ?? { errorCode: r.errorCode, totalCount: 0, files: [] };
    g.totalCount += r.errorCount;
    g.files.push({ batchId: r.batchId, fileName: r.fileName, importedAt: r.importedAt, count: r.errorCount });
    map.set(r.errorCode, g);
  }
  return Array.from(map.values()).sort((a, b) => b.totalCount - a.totalCount);
}

export function ImportErrorGroupList({ rows }: { rows: CrmImportErrorRow[] }) {
  const groups = groupByErrorCode(rows);

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.errorCode} className="rounded-lg border border-red-200 bg-red-50 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-red-900">{ERROR_CODE_LABEL_TH[g.errorCode] ?? g.errorCode}</h3>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold tabular-nums text-red-800">
              {formatCount(g.totalCount)} รายการ
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {g.files.map((f) => (
              <li key={`${f.batchId}-${g.errorCode}`} className="flex items-center justify-between text-xs text-red-800">
                <span className="truncate">{f.fileName ?? "(ไม่ทราบชื่อไฟล์)"}</span>
                <span className="shrink-0 tabular-nums">
                  {formatThaiDateOnly(f.importedAt)} · {formatCount(f.count)} แถว
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
