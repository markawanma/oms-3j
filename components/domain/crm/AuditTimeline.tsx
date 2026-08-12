import { History } from "lucide-react";
import type { CrmAuditRow } from "@/lib/actions/crm";
import { EmptyState } from "@/components/ui/EmptyState";
import { auditActionLabel } from "@/lib/crm/audit";
import { formatBangkokTime } from "@/lib/format";

/** Presentational only (no mutation) — plain server component, rendered from
 * page.tsx only when getDevRole() !== "staff" (owner/admin-only section,
 * design §2.3 / migration 0021's crm_audit_log SELECT policy). */
export function AuditTimeline({ rows }: { rows: CrmAuditRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h3 className="text-sm font-bold text-zinc-800">ประวัติการแก้ไข</h3>
        <div className="mt-2">
          <EmptyState icon={History} title="ยังไม่มีประวัติการแก้ไข" description="การแก้ชื่อ/PII/โน้ตจะขึ้นที่นี่" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-800">ประวัติการแก้ไข ({rows.length})</h3>
      <ol className="mt-2.5 flex flex-col gap-2.5 border-l-2 border-zinc-100 pl-3.5">
        {rows.map((row) => (
          <li key={row.id} className="relative">
            <span className="absolute top-1.5 -left-[19px] h-2 w-2 rounded-full bg-primary-600" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-800">{auditActionLabel(row.action)}</p>
            <p className="text-[0.68rem] text-zinc-400">{formatBangkokTime(row.createdAt)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
