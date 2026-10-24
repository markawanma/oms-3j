"use client";

// ชิ้นส่วนที่ตารางจอกว้าง (GemsToBuyTable) กับการ์ดมือถือ (GemsToBuyCard) ใช้ร่วมกัน — ข้อมูลเดียวกัน คนละหน้าตา
//  - จำนวนทุกตัวคือค่าจาก DB ตรงๆ · qty_remaining กับ qty_excess แสดง "แยกกัน" ไม่หักลบกัน (ตั้งใจ)
//  - ป้ายสถานะทุกอันเป็น ไอคอน + คำ (ไม่พึ่งสีอย่างเดียว) · ไม่มีราคา/ต้นทุนในไฟล์นี้ (ต้นทุนอยู่ GemCostCell)

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { thaiDate, thaiDateTime } from "@/lib/jobs/dates";
import { jobItemKey, urgencyOf } from "@/lib/jobs/gems-to-buy";
import type { GtbJob, GtbRow, GtbTab } from "@/lib/jobs/gems-to-buy";

export const fmtN = (n: number): string => n.toLocaleString("en-US");
export const JOB_LINES_PAGE = 10;

export function UrgencyBadge({ due, todayBkk }: { due: string | null; todayBkk: string }) {
  const u = urgencyOf(due, todayBkk);
  if (u.kind === "overdue") {
    return (
      <Badge tone="red">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        เลยกำหนด {u.days} วัน
      </Badge>
    );
  }
  if (u.kind === "soon") {
    return (
      <Badge tone="amber">
        <Clock className="h-3 w-3" aria-hidden="true" />
        {u.days === 0 ? "ครบวันนี้" : `ครบใน ${u.days} วัน`}
      </Badge>
    );
  }
  return null;
}

export function GemDue({ due, todayBkk }: { due: string | null; todayBkk: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="whitespace-nowrap tabular-nums">{due === null ? "ไม่ระบุกำหนด" : thaiDate(due)}</span>
      <UrgencyBadge due={due} todayBkk={todayBkk} />
    </span>
  );
}

const SkyChip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded-sm bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
    {children}
  </span>
);
const AmberChip = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
    {children}
  </span>
);

/** จำนวนหลักของแถว + ป้ายประกอบ (ยังไม่สั่งแท็บ: ต้องใช้ · แท็บสั่งแล้ว: สั่งไว้) */
export function GemQty({ row, tab, big = false }: { row: GtbRow; tab: GtbTab; big?: boolean }) {
  const g = row.group;
  const changed = row.jobs.some((j) => j.changedAfterOrder);
  const main = tab === "pending" ? g.qtyNeededNow : g.qtyOrdered;
  return (
    <div className="space-y-1">
      <p className={`whitespace-nowrap font-bold tabular-nums text-zinc-900 ${big ? "text-2xl" : "text-base"}`}>
        {fmtN(main)} <span className="text-sm font-normal text-zinc-700">{tab === "pending" ? "เม็ด" : "เม็ด (สั่งไว้)"}</span>
      </p>
      {tab === "pending" && g.qtyOrdered > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <SkyChip>สั่งไปแล้ว {fmtN(g.qtyOrdered)}</SkyChip>
          <span className="whitespace-nowrap text-xs font-medium tabular-nums text-zinc-800">ยังไม่สั่ง {fmtN(g.qtyRemaining)}</span>
        </div>
      )}
      {g.qtyExcess > 0 && <AmberChip>สั่งเกินที่ใช้ตอนนี้ {fmtN(g.qtyExcess)}</AmberChip>}
      {changed && <AmberChip>ใบแก้จำนวนหลังสั่ง</AmberChip>}
    </div>
  );
}

/** ขนาดแสดงเป็น "4×6" (จาก DB ตัดศูนย์ท้ายแล้ว) */
export const sizeText = (row: GtbRow): string => row.group.sizeLabel;

export function RowActions({
  row,
  tab,
  expanded,
  busy,
  idPrefix,
  onToggle,
  onAct,
}: {
  row: GtbRow;
  tab: GtbTab;
  expanded: boolean;
  busy: boolean;
  idPrefix: string;
  onToggle: () => void;
  onAct: () => void;
}) {
  const verb = tab === "pending" ? "สั่งแล้ว" : "ยกเลิกสั่งแล้ว";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" loading={busy} onClick={onAct} aria-label={`${verb} — ${row.group.label}`}>
        {verb}
      </Button>
      <Button
        type="button"
        id={`${idPrefix}-expand-${row.key}`}
        variant="ghost"
        aria-expanded={expanded}
        aria-controls={`${idPrefix}-jobs-${row.key}`}
        aria-label={`${expanded ? "ซ่อนใบ" : "ดูใบ"} — ${row.group.label}`}
        onClick={onToggle}
      >
        {expanded ? "▴ ซ่อนใบ" : "▾ ดูใบ"}
      </Button>
    </div>
  );
}

