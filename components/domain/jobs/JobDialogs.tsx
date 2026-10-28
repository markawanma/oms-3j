"use client";

// JobDialogs — กล่องทำรายการของหน้าใบงาน (ออฟฟิศ): เหตุผล (ข้าม/ย้อน/ยกเลิก/เหตุผลก่อนมัดจำ) · กำหนดส่ง · ปิดงาน
// ค่าที่กรอกค้างเมื่อ DB ปฏิเสธ (error ไทยใต้ปุ่ม) · ปุ่ม ≥ 44px · ไม่ตัดสินกติกาเอง — DB เป็นด่านจริง (ตรวจเฉพาะรูปแบบก่อนส่ง)

import { useState } from "react";
import type { ReactNode, Ref } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { qtyOrderPlannedText } from "@/lib/jobs/board";
import { finalWeightRequired } from "@/lib/jobs/profile-summary";
import { LABEL_ANGLE_MSG, LABEL_ANGLE_RE } from "@/lib/jobs/input";
import { SurplusChoice } from "@/components/domain/jobs/SurplusChoice";
import type { SurplusValue } from "@/components/domain/jobs/SurplusChoice";
import type { DoneJobInput } from "@/lib/actions/job-office-write";
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

/**
 * softDisabled (0189 W2): ปุ่มยืนยันที่ยังไม่พร้อมใช้ aria-disabled แทน disabled (กดได้ — ผู้เรียกบอกเหตุ "ใส่เหตุผลก่อนลบ" ไม่ใช่ disabled เงียบ) · ไม่ส่ง = disabled เหมือนเดิม
 * cancelRef: ให้ผู้เรียกย้าย focus ไป "ยกเลิก" (กล่องที่มีช่องกรอก/ชิปก่อนปุ่ม)
 */
