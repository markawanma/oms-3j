"use server";

// lib/actions/job-profiles.ts — แบบการบันทึกของใบงาน (0176) ฝั่งออฟฟิศ owner/admin
// รายการ/สร้าง-แก้/ตั้งค่าเริ่ม/ปิด-เปิดใช้ + เปลี่ยนแบบของใบ (ก่อนช่างรับขั้นแรก)
// guard() บรรทัดแรก · p_shop_id/p_actor ใส่ฝั่ง server (callOffice) · ตรวจชนิดก่อนถึง DB · DB เป็นด่านจริง (ค่าเริ่ม/ปิดแบบ/ขั้นไม่มีโลหะ/started)
// 🔴 ไม่มีน้ำหนัก/ราคาในไฟล์นี้ — boolean + ชื่อล้วน · หน้าช่าง (/w/) ห้าม import (worker-boundary.test)
// ไฟล์ "use server": export ได้เฉพาะ async function

import { revalidatePath } from "next/cache";
import { isUuid, parseLabel, parseText } from "@/lib/jobs/input";
import { callOffice, fail, guard } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { mapProfilesData, mapRecordProfile } from "@/lib/jobs/profile";
import type { ProfilesData, RecordProfile } from "@/lib/jobs/profile";

type Raw = Record<string, unknown>;
const STAGE_CODE_RE = /^[a-z][a-z0-9_]{1,30}$/;

const touch = () => {
  revalidatePath("/jobs/profiles");
  revalidatePath("/jobs");
};

/** รายการแบบทั้งหมด (รวมที่ปิดใช้) + ทะเบียนขั้น + ค่าเริ่ม — ร้านที่ยังไม่มีแบบ DB seed ให้ตอนเรียก */
export async function listProfiles(): Promise<JobResult<ProfilesData>> {
  const g = await guard();
  if (g) return g;
  const r = await callOffice<Raw>("job_record_profile_list", {}, { noActor: true });
  if (!r.ok) return r;
  return { ok: true, data: mapProfilesData(r.data) };
}

export interface SaveProfileInput {
  /** ไม่ส่ง = สร้างใหม่ */
  id?: string | null;
  name: string;
  note?: string | null;
  requireFinalWeight: boolean;
  /** ทั้งชุดแทนที่ของเดิม — ส่งเฉพาะขั้นที่ติ๊กอย่างน้อย 1 ช่อง (ไม่มี = ปิดทั้ง 3) */
  stages: { stageCode: string; weigh: boolean; scrapQty: boolean; scrapWeight: boolean }[];
}

export async function saveProfile(i: SaveProfileInput): Promise<JobResult<RecordProfile>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || typeof i.requireFinalWeight !== "boolean" || !Array.isArray(i.stages) || i.stages.length > 100) return fail("ข้อมูลไม่ถูกต้อง");
  const editing = i.id !== null && i.id !== undefined && i.id !== "";
  if (editing && !isUuid(i.id)) return fail("ไม่พบแบบการบันทึก");
  const name = parseLabel(i.name, "ชื่อแบบ", 60, true);
  if (!name.ok) return fail(name.error);
  const note = parseText(i.note ?? null, "คำอธิบายแบบ", 200, false);
  if (!note.ok) return fail(note.error);
  const stages: { stage_code: string; weigh: boolean; scrap_qty: boolean; scrap_weight: boolean }[] = [];
  const seen = new Set<string>();
  for (const s of i.stages) {
    if (typeof s !== "object" || s === null || typeof s.stageCode !== "string" || !STAGE_CODE_RE.test(s.stageCode)) return fail("รายการขั้นของแบบไม่ถูกต้อง");
    if (typeof s.weigh !== "boolean" || typeof s.scrapQty !== "boolean" || typeof s.scrapWeight !== "boolean") return fail("รายการขั้นของแบบไม่ถูกต้อง");
    if (seen.has(s.stageCode)) return fail("มีขั้นซ้ำในแบบ");
    seen.add(s.stageCode);
    if (s.weigh || s.scrapQty || s.scrapWeight) stages.push({ stage_code: s.stageCode, weigh: s.weigh, scrap_qty: s.scrapQty, scrap_weight: s.scrapWeight });
  }
  // note: แก้ = ส่งสตริง ("" = ล้างคำอธิบาย) · สร้าง = ส่งเมื่อมีค่า
  const params: Raw = { p_name: name.value, p_stages: stages, p_require_final_weight: i.requireFinalWeight };
  if (editing) {
    params.p_id = i.id;
    params.p_note = note.value ?? "";
  } else if (note.value !== null) {
    params.p_note = note.value;
  }
  const r = await callOffice<Raw>("job_record_profile_upsert", params);
  if (!r.ok) return r;
  const p = mapRecordProfile(r.data);
  if (!p) return fail("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  touch();
  return { ok: true, data: p };
}

/** เปิด/ปิดใช้แบบ (DB ปฏิเสธการปิดแบบที่เป็นค่าเริ่ม — default_cannot_close) */
export async function setProfileActive(id: string, active: boolean): Promise<JobResult<RecordProfile>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(id) || typeof active !== "boolean") return fail("ไม่พบแบบการบันทึก");
  const r = await callOffice<Raw>("job_record_profile_upsert", { p_id: id, p_is_active: active });
  if (!r.ok) return r;
  const p = mapRecordProfile(r.data);
  if (!p) return fail("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  touch();
  return { ok: true, data: p };
}

export interface DefaultsState {
  defaultProfileId: string | null;
  defaultGoldProfileId: string | null;
}

/** ตั้งค่าเริ่ม: scope general = งานทั่วไป · gold = งานทอง · id null + gold = ล้าง (ทองใช้ตามงานทั่วไป) · general ล้างไม่ได้ (DB ปฏิเสธ) */
export async function setDefaultProfile(id: string | null, scope: "general" | "gold"): Promise<JobResult<DefaultsState>> {
  const g = await guard();
  if (g) return g;
  if (scope !== "general" && scope !== "gold") return fail("ข้อมูลไม่ถูกต้อง");
  if (id !== null && !isUuid(id)) return fail("ไม่พบแบบการบันทึก");
  if (id === null && scope === "general") return fail("ค่าเริ่มของงานทั่วไปล้างไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มแทน");
  const r = await callOffice<Raw>("job_record_profile_set_default", { p_id: id, p_scope: scope });
  if (!r.ok) return r;
  touch();
  const d = r.data;
  return {
    ok: true,
    data: {
      defaultProfileId: typeof d.default_profile_id === "string" ? d.default_profile_id : null,
      defaultGoldProfileId: typeof d.default_gold_profile_id === "string" ? d.default_gold_profile_id : null,
    },
  };
}

export interface ChangedProfile {
  profileId: string | null;
  profileName: string | null;
}

/** เปลี่ยนแบบของใบ — เฉพาะก่อนช่างรับงานขั้นแรก (DB ปฏิเสธ started) · เปลี่ยนแล้วกติกาชั่ง/ของเสียของทุกขั้นตามแบบใหม่ */
export async function changeJobProfile(jobId: string, profileId: string): Promise<JobResult<ChangedProfile>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId) || !isUuid(profileId)) return fail("ข้อมูลไม่ถูกต้อง");
  const r = await callOffice<Raw>("job_profile_set", { p_job_id: jobId, p_profile_id: profileId });
  if (!r.ok) return r;
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, data: { profileId: typeof r.data.profile_id === "string" ? r.data.profile_id : null, profileName: typeof r.data.profile_name === "string" ? r.data.profile_name : null } };
}
