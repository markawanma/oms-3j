"use client";

// ProfileDialogs — กล่องยืนยันของหน้าแบบการบันทึก (0176): ตั้งค่าเริ่ม (ทั่วไป/ทอง) · ปิดใช้งาน · ทิ้งการแก้ไขที่ยังไม่บันทึก
// ไม่ตัดสินกติกาเอง — DB เป็นด่านจริง (default_cannot_close / inactive / default_required) · ข้อความ DB ค้างในกล่อง ไม่ปิด

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DialogButtons, ErrorLine } from "@/components/domain/jobs/JobDialogs";
import { GoldGuardWarning } from "@/components/domain/jobs/GoldGuardWarning";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { setDefaultProfile, setProfileActive } from "@/lib/actions/job-profiles";
import type { RecordProfile } from "@/lib/jobs/profile";

export function SetDefaultDialog({ profile, scope, unguardedNames, onDone, onClose }: { profile: RecordProfile; scope: "general" | "gold"; unguardedNames: readonly string[]; onDone: () => void; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  async function submit() {
    const r = await run(() => setDefaultProfile(profile.id, scope), { success: "ตั้งค่าเริ่มแล้ว", refresh: false });
    if (r.ok) onDone();
  }
  const title = scope === "gold" ? "ตั้งเป็นค่าเริ่มงานทอง" : "ตั้งเป็นค่าเริ่มงานทั่วไป";
  return (
    <Modal open onClose={onClose} title={title}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {scope === "general" ? (
          <p className="text-sm text-zinc-800">ตั้ง “{profile.name}” เป็นค่าเริ่มของงานทั่วไป? ใบงานใหม่ที่ไม่ใช่ทองจะเริ่มด้วยแบบนี้ ใบที่มีอยู่ไม่เปลี่ยน</p>
        ) : (
          <p className="text-sm text-zinc-800">ตั้ง “{profile.name}” เป็นค่าเริ่มของงานทอง? ใบทองใหม่จะเริ่มด้วยแบบนี้ ใบที่มีอยู่ไม่เปลี่ยน</p>
        )}
        {scope === "gold" && <GoldGuardWarning idPrefix="sd" variant="info" stageNames={unguardedNames} />}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready confirm="ตั้งเป็นค่าเริ่ม" onClose={onClose} />
      </form>
    </Modal>
  );
}

export function CloseProfileDialog({ profile, onDone, onClose }: { profile: RecordProfile; onDone: () => void; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  async function submit() {
    const r = await run(() => setProfileActive(profile.id, false), { success: "ปิดใช้งานแล้ว", refresh: false });
    if (r.ok) onDone();
  }
  return (
    <Modal open onClose={onClose} title="ปิดใช้งานแบบ">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-sm text-zinc-800">ปิดใช้งาน “{profile.name}”? จะเลือกแบบนี้ตอนสร้างใบใหม่ไม่ได้ ใบที่ใช้อยู่ไม่กระทบ เปิดกลับได้ทุกเมื่อ</p>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready confirm="ปิดใช้งาน" onClose={onClose} danger />
      </form>
    </Modal>
  );
}

/** แก้ไขค้างอยู่แล้วจะไปที่อื่น — ถามก่อนทิ้ง (dirty guard) */
export function DiscardDialog({ onStay, onDiscard }: { onStay: () => void; onDiscard: () => void }) {
  return (
    <Modal open onClose={onStay} title="ยังไม่ได้บันทึก">
      <div className="space-y-3">
        <p className="text-sm text-zinc-800">ยังไม่ได้บันทึก — ทิ้งการแก้ไขไหม</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onDiscard}>
            ทิ้ง
          </Button>
          <Button type="button" onClick={onStay}>
            กลับไปแก้
          </Button>
        </div>
      </div>
    </Modal>
  );
}
