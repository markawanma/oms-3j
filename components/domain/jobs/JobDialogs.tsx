"use client";

// JobDialogs — กล่องทำรายการของหน้าใบงาน (ออฟฟิศ): เหตุผล (ข้าม/ย้อน/ยกเลิก/เหตุผลก่อนมัดจำ) · กำหนดส่ง · ปิดงาน
// ค่าที่กรอกค้างเมื่อ DB ปฏิเสธ (error ไทยใต้ปุ่ม) · ปุ่ม ≥ 44px · ไม่ตัดสินกติกาเอง — DB เป็นด่านจริง (ตรวจเฉพาะรูปแบบก่อนส่ง)

import { useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { cancelJob, doneJob, reopenJobStage, setJobDesignLabel, setJobDue, setJobStartGateNote, skipJobStage } from "@/lib/actions/job-office-write";

export const FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-700">{hint}</p>}
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
      {message}
    </p>
  ) : null;
}

export function DialogButtons({ busy, ready, confirm, onClose, danger }: { busy: boolean; ready: boolean; confirm: string; onClose: () => void; danger?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
        ยกเลิก
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={!ready || busy}>
        {confirm}
      </Button>
    </div>
  );
}

export type ReasonKind = { kind: "skip"; stageCode: string; stageName: string } | { kind: "reopen" } | { kind: "cancel" } | { kind: "gate" };

const REASON_COPY = {
  skip: { title: "ข้ามขั้น", label: "เหตุผลที่ข้ามขั้น", confirm: "ข้ามขั้น", ok: "ข้ามขั้นแล้ว", danger: false },
  reopen: { title: "ย้อนขั้นล่าสุด", label: "เหตุผลที่ย้อน", confirm: "ย้อนขั้น", ok: "ย้อนขั้นแล้ว", danger: false },
  cancel: { title: "ยกเลิกใบงาน", label: "เหตุผลที่ยกเลิก", confirm: "ยกเลิกใบงาน", ok: "ยกเลิกใบงานแล้ว", danger: true },
  gate: { title: "เหตุผลที่เริ่มผลิตก่อนมัดจำ", label: "เหตุผล", confirm: "บันทึกเหตุผล", ok: "บันทึกเหตุผลแล้ว", danger: false },
} as const;

