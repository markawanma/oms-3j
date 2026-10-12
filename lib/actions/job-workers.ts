"use server";

// lib/actions/job-workers.ts — ทะเบียนช่าง (ออฟฟิศ owner/admin): เพิ่ม/แก้ชื่อ+ขั้นที่ทำ · ตั้ง/สุ่ม PIN · ปิด/เปิดใช้งาน
// 🔴 PIN: ไม่เก็บ ไม่ log — ถ้าไม่ส่ง PIN ระบบสุ่มให้และคืน "ครั้งเดียว" ในผลลัพธ์ (UI แสดงแล้วทิ้ง) · DB เก็บ bcrypt เท่านั้น
// ไม่มีทางอ่าน pin_hash กลับ (grant select ซ่อนคอลัมน์) · worker_audit append-only

import { revalidatePath } from "next/cache";
import { WORKER_COLUMNS, WORKER_LOCK_COLUMNS, mapLockRow, mapWorkerRow } from "@/lib/jobs/types";
import type { WorkerRow } from "@/lib/jobs/types";
import { isUuid, parsePin, parseStageCodes, parseText } from "@/lib/jobs/input";
import { callOffice, db, fail, guard, shopId } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

type Raw = Record<string, unknown>;

export interface WorkersData {
  workers: WorkerRow[];
  stages: { code: string; nameTh: string }[];
}

export async function getWorkers(): Promise<JobResult<WorkersData>> {
  const g = await guard();
  if (g) return g;
  try {
    const shop = shopId();
    const [w, d, lk] = await Promise.all([
      db().from("worker").select(WORKER_COLUMNS).eq("shop_id", shop).order("is_active", { ascending: false }).order("display_name", { ascending: true }).limit(100),
      db().from("job_stage_def").select("code, name_th, seq_default").eq("shop_id", shop).eq("is_active", true).order("seq_default", { ascending: true }).limit(50),
      db().from("v_worker_lock").select(WORKER_LOCK_COLUMNS).eq("shop_id", shop).limit(100),
    ]);
    if (w.error) throw w.error;
    if (d.error) throw d.error;
    if (lk.error) throw lk.error;
    const rows = (x: unknown) => (Array.isArray(x) ? (x as Raw[]) : []);
    const locks = new Map(rows(lk.data).flatMap((x) => { const m = mapLockRow(x); return m ? [[m.workerId, m] as const] : []; }));
    return {
      ok: true,
      data: {
        workers: rows(w.data).map((x) => mapWorkerRow(x, locks.get(String(x.id)))).filter((r): r is WorkerRow => r !== null),
        stages: rows(d.data).flatMap((s) => (typeof s.code === "string" && typeof s.name_th === "string" ? [{ code: s.code, nameTh: s.name_th }] : [])),
      },
    };
  } catch (err) {
    logJobFailure("getWorkers", err);
    return fail("โหลดทะเบียนช่างไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

export interface UpsertWorkerInput {
  id?: string | null;
  displayName: string;
  stageCodes: string[];
  /** เฉพาะช่างใหม่ — ว่าง = ระบบสุ่มให้ (คืนครั้งเดียว) */
  pin?: string | null;
}

export interface WorkerSaved {
  id: string;
  /** PIN ที่ระบบสุ่ม — แสดงครั้งเดียว (null = ไม่ได้สุ่ม) */
  pin: string | null;
}

export async function saveWorker(i: UpsertWorkerInput): Promise<JobResult<WorkerSaved>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null) return fail("ข้อมูลไม่ถูกต้อง");
  const editing = i.id !== null && i.id !== undefined && i.id !== "";
  if (editing && !isUuid(i.id)) return fail("ไม่พบช่าง");
  const name = parseText(i.displayName, "ชื่อช่าง", 60, true);
  if (!name.ok) return fail(name.error);
  const codes = parseStageCodes(i.stageCodes, true);
  if (!codes.ok) return fail(codes.error);
  let pin: string | null = null;
  if (!editing && i.pin) {
    const p = parsePin(i.pin);
    if (!p.ok) return fail(p.error);
    pin = p.value;
  }
  if (editing && i.pin) return fail("แก้ช่างเดิมไม่รับ PIN — ใช้ปุ่มรีเซ็ต PIN");
  const r = await callOffice<Raw>("worker_upsert", { p_id: editing ? i.id : null, p_display_name: name.value, p_stage_codes: codes.value, p_pin: pin });
  if (!r.ok) return r;
  const id = r.data.id;
  if (typeof id !== "string" || !isUuid(id)) return fail(GENERIC_JOB_ERROR);
  revalidatePath("/jobs/workers");
  return { ok: true, data: { id, pin: typeof r.data.pin === "string" ? r.data.pin : null } };
}

/** รีเซ็ต PIN: ไม่ส่ง PIN = สุ่มให้ (คืนครั้งเดียว) · ส่ง PIN = ตั้งตามนั้น (ไม่คืนกลับ) · ทุก session เดิมของช่างหลุดทันที */
export async function resetWorkerPin(workerId: string, pin?: string | null): Promise<JobResult<{ pin: string | null }>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(workerId)) return fail("ไม่พบช่าง");
  let p: string | null = null;
  if (pin) {
    const parsed = parsePin(pin);
    if (!parsed.ok) return fail(parsed.error);
    p = parsed.value;
  }
  const r = await callOffice<Raw>("worker_pin_set", { p_worker_id: workerId, p_pin: p });
  if (!r.ok) return r;
  revalidatePath("/jobs/workers");
  return { ok: true, data: { pin: typeof r.data.pin === "string" ? r.data.pin : null } };
}

/** ปลดล็อกช่าง (ล้างตัวนับ PIN ผิด + การล็อกรวมล็อกถาวร) — ไม่เพิกถอน session เดิม · ไม่เปลี่ยน PIN (ถ้าลืม PIN ใช้ "รีเซ็ต PIN") */
export async function unlockWorker(workerId: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(workerId)) return fail("ไม่พบช่าง");
  const r = await callOffice("worker_unlock", { p_worker_id: workerId });
  if (!r.ok) return r;
  revalidatePath("/jobs/workers");
  return { ok: true, data: null };
}

export async function setWorkerActive(workerId: string, active: boolean): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(workerId) || typeof active !== "boolean") return fail("ข้อมูลไม่ถูกต้อง");
  const r = await callOffice("worker_set_active", { p_worker_id: workerId, p_active: active });
  if (!r.ok) return r;
  revalidatePath("/jobs/workers");
  return { ok: true, data: null };
}
