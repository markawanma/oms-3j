"use server";

// lib/actions/job-workers.ts — ทะเบียนช่าง (ออฟฟิศ owner/admin): เพิ่ม/แก้ชื่อ+ขั้นที่ทำ · ตั้ง/สุ่ม PIN · ปิด/เปิดใช้งาน
// 🔴 PIN: ไม่เก็บ ไม่ log — ถ้าไม่ส่ง PIN ระบบสุ่มให้และคืน "ครั้งเดียว" ในผลลัพธ์ (UI แสดงแล้วทิ้ง) · DB เก็บ bcrypt เท่านั้น
// ไม่มีทางอ่าน pin_hash กลับ (grant select ซ่อนคอลัมน์) · worker_audit append-only

import { revalidatePath } from "next/cache";
import { WORKER_COLUMNS, WORKER_LOCK_COLUMNS, mapLockRow, mapWorkerRow } from "@/lib/jobs/types";
import type { WorkerRow } from "@/lib/jobs/types";
import { isUuid, parseLabel, parsePin, parseStageCodes } from "@/lib/jobs/input";
import { callOffice, db, fail, guard, shopId } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

type Raw = Record<string, unknown>;

export interface WorkersData {
  workers: WorkerRow[];
  /** ขั้นที่เปิดใช้งาน — ตัวเลือกให้ติ๊กตอนเพิ่ม/แก้ช่าง */
  stages: { code: string; nameTh: string }[];
  /** ขั้นที่เลิกใช้ (เช่น polish "แต่ง ขัด" หลัง 0184) — ไว้แสดงชื่อไทยของรหัสที่ช่างยังถืออยู่ ไม่ใช่ตัวเลือกใหม่ */
  retiredStages?: { code: string; nameTh: string }[];
}

