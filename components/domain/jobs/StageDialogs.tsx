"use client";

// StageDialogs — ออฟฟิศกรอกแทนจากกระดาษ: รับงาน / ส่งต่อ ของขั้นหนึ่ง (วันที่ย้อนได้ ≤ 14 วัน ไม่อนาคต · ต้องระบุผู้รับ · ชั่งตามที่ขั้นบังคับ)
// ส่ง expectedSeq = ขั้นที่หน้าจอเห็น (กัน 2 คนกดพร้อมกัน) · DB ตัดสินกติกา (น้ำหนัก ≤ เข้า+เติม · เสีย+ดี = เข้า ฯลฯ)

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DialogButtons, ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { officeReceiveStage, officeSendStage } from "@/lib/actions/job-office-write";
import { addDays } from "@/lib/jobs/dates";
import { SCRAP_REASON_LABEL, SCRAP_REASONS } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";

const num = (v: string) => v.replace(/[^0-9.,]/g, "");

function DateField({ value, onChange, todayTh }: { value: string; onChange: (v: string) => void; todayTh: string }) {
  return (
    <Field id="on" label="วันที่ (ตามกระดาษ)" hint="ย้อนหลังได้ไม่เกิน 14 วัน · ไม่เป็นอนาคต">
      <input id="on" type="date" min={addDays(todayTh, -14)} max={todayTh} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} />
    </Field>
  );
}

export function ReceiveStageDialog({
  jobId,
  stage,
  workers,
  todayTh,
  prevWeightOut,
  onClose,
}: {
  jobId: string;
  stage: StageRow;
  workers: { id: string; displayName: string; stageCodes: string[] }[];
  todayTh: string;
  prevWeightOut: number | null;
  onClose: () => void;
}) {
  const { run, busy, error } = useOfficeRun();
  const [on, setOn] = useState(todayTh);
  const [w, setW] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [name, setName] = useState("");
  const ready = on !== "" && (workerId !== "" || name.trim() !== "") && (!stage.weighRequired || w.trim() !== "");
  const eligible = workers.filter((x) => x.stageCodes.length === 0 || x.stageCodes.includes(stage.code));

  async function submit() {
    const r = await run(() => officeReceiveStage({ jobId, expectedSeq: stage.seq, occurredOn: on, weightIn: w.trim() || null, workerId: workerId || null, assigneeName: workerId ? null : name.trim() || null }), { success: `รับงานแล้ว — ${stage.name}` });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`รับงาน: ${stage.name}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <DateField value={on} onChange={setOn} todayTh={todayTh} />
        <Field id="win" label={`น้ำหนักเข้า (กรัม)${stage.weighRequired ? " — ขั้นนี้ต้องใส่" : " — ไม่บังคับ"}`} hint={prevWeightOut !== null ? `ขั้นก่อนส่งออก ${prevWeightOut} กรัม` : undefined}>
          <input id="win" inputMode="decimal" value={w} onChange={(e) => setW(num(e.target.value))} className={FIELD} />
        </Field>
        <Field id="worker" label="ผู้รับงาน">
          <select id="worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={FIELD}>
            <option value="">เลือกช่างในทะเบียน…</option>
            {eligible.map((x) => (
              <option key={x.id} value={x.id}>
                {x.displayName}
              </option>
            ))}
          </select>
        </Field>
        {!workerId && (
          <Field id="aname" label="หรือพิมพ์ชื่อ (ช่างนอกทะเบียน)">
            <input id="aname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={FIELD} />
          </Field>
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="บันทึกรับงาน" onClose={onClose} />
      </form>
    </Modal>
  );
}

export function SendStageDialog({ jobId, stage, todayTh, onClose }: { jobId: string; stage: StageRow; todayTh: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [on, setOn] = useState(todayTh);
  const [w, setW] = useState("");
  const [scrap, setScrap] = useState("0");
  const [reason, setReason] = useState("");
  const [added, setAdded] = useState("");
  const [note, setNote] = useState("");
  const scrapN = /^\d+$/.test(scrap) ? Number(scrap) : NaN;
  const addedOn = added.trim() !== "" && !/^0+(\.0+)?$/.test(added.trim());
  const ready = on !== "" && Number.isInteger(scrapN) && (scrapN === 0 || reason !== "") && (!stage.weighRequired || w.trim() !== "") && (!addedOn || note.trim() !== "");

  async function submit() {
    const r = await run(
      () => officeSendStage({ jobId, expectedSeq: stage.seq, occurredOn: on, weightOut: w.trim() || null, qtyScrap: scrapN, scrapReason: scrapN > 0 ? reason : null, metalAdded: addedOn ? added : null, weightNote: addedOn ? note.trim() : null }),
      { success: `ส่งต่อแล้ว — ${stage.name}` }
    );
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`ส่งต่อ: ${stage.name}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <DateField value={on} onChange={setOn} todayTh={todayTh} />
        <p className="text-sm text-zinc-700">รับเข้า {stage.qtyIn ?? "—"} ชิ้น{stage.weightInG !== null ? ` · น้ำหนักเข้า ${stage.weightInG} กรัม` : ""}</p>
        <Field id="wout" label={`น้ำหนักออก (กรัม)${stage.weighRequired ? " — ขั้นนี้ต้องใส่" : " — ไม่บังคับ"}`}>
          <input id="wout" inputMode="decimal" value={w} onChange={(e) => setW(num(e.target.value))} className={FIELD} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="scrap" label="ของเสีย (ชิ้น)">
            <input id="scrap" inputMode="numeric" value={scrap} onChange={(e) => setScrap(e.target.value)} className={FIELD} />
          </Field>
          <Field id="sreason" label="เหตุผลของเสีย">
            <select id="sreason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!(scrapN > 0)} className={FIELD}>
              <option value="">{scrapN > 0 ? "เลือก…" : "ไม่มีของเสีย"}</option>
              {SCRAP_REASONS.map((r) => (
                <option key={r} value={r}>
                  {SCRAP_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="added" label="เติมโลหะ (กรัม) — ถ้ามี">
          <input id="added" inputMode="decimal" value={added} onChange={(e) => setAdded(num(e.target.value))} className={FIELD} />
        </Field>
        {addedOn && (
          <Field id="wnote" label="หมายเหตุการเติมโลหะ (จำเป็น)">
            <input id="wnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={FIELD} />
          </Field>
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="บันทึกส่งต่อ" onClose={onClose} />
      </form>
    </Modal>
  );
}
