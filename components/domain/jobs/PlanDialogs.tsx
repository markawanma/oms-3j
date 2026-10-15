"use client";

// PlanDialogs — กล่องแก้ของ "จำนวนและแผน" บนหน้าใบงาน (0175): แก้จำนวนเริ่มผลิต · แก้แผนโลหะ · ตัดสินของเหลือ
// ไม่ตัดสินกติกาเอง — DB เป็นด่านจริง (started / cast_started / plan_override_stale / surplus_* → ข้อความไทยใต้ปุ่ม ค่าที่กรอกค้างไว้)
// 🔴 ไม่คำนวณโลหะที่นี่: ตัวอย่างแผนในกล่องแก้แผนมาจาก getJobPlanSuggest (ใช้ PlanFields ตัวเดียวกับฟอร์มสร้าง)

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DialogButtons, ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { EMPTY_PLAN_FIELDS, PlanFields, planFieldsIssues, sameWeightText } from "@/components/domain/jobs/PlanFields";
import type { PlanFieldsValue } from "@/components/domain/jobs/PlanFields";
import { SurplusChoice } from "@/components/domain/jobs/SurplusChoice";
import type { SurplusValue } from "@/components/domain/jobs/SurplusChoice";
import { usePlanPreview } from "@/components/domain/jobs/usePlanPreview";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { num } from "@/lib/jobs/format";
import { qtyOrderPlannedText } from "@/lib/jobs/board";
import { parseQtyText, parseText } from "@/lib/jobs/input";
import { setJobPlan, setJobQtyPlanned, setJobSurplus } from "@/lib/actions/job-office-write";

