"use client";

import { useState } from "react";
import { RelativeBar } from "@/components/ui/RelativeBar";
import { dailyNewestFirst, formatInt } from "@/lib/marketing/ring-size-format";
import { thaiDate } from "@/lib/jobs/dates";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { NoData, StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §7.7 — รายวัน · ใหม่→เก่า · 14 วันล่าสุด + ปุ่มขยาย (ช่วง 180 วัน = 180 แถว ไม่ควรเป็นค่าเริ่มต้น)
// วันก่อน data_since ไม่ใช่ "0 ครั้ง" แต่คือ "ยังไม่ได้เก็บข้อมูล" ⇒ ตัดออกแล้วแทรกแถวคั่นท้ายรายการ
// ไม่มีเวลาระดับนาที/ชั่วโมง (RPC ไม่ให้ และ client ไม่รับ) · ใช้ slice ไม่ใช้ conditional render ซ้ำซ้อน

const COLLAPSED_DAYS = 14;

export function DailyList({ stats, from }: { stats: RingSizeStats; from: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!stats.daily) {
    return (
      <StatsCard id="rs-daily" title="รายวัน">
        <NoData />
      </StatsCard>
    );
  }
  const rows = dailyNewestFirst(stats.daily, stats.dataSince);
  if (rows.length === 0) {
    return (
      <StatsCard id="rs-daily" title="รายวัน">
        <NoData />
      </StatsCard>
    );
  }
  const max = rows.reduce((m, r) => Math.max(m, r.sessions), 0);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_DAYS);
  const canExpand = rows.length > COLLAPSED_DAYS;
  const showsOldest = shown.length === rows.length;
  const beforeStart = stats.dataSince !== null && stats.dataSince > from;

  return (
    <StatsCard id="rs-daily" title="รายวัน">
      <ul className="space-y-1.5" id="rs-daily-list">
        {shown.map((r) => (
          <li key={r.date} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 tabular-nums text-zinc-600">{thaiDate(r.date, false)}</span>
            <RelativeBar value={r.sessions} max={max} className="flex-1" />
            <span className="shrink-0 whitespace-nowrap text-right tabular-nums text-zinc-700">
              {formatInt(r.sessions)} เปิด · {formatInt(r.measured)} ได้เบอร์
            </span>
          </li>
        ))}
        {beforeStart && showsOldest && (
          <li className="pt-1 text-center text-xs text-zinc-600">— ก่อนวันนี้ยังไม่ได้เก็บข้อมูล —</li>
        )}
      </ul>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="rs-daily-list"
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
        >
          {expanded ? `แสดงแค่ ${COLLAPSED_DAYS} วันล่าสุด` : `แสดงทั้งหมด ${rows.length} วัน`}
        </button>
      )}
    </StatsCard>
  );
}