/** กล่องเหตุผลบังคับ (ข้าม/ย้อน/ยกเลิก/เหตุผลก่อนมัดจำ) — เหตุผลต้องมีตัวอักษร (DB ตรวจซ้ำ) */
export function ReasonDialog({ jobId, spec, onClose }: { jobId: string; spec: ReasonKind; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [reason, setReason] = useState("");
  const c = REASON_COPY[spec.kind];
  const ready = reason.trim().length >= 1;

  async function submit() {
    const fn = () =>
      spec.kind === "skip" ? skipJobStage(jobId, spec.stageCode, reason) : spec.kind === "reopen" ? reopenJobStage(jobId, reason) : spec.kind === "cancel" ? cancelJob(jobId, reason) : setJobStartGateNote(jobId, reason);
    const r = await run(fn, { success: c.ok });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={spec.kind === "skip" ? `ข้ามขั้น ${spec.stageName}` : c.title}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        {spec.kind === "reopen" && <p className="text-sm text-zinc-700">ย้อนทีละขั้นจากขั้นล่าสุดที่มีความคืบหน้า — ค่าเดิมเก็บไว้ในประวัติ</p>}
        {spec.kind === "cancel" && <p className="text-sm text-zinc-700">ยกเลิกแล้ว QR ทุกใบของงานนี้ใช้ไม่ได้ทันที · ประวัติยังอยู่ครบ</p>}
        <Field id="reason" label={c.label}>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={spec.kind === "gate" ? 500 : 300} className={`${FIELD} py-2`} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm={c.confirm} onClose={onClose} danger={c.danger} />
      </form>
    </Modal>
  );
}

/** ข้อความเตือนที่ใช้ทุกที่ที่ตั้งชื่อเรียกภายใน — ช่างเห็นชื่อนี้บนมือถือและใบพิมพ์ติดถุงงาน */
export const DESIGN_LABEL_WARNING = "ช่างเห็นชื่อนี้บนมือถือและบนใบงาน — ห้ามมีชื่อแบรนด์/ชื่อลูกค้า (ตั้งชื่อกลางๆ เช่น “แหวนลายใบไม้ ไซส์ 7”)";

export function DesignLabelDialog({ jobId, current, onClose }: { jobId: string; current: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [label, setLabel] = useState(current);
  const ready = label.trim() !== "" && label.trim() !== current.trim();
  async function submit() {
    const r = await run(() => setJobDesignLabel(jobId, label), { success: "แก้ชื่อเรียกใบงานแล้ว" });
    if (r.ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="แก้ชื่อเรียกใบงาน">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <Field id="dlabel" label="ชื่อเรียกภายใน (ช่างเห็น)" hint={DESIGN_LABEL_WARNING}>
          <input id="dlabel" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} className={FIELD} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="บันทึก" onClose={onClose} />
      </form>
    </Modal>
  );
}

export function DueDialog({ jobId, current, todayTh, onClose }: { jobId: string; current: string | null; todayTh: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [due, setDue] = useState(current ?? "");
  async function save(value: string | null) {
    const r = await run(() => setJobDue(jobId, value), { success: value ? "ตั้งกำหนดส่งแล้ว" : "ล้างกำหนดส่งแล้ว" });
    if (r.ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="กำหนดส่ง">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(due || null); }}>
        <Field id="due" label="วันที่ส่งงาน" hint="วันนี้หรืออนาคต · ไม่เกิน 2 ปี">
          <input id="due" type="date" min={todayTh} value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
        </Field>
        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="secondary" onClick={() => void save(null)} disabled={busy || !current}>
            ล้างกำหนดส่ง
          </Button>
          <DialogButtons busy={busy} ready={due !== "" && due !== current} confirm="บันทึก" onClose={onClose} />
        </div>
      </form>
    </Modal>
  );
}

export function DoneDialog({ jobId, planned, metal, onClose }: { jobId: string; planned: number; metal: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [good, setGood] = useState(String(planned));
  const [scrap, setScrap] = useState("0");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const sumOk = /^\d+$/.test(good) && /^\d+$/.test(scrap) && Number(good) + Number(scrap) === planned;
  const ready = sumOk && (metal !== "gold" || weight.trim() !== "");
  async function submit() {
    const r = await run(() => doneJob({ jobId, qtyGood: Number(good), qtyScrap: Number(scrap), weightFinal: weight.trim() || null, note: note.trim() || null }), { success: "ปิดงานแล้ว" });
    if (r.ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="ปิดงาน">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-700">ปิดได้เมื่อทุกขั้น ส่งต่อหรือข้ามแล้ว · ปิดแล้ว QR ใช้ไม่ได้และแก้ไม่ได้</p>
        <div className="grid grid-cols-2 gap-3">
          <Field id="good" label="จำนวนดี (ชิ้น)">
            <input id="good" inputMode="numeric" value={good} onChange={(e) => setGood(e.target.value)} className={FIELD} />
          </Field>
          <Field id="scrap" label="จำนวนเสีย (ชิ้น)">
            <input id="scrap" inputMode="numeric" value={scrap} onChange={(e) => setScrap(e.target.value)} className={FIELD} />
          </Field>
        </div>
        {!sumOk && <p className="text-xs font-medium text-amber-900">ดี + เสีย ต้องเท่ากับจำนวนที่วางแผน ({planned} ชิ้น)</p>}
        <Field id="wfinal" label={`น้ำหนักสุทธิ (กรัม)${metal === "gold" ? " — งานทองต้องใส่" : " — ไม่บังคับ"}`}>
          <input id="wfinal" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.,]/g, ""))} className={FIELD} />
        </Field>
        <Field id="dnote" label="หมายเหตุ (ไม่บังคับ)">
          <input id="dnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={FIELD} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="ปิดงาน" onClose={onClose} />
      </form>
    </Modal>
  );
}
