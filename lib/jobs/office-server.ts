// lib/jobs/office-server.ts — ชั้นกลางของ action ออฟฟิศระบบใบงาน (server-only · ไม่ใช่ "use server")
//  - guard(): session จริง (ถ้า AUTH_GATE on) + allowlist owner|admin (ไม่ใช่ "ไม่ใช่ staff")
//  - callOffice(): ใส่ p_shop_id (จาก server) + p_actor (session user id ฝั่ง server) "หลัง" spread ของพารามิเตอร์ธุรกิจ → client ทับไม่ได้
//  - error: officeErrorMessage (ไทย) · log เฉพาะ code+hint (logJobFailure) — ไม่ log ทั้งก้อน/พารามิเตอร์
// RPC ออฟฟิศ raise 22023/55000 + hint เมื่อผิดกติกา (หน้าจอแสดงข้อความ DB ที่สะอาดแล้ว) · 42501 = ไม่มีสิทธิ์

import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getSessionUser, requireSessionIfGateOn } from "@/lib/auth/session";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR, officeErrorMessage, safeLogShape } from "@/lib/jobs/messages";
import { parseGemRpcError } from "@/lib/jobs/gems";
import type { GemErrorInfo } from "@/lib/jobs/gems";

/** code = hint ของ RPC (snake_case สั้นๆ เช่น name_dup · profile_invalid · started) — ให้หน้าจอแยกเคสโดยไม่ต้องเทียบข้อความไทย · ไม่ใส่ = ข้อผิดพลาดที่ไม่มี hint */
/** gem (0190) = รายละเอียดข้อผิดพลาดของแถวพลอย/ตัวดักชื่อคล้าย (row · field · similar[]) — มีเฉพาะ error ของ RPC พลอย */
export type JobResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; gem?: GemErrorInfo };
export const fail = (error: string, code?: string): { ok: false; error: string; code?: string } => (code ? { ok: false, error, code } : { ok: false, error });

export const NOT_ALLOWED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานระบบใบงานได้";
const SCHEMA = "analytics";

/** บรรทัดแรกของทุก action (อ่านและเขียน): ต้องมี session (เมื่อเปิด gate) และเป็น owner/admin */
export async function guard(): Promise<{ ok: false; error: string } | null> {
  try {
    await requireSessionIfGateOn();
  } catch {
    return fail("ต้องเข้าสู่ระบบก่อน");
  }
  if (!(await canManageJobs())) return fail(NOT_ALLOWED);
  return null;
}

/** id ผู้ใช้จาก session ฝั่ง server (ไม่รับจาก client) · อ่านไม่ได้ = null → RPC ปฏิเสธด้วย actor_required */
export async function actorId(): Promise<string | null> {
  try {
    return (await getSessionUser())?.id ?? null;
  } catch {
    return null;
  }
}

export function shopId(): string {
  return getDevShopId();
}

export function db() {
  return getServiceClient().schema(SCHEMA);
}

/**
 * เรียก RPC ออฟฟิศที่รับ p_actor — ไม่มี actor = ไม่เรียก (ข้อความไทย)
 * @param opts.noActor RPC ที่ไม่มี p_actor (job_stage_suggest) — ไม่ใส่ p_actor
 */
export async function callOffice<T>(fn: string, params: Record<string, unknown>, opts: { noActor?: boolean } = {}): Promise<JobResult<T>> {
  let actor: string | null = null;
  if (!opts.noActor) {
    actor = await actorId();
    if (!actor) return fail("ต้องเข้าสู่ระบบก่อนทำรายการ");
  }
  try {
    const sent = opts.noActor ? { ...params, p_shop_id: shopId() } : { ...params, p_shop_id: shopId(), p_actor: actor };
    const { data, error } = await db().rpc(fn, sent);
    if (error) throw error;
    return { ok: true, data: data as T };
  } catch (err) {
    logJobFailure(fn, err);
    // hint ที่รูปร่างปลอดภัยเท่านั้น (ผ่านไปถึง client — ห้ามเป็นข้อความดิบ)
    const hint = safeLogShape(err).hint;
    const failed = fail(officeErrorMessage(err, GENERIC_JOB_ERROR), hint !== null && /^[a-z][a-z0-9_]{1,40}$/.test(hint) ? hint : undefined);
    // 0190: error ของพลอยพา row/field/similar กลับไปด้วย (detail ของ DB ผ่านด่านตรวจรูปร่างใน parseGemRpcError) — error อื่นเหมือนเดิมทุกประการ
    // hint บางตัว (qty_invalid · date_invalid · kind_invalid ฯลฯ) ใช้ร่วมกับ RPC อื่น — แนบ gem เฉพาะ RPC พลอย หรือเมื่อ DB ส่ง detail ของแถว/ตัวดักคล้ายมาด้วย (การสร้างใบ) · error ของ RPC อื่นเหมือนเดิมทุกประการ
    const gem = parseGemRpcError(err);
    const gemFn = /^(gem_|product_gem_bom_|job_gem_bom_)/.test(fn);
    return gem && (gemFn || gem.row !== undefined || gem.similar !== undefined) ? { ...failed, gem } : failed;
  }
}
