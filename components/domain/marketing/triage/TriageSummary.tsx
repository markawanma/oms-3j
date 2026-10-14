// TriageSummary — แถบข้อมูลหัวหน้าคัดไอเดีย (server-safe · ไม่มีตัวหาร ยกเว้น LINE)
// จำนวนที่ทำแล้วแยกช่อง · LINE ใช้/โควตา + วางแผนอีก (v_line_quota_28d ตรงๆ) · คิวรออนุมัติ (+ธงเกิน DB บอก) · วันที่ยังไม่มีชิ้นงาน · ผลสัปดาห์ก่อน (บรรทัดจากสรุปจริง ไม่ประกอบเอง)

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { SectionError } from "@/components/domain/marketing/workflow/PageError";
import { CHANNEL_LABEL } from "@/lib/marketing/piece-labels";
import { countByChannel, emptyDayCount, pieceCountsByDay, triageWeekDays } from "@/lib/marketing/triage";
import type { TriageData } from "@/lib/marketing/triage";

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-zinc-50 px-3 py-2">
      <dt className="text-xs font-semibold text-zinc-700">{label}</dt>
      <dd className="text-sm font-medium break-words text-zinc-900 tabular-nums">{children}</dd>
    </div>
  );
}

export function TriageSummary({ d }: { d: TriageData }) {
  const days = triageWeekDays(d.weekFrom);
  const week = d.weekRows.ok ? d.weekRows.data : null;
  const byChannel = week ? countByChannel(week) : null;
  const empties = week ? emptyDayCount(pieceCountsByDay(week, days)) : null;
  const q = d.lineQuota.ok ? d.lineQuota.data : null;

  return (
    <section aria-label="ภาพรวมสัปดาห์" className="space-y-2">
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="ทำแล้วในสัปดาห์นี้ (แยกช่อง)">
          {!byChannel ? (
            "โหลดไม่ได้"
          ) : byChannel.length === 0 ? (
            "ยังไม่มีชิ้นในสัปดาห์นี้"
          ) : (
            byChannel.map((c) => `${(CHANNEL_LABEL as Record<string, string>)[c.channel] ?? c.channel} ${c.n}`).join(" · ")
          )}
        </Tile>
        <Tile label="LINE (28 วัน)">
          {!d.lineQuota.ok ? (
            "โหลดไม่ได้"
          ) : q ? (
            <>
              ส่งแล้ว {q.used28d}/{q.quota} · วางแผนอีก {q.planned28d} · เหลือ {q.remaining28d}
              {q.overQuotaPlanned && <span className="block text-amber-900">แผนรวมเกินโควตา</span>}
            </>
          ) : (
            "ยังไม่มีข้อมูลโควตา"
          )}
        </Tile>
        <Tile label="คิวรออนุมัติ">
          {!d.counts.ok ? (
            "โหลดไม่ได้"
          ) : (
            <>
              <Link href="/marketing" className="inline-flex min-h-11 items-center underline-offset-2 hover:underline">
                {d.counts.data.reviewQueue} ชิ้น
              </Link>
              {d.counts.data.reviewOverLimit && <span className="block text-amber-900">เกินที่รับไหว — อนุมัติก่อนเพิ่มของใหม่</span>}
            </>
          )}
        </Tile>
        <Tile label="วันที่ยังไม่มีชิ้นงาน">{empties === null ? "โหลดไม่ได้" : `${empties} จาก 7 วัน`}</Tile>
      </dl>

      {d.weekTruncated && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ชิ้นงานของสัปดาห์นี้มากเกินที่แสดง — ตัวเลขข้างบนอาจไม่ครบ ดูทั้งหมดที่ปฏิทิน
        </p>
      )}
      {!d.weekRows.ok && <SectionError message={d.weekRows.error} />}
      {d.lastWeekLine.ok && d.lastWeekLine.data && (
        <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm break-words text-zinc-800">
          <span className="font-semibold">ผลสัปดาห์ก่อน:</span> {d.lastWeekLine.data}
        </p>
      )}
    </section>
  );
}
