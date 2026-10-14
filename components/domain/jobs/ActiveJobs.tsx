"use client";

// ActiveJobs — ส่วน "งานที่วิ่งอยู่": เรียงเร่งด่วนก่อน · แถวละ 1 ใบ · กดแถว = เลื่อนไปการ์ดในบอร์ด (focusJob) · ลิงก์ ↗ = เปิดใบงาน
// แถวมี 2 control ที่ไม่ซ้อนกัน: <button> ทั้งแถว (เนื้อในเป็น span ทั้งหมด) + <Link> ไอคอน (พี่น้องกัน ไม่ใช่ลูก)
// 🔴 ไม่แสดงราคา/ต้นทุน/ชื่อลูกค้า/sourceRef — ใช้เฉพาะ field ของ BoardRow ที่บอร์ดเดิมแสดงอยู่แล้ว

import Link from "next/link";
import type { RefObject } from "react";
import { ArrowDown, ArrowUpRight, CheckCircle2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusChip, STATUS_BAR } from "@/components/domain/jobs/StatusChip";
import { ATTENTION_MAX_RANK, columnOf, compareBySeverity, dueInfo, primaryStatus, secondaryStatuses, stageAgeLabel } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { METAL_LABEL, SOURCE_LABEL, STAGE_STATUS_LABEL } from "@/lib/jobs/types";
import type { BoardRow } from "@/lib/jobs/types";

export const ACTIVE_CAP = 10;

const DUE_CLS = { overdue: "font-bold text-red-800", soon: "font-semibold text-amber-900", normal: "text-zinc-800", none: "text-zinc-700" } as const;

