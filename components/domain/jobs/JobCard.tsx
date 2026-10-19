"use client";

// JobCard — การ์ดใบงานบนบอร์ด: ป้ายหลัก 1 อัน (สีตามความเร่งด่วน) + ป้ายรอง · เลขงาน · แบบ · จำนวน·โลหะ · ผู้ถือ · ค้างกี่วัน · ครบกำหนด
// ลิงก์ทั้งการ์ดไปหน้าใบงาน (≥ 44px) · ธงทุกตัวมาจาก v_job_board (DB ตัดสิน) · แถบสีซ้ายตาม tone ป้ายหลัก
// id = `${idPrefix}-job-${id}` ให้ส่วน "งานที่วิ่งอยู่" เลื่อนมาหา (การ์ดมี 2 ชุด: board/list) · highlighted = วงแหวน 3 วินาทีหลังถูกเลื่อนมา

import Link from "next/link";
import { UserRound } from "lucide-react";
import { StatusChip, STATUS_BAR } from "@/components/domain/jobs/StatusChip";
import { dueInfo, primaryStatus, qtyLabel, secondaryStatuses, stageAgeLabel } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { BoardRow } from "@/lib/jobs/types";

export function JobCard({ row, todayTh, idPrefix = "board", highlighted = false }: { row: BoardRow; todayTh: string; idPrefix?: "board" | "list"; highlighted?: boolean }) {
  const primary = primaryStatus(row, todayTh);
  const secondary = secondaryStatuses(row, todayTh);
  const due = dueInfo(row, todayTh);
  const age = stageAgeLabel(row);
  return (
    <li id={`${idPrefix}-job-${row.id}`} className="min-w-0 scroll-mt-24">
      <Link
        href={`/jobs/${row.id}`}
        className={`block min-h-11 min-w-0 rounded-lg border border-l-4 p-3 hover:border-y-zinc-500 hover:border-r-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${STATUS_BAR[primary.tone]} ${
          highlighted ? "border-primary-600 bg-primary-50 ring-2 ring-primary-600 ring-offset-2" : "border-zinc-200 bg-white"
        }`}
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip status={primary} size="primary" />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-bold text-zinc-900 tabular-nums">{row.jobNo}</span>
          <span className="text-xs text-zinc-700">{SOURCE_LABEL[row.sourceKind] ?? row.sourceKind}</span>
        </div>
        <p className="mt-0.5 min-w-0 text-sm font-medium text-zinc-900 [overflow-wrap:anywhere]">{row.designLabel}</p>
        <p className="text-sm text-zinc-700">
          {qtyLabel(row)} · {METAL_LABEL[row.metal] ?? row.metal}
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
          <p className={`mt-0.5 text-sm tabular-nums ${due.kind === "overdue" ? "font-bold text-red-800" : "text-zinc-800"}`}>
            {due.kind === "overdue" ? "เลยกำหนด " : "กำหนดส่ง "}
            {thaiDate(row.dueDate, false)}
          </p>
        )}
        {secondary.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="สถานะอื่นที่ต้องดู">
            {secondary.map((s) => (
              <li key={s.key}>
                <StatusChip status={s} />
              </li>
            ))}
          </ul>
        )}
      </Link>
    </li>
  );
}
