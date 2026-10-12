"use client";

// JobCard — การ์ดใบงานบนบอร์ด: เลขงาน · แบบ · จำนวน·โลหะ · ผู้ถือ · ค้างกี่วัน · ครบกำหนด · ป้าย (ข้อความ+ไอคอน ไม่พึ่งสี)
// ลิงก์ทั้งการ์ดไปหน้าใบงาน (≥ 44px) · ธงทุกตัวมาจาก v_job_board (DB ตัดสิน)

import Link from "next/link";
import { AlertTriangle, CircleDashed, Clock, Info, PauseCircle, UserRound } from "lucide-react";
import { cardBadges, stageAgeLabel } from "@/lib/jobs/board";
import type { BadgeTone } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { BoardRow } from "@/lib/jobs/types";

const TONE: Record<BadgeTone, string> = {
  red: "border-red-300 bg-red-50 text-red-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  gray: "border-zinc-300 bg-zinc-50 text-zinc-800",
  blue: "border-sky-300 bg-sky-50 text-sky-900",
};
const ICON: Record<string, typeof Info> = { overdue: AlertTriangle, hold: PauseCircle, deposit: CircleDashed, stale: Clock, auto: Info, qty: Info, handoff: AlertTriangle, mismatch: AlertTriangle };

export function JobCard({ row }: { row: BoardRow }) {
  const badges = cardBadges(row);
  const age = stageAgeLabel(row);
  return (
    <li>
      <Link
        href={`/jobs/${row.id}`}
        className={`block min-h-11 rounded-lg border bg-white p-3 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${row.isOverdue ? "border-red-400" : "border-zinc-200"}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-bold text-zinc-900 tabular-nums">{row.jobNo}</span>
          <span className="text-xs text-zinc-700">{SOURCE_LABEL[row.sourceKind] ?? row.sourceKind}</span>
        </div>
        <p className="mt-0.5 text-sm font-medium break-words text-zinc-900">{row.designLabel}</p>
        <p className="text-sm text-zinc-700">
          {row.qtyPlanned} ชิ้น · {METAL_LABEL[row.metal] ?? row.metal}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-zinc-800">
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
            {row.holderName ?? "ยังไม่มีผู้ถือ"}
          </span>
          {age && <span>ค้าง {age}</span>}
          {row.stageCount > 0 && (
            <span className="tabular-nums">
              ขั้น {row.stageDoneCount}/{row.stageCount}
            </span>
          )}
        </p>
        {row.dueDate && (
          <p className={`mt-0.5 text-sm tabular-nums ${row.isOverdue ? "font-bold text-red-800" : "text-zinc-800"}`}>
            {row.isOverdue ? "เลยกำหนด " : "กำหนดส่ง "}
            {thaiDate(row.dueDate, false)}
          </p>
        )}
        {badges.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="สถานะที่ต้องดู">
            {badges.map((b) => {
              const Icon = ICON[b.key] ?? Info;
              return (
                <li key={b.key} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${TONE[b.tone]}`}>
                  <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {b.label}
                </li>
              );
            })}
          </ul>
        )}
      </Link>
    </li>
  );
}
