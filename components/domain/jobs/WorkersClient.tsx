"use client";

// WorkersClient — ทะเบียนช่าง: เพิ่ม/แก้ชื่อ+ขั้นที่ทำ · รีเซ็ต PIN · ปิด/เปิดใช้งาน
// 🔴 PIN แสดงครั้งเดียวในกล่องนี้ (state ในหน้าจอเท่านั้น ไม่ลง storage/URL/log) — ปิดกล่อง = หาย · DB เก็บ bcrypt อ่านกลับไม่ได้

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, UserX, UserCheck, KeyRound, Pencil, Lock, LockOpen } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { resetWorkerPin, saveWorker, setWorkerActive, unlockWorker } from "@/lib/actions/job-workers";
import type { WorkersData } from "@/lib/actions/job-workers";
import { LABEL_ANGLE_MSG, LABEL_ANGLE_RE } from "@/lib/jobs/input";
import { LOCK_STATE_LABEL } from "@/lib/jobs/types";
import type { WorkerRow } from "@/lib/jobs/types";

type Dlg = { t: "edit"; worker: WorkerRow | null } | { t: "pin"; worker: WorkerRow } | { t: "shown"; name: string; pin: string } | null;
type OnShown = (name: string, pin: string) => void;

function ShownPinDialog({ name, pin, onClose }: { name: string; pin: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`PIN ของ ${name}`}>
      <div className="space-y-3">
        <p role="status" className="text-center text-4xl font-extrabold tracking-[0.4em] text-zinc-900 tabular-nums" aria-label={`PIN ${pin.split("").join(" ")}`}>
          {pin}
        </p>
        <p className="text-sm font-medium text-amber-900">แสดงครั้งเดียว — ปิดกล่องนี้แล้วดูซ้ำไม่ได้ (ถ้าลืมให้รีเซ็ตใหม่) · แจ้งช่างด้วยตัวเอง อย่าส่งในแชทกลุ่ม</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => void copy()}>
            {copied ? "คัดลอกแล้ว" : "คัดลอก PIN"}
          </Button>
          <Button type="button" onClick={onClose}>
            จดแล้ว ปิด
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditDialog({ worker, stages, retired, onClose, onShown }: { worker: WorkerRow | null; stages: WorkersData["stages"]; retired: NonNullable<WorkersData["retiredStages"]>; onClose: () => void; onShown: OnShown }) {
  const { run, busy, error } = useOfficeRun();
  // ขั้นเลิกใช้: โชว์เฉพาะที่ช่างคนนี้ยังถืออยู่ (ติ๊กอยู่ · เอาออกได้ · เพิ่มกลับไม่ได้) — กดบันทึกโดยไม่แตะ = คงรหัสไว้ ไม่หลุด
  const heldRetired = retired.filter((s) => worker?.stageCodes.includes(s.code));
  const [name, setName] = useState(worker?.displayName ?? "");
  const [codes, setCodes] = useState<string[]>(worker?.stageCodes ?? []);
  const [pin, setPin] = useState("");
  const pinOk = pin === "" || /^\d{4}$/.test(pin);
  const nameBad = LABEL_ANGLE_RE.test(name);
  const ready = name.trim() !== "" && codes.length > 0 && pinOk && !nameBad;
  const toggle = (c: string) => setCodes((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  async function submit() {
    const r = await run(() => saveWorker({ id: worker?.id ?? null, displayName: name, stageCodes: codes, pin: worker ? null : pin || null }), { success: worker ? "บันทึกแล้ว" : "เพิ่มช่างแล้ว" });
    if (!r.ok) return;
    onClose();
    if (r.data.pin) onShown(name.trim(), r.data.pin);
  }

  return (
    <Modal open onClose={onClose} title={worker ? `แก้ไข ${worker.displayName}` : "เพิ่มช่าง"}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <Field id="wname" label="ชื่อที่ช่างเห็นในหน้ามือถือ" hint={nameBad ? LABEL_ANGLE_MSG : undefined}>
          <input id="wname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={FIELD} />
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-zinc-800">ขั้นที่ช่างทำ (เลือกอย่างน้อย 1)</legend>
          <div className="grid grid-cols-2 gap-1">
            {stages.map((s) => (
              <label key={s.code} className="flex min-h-11 items-center gap-2 text-sm text-zinc-900">
                <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={codes.includes(s.code)} onChange={() => toggle(s.code)} />
                {s.nameTh}
              </label>
            ))}
            {heldRetired.map((s) => (
              <label key={s.code} className="flex min-h-11 items-center gap-2 text-sm text-zinc-600">
                <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={codes.includes(s.code)} onChange={() => toggle(s.code)} />
                {s.nameTh} (เลิกใช้)
              </label>
            ))}
          </div>
        </fieldset>
        {!worker && (
          <Field id="wpin" label="PIN 4 หลัก (ไม่ใส่ = ระบบสุ่มให้)" hint={pinOk ? undefined : "ต้องเป็นตัวเลข 4 หลักเท่านั้น"}>
            <input id="wpin" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={FIELD} />
          </Field>
        )}
        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} disabled={!ready || busy}>
            บันทึก
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPinDialog({ worker, onClose, onShown }: { worker: WorkerRow; onClose: () => void; onShown: OnShown }) {
  const { run, busy, error } = useOfficeRun();
  async function submit() {
    const r = await run(() => resetWorkerPin(worker.id, null), { success: "รีเซ็ต PIN แล้ว" });
    if (!r.ok) return;
    onClose();
    if (r.data.pin) onShown(worker.displayName, r.data.pin);
  }
  return (
    <Modal open onClose={onClose} title={`รีเซ็ต PIN ของ ${worker.displayName}`}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-800">ระบบจะสุ่ม PIN ใหม่ให้ — PIN เดิมใช้ไม่ได้ และช่างที่เปิดค้างอยู่จะถูกให้ระบุตัวใหม่ทันที</p>
        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={() => void submit()} loading={busy}>
            สุ่ม PIN ใหม่
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type ItemProps = { w: WorkerRow; stageName: (c: string) => string; onEdit: () => void; onPin: () => void; onToggle: () => void; onUnlock: () => void };

// แถวช่าง: ซ้าย = ชื่อ + badge สถานะ + ขั้น + คำเตือน (ตัดบรรทัดในพื้นที่ตัวเอง) · ขวา = ปุ่มแถวเดียวบน ≥768px (มือถือซ้อนได้)
function WorkerItem({ w, stageName, onEdit, onPin, onToggle, onUnlock }: ItemProps) {
  return (
    <li className={`flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4 ${w.isActive ? "" : "bg-zinc-50"}`}>
      <div className="min-w-0 md:flex-1">
        <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold ${w.isActive ? "text-zinc-900" : "text-zinc-600"}`}>
          <span className="break-words">{w.displayName}</span>
          <Badge tone={w.isActive ? "green" : "slate"}>{w.isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}</Badge>
        </p>
        <p className={`break-words text-sm ${w.isActive ? "text-zinc-800" : "text-zinc-600"}`}>{w.stageCodes.length > 0 ? w.stageCodes.map(stageName).join(" · ") : "ยังไม่กำหนดขั้น"}</p>
        {w.lockState !== "none" && (
          <p className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {LOCK_STATE_LABEL[w.lockState]}
            {w.failedAttempts > 0 ? ` · ผิด ${w.failedAttempts} ครั้ง` : ""}
          </p>
        )}
        {w.pinWarning && (
          <p role="alert" className="mt-1 flex items-start gap-1.5 rounded-md border-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-sm font-semibold text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              มีคนใส่ PIN ผิด {w.failedAttempts} ครั้ง ในรอบ 24 ชม.
              <span className="block font-normal">ครบ 15 ครั้งใน 24 ชม. ระบบจะล็อกจนกว่าออฟฟิศปลดล็อก — ถ้าไม่ใช่ช่างลืม PIN ให้รีเซ็ต PIN และสอบถามช่าง</span>
            </span>
          </p>
        )}
        {!w.pinWarning && w.lockState === "none" && w.failedAttempts > 0 && <p className="text-xs text-zinc-700">ใส่ PIN ผิด {w.failedAttempts} ครั้งในรอบ 24 ชม.</p>}
      </div>
      <div className="flex flex-wrap gap-2 md:shrink-0 md:flex-nowrap">
        <Button type="button" variant="secondary" className="md:whitespace-nowrap" onClick={onEdit} aria-label={`แก้ไข ${w.displayName}`}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          แก้ไข
        </Button>
        {(w.lockState !== "none" || w.pinWarning) && (
          <Button type="button" variant="secondary" className="md:whitespace-nowrap" onClick={onUnlock} aria-label={`ปลดล็อก ${w.displayName}`}>
            <LockOpen className="h-4 w-4" aria-hidden="true" />
            ปลดล็อก / รีเซ็ตตัวนับ
          </Button>
        )}
        <Button type="button" variant="secondary" className="md:whitespace-nowrap" onClick={onPin} aria-label={`รีเซ็ต PIN ของ ${w.displayName}`}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          รีเซ็ต PIN
        </Button>
        <Button type="button" variant="secondary" className="md:whitespace-nowrap" onClick={onToggle} aria-label={`${w.isActive ? "ปิด" : "เปิด"}ใช้งาน ${w.displayName}`}>
          {w.isActive ? <UserX className="h-4 w-4" aria-hidden="true" /> : <UserCheck className="h-4 w-4" aria-hidden="true" />}
          {w.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
        </Button>
      </div>
    </li>
  );
}

type Tab = "active" | "inactive";

export function WorkersClient({ data }: { data: WorkersData }) {
  const { run, error } = useOfficeRun();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [tab, setTab] = useState<Tab>("active");
  const { activeWorkers, inactiveWorkers } = useMemo(
    () => ({ activeWorkers: data.workers.filter((w) => w.isActive), inactiveWorkers: data.workers.filter((w) => !w.isActive) }),
    [data.workers],
  );
  const visible = tab === "active" ? activeWorkers : inactiveWorkers;
  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "active", label: "ใช้งานอยู่", count: activeWorkers.length },
    { value: "inactive", label: "ปิดใช้งาน", count: inactiveWorkers.length },
  ];
  const retired = data.retiredStages ?? [];
  // ขั้นที่เลิกใช้แล้ว (เช่น "แต่ง ขัด") ยังต้องอ่านออก — แสดงชื่อไทย + ป้าย ไม่โชว์รหัสดิบ
  const stageName = (c: string) => {
    const a = data.stages.find((s) => s.code === c);
    if (a) return a.nameTh;
    const r = retired.find((s) => s.code === c);
    return r ? `${r.nameTh} (เลิกใช้)` : c;
  };
  const toggleActive = (w: WorkerRow) =>
    void run(() => setWorkerActive(w.id, !w.isActive), { success: w.isActive ? `ปิดใช้งาน ${w.displayName} แล้ว` : `เปิดใช้งาน ${w.displayName} แล้ว` });
  const unlock = (w: WorkerRow) => void run(() => unlockWorker(w.id), { success: `ปลดล็อก ${w.displayName} แล้ว` });
  const shown: OnShown = (name, pin) => setDlg({ t: "shown", name, pin });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-zinc-900">ทะเบียนช่าง</h1>
        <Button type="button" onClick={() => setDlg({ t: "edit", worker: null })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          เพิ่มช่าง
        </Button>
      </div>
      <ErrorLine message={error} />
      {data.workers.length === 0 ? (
        <EmptyState title="ยังไม่มีช่างในทะเบียน" description="เพิ่มช่างก่อน แล้วค่อยพิมพ์ใบงาน — ช่างระบุตัวด้วยชื่อ + PIN 4 หลักบนมือถือ" />
      ) : (
        <>
          <div role="group" aria-label="กรองช่างตามสถานะ" className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={tab === t.value}
                onClick={() => setTab(t.value)}
                className={`min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${
                  tab === t.value ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              title={tab === "active" ? "ยังไม่มีช่างที่ใช้งานอยู่" : "ยังไม่มีช่างที่ปิดใช้งาน"}
              description={tab === "active" ? "ช่างทุกคนถูกปิดใช้งาน — เปิดจากแท็บ “ปิดใช้งาน” หรือเพิ่มช่างใหม่" : undefined}
            />
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
              {visible.map((w) => (
                <WorkerItem key={w.id} w={w} stageName={stageName} onEdit={() => setDlg({ t: "edit", worker: w })} onPin={() => setDlg({ t: "pin", worker: w })} onToggle={() => toggleActive(w)} onUnlock={() => unlock(w)} />
              ))}
            </ul>
          )}
        </>
      )}
      {dlg?.t === "edit" && <EditDialog worker={dlg.worker} stages={data.stages} retired={retired} onClose={() => setDlg(null)} onShown={shown} />}
      {dlg?.t === "pin" && <ResetPinDialog worker={dlg.worker} onClose={() => setDlg(null)} onShown={shown} />}
      {dlg?.t === "shown" && <ShownPinDialog name={dlg.name} pin={dlg.pin} onClose={() => setDlg(null)} />}
    </div>
  );
}
