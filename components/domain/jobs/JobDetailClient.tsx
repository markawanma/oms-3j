"use client";

// JobDetailClient — หน้าใบงาน /jobs/[id] (ออฟฟิศ): หัวใบงาน · ขั้นตอน+น้ำหนัก · ปุ่มออฟฟิศ · ประวัติ event
// ปุ่ม/สถานะเป็นเพียงทางเลือกที่แสดง — ทุกกติกา (ลำดับขั้น · น้ำหนัก · วันย้อน ≤14 · มัดจำ) ตัดสินที่ DB และแสดงข้อความไทยกลับมา

import { Suspense, lazy, useState } from "react";
import Link from "next/link";
import { Printer, Scissors } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DesignLabelDialog, DoneDialog, DueDialog, ReasonDialog } from "@/components/domain/jobs/JobDialogs";
import type { ReasonKind } from "@/components/domain/jobs/JobDialogs";
import { ChangeProfileDialog } from "@/components/domain/jobs/ChangeProfileDialog";
import { JobPhotosCard } from "@/components/domain/jobs/JobPhotosCard";
import { JobProfileCard } from "@/components/domain/jobs/JobProfileCard";
import { PlanCard } from "@/components/domain/jobs/PlanCard";
import { PlanDialog, QtyPlannedDialog, SurplusDialog } from "@/components/domain/jobs/PlanDialogs";
import { ReceiveStageDialog, SendStageDialog } from "@/components/domain/jobs/StageDialogs";
import { StatusChip } from "@/components/domain/jobs/StatusChip";
import { JobEvents, StageTable } from "@/components/domain/jobs/JobStages";
import type { JobDetailData } from "@/lib/actions/job-office";
import { qtyOrderPlannedText, statusSignals } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { closeBlocker, hasLots, rootLossFromTree, splittableParts } from "@/lib/jobs/lots";
import { JOB_STATUS_LABEL, METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";
import type { LotDialogSpec } from "@/components/domain/jobs/JobLotsSection";

// 0181: แผงส่วนย่อย/dialog โหลดเมื่อใช้จริงเท่านั้น (ใบเดี่ยวที่ไม่เคยแยกไม่โหลดโค้ดชุดนี้ · ระหว่างโหลดแสดง skeleton)
const LotsPanel = lazy(() => import("@/components/domain/jobs/JobLotsSection").then((m) => ({ default: m.LotsPanel })));
const LotDialogs = lazy(() => import("@/components/domain/jobs/JobLotsSection").then((m) => ({ default: m.LotDialogs })));

type Dlg =
  | { t: "reason"; spec: ReasonKind }
  | { t: "due" }
  | { t: "label" }
  | { t: "done" }
  | { t: "qty" }
  | { t: "plan" }
  | { t: "surplus" }
  | { t: "profile" }
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
  const [lotDlg, setLotDlg] = useState<LotDialogSpec>(null);
  const lots = data.lots ?? null;
  // ส่วนหลัก (ใบเอง) — ให้ dialog รับแทนรู้จำนวนที่ส่งมา/ขั้นถูกล็อก (ใบเดี่ยวที่ถูกล็อก L-2 ก็ต้องมีช่องจำนวน)
  const rootPart = lots?.parts.find((p) => p.lotSeq === 0) ?? null;
  const showLots = hasLots(lots);
  // ใบเดี่ยวที่ยังไม่เคยแยก: ปุ่ม "แยกส่วน" อยู่แถวปุ่มด้านบน (เมื่อมีผู้ถือถือ ≥ 2 ชิ้น) · ใบที่แยกแล้วอยู่ในแผงส่วน
  const canStartSplit = !showLots && lots !== null && splittableParts(lots).length > 0;
  // ปิด full ไม่ได้เมื่อมีส่วนย่อยค้าง/ส่วนต่างรอชี้แจง — เหตุผลขึ้นบนปุ่ม (DB ตัดสินซ้ำที่ job_done: parts_open)
  const doneBlocker = closeBlocker(lots);
  // M-A: ใบที่แยกส่วนแล้ว — loss/ส่วนต่างส่งมอบของขั้นในใบแม่ใช้ตัวเลขทั้งต้นไม้ (v_job_tree_stage_loss) · ไม่มี = ของใบเอง
  const lossMap = lots?.treeLoss ? { ...loss, ...rootLossFromTree(lots.treeLoss) } : loss;
  const stageNameByCode = Object.fromEntries(stages.map((s) => [s.code, s.name]));
  const closed = job.status === "done" || job.status === "cancelled";
  const firstOpen = stages.find((s) => s.status === "pending" || s.status === "received") ?? null;
  const started = stages.some((s) => s.status !== "pending");
  // เปลี่ยนแบบการบันทึกไม่ได้เมื่อมีขั้นที่ช่างรับ/ส่งแล้ว (DB ตัดสินซ้ำ รวมใบที่เคยรับแล้วย้อนขั้น)
  // รวม event stage_receive (ใบที่เคยรับงานแล้วย้อนขั้นจนทุกขั้นกลับเป็น pending ก็ถือว่าเริ่มแล้ว — ตรงกับ DB security L1)
  const profileLocked = stages.some((s) => s.status === "received" || s.status === "sent") || events.some((e) => e.type === "stage_receive");
  const allDone = stages.length > 0 && stages.every((s) => s.status === "sent" || s.status === "skipped");
  const prevOut = (() => {
    if (!firstOpen) return null;
    const prev = [...stages].filter((s) => s.seq < firstOpen.seq && s.status === "sent").pop();
    return prev?.weightOutG ?? null;
  })();
  // ป้ายสถานะ: ชุดเดียวกับบอร์ด v2 (StatusChip) — ธงทุกตัวมาจาก v_job_board (DB ตัดสิน)
  const badges = board ? statusSignals(board, todayTh) : [];
  // 0175: เท่ากัน = "30 ชิ้น" เหมือนเดิม (ใบเดิมไม่ขึ้นสองเลข) · ต่างกัน = "สั่ง 30 · เริ่มผลิต 35 ชิ้น"
  const qtyText = qtyOrderPlannedText(job);
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

      <JobProfileCard job={job} stages={stages} started={profileLocked} onChange={() => setDlg({ t: "profile" })} />

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
          {canStartSplit && (
            <Button type="button" variant="secondary" onClick={() => setLotDlg({ t: "split" })}>
              <Scissors className="h-4 w-4" aria-hidden="true" />
              แยกส่วน
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={!allDone || doneBlocker !== null} title={doneBlocker ?? (allDone ? undefined : "ปิดได้เมื่อทุกขั้นส่งต่อหรือข้ามแล้ว")} onClick={() => setDlg({ t: "done" })}>
            {doneBlocker ? `ปิดงานไม่ได้ — ${doneBlocker}` : "ปิดงาน"}
          </Button>
          <Button type="button" variant="danger" onClick={() => setDlg({ t: "reason", spec: { kind: "cancel" } })}>
            ยกเลิกใบงาน
          </Button>
        </div>
      )}
      {!closed && <p className="text-sm text-zinc-700">QR ที่ใช้งานอยู่ {data.activeTokens} ใบ{data.activeTokens === 0 ? " — ยังไม่ได้พิมพ์ใบงาน" : ""}</p>}
      {/* 0182: ไม่มีรูป = เตือนเบาๆ ไม่บล็อกการพิมพ์ (รูปไม่ใช่ด่าน — มติ จ5) · photos === undefined (อ่านรูปไม่ได้) ไม่เตือนว่า "ไม่มีรูป" เพราะไม่รู้ */}
      {!closed && data.photos !== undefined && data.photos.length === 0 && (
        <p className="text-sm text-zinc-800">
          ใบนี้ยังไม่มีรูป — ใบพิมพ์จะไม่มีรูปหลัก ·{" "}
          <a href="#job-photos" className="font-semibold text-primary-700 underline underline-offset-2">
            เพิ่มรูป
          </a>
        </p>
      )}

      {/* 2 คอลัมน์บนจอใหญ่: แผนโลหะ (ซ้าย) · รูปงาน (ขวา) — จอเล็กเรียงบนลงล่าง และรูปงานขึ้นก่อนแผนโลหะ (รูปเป็นสิ่งที่ต้องทำก่อนพิมพ์) */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <PlanCard job={job} board={board} stages={stages} onEditQty={() => setDlg({ t: "qty" })} onEditPlan={() => setDlg({ t: "plan" })} onDecideSurplus={() => setDlg({ t: "surplus" })} />
        <JobPhotosCard jobId={job.id} jobNo={job.jobNo} sku={job.sku} sourceKind={job.sourceKind} activeTokens={data.activeTokens} photos={data.photos} />
      </div>

      {lots === null && (board?.partsCount ?? 0) > 1 && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
          โหลดส่วนย่อยของใบนี้ไม่ได้ — ตัวเลข/ปุ่มปิดงานบนหน้านี้อาจไม่ครบ ลองรีเฟรช ถ้ายังไม่ได้แจ้งผู้ดูแลระบบ
        </p>
      )}
      {showLots && lots && (
        <Suspense fallback={<p role="status" aria-busy="true" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">กำลังโหลดส่วนของใบนี้…</p>}>
          <LotsPanel jobId={job.id} lots={lots} closed={closed} openDialog={setLotDlg} gold={job.metal === "gold"} stageNames={stageNameByCode} />
        </Suspense>
      )}

      <section aria-labelledby="stages-h" className="space-y-2">
        <h2 id="stages-h" className="text-lg font-bold text-zinc-900">
          ขั้นตอน
        </h2>
        <StageTable
          stages={stages}
          loss={lossMap}
          closed={closed}
          profiled={job.profileId !== null}
          gold={job.metal === "gold"}
          firstOpenId={firstOpen?.id ?? null}
          onReceive={(s) => setDlg({ t: "receive", stage: s })}
          onSend={(s) => setDlg({ t: "send", stage: s })}
          onSkip={(s) => setDlg({ t: "reason", spec: { kind: "skip", stageCode: s.code, stageName: s.name } })}
        />
      </section>

      <JobEvents events={events} truncated={data.eventsTruncated} stageNames={Object.fromEntries(stages.map((s) => [s.code, s.name]))} />

      {lotDlg && lots && (
        <Suspense fallback={null}>
          <LotDialogs jobId={job.id} lots={lots} spec={lotDlg} onClose={() => setLotDlg(null)} gold={job.metal === "gold"} workers={workers} todayTh={todayTh} job={{ sourceKind: job.sourceKind, metal: job.metal, requireFinalWeight: job.requireFinalWeight }} />
        </Suspense>
      )}
      {dlg?.t === "reason" && <ReasonDialog jobId={job.id} spec={dlg.spec} onClose={() => setDlg(null)} />}
      {dlg?.t === "label" && <DesignLabelDialog jobId={job.id} current={job.designLabel} onClose={() => setDlg(null)} />}
      {dlg?.t === "due" && <DueDialog jobId={job.id} current={job.dueDate} todayTh={todayTh} onClose={() => setDlg(null)} />}
      {dlg?.t === "done" && <DoneDialog jobId={job.id} planned={job.qtyPlanned} qtyOrder={job.qtyOrder} sourceKind={job.sourceKind} metal={job.metal} requireFinalWeight={job.requireFinalWeight} weighRequired={job.weighRequired} recordedScrap={stages.reduce((n, s) => n + s.qtyScrap, 0) + (rootPart?.qtyDiscrepancyResolved ?? 0)} qtySplitOut={rootPart?.qtySplitOut ?? 0} qtyArrived={rootPart?.qtyDiscrepancyArrived ?? 0} onClose={() => setDlg(null)} />}
      {dlg?.t === "profile" && <ChangeProfileDialog jobId={job.id} metal={job.metal} stages={stages} currentProfileId={job.profileId} onClose={() => setDlg(null)} />}
      {dlg?.t === "qty" && <QtyPlannedDialog jobId={job.id} qtyOrder={job.qtyOrder} current={job.qtyPlanned} hasOverride={typeof job.metalPlanBasis?.override_g === "number"} hasTarget={job.targetPieceG !== null} onClose={() => setDlg(null)} />}
      {dlg?.t === "plan" && (
        <PlanDialog
          job={{ id: job.id, sourceKind: job.sourceKind, sourceItemId, metal: job.metal, qtyPlanned: job.qtyPlanned, targetPieceG: job.targetPieceG, metalPlanBasis: job.metalPlanBasis }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg?.t === "surplus" && <SurplusDialog jobId={job.id} qtySurplus={surplusLeft ?? 0} onClose={() => setDlg(null)} />}
      {dlg?.t === "receive" && <ReceiveStageDialog jobId={job.id} stage={dlg.stage} workers={workers} todayTh={todayTh} prevWeightOut={prevOut} qtyExpected={rootPart?.pendingSeq === dlg.stage.seq ? rootPart.pendingQtyExpected : null} locked={rootPart?.pendingSeq === dlg.stage.seq && rootPart.receiveLocked} onClose={() => setDlg(null)} />}
      {dlg?.t === "send" && <SendStageDialog jobId={job.id} stage={dlg.stage} todayTh={todayTh} onClose={() => setDlg(null)} />}
    </div>
  );
}
