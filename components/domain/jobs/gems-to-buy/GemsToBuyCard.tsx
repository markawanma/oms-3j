"use client";

// GemsToBuyCard — การ์ดต่อรายการของมือถือ (< md · 360px) · ข้อมูลเดียวกับ GemsToBuyTable
// ช่องเลือก 44×44 · ชื่อ break-words · เลข whitespace-nowrap (ไม่ตัดกลางตัวเลข) · ปุ่ม ≥ 44px · เปิดต้นทุน = เพิ่มบรรทัดในการ์ด

import { GemCostCell } from "@/components/domain/jobs/gems-to-buy/GemCostCell";
import { GemDue, GemOrderJobLines, GemQty, RowActions, sizeText } from "@/components/domain/jobs/gems-to-buy/GemRowParts";
import type { GemsListProps } from "@/components/domain/jobs/gems-to-buy/GemsToBuyTable";

const ID = "gtb-c";

export function GemsToBuyCard(p: GemsListProps) {
  const showCost = p.tab === "pending" && p.cost.status !== "off";
  return (
    <ul className="space-y-3 md:hidden" data-testid="gems-cards" aria-label={p.tab === "pending" ? "พลอยที่ใบงานต้องใช้และยังไม่ได้สั่ง" : "พลอยที่ทำเครื่องหมายว่าสั่งแล้ว"}>
      {p.rows.map((row) => {
        const open = p.expanded.has(row.key);
        const busy = p.busyKeys.has(row.key) || p.busyKeys.has("*");
        return (
          <li key={row.key} aria-label={row.group.label} aria-busy={busy || undefined} className={`rounded-lg border bg-white p-3 ${p.selected.has(row.key) ? "border-primary-600 bg-primary-50" : "border-zinc-200"}`}>
            <div className="flex items-start gap-2">
              <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={p.selected.has(row.key)} onChange={() => p.onToggleSelect(row.key)} aria-label={`เลือก ${row.group.label}`} />
              </label>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="pt-2.5 text-base font-bold text-zinc-900 break-words [overflow-wrap:anywhere]">
                  {row.group.typeName} · {row.group.shapeName} · <span className="whitespace-nowrap">{sizeText(row)} มม.</span>
                </p>
                <GemQty row={row} tab={p.tab} big />
                <p className="text-sm text-zinc-800">
                  <span className="whitespace-nowrap tabular-nums">{row.jobs.length} ใบ</span> · เร็วสุด <GemDue due={row.earliestDue} todayBkk={p.todayBkk} />
                </p>
                {showCost && (
                  <p className="text-sm text-zinc-800 print:hidden">
                    ต้นทุนประมาณ (ส่วนที่ยังไม่สั่ง): <GemCostCell cost={p.cost} row={row} />
                  </p>
                )}
                <RowActions row={row} tab={p.tab} expanded={open} busy={busy} idPrefix={ID} onToggle={() => p.onToggleExpand(row.key)} onAct={() => p.onActRow(row)} />
                {open && (
                  <GemOrderJobLines
                    row={row}
                    tab={p.tab}
                    todayBkk={p.todayBkk}
                    busyKeys={p.busyKeys}
                    removedQty={p.removedQty}
                    showAll={p.moreJobs.has(row.key)}
                    idPrefix={ID}
                    onShowAll={() => p.onShowAllJobs(row.key)}
                    onAct={(j) => p.onActJob(row, j)}
                  />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
