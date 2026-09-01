// OrphanBacklogPanel — Feature B (task brief "แยก orphan ตามอายุ") on
// /crm/import, server-rendered above the history table. Pure presentational
// component: the fetch (getOrphanBacklog, lib/actions/import-line-items.ts)
// and its fail-soft try/catch both live in page.tsx — this component only
// ever receives an already-successful OrphanBacklog, so it never needs to
// render its own error state. When the fetch itself fails, page.tsx simply
// never renders this component at all (panel disappears, rest of the page
// is unaffected).
//
// Two groups, different tone on purpose:
//   - "รอออเดอร์" (amber) — still worth waiting for the matching order-report
//     file, systemically self-heals once it lands (see getOrphanBacklog's
//     "STRICTLY READ-ONLY" header comment — this panel never writes).
//   - "ไม่มีออเดอร์ต้นทาง" (zinc, NOT red/danger) — old enough (>= 7 days,
//     ORPHAN_WAIT_DAYS) that the order probably doesn't exist upstream
//     anymore. This is a "give up waiting" status, not a fault — task brief
//     is explicit: "เป็นสถานะ 'เลิกรอ' ไม่ใช่ danger อย่าใช้สีแดง".
//
// Order numbers render in <code> (monospace, natively selectable) rather
// than behind a copy button — the owner needs to paste them into Shipnity's
// own search box, and plain selectable text gets there without adding
// client-side clipboard code to what would otherwise be a server component.

import { Clock, Search } from "lucide-react";
import type { OrphanBacklog, OrphanOrderGroup } from "@/lib/actions/import-line-items";
import { formatCount } from "@/lib/tiktok/format";

function OrphanGroupList({ groups }: { groups: OrphanOrderGroup[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <li
          key={g.sourceOrderNo}
          className="inline-flex items-center gap-1.5 rounded-md border border-white bg-white/70 px-2 py-1 text-xs"
        >
          <code className="font-mono font-semibold text-zinc-800">{g.sourceOrderNo}</code>
          <span className="text-zinc-500">
            · {formatCount(g.lineCount)} แถว · อายุ {formatCount(g.ageDays)} วัน
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OrphanBacklogPanel({ backlog }: { backlog: OrphanBacklog }) {
  if (backlog.totalOrderCount === 0) return null;

  const shownCount = backlog.waiting.length + backlog.noSource.length;

  return (
    <div className="flex flex-col gap-2">
      {backlog.waiting.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            รอออเดอร์ ({formatCount(backlog.waiting.length)})
          </h3>
          <p className="mt-1 text-xs text-amber-800">
            ยังไม่พบรายงานยอดขายของออเดอร์เหล่านี้ — จะจับคู่และคำนวณกำไรให้อัตโนมัติเมื่อนำเข้ารายงานยอดขายของออเดอร์นั้นแล้ว
          </p>
          <OrphanGroupList groups={backlog.waiting} />
        </div>
      )}

      {backlog.noSource.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            ไม่มีออเดอร์ต้นทาง ({formatCount(backlog.noSource.length)})
          </h3>
          <p className="mt-1 text-xs text-zinc-600">
            เกิน 7 วันแล้วยังไม่พบรายงานยอดขายของออเดอร์เหล่านี้ — น่าจะถูกยกเลิกใน Shipnity เอาเลขไปเช็คได้ ·
            ถ้าออเดอร์มาภายหลังระบบจับคู่ให้อัตโนมัติเหมือนเดิม
          </p>
          <OrphanGroupList groups={backlog.noSource} />
        </div>
      )}

      {backlog.listCapped && (
        <p className="text-xs text-zinc-500">
          แสดง {formatCount(shownCount)} จากทั้งหมด {formatCount(backlog.totalOrderCount)} ออเดอร์ (
          {formatCount(backlog.totalLineCount)} แถว)
        </p>
      )}
    </div>
  );
}