export async function getWorkers(): Promise<JobResult<WorkersData>> {
  const g = await guard();
  if (g) return g;
  try {
    const shop = shopId();
    const [w, d, lk] = await Promise.all([
      db().from("worker").select(WORKER_COLUMNS).eq("shop_id", shop).order("is_active", { ascending: false }).order("display_name", { ascending: true }).limit(100),
      db().from("job_stage_def").select("code, name_th, seq_default, is_active").eq("shop_id", shop).order("seq_default", { ascending: true }).limit(50),
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
        stages: rows(d.data).flatMap((s) => (typeof s.code === "string" && typeof s.name_th === "string" && s.is_active !== false ? [{ code: s.code, nameTh: s.name_th }] : [])),
        retiredStages: rows(d.data).flatMap((s) => (typeof s.code === "string" && typeof s.name_th === "string" && s.is_active === false ? [{ code: s.code, nameTh: s.name_th }] : [])),
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
  /** 0187: ผู้จัดการ (เปิดใบจากมือถือด้วย QR ร้าน + PIN) — ไม่ส่ง = ไม่แตะ (ช่างใหม่ = ปิด) · ยังต้องเลือกขั้นที่ทำอย่างน้อย 1 */
  canOpenJob?: boolean;
  /** 0187: ผู้ดูแลงานนอกร้าน — ไม่ส่ง = ไม่แตะ */
  canExternal?: boolean;
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
  const name = parseLabel(i.displayName, "ชื่อช่าง", 60, true);
  if (!name.ok) return fail(name.error);
  const codes = parseStageCodes(i.stageCodes, false) // 0174: ช่างต้องมีอย่างน้อย 1 ขั้น (DB hint stages_required) — ตรงกับ DB ไม่ปล่อยไปให้ DB ตีกลับ;
  if (!codes.ok) return fail(codes.error);
  let pin: string | null = null;
  if (!editing && i.pin) {
    const p = parsePin(i.pin);
    if (!p.ok) return fail(p.error);
    pin = p.value;
  }
  if (editing && i.pin) return fail("แก้ช่างเดิมไม่รับ PIN — ใช้ปุ่มรีเซ็ต PIN");
  // 0187: flag ส่งเฉพาะที่ระบุเป็น boolean จริง (ไม่ส่ง = DB ไม่แตะค่าเดิม) · ชนิดอื่น = ปฏิเสธ ไม่แปลงเงียบ
  for (const f of [i.canOpenJob, i.canExternal]) if (f !== undefined && typeof f !== "boolean") return fail("ข้อมูลสิทธิ์ไม่ถูกต้อง");
  const flags: Record<string, boolean> = {};
  if (typeof i.canOpenJob === "boolean") flags.p_can_open_job = i.canOpenJob;
  if (typeof i.canExternal === "boolean") flags.p_can_external = i.canExternal;
  const r = await callOffice<Raw>("worker_upsert", { p_id: editing ? i.id : null, p_display_name: name.value, p_stage_codes: codes.value, p_pin: pin, ...flags });
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

// ---------------------------------------------------------------------------
// 0187 W1 — QR ร้าน (hub ที่ผู้จัดการสแกนเพื่อเปิดใบ) · DB เก็บ hash เท่านั้น · active ได้ 1 ใบ/ร้าน · ออกใหม่ = เพิกถอนใบเก่าในตัว
// 🔴 ค่าดิบ (token) คืนให้หน้าจอ "ครั้งเดียว" ตอนออก (ไว้ทำ QR/ลิงก์พิมพ์) — ไม่ log ไม่เก็บ · อ่านย้อนหลังไม่ได้ ถ้าหายต้องออกใหม่
// ---------------------------------------------------------------------------
export interface ShopIntakeStatus {
  active: boolean;
  /** เวลาออกของ QR ใบล่าสุด (active = ใบที่ใช้อยู่ · ไม่ active = ใบล่าสุดที่เคยออก) · null = ไม่เคยออกเลย */
  issuedAt: string | null;
  /** เวลาเพิกถอนของใบล่าสุด · null = ใบที่ใช้อยู่ หรือไม่เคยออก — หน้าจอแยก "ถูกเพิกถอน" (active=false + revokedAt) ออกจาก "ไม่เคยออก" (issuedAt=null) (0188) */
  revokedAt: string | null;
}

export async function getShopIntakeStatus(): Promise<JobResult<ShopIntakeStatus>> {
  const g = await guard();
  if (g) return g;
  const r = await callOffice<Raw>("shop_intake_token_status", {}, { noActor: true }); // RPC อ่านอย่างเดียว ไม่มี p_actor
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      active: r.data.active === true,
      issuedAt: typeof r.data.issued_at === "string" ? r.data.issued_at : null,
      revokedAt: typeof r.data.revoked_at === "string" ? r.data.revoked_at : null,
    },
  };
}

export interface ShopIntakeIssued {
  /** ค่าดิบ — แสดง/พิมพ์ครั้งเดียว · ลิงก์ที่ผู้จัดการสแกน = <APP_ORIGIN>/w/s/<token> */
  token: string;
  issuedAt: string;
  /** จำนวน QR ร้านเดิมที่ถูกเพิกถอนพร้อมกัน (0 หรือ 1) */
  revokedPrevious: number;
}

export async function issueShopIntakeToken(): Promise<JobResult<ShopIntakeIssued>> {
  const g = await guard();
  if (g) return g;
  const r = await callOffice<Raw>("shop_intake_token_issue", {});
  if (!r.ok) return r;
  const token = r.data.token;
  const issuedAt = r.data.issued_at;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(token) || typeof issuedAt !== "string") return fail(GENERIC_JOB_ERROR);
  const prev = typeof r.data.revoked_previous === "number" && Number.isInteger(r.data.revoked_previous) ? r.data.revoked_previous : 0;
  revalidatePath("/jobs/workers");
  return { ok: true, data: { token, issuedAt, revokedPrevious: prev } };
}

export async function revokeShopIntakeToken(): Promise<JobResult<{ revoked: number }>> {
  const g = await guard();
  if (g) return g;
  const r = await callOffice<Raw>("shop_intake_token_revoke", {});
  if (!r.ok) return r;
  revalidatePath("/jobs/workers");
  return { ok: true, data: { revoked: typeof r.data.revoked === "number" && Number.isInteger(r.data.revoked) ? r.data.revoked : 0 } };
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
