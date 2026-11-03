"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { RelativeBar } from "@/components/ui/RelativeBar";
import { formatInt } from "@/lib/marketing/ring-size-format";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { NoData } from "./StatsCard";

// ux-ring-size-stats.md §7.8 — การกระจายเส้นรอบวง (มม.) · พับไว้เป็นค่าเริ่มต้น · ใช้ตรวจว่าค่ากองอยู่ติดเส้นปัดเบอร์ไหม (ช่าง/ทีม)
// spec เสนอให้ตัดทิ้งได้ใน v1 (D10) แต่ design §6 ระบุไว้ จึงไม่ตัดเอง — ตัดถ้าเจ้าของไม่เปิดดูตอนทดลอง
// ตารางมี overflow-x-auto + tabIndex=0 + aria-label (ยกเว้นเดียวของหน้านี้ที่เลื่อนแนวนอนได้)

export function CircHistogram({ stats }: { stats: RingSizeStats }) {
  const [open, setOpen] = useState(false);
  const rows = stats.circHist;
  const max = rows ? rows.reduce((m, r) => Math.max(m, r.count), 0) : 0;
  return (
    <CollapsibleSection id="rs-circ" title="การกระจายเส้นรอบวง (มม.)" open={open} onToggle={() => setOpen((v) => !v)}>
      {!rows || rows.length === 0 ? (
        <NoData />
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="group" aria-label="ตารางการกระจายเส้นรอบวงเป็นมิลลิเมตร เลื่อนดูได้">
          <table className="w-full text-sm">
            <caption className="sr-only">จำนวนครั้งที่วัดได้ ตามเส้นรอบวง (ช่วงละ 1 มม.)</caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-zinc-600">
                <th scope="col" className="py-1 pr-2">
                  มม.
                </th>
                <th scope="col" className="py-1 text-right">
                  ครั้ง
                </th>
                <th scope="col" className="w-1/2 py-1 pl-3">
                  <span className="sr-only">แท่ง</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.mm} className="border-t border-zinc-100">
                  <th scope="row" className="py-1 pr-2 text-left tabular-nums text-zinc-800">
                    {r.mm}
                  </th>
                  <td className="py-1 text-right tabular-nums text-zinc-800">{formatInt(r.count)}</td>
                  <td className="py-1 pl-3">
                    <RelativeBar value={r.count} max={max} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}
