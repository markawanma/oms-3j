"use client";

// ProfilePicker — เลือก "แบบการบันทึก" ของใบงาน + พรีวิวว่าขั้นที่ติ๊กจะชั่ง/ถามของเสียอะไร (ฟอร์มสร้างใบงาน · กล่องเปลี่ยนแบบ) — ออฟฟิศเท่านั้น
// พรีวิว = lookup boolean ของแบบ × ขั้นของใบนี้ (analyzePicker) — ไม่คำนวณกติกา · ด่านจริงอยู่ที่ DB (profile_invalid / started / flag_not_applicable)
// state: ไม่มีแบบที่ใช้งาน (กล่องเหลือง + ลิงก์ · ผู้เรียกปิดปุ่มสร้าง) · เลือกแล้ว (พรีวิว + เตือนเทา/เหลือง/แดงทอง)
// ack กล่องแดงทองไม่ส่ง server — รีเซ็ตทุกครั้งที่เปลี่ยนแบบ/ขั้น

import { useEffect } from "react";
import { FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { GoldGuardWarning } from "@/components/domain/jobs/GoldGuardWarning";
import { analyzePicker } from "@/lib/jobs/profile-summary";
import type { PickerStage } from "@/lib/jobs/profile-summary";
import type { RecordProfile } from "@/lib/jobs/profile";

interface Props {
  idPrefix: string;
  profiles: readonly RecordProfile[];
  defaultProfileId: string | null;
  profileId: string | null;
  onProfile: (id: string | null) => void;
  /** ขั้นของใบนี้ที่ติ๊ก (ไม่รวมที่ข้าม) ตามลำดับ */
  stages: readonly PickerStage[];
  /** ชื่อไทยของทุกขั้น (บอกขั้นที่แบบตั้งไว้แต่ใบนี้ไม่ผ่าน) */
  allNames?: Readonly<Record<string, string>>;
  metal: string;
  ack: boolean;
  onAck: (v: boolean) => void;
  disabled?: boolean;
  /** กล่องเปลี่ยนแบบของใบเดิม (ยังไม่มีแบบ) — เปิดเป็น "เลือกแบบ…" */
  placeholder?: string;
}

const MANAGE_HREF = "/jobs/profiles";

export function ProfilePicker({ idPrefix, profiles, defaultProfileId, profileId, onProfile, stages, allNames, metal, ack, onAck, disabled, placeholder }: Props) {
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const a = profile ? analyzePicker(profile, stages, metal, allNames) : null;

  // ack ใช้ได้กับ "แบบนี้ + ขั้นเหล่านี้" เท่านั้น — เปลี่ยนอย่างใดอย่างหนึ่งต้องติ๊กใหม่
  const stageKey = stages.map((s) => s.code).join(",");
  useEffect(() => {
    onAck(false);
    // onAck จาก parent เป็น setState (คงที่) — ไม่ใส่ใน deps กันวนรีเซ็ต
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, stageKey]);

  if (profiles.length === 0) {
    return (
      <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
        ยังไม่มีแบบการบันทึกที่ใช้งานอยู่ — ตั้งค่าที่{" "}
        <a href={MANAGE_HREF} target="_blank" rel="noopener noreferrer" className="underline">
          แบบการบันทึก ↗
        </a>{" "}
        แล้วเปิดหน้านี้ใหม่
      </p>
    );
  }

  const list = (xs: readonly string[]) => (xs.length > 0 ? xs.join(", ") : "ไม่มี");
  return (
    <div className="space-y-2">
      <Field id={`${idPrefix}-profile`} label="แบบการบันทึก (ช่างต้องชั่ง/บันทึกอะไรในแต่ละขั้น)">
        <select id={`${idPrefix}-profile`} className={FIELD} value={profileId ?? ""} onChange={(e) => onProfile(e.target.value === "" ? null : e.target.value)} disabled={disabled}>
          {profileId === null && <option value="">{placeholder ?? "เลือกแบบ…"}</option>}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === defaultProfileId ? " (ค่าเริ่ม)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs">
        <a href={MANAGE_HREF} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary-700 underline">
          จัดการแบบ ↗
        </a>
      </p>

      {profile && a && (
        <>
          <dl aria-label="สิ่งที่ช่างต้องทำในใบนี้" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <dt className="font-medium text-zinc-700">ชั่งน้ำหนัก</dt>
            <dd className="break-words text-zinc-900">{list(a.weigh)}</dd>
            <dt className="font-medium text-zinc-700">ชิ้นเสีย</dt>
            <dd className="break-words text-zinc-900">{list(a.scrapQty)}</dd>
            <dt className="font-medium text-zinc-700">เศษโลหะ</dt>
            <dd className="break-words text-zinc-900">{list(a.scrapWeight)}</dd>
            <dt className="font-medium text-zinc-700">ปิดงาน</dt>
            <dd className="text-zinc-900">{a.finalRequired ? "บังคับใส่น้ำหนักสุทธิ" : "ไม่บังคับน้ำหนักสุทธิ"}</dd>
          </dl>
          {a.weighNotInJob.length > 0 && <p className="text-xs text-zinc-700">แบบนี้ตั้งชั่งที่ ‘{a.weighNotInJob.join("’, ‘")}’ แต่ใบนี้ไม่ผ่านขั้นนั้น — ข้ามไป</p>}
          {a.weighNoMatch && (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
              แบบนี้ตั้งให้ชั่ง แต่ขั้นที่เลือกไม่มีขั้นไหนที่ชั่งเลย — เลือกแบบอื่นหรือเพิ่มขั้น
            </p>
          )}
          <GoldGuardWarning idPrefix={idPrefix} variant="ack" stageNames={a.goldUnguarded} finalRequired={a.finalRequired} ack={ack} onAck={onAck} disabled={disabled} />
        </>
      )}
    </div>
  );
}

/** ใบทองนี้ต้อง ack ก่อนสร้าง/เปลี่ยนแบบไหม (มีขั้นที่โลหะอยู่ในมือแต่ไม่ชั่ง) — ใช้คำนวณ ready ใน parent */
export function needsGoldAck(profile: RecordProfile | null, stages: readonly PickerStage[], metal: string): boolean {
  return profile !== null && analyzePicker(profile, stages, metal).goldUnguarded.length > 0;
}
