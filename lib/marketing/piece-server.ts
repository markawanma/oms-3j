// lib/marketing/piece-server.ts — ตัวช่วยฝั่ง server ที่ server action ของ workflow ชิ้นงานใช้ร่วมกัน
// (content-ui-build-plan.md §5.4, F2/F3/F4)
//
// ไม่ใช่ "use server" (export ได้ทุกชนิด) · import "server-only" กันหลุดเข้า client bundle
//
// กติกาที่บังคับโดยโครงสร้าง ไม่ใช่โดยวินัย:
//  - actor_role = 'owner' ตายตัวในไฟล์นี้ — ไม่มี parameter ไหนรับค่านี้จากภายนอก (F2)
//  - shop_id มาจาก getDevShopId() ที่นี่ที่เดียว — action ไม่รับ shopId จาก client
//  - error ที่ log = {code, message: redactUrls(...)} เท่านั้น ไม่ log ก้อน error ทั้งหมด (บทเรียน supabase-error-logging-trap)

import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import { describeRpcError, type RpcErrorOptions } from "@/lib/marketing/rpc-messages";
import type { PieceResult } from "@/lib/marketing/piece-types";

export type { PieceResult };
import { readErrorCode, readErrorMessage, redactUrls } from "@/lib/supabase/postgrest-error";

export const SCHEMA = "analytics";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** บรรทัดแรกของทุก action (F2): staff ใช้ไม่ได้ · AUTH_GATE on ⇒ role มาจาก session จริง (lib/auth/role.ts) */
export async function requireOwnerAdmin(): Promise<PieceResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนนี้ได้" };
  }
  return null;
}

export function shopId(): string {
  return getDevShopId();
}

export function logRpcFailure(label: string, err: unknown): void {
  console.error(`${label} failed`, { code: readErrorCode(err), message: redactUrls(readErrorMessage(err)) });
}

/**
 * เรียก RPC ของสายงาน content ผ่านวิธีเดียว:
 * - ใส่ p_shop_id และ p_actor_role = 'owner' ให้เอง (ผู้เรียกส่งได้เฉพาะพารามิเตอร์ธุรกิจ)
 * - แปลง error เป็นไทยด้วย describeRpcError
 */
export async function callRpc<T = unknown>(
  fn: string,
  params: Record<string, unknown>,
  fallback: string,
  opts: RpcErrorOptions & { withActor?: boolean } = {}
): Promise<PieceResult<T>> {
  try {
    const supabase = getServiceClient();
    const withActor = opts.withActor !== false;
    const { data, error } = await supabase
      .schema(SCHEMA)
      .rpc(fn, { p_shop_id: shopId(), ...params, ...(withActor ? { p_actor_role: "owner" } : {}) });
    if (error) throw error;
    return { ok: true, data: data as T };
  } catch (err) {
    logRpcFailure(fn, err);
    const d = describeRpcError(err, fallback, opts);
    return { ok: false, error: d.message, stale: d.stale };
  }
}
