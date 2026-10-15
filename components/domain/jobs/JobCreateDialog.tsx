"use client";

// JobCreateDialog — สร้างใบงานจากรายการ (OEM won / ใบผลิต): ข้อเสนอขั้นตอนจาก job_stage_suggest → จำนวน/แผนโลหะ (0175) → ติ๊กขั้น → กำหนดส่ง → สร้าง
// ไม่มีตรรกะเงิน/น้ำหนัก: จำนวนแนะนำ + โลหะที่ต้องเตรียมมาจาก job_plan_suggest (debounce ~400ms) · มัดจำยังไม่มี = DB บังคับเหตุผล
// ส่ง qtyPlanned/targetPieceG เฉพาะเมื่อต่างจากค่าเริ่มของ DB (qty = จำนวนสั่ง · น้ำหนัก = ค่าจากต้นทาง) — กันตีตราที่มาเป็น "กรอกเอง" โดยไม่ได้แก้

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { LABEL_ANGLE_MSG, LABEL_ANGLE_RE, parseQtyText } from "@/lib/jobs/input";
import { DESIGN_LABEL_WARNING, ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { EMPTY_PLAN_FIELDS, PlanFields, planFieldsIssues, targetDiffers } from "@/components/domain/jobs/PlanFields";
import type { PlanFieldsValue } from "@/components/domain/jobs/PlanFields";
import { ProfilePicker, needsGoldAck } from "@/components/domain/jobs/ProfilePicker";
import { QtyFields } from "@/components/domain/jobs/QtyFields";
import { usePlanPreview } from "@/components/domain/jobs/usePlanPreview";
import { useToast } from "@/components/ui/Toast";
import { createJob, suggestJob } from "@/lib/actions/job-office";
import type { CreateJobInput, JobSuggestion } from "@/lib/actions/job-office";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { METAL_LABEL } from "@/lib/jobs/types";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: JobSuggestion };

/** ค่าน้ำหนักเริ่มต้นจากต้นทาง เป็นข้อความในช่อง (3 ตำแหน่ง ไม่มีตัวคั่นหลักพัน) — null = ต้นทางไม่มีข้อมูล (ไม่เดา) */
const targetText = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(3) : "");

