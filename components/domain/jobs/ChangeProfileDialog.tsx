"use client";

// ChangeProfileDialog — เปลี่ยนแบบการบันทึกของใบงาน (ก่อนช่างรับขั้นแรกเท่านั้น · 0176 · ออฟฟิศเท่านั้น)
// โหลดรายการแบบจาก listProfiles (loading/error+ลองใหม่/ว่าง/พร้อม) · ProfilePicker กับขั้นของใบนี้ (ไม่รวมขั้นที่ข้าม) · ใบทองที่มีขั้นโลหะไม่ชั่ง = ติ๊กรับทราบก่อน
// DB เป็นด่านจริง (started / profile_invalid) — started: ข้อความ + refresh หน้า (ปุ่มเปลี่ยนแบบจะกลายเป็น disabled ตามสถานะจริง)

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { DialogButtons, ErrorLine } from "@/components/domain/jobs/JobDialogs";
import { ProfilePicker, needsGoldAck } from "@/components/domain/jobs/ProfilePicker";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { changeJobProfile, listProfiles } from "@/lib/actions/job-profiles";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { ProfilesData } from "@/lib/jobs/profile";
import type { StageRow } from "@/lib/jobs/types";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: ProfilesData };

interface Props {
  jobId: string;
  metal: string;
  stages: readonly StageRow[];
  currentProfileId: string | null;
  onClose: () => void;
}

export function ChangeProfileDialog({ jobId, metal, stages, currentProfileId, onClose }: Props) {
  const router = useRouter();
  const { run, busy, error, setError } = useOfficeRun();
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [profileId, setProfileId] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  const fetchProfiles = useCallback(async () => {
    setLoad({ s: "loading" });
    try {
      const r = await listProfiles();
      if (!r.ok) return setLoad({ s: "error", message: r.error });
      setLoad({ s: "ready", data: r.data });
      // เริ่มที่แบบปัจจุบันของใบ (ถ้ายังใช้งานอยู่) — ใบเดิมไม่มีแบบ = "เลือกแบบ…"
      setProfileId(r.data.profiles.some((p) => p.id === currentProfileId && p.isActive) ? currentProfileId : null);
    } catch {
      setLoad({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, [currentProfileId]);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  const data = load.s === "ready" ? load.data : null;
  const active = data ? data.profiles.filter((p) => p.isActive) : [];
  // 0186 M1: ทอง = ค่าเริ่มทองเท่านั้น (ไม่มี = null → ผู้ใช้ต้องเลือกแบบเอง) — ไม่ fallback ไปแบบงานทั่วไปเงียบๆ เหมือน DB (job_profile_default_for)
  const defaultId = data ? (metal === "gold" ? data.defaultGoldProfileId : data.defaultProfileId) : null;
  const pickerStages = stages.filter((s) => s.status !== "skipped").map((s) => ({ code: s.code, nameTh: s.name, metalPresent: s.metalPresent, goldWeighExempt: s.goldWeighExempt === true }));
  const allNames = Object.fromEntries(stages.map((s) => [s.code, s.name]));
  const profile = active.find((p) => p.id === profileId) ?? null;
  const ready = profile !== null && profileId !== currentProfileId && (!needsGoldAck(profile, pickerStages, metal) || ack);

  async function submit() {
    if (!ready || !profile) return;
    const r = await run(() => changeJobProfile(jobId, profile.id), { success: `เปลี่ยนเป็น “${profile.name}” แล้ว` });
    if (r.ok) return onClose();
    // started: ช่างรับงานไปแล้วระหว่างที่กล่องเปิดอยู่ — โหลดหน้าใหม่ให้สถานะตรงจริง · profile_invalid: ดึงรายการแบบใหม่
    if (r.code === "started") router.refresh();
    else if (r.code === "profile_invalid") {
      setError("แบบที่เลือกถูกปิดใช้หรือแก้ไปแล้ว — เลือกใหม่");
      void fetchProfiles();
    }
  }

  return (
    <Modal open onClose={onClose} title="เปลี่ยนแบบการบันทึก">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-sm text-zinc-700">เปลี่ยนได้ก่อนช่างรับงานขั้นแรกเท่านั้น — เปลี่ยนแล้วกติกาชั่ง/ของเสียของทุกขั้นตามแบบใหม่</p>
        {load.s === "loading" && (
          <div role="status" aria-label="กำลังโหลดแบบการบันทึก" className="space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {load.s === "error" && (
          <div className="space-y-2">
            <ErrorLine message={load.message} />
            <Button type="button" variant="secondary" size="sm" onClick={() => void fetchProfiles()}>
              ลองใหม่
            </Button>
          </div>
        )}
        {data && (
          <ProfilePicker
            idPrefix="cp"
            profiles={active}
            defaultProfileId={defaultId}
            profileId={profileId}
            onProfile={setProfileId}
            stages={pickerStages}
            allNames={allNames}
            metal={metal}
            ack={ack}
            onAck={setAck}
            disabled={busy}
          />
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="เปลี่ยนแบบ" onClose={onClose} />
      </form>
    </Modal>
  );
}