export function DialogButtons({ busy, ready, confirm, onClose, danger, softDisabled, cancelRef }: { busy: boolean; ready: boolean; confirm: string; onClose: () => void; danger?: boolean; softDisabled?: boolean; cancelRef?: Ref<HTMLButtonElement> }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button ref={cancelRef} type="button" variant="secondary" onClick={onClose} disabled={busy}>
        ยกเลิก
      </Button>
      {softDisabled ? (
        <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} aria-disabled={!ready ? true : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
          {confirm}
        </Button>
      ) : (
        <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={!ready || busy}>
          {confirm}
        </Button>
      )}
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
  const bad = LABEL_ANGLE_RE.test(label);
  const ready = label.trim() !== "" && label.trim() !== current.trim() && !bad;
  async function submit() {
    const r = await run(() => setJobDesignLabel(jobId, label), { success: "แก้ชื่อเรียกใบงานแล้ว" });
    if (r.ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="แก้ชื่อเรียกใบงาน">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <Field id="dlabel" label="ชื่อเรียกภายใน (ช่างเห็น)" hint={bad ? LABEL_ANGLE_MSG : DESIGN_LABEL_WARNING}>
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

export function DoneDialog({ jobId, planned, qtyOrder, sourceKind, metal, requireFinalWeight, weighRequired, recordedScrap = 0, qtySplitOut = 0, qtyArrived = 0, title = "ปิดงาน", onClose }: { jobId: string; planned: number; qtyOrder: number; sourceKind: string; metal: string; requireFinalWeight?: boolean; weighRequired?: boolean; recordedScrap?: number; /** 0181: ชิ้นที่แยกเป็นส่วนย่อยแล้ว (อ่านอย่างเดียว) — DB บังคับ ดี + เสีย + แยกออก = จำนวนเริ่มผลิต · 0 = ใบเดี่ยวเหมือนเดิมเป๊ะ */ qtySplitOut?: number; /** 0183: ส่วนต่างของใบนี้ที่ "ได้รับเพิ่มแล้ว" (ชิ้น · อ่านอย่างเดียว) — ชิ้นนั้นไปอยู่ที่ส่วนใหม่แล้ว · DB บังคับ ดี + เสีย + แยกออก + ค่านี้ = จำนวนเริ่มผลิต · 0 = เหมือนเดิมเป๊ะ */ qtyArrived?: number; /** ปิดส่วนย่อยใช้ชื่อ "ปิด ส่วนที่ k" */ title?: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  // ค่าเริ่ม: เสีย = ของเสียที่ช่างแจ้งไว้ในขั้นต่างๆ (ผลรวมจำนวนชิ้น qty_scrap — บวกชิ้น ไม่ใช่เงิน/น้ำหนัก) · ดี = เริ่มผลิต − เสีย
  // ไม่ดึง = เสนอ "ดี = เริ่มผลิตทั้งหมด" ทั้งที่ช่างแจ้งเสียไปแล้ว → ใบผลิตเข้าสต็อกเกิน + ของเหลือผิด (QA 0176) · ผู้ใช้แก้ได้ · DB ตรวจ ดี+เสีย = เริ่มผลิต ซ้ำ
  // 0181: ฐานของ ดี+เสีย = เริ่มผลิต − ที่แยกเป็นส่วนย่อย (ใบเดี่ยว split = 0 ⇒ เท่าเดิม)
  // 0183: ชิ้นที่ได้รับเพิ่มแล้วไปอยู่ที่ส่วนใหม่ — ไม่นับในดี/เสียของใบนี้ (ไม่หักแล้ว DB ตอบ qty_mismatch) · ไม่มี arrived = เท่าเดิม
  const base = planned - qtySplitOut - qtyArrived;
  const prefillScrap = Number.isInteger(recordedScrap) && recordedScrap > 0 ? Math.min(recordedScrap, base) : 0;
  const [good, setGood] = useState(String(base - prefillScrap));
  const [scrap, setScrap] = useState(String(prefillScrap));
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [disp, setDisp] = useState<SurplusValue>("hold");
  const [sNote, setSNote] = useState("");
  const goodN = /^\d+$/.test(good) ? Number(good) : null;
  const sumOk = goodN !== null && /^\d+$/.test(scrap) && goodN + Number(scrap) === base;
  // ผลต่างจำนวนชิ้น (ไม่ใช่เงิน/น้ำหนัก) เพื่อบอกผู้ใช้ — DB ตัดสินซ้ำเอง (qty_surplus · surplus_unexpected)
  const surplus = sumOk && goodN !== null && goodN > qtyOrder ? goodN - qtyOrder : 0;
  // ใบที่แยกส่วน: ดีของใบแม่น้อยกว่าที่สั่งเป็นเรื่องปกติ (ส่วนที่แยกไปปิดแยก) — ไม่ขึ้น "ขาด"
  const short = sumOk && qtySplitOut === 0 && qtyArrived === 0 && goodN !== null && goodN < qtyOrder ? qtyOrder - goodN : 0;
  const isOem = sourceKind === "oem";
  // น้ำหนักสุทธิ: แบบการบันทึกบังคับ หรือ ใบทองที่มีขั้นต้องชั่ง (กติกาเดียวกับ DB — ด่านจริงอยู่ที่ job_done) · ไม่ได้ส่ง flag มา (ใบเดิม/ผู้เรียกเก่า) = กติกา J1: ทองบังคับ
  const finalRequired = requireFinalWeight === undefined && weighRequired === undefined ? metal === "gold" : finalWeightRequired({ requireFinalWeight: requireFinalWeight === true, metal, hasWeigh: weighRequired === true });
  const ready = sumOk && (!finalRequired || weight.trim() !== "");
  async function submit() {
    const input: DoneJobInput = { jobId, qtyGood: Number(good), qtyScrap: Number(scrap), weightFinal: weight.trim() || null, note: note.trim() || null };
    // 🔴 ส่งการจัดการของเหลือเฉพาะเมื่อ ดี > สั่ง และเป็น OEM — ดี ≤ สั่ง ห้ามส่ง (DB: surplus_unexpected) · ใบผลิตไม่ส่ง (DB ตั้งเข้าสต็อกเอง)
    if (surplus > 0 && isOem) {
      input.surplusDisposition = disp;
      input.surplusNote = sNote.trim() || null;
    }
    const r = await run(() => doneJob(input), { success: "ปิดงานแล้ว" });
    if (r.ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title={title}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-700">ปิดได้เมื่อทุกขั้น ส่งต่อหรือข้ามแล้ว · ปิดแล้ว QR ใช้ไม่ได้และแก้ไม่ได้</p>
        <p className="text-base font-semibold text-zinc-900">{qtyOrderPlannedText({ qtyOrder, qtyPlanned: planned }, { alwaysOrder: true })}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field id="good" label="จำนวนดี (ชิ้น)">
            <input id="good" inputMode="numeric" value={good} onChange={(e) => setGood(e.target.value)} className={FIELD} />
          </Field>
          <Field id="scrap" label="จำนวนเสีย (ชิ้น)">
            <input id="scrap" inputMode="numeric" value={scrap} onChange={(e) => setScrap(e.target.value)} className={FIELD} />
          </Field>
        </div>
        {qtySplitOut > 0 && (
          <p role="status" className="rounded-md bg-zinc-50 p-2 text-sm text-zinc-900">
            แยกเป็นส่วนย่อย <strong className="tabular-nums">{qtySplitOut}</strong> ชิ้น (ปิดแยกตามส่วน) — ไม่นับในดี/เสียของใบนี้
          </p>
        )}
        {qtyArrived > 0 && (
          <p role="status" className="rounded-md bg-zinc-50 p-2 text-sm text-zinc-900">
            ได้รับเพิ่มแล้ว <strong className="tabular-nums">{qtyArrived}</strong> ชิ้น (อยู่ที่ส่วนใหม่ ปิดแยกตามส่วน) — ไม่นับในดี/เสียของใบนี้
          </p>
        )}
        {prefillScrap > 0 && <p className="text-xs text-zinc-700">ของเสียที่บันทึกในขั้น: {prefillScrap} ชิ้น</p>}
        {!sumOk && (
          <p className="text-xs font-medium text-amber-900">
            {qtyArrived > 0
              ? `ดี + เสีย${qtySplitOut > 0 ? " + แยกเป็นส่วนย่อย" : ""} + ได้รับเพิ่ม ต้องเท่ากับจำนวนเริ่มผลิต (${planned} ชิ้น)`
              : qtySplitOut > 0
                ? `ดี + เสีย + แยกเป็นส่วนย่อย ต้องเท่ากับจำนวนเริ่มผลิต (${planned} ชิ้น)`
                : `ดี + เสีย ต้องเท่ากับจำนวนเริ่มผลิต (${planned} ชิ้น)`}
          </p>
        )}
        {short > 0 && (
          <p role="status" className="rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm font-medium text-sky-900">
            ดี {goodN} น้อยกว่าที่สั่ง {qtyOrder} — ขาด {short} ชิ้น
          </p>
        )}
        {surplus > 0 && (
          <div role="status" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
            <p className="font-semibold">
              ของเหลือ {surplus} ชิ้น (ดี {goodN} − สั่ง {qtyOrder})
            </p>
            {isOem ? (
              <>
                <SurplusChoice idPrefix="done" value={disp} onChange={setDisp} note={sNote} onNote={setSNote} disabled={busy} />
                <p className="text-xs">ยังไม่ตัดสินก็ปิดงานได้ — บอร์ดจะเตือน</p>
              </>
            ) : (
              <p>
                เข้าสต็อกทั้งหมดตอนปิดใบผลิต (ผลิตได้ {goodN} มากกว่าที่สั่ง {qtyOrder})
              </p>
            )}
          </div>
        )}
        <Field id="wfinal" label={`น้ำหนักสุทธิ (กรัม)${finalRequired ? (metal === "gold" ? " — งานทองต้องใส่" : " — แบบการบันทึกนี้บังคับ") : " — ไม่บังคับ"}`}>
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
