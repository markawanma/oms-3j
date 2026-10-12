"use client";

// JobCreateDialog — สร้างใบงานจากรายการ (OEM won / ใบผลิต): ข้อเสนอขั้นตอนจาก job_stage_suggest → ติ๊กขั้น → กำหนดส่ง → สร้าง
// ไม่มีตรรกะเงิน: มัดจำยังไม่มี = DB บังคับเหตุผล (เราแค่แสดงช่องให้กรอก) · ซ้ำรายการเดิม/ลำดับขั้น/ขั้นที่ไม่รู้จัก DB ตัดสิน

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { useToast } from "@/components/ui/Toast";
import { createJob, suggestJob } from "@/lib/actions/job-office";
import type { JobSuggestion } from "@/lib/actions/job-office";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { METAL_LABEL } from "@/lib/jobs/types";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: JobSuggestion };

export function JobCreateDialog({ kind, itemId, itemLabel, onClose, onCreated }: { kind: "oem" | "production"; itemId: string; itemLabel: string; onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [codes, setCodes] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [gate, setGate] = useState("");
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
  const needGate = data?.depositMissing === true && kind === "oem";
  const ready = data !== null && !data.existingJob && codes.length > 0 && (!needGate || gate.trim() !== "");
  const toggle = (c: string) => setCodes((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  async function submit() {
    if (busy || !data) return;
    setBusy(true);
    setError(null);
    try {
      // เรียงตามลำดับที่ DB เสนอ (ไม่ใช่ลำดับที่ติ๊ก) — ลำดับขั้นของช่างต้องคงที่
      const ordered = data.stages.filter((s) => codes.includes(s.code)).map((s) => s.code);
      const r = await createJob({ kind, itemId, stageCodes: ordered, dueDate: due || null, startGateNote: needGate ? gate.trim() : null });
      if (!r.ok) return setError(r.error);
      toast.push(`สร้างใบงาน ${r.data.jobNo} แล้ว`);
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
            <p className="text-sm text-zinc-800">
              {data.qty} ชิ้น · {METAL_LABEL[data.metal] ?? data.metal}
            </p>
            {data.existingJob && (
              <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
                รายการนี้มีใบงานแล้ว:{" "}
                <Link href={`/jobs/${data.existingJob.id}`} className="underline">
                  {data.existingJob.jobNo}
                </Link>
              </p>
            )}
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-zinc-800">ขั้นตอน (ติ๊กที่ต้องผ่าน)</legend>
              {data.stages.map((s) => (
                <label key={s.code} className="flex min-h-11 items-center gap-2 text-base text-zinc-900">
                  <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={codes.includes(s.code)} onChange={() => toggle(s.code)} disabled={busy || data.existingJob !== null} />
                  {s.nameTh}
                </label>
              ))}
            </fieldset>
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
