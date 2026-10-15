"use client";

// JobDetailClient — หน้าใบงาน /jobs/[id] (ออฟฟิศ): หัวใบงาน · ขั้นตอน+น้ำหนัก · ปุ่มออฟฟิศ · ประวัติ event
// ปุ่ม/สถานะเป็นเพียงทางเลือกที่แสดง — ทุกกติกา (ลำดับขั้น · น้ำหนัก · วันย้อน ≤14 · มัดจำ) ตัดสินที่ DB และแสดงข้อความไทยกลับมา

import { useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DesignLabelDialog, DoneDialog, DueDialog, ReasonDialog } from "@/components/domain/jobs/JobDialogs";
import type { ReasonKind } from "@/components/domain/jobs/JobDialogs";
import { PlanCard } from "@/components/domain/jobs/PlanCard";
import { PlanDialog, QtyPlannedDialog, SurplusDialog } from "@/components/domain/jobs/PlanDialogs";
import { ReceiveStageDialog, SendStageDialog } from "@/components/domain/jobs/StageDialogs";
import { StatusChip } from "@/components/domain/jobs/StatusChip";
import { JobEvents, StageTable } from "@/components/domain/jobs/JobStages";
import type { JobDetailData } from "@/lib/actions/job-office";
import { statusSignals } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { JOB_STATUS_LABEL, METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";

type Dlg =
  | { t: "reason"; spec: ReasonKind }
  | { t: "due" }
  | { t: "label" }
  | { t: "done" }
  | { t: "qty" }
  | { t: "plan" }
  | { t: "surplus" }
  | { t: "receive"; stage: StageRow }
  | { t: "send"; stage: StageRow }
  | null;

const STATUS_TONE: Record<string, string> = {
  open: "bg-zinc-100 text-zinc-800",
  in_progress: "bg-blue-100 text-blue-900",
  on_hold: "bg-amber-100 text-amber-900",
  done: "bg-green-100 text-green-900",
  cancelled: "bg-zinc-200 text-zinc-700 line-through",
};

export function JobDetailClient({ data }: { data: JobDetailData }) {
  const { job, board, stages, loss, events, workers, source, todayTh } = data;
  const [dlg, setDlg] = useState<Dlg>(null);
  const closed = job.status === "done" || job.status === "cancelled";
  const firstOpen = stages.find((s) => s.status === "pending" || s.status === "received") ?? null;
  const started = stages.some((s) => s.status !== "pending");
  const allDone = stages.length > 0 && stages.every((s) => s.status === "sent" || s.status === "skipped");
  const prevOut = (() => {
    if (!firstOpen) return null;
    const prev = [...stages].filter((s) => s.seq < firstOpen.seq && s.status === "sent").pop();
    return prev?.weightOutG ?? null;
  })();
  // ป้ายสถานะ: ชุดเดียวกับบอร์ด v2 (StatusChip) — ธงทุกตัวมาจาก v_job_board (DB ตัดสิน)
  const badges = board ? statusSignals(board, todayTh) : [];
  // 0175: เท่ากัน = "30 ชิ้น" เหมือนเดิม (ใบเดิมไม่ขึ้นสองเลข) · ต่างกัน = "สั่ง 30 · เริ่มผลิต 35 ชิ้น"
  const qtyText = job.qtyOrder === job.qtyPlanned ? `${job.qtyPlanned} ชิ้น` : `สั่ง ${job.qtyOrder} · เริ่มผลิต ${job.qtyPlanned} ชิ้น`;
  const surplusLeft = board?.qtySurplus ?? null;
  const sourceItemId = job.sourceKind === "oem" ? job.oemQuoteItemId : job.productionOrderItemId;
  const needGateNote = job.sourceKind === "oem" && !closed && board?.depositMissing === true && !job.startGateNote;
  const sourceHref = source ? (source.kind === "oem" ? `/oem/quotes/${source.id}` : `/production/${source.id}`) : null;
  const B = "min-h-11";

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-zinc-900 tabular-nums">{job.jobNo}</h1>
          <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${STATUS_TONE[job.status] ?? STATUS_TONE.open}`}>{JOB_STATUS_LABEL[job.status] ?? job.status}</span>
          <span className="text-sm text-zinc-700">{SOURCE_LABEL[job.sourceKind] ?? job.sourceKind}</span>
          {sourceHref && (
            <Link href={sourceHref} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline">
              {source!.kind === "oem" ? `ใบเสนอราคา${board?.sourceRef ? ` ${board.sourceRef}` : ""}` : `ใบผลิต${board?.sourceRef ? ` ${board.sourceRef}` : ""}`}
            </Link>
          )}
        </div>
        <p className="text-lg font-semibold break-words text-zinc-900">{job.designLabel}</p>
        <p className="text-sm text-zinc-800">
          {qtyText} · {METAL_LABEL[job.metal] ?? job.metal}
          {job.sku ? ` · ${job.sku}` : ""} · กำหนดส่ง {thaiDate(job.dueDate)}
          {job.status === "done" && ` · ดี ${job.qtyGood ?? "—"} เสีย ${job.qtyScrap ?? "—"}${surplusLeft !== null && surplusLeft > 0 ? ` · เหลือ ${surplusLeft}` : ""}${job.weightFinalG !== null ? ` · สุทธิ ${job.weightFinalG} กรัม` : ""}`}
          {job.status === "cancelled" && job.cancelReason ? ` · ยกเลิกเพราะ: ${job.cancelReason}` : ""}
        </p>
        {badges.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="สถานะที่ต้องดู">
            {badges.map((b) => (
              <li key={b.key}>
                <StatusChip status={b} />
              </li>
            ))}
          </ul>
        )}
        {job.startGateNote && <p className="rounded-md bg-zinc-50 p-2 text-sm text-zinc-800">เริ่มผลิตก่อนมัดจำเพราะ: {job.startGateNote}</p>}
        {needGateNote && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
            ดีลนี้ยังไม่มีมัดจำ — พิมพ์ QR ไม่ได้จนกว่าจะบันทึกเหตุผลที่เริ่มผลิตก่อน
            <Button type="button" variant="secondary" className={B} onClick={() => setDlg({ t: "reason", spec: { kind: "gate" } })}>
              บันทึกเหตุผล
            </Button>
          </p>
        )}
      </header>

      {!closed && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/jobs/${job.id}/print`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-base font-medium text-white hover:bg-primary-700">
            <Printer className="h-4 w-4" aria-hidden="true" />
            พิมพ์ใบงาน (QR)
          </Link>
          <Button type="button" variant="secondary" onClick={() => setDlg({ t: "due" })}>
            ตั้งกำหนดส่ง
          </Button>
          <Button type="button" variant="secondary" onClick={() => setDlg({ t: "label" })}>
            แก้ชื่อเรียก
          </Button>
          {started && (
            <Button type="button" variant="secondary" onClick={() => setDlg({ t: "reason", spec: { kind: "reopen" } })}>
              ย้อนขั้น
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={!allDone} title={allDone ? undefined : "ปิดได้เมื่อทุกขั้นส่งต่อหรือข้ามแล้ว"} onClick={() => setDlg({ t: "done" })}>
            ปิดงาน
          </Button>
          <Button type="button" variant="danger" onClick={() => setDlg({ t: "reason", spec: { kind: "cancel" } })}>
            ยกเลิกใบงาน
          </Button>
        </div>
      )}
      {!closed && <p className="text-sm text-zinc-700">QR ที่ใช้งานอยู่ {data.activeTokens} ใบ{data.activeTokens === 0 ? " — ยังไม่ได้พิมพ์ใบงาน" : ""}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <PlanCard job={job} board={board} stages={stages} onEditQty={() => setDlg({ t: "qty" })} onEditPlan={() => setDlg({ t: "plan" })} onDecideSurplus={() => setDlg({ t: "surplus" })} />
      </div>

      <section aria-labelledby="stages-h" className="space-y-2">
        <h2 id="stages-h" className="text-lg font-bold text-zinc-900">
          ขั้นตอน
        </h2>
        <StageTable
          stages={stages}
          loss={loss}
          closed={closed}
          firstOpenId={firstOpen?.id ?? null}
          onReceive={(s) => setDlg({ t: "receive", stage: s })}
          onSend={(s) => setDlg({ t: "send", stage: s })}
          onSkip={(s) => setDlg({ t: "reason", spec: { kind: "skip", stageCode: s.code, stageName: s.name } })}
        />
      </section>

      <JobEvents events={events} truncated={data.eventsTruncated} stageNames={Object.fromEntries(stages.map((s) => [s.code, s.name]))} />

      {dlg?.t === "reason" && <ReasonDialog jobId={job.id} spec={dlg.spec} onClose={() => setDlg(null)} />}
      {dlg?.t === "label" && <DesignLabelDialog jobId={job.id} current={job.designLabel} onClose={() => setDlg(null)} />}
      {dlg?.t === "due" && <DueDialog jobId={job.id} current={job.dueDate} todayTh={todayTh} onClose={() => setDlg(null)} />}
      {dlg?.t === "done" && <DoneDialog jobId={job.id} planned={job.qtyPlanned} qtyOrder={job.qtyOrder} sourceKind={job.sourceKind} metal={job.metal} onClose={() => setDlg(null)} />}
      {dlg?.t === "qty" && <QtyPlannedDialog jobId={job.id} qtyOrder={job.qtyOrder} current={job.qtyPlanned} hasOverride={typeof job.metalPlanBasis?.override_g === "number"} onClose={() => setDlg(null)} />}
      {dlg?.t === "plan" && (
        <PlanDialog
          job={{ id: job.id, sourceKind: job.sourceKind, sourceItemId, metal: job.metal, qtyPlanned: job.qtyPlanned, targetPieceG: job.targetPieceG, metalPlanBasis: job.metalPlanBasis }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg?.t === "surplus" && <SurplusDialog jobId={job.id} qtySurplus={surplusLeft ?? 0} onClose={() => setDlg(null)} />}
      {dlg?.t === "receive" && <ReceiveStageDialog jobId={job.id} stage={dlg.stage} workers={workers} todayTh={todayTh} prevWeightOut={prevOut} onClose={() => setDlg(null)} />}
      {dlg?.t === "send" && <SendStageDialog jobId={job.id} stage={dlg.stage} todayTh={todayTh} onClose={() => setDlg(null)} />}
    </div>
  );
}