// ---------------------------------------------------------------------------
// แก้จำนวนเริ่มผลิต (ก่อนขั้นแรกถูกรับ)
// ---------------------------------------------------------------------------
export function QtyPlannedDialog({ jobId, qtyOrder, current, hasOverride, hasTarget, onClose }: { jobId: string; qtyOrder: number; current: number; hasOverride: boolean; hasTarget: boolean; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [text, setText] = useState(String(current));
  const [reason, setReason] = useState("");
  const q = parseQtyText(text);
  const why = parseText(reason, "เหตุผล", 200, false);
  const ready = q.ok && q.value !== current && why.ok && !hasOverride;
  const short = q.ok && q.value < qtyOrder ? qtyOrder - q.value : 0; // ผลต่างจำนวนชิ้น (ไม่ใช่เงิน/น้ำหนัก)

  async function submit() {
    if (!q.ok) return;
    const r = await run(() => setJobQtyPlanned(jobId, q.value, reason.trim() || null), { success: "แก้จำนวนเริ่มผลิตแล้ว" });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="แก้จำนวนเริ่มผลิต">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-800">
          {qtyOrderPlannedText({ qtyOrder, qtyPlanned: current }, { alwaysOrder: true })}
        </p>
        {hasOverride && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
            ใบนี้กำหนดน้ำหนักโลหะเองไว้ — กด “แก้แผน” แล้วเลือก “ใช้ค่าระบบ” ก่อน จึงแก้จำนวนได้ (ระบบจะคำนวณโลหะใหม่ให้ตามจำนวน)
          </p>
        )}
        <Field id="qp-qty" label="เริ่มผลิต (ชิ้น)" hint={q.ok && hasTarget ? "แก้แล้วระบบคำนวณโลหะที่ต้องเตรียมใหม่ให้" : undefined}>
          <input id="qp-qty" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-invalid={q.ok ? undefined : true} className={FIELD} />
        </Field>
        {!q.ok && (
          <p role="alert" className="text-xs font-medium text-red-800">
            {q.error}
          </p>
        )}
        {short > 0 && q.ok && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
            ผลิตบางส่วน — เริ่ม {q.value} น้อยกว่าที่สั่ง {qtyOrder} (ขาด {short} ชิ้น)
          </p>
        )}
        <Field id="qp-why" label="เหตุผล (ไม่บังคับ)">
          <input id="qp-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} disabled={busy} className={FIELD} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="บันทึกจำนวน" onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// แก้แผนโลหะ (ก่อนขั้นหล่อถูกรับ) — PlanFields ตัวเดียวกับฟอร์มสร้างใบงาน
// ---------------------------------------------------------------------------
export interface PlanDialogJob {
  id: string;
  sourceKind: string;
  sourceItemId: string | null;
  metal: string;
  qtyPlanned: number;
  targetPieceG: number | null;
  metalPlanBasis: Record<string, unknown> | null;
}

function initialPlan(job: PlanDialogJob): PlanFieldsValue {
  const b = job.metalPlanBasis;
  const ov = num(b?.override_g);
  return {
    ...EMPTY_PLAN_FIELDS,
    targetText: job.targetPieceG !== null ? job.targetPieceG.toFixed(3) : "",
    overrideOn: ov !== null,
    overrideText: ov !== null ? ov.toFixed(3) : "",
    overrideReason: typeof b?.override_reason === "string" ? b.override_reason : "",
  };
}

export function PlanDialog({ job, onClose }: { job: PlanDialogJob; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [start] = useState(() => initialPlan(job));
  const [plan, setPlan] = useState<PlanFieldsValue>(start);
  // ที่มาของน้ำหนักที่ใบเก็บไว้ (basis.target_source) — การ์ดขึ้นที่มาเดียวกัน ไม่ขึ้น "กรอกเอง" ทั้งที่ยังไม่ได้แก้ (BUG-2)
  const src = job.metalPlanBasis?.target_source;
  const startSource = src === "quote" || src === "product" || src === "input" ? src : null;
  const issues = planFieldsIssues(plan, "");
  const kind = job.sourceKind === "oem" || job.sourceKind === "production" ? job.sourceKind : null;
  const { state: preview, retry } = usePlanPreview({
    kind: kind ?? "oem",
    itemId: kind ? job.sourceItemId : null,
    enabled: kind !== null && job.sourceItemId !== null && issues.hasTarget && issues.targetError === null,
    qtyPlanned: job.qtyPlanned,
    targetPieceG: issues.hasTarget ? plan.targetText.trim() : null,
    stageCodes: null,
  });
  const changed = !sameWeightText(plan.targetText, start.targetText) || plan.overrideOn !== start.overrideOn || (plan.overrideOn && (plan.overrideText.trim() !== start.overrideText.trim() || plan.overrideReason.trim() !== start.overrideReason.trim()));
  // "ล้างแผน" = ช่องว่างจริงเท่านั้น — พิมพ์ผิดรูปแบบเป็น error ของช่อง ไม่ใช่การล้าง (BUG-3)
  const clearing = plan.targetText.trim() === "" && start.targetText !== "";
  const ready = changed && !issues.blocking && preview.s !== "loading";

  async function submit() {
    const useOverride = plan.overrideOn && issues.hasTarget;
    const r = await run(
      () =>
        setJobPlan({
          jobId: job.id,
          targetPieceG: issues.hasTarget ? plan.targetText.trim() : null,
          overrideG: useOverride ? plan.overrideText.trim() : null,
          overrideReason: useOverride ? plan.overrideReason.trim() : null,
        }),
      { success: clearing ? "ล้างแผนโลหะแล้ว" : "แก้แผนโลหะแล้ว" }
    );
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={start.targetText === "" ? "ตั้งแผนโลหะ" : "แก้แผนโลหะ"}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-700">แก้ได้จนกว่าขั้นหล่อจะถูกรับ · ระบบคำนวณโลหะที่ต้องเตรียมให้จากจำนวนเริ่มผลิต {job.qtyPlanned} ชิ้น</p>
        <PlanFields idPrefix="pd" metal={job.metal} value={plan} onChange={setPlan} preview={preview} onRetry={retry} defaultSource={startSource} defaultTargetText="" sourceBaseText={start.targetText} disabled={busy} noPreview={job.sourceItemId === null} />
        {clearing && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
            ช่องน้ำหนักว่าง = ล้างแผนโลหะของใบนี้
          </p>
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm={clearing ? "ล้างแผนโลหะ" : "บันทึกแผน"} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ตัดสินของเหลือ (ใบ OEM ที่ปิดแล้วและยังถือไว้)
// ---------------------------------------------------------------------------
export function SurplusDialog({ jobId, qtySurplus, onClose }: { jobId: string; qtySurplus: number; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [disp, setDisp] = useState<SurplusValue>("hold");
  const [note, setNote] = useState("");
  const noteOk = parseText(note, "หมายเหตุ", 200, false).ok;
  const ready = noteOk && (disp !== "hold" || note.trim() !== "");

  async function submit() {
    const r = await run(() => setJobSurplus(jobId, disp, note.trim() || null), { success: "บันทึกการจัดการของเหลือแล้ว" });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="ตัดสินของเหลือ">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm font-semibold text-zinc-900">ของเหลือ {qtySurplus} ชิ้น — ของลูกค้า ยังไม่เข้าสต็อก</p>
        <SurplusChoice idPrefix="sd" value={disp} onChange={setDisp} note={note} onNote={setNote} disabled={busy} />
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="บันทึก" onClose={onClose} />
      </form>
    </Modal>
  );
}
