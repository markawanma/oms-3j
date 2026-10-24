"use client";

// GemsToBuyTable — ตารางจอกว้าง (≥ md) ของหน้า "พลอยที่ต้องสั่งซื้อ" · มือถือใช้ GemsToBuyCard (ข้อมูลเดียวกัน คนละหน้าตา)
// semantic: caption sr-only · th scope · ทุกแถว aria-label · ช่องเลือก (☐) ไม่ใช่ช่อง "สั่งแล้ว" — "สั่งแล้ว" เป็นปุ่มข้อความ (D2)
// แถวกาง = <tr> colSpan รายการใบ · กางหลายแถวพร้อมกันได้

import { Fragment } from "react";
import { GemCostCell } from "@/components/domain/jobs/gems-to-buy/GemCostCell";
import { GemDue, GemOrderJobLines, GemQty, RowActions, sizeText } from "@/components/domain/jobs/gems-to-buy/GemRowParts";
import type { GemCostState } from "@/components/domain/jobs/gems-to-buy/useGemCost";
import type { GtbJob, GtbRow, GtbSort, GtbTab } from "@/lib/jobs/gems-to-buy";

export interface GemsListProps {
  rows: GtbRow[];
  tab: GtbTab;
  sort: GtbSort;
  todayBkk: string;
  selected: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  moreJobs: ReadonlySet<string>;
  busyKeys: ReadonlySet<string>;
  cost: GemCostState;
  onToggleSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onShowAllJobs: (key: string) => void;
  onActRow: (row: GtbRow) => void;
  onActJob: (row: GtbRow, job: GtbJob) => void;
}

const TH = "px-3 py-2 text-left text-xs font-semibold text-zinc-700";
const ID = "gtb-t";

export function GemsToBuyTable(p: GemsListProps) {
  const showCost = p.tab === "pending" && p.cost.status !== "off";
  const colSpan = 8 + (showCost ? 1 : 0);
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white md:block" data-testid="gems-table">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">{p.tab === "pending" ? "พลอยที่ใบงานต้องใช้และยังไม่ได้สั่ง" : "พลอยที่ทำเครื่องหมายว่าสั่งแล้ว"}</caption>
        <thead className="bg-zinc-50">
          <tr>
            <th scope="col" className={`${TH} w-12`}>
              <span className="sr-only">เลือก</span>
            </th>
            <th scope="col" className={TH}>ชนิด</th>
            <th scope="col" className={TH}>รูปทรง</th>
            <th scope="col" className={TH}>ขนาด (มม.)</th>
            <th scope="col" className={`${TH} text-right`}>{p.tab === "pending" ? "ต้องใช้ (เม็ด)" : "สั่งไว้ (เม็ด)"}</th>
            <th scope="col" className={TH}>จำนวนใบ</th>
            <th scope="col" className={TH}>{p.tab === "pending" ? "ครบกำหนดเร็วสุด" : "กำหนดเร็วสุด"}</th>
            {showCost && <th scope="col" className={TH}>ต้นทุนประมาณ (ส่วนที่ยังไม่สั่ง)</th>}
            <th scope="col" className={TH}>
              <span className="sr-only">การกระทำ</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {p.rows.map((row, i) => {
            const open = p.expanded.has(row.key);
            const prev = i > 0 ? p.rows[i - 1] : null;
            const hideType = p.sort === "type" && prev !== null && prev.group.typeId === row.group.typeId;
            const busy = p.busyKeys.has(row.key) || p.busyKeys.has("*");
            return (
              <Fragment key={row.key}>
                <tr aria-label={row.group.label} aria-busy={busy || undefined} className={`align-top ${p.selected.has(row.key) ? "bg-primary-50" : ""}`}>
                  <td className="px-3 py-1">
                    <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                      <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={p.selected.has(row.key)} onChange={() => p.onToggleSelect(row.key)} aria-label={`เลือก ${row.group.label}`} />
                    </label>
                  </td>
                  <td className="px-3 py-3 font-semibold text-zinc-900 break-words [overflow-wrap:anywhere]">{hideType ? <span className="sr-only">{row.group.typeName}</span> : row.group.typeName}</td>
                  <td className="px-3 py-3 text-zinc-900 break-words [overflow-wrap:anywhere]">{row.group.shapeName}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-zinc-900">{sizeText(row)}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-block text-left">
                      <GemQty row={row} tab={p.tab} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-zinc-900">{row.jobs.length} ใบ</td>
                  <td className="px-3 py-3 text-zinc-900">
                    <GemDue due={row.earliestDue} todayBkk={p.todayBkk} />
                  </td>
                  {showCost && (
                    <td className="px-3 py-3">
                      <GemCostCell cost={p.cost} row={row} />
                    </td>
                  )}
                  <td className="px-3 py-1">
                    <RowActions row={row} tab={p.tab} expanded={open} busy={busy} idPrefix={ID} onToggle={() => p.onToggleExpand(row.key)} onAct={() => p.onActRow(row)} />
                  </td>
                </tr>
                {open && (
                  <tr className="bg-zinc-50">
                    <td />
                    <td colSpan={colSpan - 1} className="px-3 py-3">
                      <GemOrderJobLines
                        row={row}
                        tab={p.tab}
                        todayBkk={p.todayBkk}
                        busyKeys={p.busyKeys}
                        showAll={p.moreJobs.has(row.key)}
                        idPrefix={ID}
                        onShowAll={() => p.onShowAllJobs(row.key)}
                        onAct={(j) => p.onActJob(row, j)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
