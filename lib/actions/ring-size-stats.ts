"use server";

// lib/actions/ring-size-stats.ts — อ่านสถิติไซส์แหวนแบบไม่ระบุตัวตน สำหรับหน้า /marketing/ring-size (P3)
// Pattern เดียวกับ lib/actions/gem-quiz-stats.ts: getServiceClient() + requireOwnerAdmin() ชั้นแอป + ActionResult<T>
//
// 🔴 ด่านสิทธิ์ชั้นเดียวที่มีผลจริง = requireOwnerAdmin() ด้านล่าง — analytics.ring_size_stats เรียก crm_require_owner_admin
//    แต่ฟังก์ชันนั้นข้ามการตรวจเมื่อ auth.role()='service_role' (0154 F5 / migration trap #18) และเราเรียกผ่าน service client
//    เสมอ ⇒ ถ้าตัดด่านนี้ออก ใครก็เรียก action นี้ได้ ห้ามตัดโดยคิดว่า RPC กันให้
// 🔴 ลำดับด่าน (เทสต์ล็อก): สิทธิ์ → ช่วงวัน → (shop_id จาก env ฝั่ง server) → RPC · ตัวไหนไม่ผ่าน = ไม่แตะ shop_id/DB เลย
// 🔴 shop_id มาจาก getDevShopId() เท่านั้น — input ไม่มี field shop (และ field เกินที่ client ส่งมาถูกทิ้ง ไม่ถูกอ่าน)
// 🔴 ผลลัพธ์ผ่าน parseRingSizeStats ที่ประกอบทีละ field — แถวดิบ/session id/เวลา ไปไม่ถึง client ต่อให้ RPC คืนเกิน
// 🔴 error: log แค่ SQLSTATE (ห้ามก้อน error ของ supabase — PII; memory supabase-error-logging-trap) · ข้อความที่ส่งกลับเป็นข้อความคงที่
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { checkRingStatsRange } from "@/lib/marketing/ring-size-filters";
import { parseRingSizeStats, type RingSizeStats } from "@/lib/marketing/ring-size-stats";

const SCHEMA = "analytics";

export type { RingSizeStats };

export interface GetRingSizeStatsInput {
  /** วันธุรกิจไทย YYYY-MM-DD, inclusive */
  from: string;
  /** วันธุรกิจไทย YYYY-MM-DD, inclusive */
  to: string;
}

const LOAD_FAILED = "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง";

// คัดลอกตามธรรมเนียม repo (module-private ทุกไฟล์ — ไม่ share ข้ามโมดูล)
async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูสถิติไซส์แหวนได้" };
  }
  return null;
}

export async function getRingSizeStats(input: GetRingSizeStatsInput): Promise<ActionResult<RingSizeStats>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  // อ่านเฉพาะ from/to ทีละ field (ไม่ spread input) — field อื่นที่ client แอบส่งมาไม่มีทางไปถึง RPC
  const rangeErr = checkRingStatsRange(input?.from, input?.to);
  if (rangeErr) return { ok: false, error: rangeErr };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("ring_size_stats", {
      p_shop_id: shopId,
      p_from: input.from,
      p_to: input.to,
    });
    if (error) throw error;

    const parsed = parseRingSizeStats(data);
    if (!parsed) {
      console.error("getRingSizeStats: RPC คืน shape ที่ไม่ตรงสัญญา");
      return { ok: false, error: LOAD_FAILED };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    console.error("getRingSizeStats failed", readErrorCode(err) ?? "unknown");
    return { ok: false, error: LOAD_FAILED };
  }
}