function ActiveJobRow({
  row,
  todayTh,
  stageNames,
  known,
  onFocus,
}: {
  row: BoardRow;
  todayTh: string;
  stageNames: ReadonlyMap<string, string>;
  known: ReadonlySet<string>;
  onFocus: (r: BoardRow) => void;
}) {
  const primary = primaryStatus(row, todayTh);
  const secondary = secondaryStatuses(row, todayTh);
  const due = dueInfo(row, todayTh);
  const age = stageAgeLabel(row);
  const stageName = stageNames.get(columnOf(row, known)) ?? row.stageName ?? "ยังไม่เริ่ม";
  const stageState = row.stageStatus ? (STAGE_STATUS_LABEL[row.stageStatus] ?? row.stageStatus) : null;
  const stageDetail = [stageState, age ? `ค้าง ${age}` : null].filter(Boolean).join(" · ");
  const pct = row.stageCount > 0 ? Math.min(100, Math.round((row.stageDoneCount / row.stageCount) * 100)) : 0;
  const meta = `${row.qtyPlanned} ชิ้น · ${METAL_LABEL[row.metal] ?? row.metal} · ${SOURCE_LABEL[row.sourceKind] ?? row.sourceKind}`;

  return (
    <li className={`flex items-stretch rounded-lg border border-l-4 border-zinc-200 bg-white hover:bg-zinc-50 ${STATUS_BAR[primary.tone]}`} data-job-id={row.id}>
      <button
        type="button"
        onClick={() => onFocus(row)}
        className="min-h-11 min-w-0 flex-1 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        <span className="grid gap-x-3 gap-y-1.5 lg:grid-cols-[11rem_minmax(0,1.3fr)_minmax(0,1.2fr)_9rem_8rem_auto] lg:items-center">
          {/* ป้ายหลัก + รอง (มือถือ: ป้ายรองไปท้ายการ์ด) */}
          <span className="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-start">
            <StatusChip status={primary} size="primary" />
            {secondary.length > 0 && (
              <span className="flex flex-wrap gap-1 max-lg:hidden">
                {secondary.map((s) => (
                  <StatusChip key={s.key} status={s} />
                ))}
              </span>
            )}
          </span>
          {/* เลขงาน + แบบ + จำนวน·โลหะ·แหล่ง */}
          <span className="block min-w-0">
            <span className="block text-base font-bold tabular-nums text-zinc-900">{row.jobNo}</span>
            <span className="line-clamp-2 block break-words text-sm font-medium text-zinc-900">{row.designLabel}</span>
            <span className="block text-xs text-zinc-700">{meta}</span>
          </span>
          {/* ขั้นปัจจุบัน */}
          <span className="block min-w-0 text-sm text-zinc-800">
            <span className="block max-lg:hidden">
              <span className="block break-words font-bold text-zinc-900">{stageName}</span>
              <span className="block text-xs text-zinc-700">{[stageDetail, row.stageCount > 0 ? `ขั้น ${row.stageDoneCount}/${row.stageCount}` : null].filter(Boolean).join(" · ")}</span>
              {row.stageCount > 0 && (
                <span className="mt-1 block h-1 w-full rounded-full bg-zinc-200" aria-hidden="true">
                  <span className="block h-1 rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
                </span>
              )}
            </span>
            <span className="lg:hidden">
              อยู่ขั้น: <span className="font-bold text-zinc-900">{stageName}</span>
              {stageDetail && <span className="text-zinc-700"> ({stageDetail})</span>}
            </span>
          </span>
          {/* ผู้ถือ */}
          <span className="flex min-w-0 items-center gap-1 text-sm text-zinc-800">
            <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={row.holderName ?? "ยังไม่มีผู้ถือ"}>
              {row.holderName ?? "ยังไม่มีผู้ถือ"}
            </span>
          </span>
          {/* กำหนดส่ง */}
          <span className="block text-sm tabular-nums">
            {row.dueDate && <span className="block text-zinc-900">{thaiDate(row.dueDate, false)}</span>}
            <span className={`block text-xs ${DUE_CLS[due.kind]}`}>{due.text}</span>
          </span>
          {/* มือถือ: ป้ายรองท้ายการ์ด */}
          {secondary.length > 0 && (
            <span className="flex flex-wrap gap-1 lg:hidden">
              {secondary.map((s) => (
                <StatusChip key={s.key} status={s} />
              ))}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700">
            ดูในบอร์ด
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </span>
      </button>
      <Link
        href={`/jobs/${row.id}`}
        aria-label={`เปิดใบงาน ${row.jobNo}`}
        className="flex min-h-11 min-w-11 shrink-0 items-start justify-center rounded-r-lg p-3 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function ActiveJobs({
  rows,
  todayTh,
  stageNames,
  known,
  showAll,
  onToggleAll,
  onFocus,
  headingRef,
}: {
  rows: readonly BoardRow[];
  todayTh: string;
  stageNames: ReadonlyMap<string, string>;
  known: ReadonlySet<string>;
  showAll: boolean;
  onToggleAll: () => void;
  onFocus: (r: BoardRow) => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const sorted = [...rows].sort((a, b) => compareBySeverity(a, b, todayTh));
  const attention = sorted.filter((r) => primaryStatus(r, todayTh).rank <= ATTENTION_MAX_RANK).length;
  const shown = showAll ? sorted : sorted.slice(0, ACTIVE_CAP);
  const overCap = sorted.length > ACTIVE_CAP;

  return (
    <section aria-labelledby="active-jobs-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="active-jobs-heading" ref={headingRef} tabIndex={-1} className="scroll-mt-24 text-lg font-bold text-zinc-900 focus:outline-none">
          งานที่วิ่งอยู่ ({sorted.length})
        </h2>
        {attention > 0 ? (
          <p className="text-sm font-semibold text-amber-900">ต้องดู {attention} ใบ · เรียงเร่งด่วนก่อน</p>
        ) : (
          <p className="inline-flex items-center gap-1 text-sm font-semibold text-green-900">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ไม่มีงานที่ต้องตามเป็นพิเศษ
          </p>
        )}
        <p className="text-xs text-zinc-700">กดแถวเพื่อดูว่าอยู่ขั้นไหน</p>
      </div>
      <ul className="space-y-2">
        {shown.map((r) => (
          <ActiveJobRow key={r.id} row={r} todayTh={todayTh} stageNames={stageNames} known={known} onFocus={onFocus} />
        ))}
      </ul>
      {overCap && (
        <Button type="button" variant="secondary" aria-expanded={showAll} onClick={onToggleAll}>
          {showAll ? "แสดงน้อยลง" : `แสดงทั้งหมด ${sorted.length} ใบ`}
        </Button>
      )}
    </section>
  );
}
