"use client";

// JobProfileCard — การ์ด "แบบการบันทึก" ของใบงานบนหน้า /jobs/[id] (0176 · ออฟฟิศเท่านั้น)
// สรุปอ่านจาก snapshot ของขั้นในใบ (ไม่ใช่แบบสด — แก้แบบทีหลังไม่กระทบใบนี้) · ใบเดิม (ไม่มีแบบ) = "กติกาเดิม (ก่อนมีแบบการบันทึก)"
// ปุ่ม [เปลี่ยนแบบ]: ใบที่เริ่มแล้ว = aria-disabled + ข้อความเห็นได้ (ไม่ใช่ title อย่างเดียว) · ใบปิด/ยกเลิก = อ่านอย่างเดียว ไม่มีปุ่ม
// DB เป็นด่านจริง (started) — ปุ่มนี้เป็นแค่ทางเลือกที่แสดง

import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProfileSummary } from "@/components/domain/jobs/ProfileSummary";
import { goldUnguardedStages } from "@/lib/jobs/profile-summary";
import type { JobDetail, StageRow } from "@/lib/jobs/types";

interface Props {
  job: Pick<JobDetail, "metal" | "status" | "profileId" | "profileName">;
  stages: readonly StageRow[];
  /** ใบนี้เริ่มแล้ว (มีขั้นที่ไม่ใช่ pending) — เปลี่ยนแบบไม่ได้ */
  started: boolean;
  onChange: () => void;
}

export function JobProfileCard({ job, stages, started, onChange }: Props) {
  const closed = job.status === "done" || job.status === "cancelled";
  const legacy = job.profileId === null;
  const defs = stages.map((s) => ({ code: s.code, nameTh: s.name, metalPresent: s.metalPresent }));
  const flags = stages.map((s) => ({ stageCode: s.code, weigh: s.weighRequired, scrapQty: s.scrapQtyAsk, scrapWeight: s.scrapWeightAsk }));
  const unguarded = job.metal === "gold" && !closed && !legacy ? goldUnguardedStages(stages.map((s) => ({ code: s.code, metalPresent: s.metalPresent, weigh: s.weighRequired, skipped: s.status === "skipped" }))) : [];
  const nameOf = (c: string) => stages.find((s) => s.code === c)?.name ?? c;
  return (
    <section aria-labelledby="job-profile-h" className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="job-profile-h" className="text-base font-bold break-words text-zinc-900">
          {legacy ? "กติกาเดิม (ก่อนมีแบบการบันทึก)" : `แบบการบันทึก: ${job.profileName}`}
        </h2>
        {!closed && (
          <Button type="button" variant="secondary" size="sm" onClick={started ? undefined : onChange} aria-disabled={started ? true : undefined} aria-describedby={started ? "job-profile-started" : undefined} className={started ? "cursor-not-allowed opacity-60" : undefined}>
            เปลี่ยนแบบ
          </Button>
        )}
      </div>
      <ProfileSummary defs={defs} flags={flags} />
      <p className="text-xs text-zinc-700">{legacy ? "ใบนี้สร้างก่อนมีแบบการบันทึก — ช่างกรอกตามกติกาเดิม" : "ตามที่ตั้งไว้ตอนสร้างใบ — แก้แบบทีหลังไม่กระทบใบนี้"}</p>
      {unguarded.length > 0 && (
        <p className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-sm font-semibold text-red-900">
          <ShieldOff className="h-4 w-4" aria-hidden="true" />
          ทอง · ไม่มีด่านชั่ง: ขั้น {unguarded.map(nameOf).join(", ")} ไม่ชั่ง
        </p>
      )}
      {!closed && started && (
        <p id="job-profile-started" className="text-sm font-medium text-zinc-800">
          เปลี่ยนได้ก่อนช่างรับงานขั้นแรก — ใบนี้เริ่มแล้ว
        </p>
      )}
    </section>
  );
}