export function JobCreateDialog({ kind, itemId, itemLabel, onClose, onCreated }: { kind: "oem" | "production"; itemId: string; itemLabel: string; onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [codes, setCodes] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [gate, setGate] = useState("");
  const [label, setLabel] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [qtyTouched, setQtyTouched] = useState(false);
  const [plan, setPlan] = useState<PlanFieldsValue>(EMPTY_PLAN_FIELDS);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await suggestJob(kind, itemId);
        if (cancelled) return;
        if (!r.ok) return setLoad({ s: "error", message: r.error });
        setCodes(r.data.stages.filter((x) => x.defaultSelected).map((x) => x.code));
        setLabel(r.data.designLabel);
        setQtyText(String(r.data.qty));
        setProfileId(r.data.defaultProfileId);
        setPlan({ ...EMPTY_PLAN_FIELDS, targetText: targetText(r.data.targetPieceG) });
        setLoad({ s: "ready", data: r.data });
      } catch {
        if (!cancelled) setLoad({ s: "error", message: GENERIC_JOB_ERROR });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, itemId]);

  const data = load.s === "ready" ? load.data : null;
  const defaultTarget = targetText(data?.targetPieceG);
  const qtyParsed = parseQtyText(qtyText);
  const qtyValue = qtyParsed.ok ? qtyParsed.value : null;
  const qtyError = qtyParsed.ok ? null : qtyParsed.error;
  const issues = planFieldsIssues(plan, defaultTarget);
  // เทียบเชิงตัวเลข ("4" = "4.000" ไม่นับว่าแก้ — ไม่ส่ง/ไม่ตีตราที่มาเป็น "กรอกเอง")
  const targetChanged = targetDiffers(plan.targetText, defaultTarget);

  // ตัวอย่างแผนจาก DB: ไม่แตะค่าที่ผู้ใช้ยังไม่ได้แก้ (null = ให้ DB ใช้ค่าเริ่ม/ค่าแนะนำเอง)
  const { state: preview, retry } = usePlanPreview({
    kind,
    itemId,
    enabled: data !== null && data.existingJob === null && qtyError === null && issues.targetError === null,
    qtyPlanned: qtyTouched ? qtyValue : null,
    targetPieceG: targetChanged ? plan.targetText.trim() : null,
    stageCodes: data ? data.stages.filter((s) => codes.includes(s.code)).map((s) => s.code) : null,
  });
  const planData = preview.s === "ready" ? preview.data : null;
  // กล่องแนะนำจำนวนใช้คำตอบล่าสุดแม้กำลังถามใหม่ (ไม่กระพริบ) · ค่าที่ใส่ลงช่องใช้เฉพาะ planData ที่ตอบครบ
  const hintPlan = planData ?? (preview.s === "loading" ? (preview.prev ?? null) : null);

  // ยังไม่ได้แก้ช่องเริ่มผลิต → ตามค่าที่ DB ตอบ (ค่าแนะนำ ถ้ามี rate ครบ)
  const effQty = planData?.qtyPlannedEff;
  useEffect(() => {
    if (!qtyTouched && typeof effQty === "number" && effQty >= 1) setQtyText(String(effQty));
  }, [effQty, qtyTouched]);

  // แบบการบันทึก (0176): ขั้นที่ติ๊ก × แบบ — ใบทองที่มีขั้นโลหะไม่ชั่งต้องติ๊กรับทราบก่อน · ไม่มีแบบ/ค่าเริ่ม = สร้างไม่ได้
  const pickerStages = data ? data.stages.filter((s) => codes.includes(s.code)).map((s) => ({ code: s.code, nameTh: s.nameTh, metalPresent: s.metalPresent })) : [];
  const allNames = data ? Object.fromEntries(data.stages.map((s) => [s.code, s.nameTh])) : {};
  const profile = data?.profiles.find((p) => p.id === profileId) ?? null;
  const profileOk = profile !== null && (!needsGoldAck(profile, pickerStages, data?.metal ?? "") || ack);
  const needGate = data?.depositMissing === true && kind === "oem";
  // OEM: ออฟฟิศต้องตั้ง/ยืนยันชื่อเรียกภายในเอง (มติเจ้าของ 12 ต.ค.) — ค่าเริ่มมาจากข้อเสนอของระบบ แต่ห้ามว่าง · ใบผลิตเข้าสต็อกไม่บังคับ
  const labelRequired = kind === "oem";
  const labelBad = LABEL_ANGLE_RE.test(label);
  const planPending = preview.s === "loading"; // รอ DB คำนวณ → ห้ามสร้าง (ล้ม = สร้างได้ ระบบคำนวณตอนสร้าง)
  const ready =
    data !== null && !data.existingJob && codes.length > 0 && (!needGate || gate.trim() !== "") && (!labelRequired || label.trim() !== "") && !labelBad && qtyError === null && !issues.blocking && !planPending && profileOk;
  /** แบบที่เลือกถูกปิด/แก้ไปแล้ว (DB ปฏิเสธ profile_invalid) → ดึงรายการแบบใหม่ เก็บขั้นที่ติ๊กไว้ */
  async function refreshProfiles() {
    try {
      const r = await suggestJob(kind, itemId);
      if (r.ok) {
        setLoad((p) => (p.s === "ready" ? { s: "ready", data: { ...p.data, profiles: r.data.profiles, defaultProfileId: r.data.defaultProfileId } } : p));
        setProfileId(r.data.defaultProfileId);
      }
    } catch {
      /* คงรายการเดิม — ผู้ใช้กดสร้างซ้ำได้ ข้อความผิดพลาดยังค้างอยู่ */
    }
  }
  const toggle = (c: string) => setCodes((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  async function submit() {
    if (busy || !data || qtyValue === null) return;
    setBusy(true);
    setError(null);
    try {
      // เรียงตามลำดับที่ DB เสนอ (ไม่ใช่ลำดับที่ติ๊ก) — ลำดับขั้นของช่างต้องคงที่
      const ordered = data.stages.filter((s) => codes.includes(s.code)).map((s) => s.code);
      const input: CreateJobInput = { kind, itemId, stageCodes: ordered, dueDate: due || null, startGateNote: needGate ? gate.trim() : null, designLabel: label.trim() || null };
      if (qtyValue !== data.qty) input.qtyPlanned = qtyValue;
      input.profileId = profileId;
      if (targetChanged) input.targetPieceG = plan.targetText.trim();
      if (plan.overrideOn && issues.hasTarget) {
        input.metalPlanOverrideG = plan.overrideText.trim();
        input.metalPlanReason = plan.overrideReason.trim();
      }
      const r = await createJob(input);
      if (!r.ok) {
        if (r.code === "profile_invalid") {
          setError("แบบที่เลือกถูกปิดใช้หรือแก้ไปแล้ว — เลือกใหม่");
          void refreshProfiles();
          return;
        }
        return setError(r.error);
      }
      toast.push(`สร้างใบงาน ${r.data.jobNo} แล้ว${r.data.planMissing.length > 0 ? " · ยังไม่มีแผนโลหะ" : ""}`);
      onCreated();
      onClose();
      router.push(`/jobs/${r.data.jobId}`);
    } catch {
      setError(GENERIC_JOB_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="สร้างใบงาน">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm font-semibold break-words text-zinc-900">{itemLabel}</p>
        {load.s === "loading" && <p role="status" className="text-sm text-zinc-700">กำลังโหลดขั้นตอนที่แนะนำ…</p>}
        {load.s === "error" && <ErrorLine message={load.message} />}
        {data && (
          <>
            <p className="text-sm text-zinc-800">{METAL_LABEL[data.metal] ?? data.metal}</p>
            {data.existingJob && (
              <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
                รายการนี้มีใบงานแล้ว:{" "}
                <Link href={`/jobs/${data.existingJob.id}`} className="underline">
                  {data.existingJob.jobNo}
                </Link>
              </p>
            )}
            <fieldset className="space-y-2 rounded-md border border-zinc-200 p-3" disabled={busy || data.existingJob !== null}>
              <legend className="px-1 text-sm font-semibold text-zinc-800">จำนวนและโลหะ</legend>
              <QtyFields
                idPrefix="jc"
                kind={kind}
                qtyOrder={data.qty}
                qtyText={qtyText}
                onQtyText={(v) => {
                  setQtyTouched(true);
                  setQtyText(v);
                }}
                qtyError={qtyError}
                qtyValue={qtyValue}
                plan={hintPlan}
                preview={preview}
                onRetry={issues.hasTarget ? undefined : retry}
                onUseSuggest={(n) => {
                  setQtyTouched(true);
                  setQtyText(String(n));
                }}
                disabled={busy}
              />
              <PlanFields idPrefix="jc" metal={data.metal} value={plan} onChange={setPlan} preview={preview} onRetry={retry} defaultSource={data.targetPieceGSource} defaultTargetText={defaultTarget} disabled={busy} />
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-zinc-800">ขั้นตอน (ติ๊กที่ต้องผ่าน)</legend>
              {data.stages.map((s) => (
                <label key={s.code} className="flex min-h-11 items-center gap-2 text-base text-zinc-900">
                  <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={codes.includes(s.code)} onChange={() => toggle(s.code)} disabled={busy || data.existingJob !== null} />
                  {s.nameTh}
                </label>
              ))}
            </fieldset>
            <ProfilePicker
              idPrefix="jc"
              profiles={data.profiles}
              defaultProfileId={data.defaultProfileId}
              profileId={profileId}
              onProfile={setProfileId}
              stages={pickerStages}
              allNames={allNames}
              metal={data.metal}
              ack={ack}
              onAck={setAck}
              disabled={busy || data.existingJob !== null}
            />
            <Field id="jlabel" label={`ชื่อเรียกภายใน (ช่างเห็น)${labelRequired ? " — จำเป็น" : " — ไม่บังคับ"}`} hint={labelBad ? LABEL_ANGLE_MSG : DESIGN_LABEL_WARNING}>
              <input id="jlabel" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} className={FIELD} disabled={busy} />
            </Field>
            <Field id="jdue" label="กำหนดส่ง (ไม่บังคับ)">
              <input id="jdue" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
            </Field>
            {needGate && (
              <Field id="jgate" label="ยังไม่มีมัดจำ — เหตุผลที่เริ่มผลิตก่อน (จำเป็น)">
                <textarea id="jgate" value={gate} onChange={(e) => setGate(e.target.value)} rows={2} maxLength={500} className={`${FIELD} py-2`} />
              </Field>
            )}
          </>
        )}
        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} disabled={!ready || busy}>
            สร้างใบงาน
          </Button>
        </div>
      </form>
    </Modal>
  );
}