function OrderedMeta({ job }: { job: GtbJob }) {
  if (job.orderedAt === null && job.orderedBy === null) return null;
  const when = job.orderedAt === null ? "" : `สั่งเมื่อ ${thaiDateTime(job.orderedAt)}`;
  const who = job.orderedBy === "me" ? "โดยคุณ" : job.orderedBy === "other" ? "โดยคนอื่น" : "";
  return <p className="text-xs text-zinc-700">{[when, who].filter(Boolean).join(" · ")}</p>;
}

/** บรรทัดใบในแถวที่กาง — ลิงก์ JB · แบบ · กำหนด · จำนวน · ปุ่มระดับใบ · มากกว่า 10 ใบ = ดูอีก n ใบ (ไม่ทำ scroll ซ้อน) */
export function GemOrderJobLines({
  row,
  tab,
  todayBkk,
  busyKeys,
  removedQty,
  showAll,
  idPrefix,
  onShowAll,
  onAct,
}: {
  row: GtbRow;
  tab: GtbTab;
  todayBkk: string;
  busyKeys: ReadonlySet<string>;
  removedQty: ReadonlyMap<string, number>;
  showAll: boolean;
  idPrefix: string;
  onShowAll: () => void;
  onAct: (job: GtbJob) => void;
}) {
  const verb = tab === "pending" ? "สั่งแล้ว" : "ยกเลิกสั่งแล้ว";
  const shown = showAll ? row.jobs : row.jobs.slice(0, JOB_LINES_PAGE);
  const rowBusy = busyKeys.has(row.key) || busyKeys.has("*");
  return (
    <div id={`${idPrefix}-jobs-${row.key}`}>
      <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
        {shown.map((j) => {
          const jobKey = `${row.key}:${j.jobId}`;
          return (
            <li key={j.jobId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 py-2" aria-busy={busyKeys.has(jobKey) || undefined}>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="break-words [overflow-wrap:anywhere]">
                  <Link href={`/jobs/${j.jobId}`} className="font-semibold text-primary-700 underline underline-offset-2">
                    {j.jobNo}
                  </Link>
                  {j.designLabel !== null && <span className="text-zinc-900"> · {j.designLabel}</span>}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-800">
                  <span className="whitespace-nowrap">กำหนด {j.dueDate === null ? "ไม่ระบุ" : thaiDate(j.dueDate, false)}</span>
                  <UrgencyBadge due={j.dueDate} todayBkk={todayBkk} />
                </p>
                {tab === "pending" ? (
                  <p className="whitespace-nowrap tabular-nums text-zinc-900">
                    ต้องใช้ <b>{fmtN(j.qtyNeededNow)}</b> เม็ด
                    {j.isOrdered && (
                      <span className="text-zinc-800">
                        {" "}
                        · สั่งไว้ {fmtN(j.qtyOrdered)} · ยังไม่สั่ง <b>{fmtN(j.qtyRemaining)}</b>
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="tabular-nums text-zinc-900">
                    <span className="whitespace-nowrap">
                      สั่งไว้ <b>{fmtN(j.qtyOrdered)}</b> เม็ด
                    </span>{" "}
                    <span className="whitespace-nowrap text-zinc-800">
                      · ตอนนี้ใช้ {fmtN(j.qtyNeededNow)}
                      {j.qtyExcess > 0 ? ` (เกิน ${fmtN(j.qtyExcess)})` : ""}
                    </span>
                  </p>
                )}
                {j.changedAfterOrder && (
                  <AmberChip>
                    ใบแก้จำนวนหลังสั่ง: สั่งไว้ {fmtN(j.qtyOrdered)} → ตอนนี้ {fmtN(j.qtyNeededNow)}
                  </AmberChip>
                )}
                {tab === "pending" && (removedQty.get(jobItemKey(j.jobId, row.key)) ?? 0) > 0 && (
                  <AmberChip>เคยสั่งไว้ {fmtN(removedQty.get(jobItemKey(j.jobId, row.key)) as number)} เม็ดก่อนถูกลบ — ระวังสั่งซ้ำ</AmberChip>
                )}
                {tab === "ordered" && <OrderedMeta job={j} />}
              </div>
              <Button
                type="button"
                variant="secondary"
                loading={busyKeys.has(jobKey)}
                disabled={rowBusy && !busyKeys.has(jobKey)}
                onClick={() => onAct(j)}
                aria-label={`${verb} — ${j.jobNo} ${row.group.label}`}
              >
                {verb}
              </Button>
            </li>
          );
        })}
      </ul>
      {!showAll && row.jobs.length > JOB_LINES_PAGE && (
        <Button type="button" variant="ghost" className="mt-1" onClick={onShowAll}>
          ดูอีก {row.jobs.length - JOB_LINES_PAGE} ใบ
        </Button>
      )}
    </div>
  );
}
