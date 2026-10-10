"use server";

// lib/actions/content-shoot.ts — "รอบถ่าย" /marketing/shoot (content-ui-build-plan.md §4 P1b ข้อ 3)
// อ่าน: ชิ้น approved + needs_shoot ของสัปดาห์ (นิยามเดียวกับ shoot_this_week) · เขียน: ติ๊กช็อต/เลื่อน ใช้ action เดิมของหน้าชิ้นงาน
// จบรอบถ่าย = วนทีละชิ้น (ลำดับ ไม่ขนาน): setPlan({shoot_note, footage_url}) ถ้ามี แล้ว advance('produced') — รายงานผลรายชิ้น ชิ้นหนึ่งล้มไม่หยุดชิ้นอื่น
// ไฟล์ "use server": export ได้เฉพาะ async function · requireOwnerAdmin บรรทัดแรกทุก action

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { PIECE_LIGHT_COLUMNS, mapPieceRow } from "@/lib/marketing/piece-types";
import type { PieceRow } from "@/lib/marketing/piece-types";
import { addDays } from "@/lib/marketing/calendar-view";
import { shootWeekFrom } from "@/lib/marketing/shoot";
import { analyticsDb, asRows } from "@/lib/marketing/piece-queries";
import { isUuid, logRpcFailure, requireOwnerAdmin, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";
import { safeHttpUrl } from "@/lib/marketing/safe-url";
import { advancePiece, setPlan } from "@/lib/actions/content-pieces";

const SHOOT_LIMIT = 60;
const MAX_ROUND = 40;
const NOTE_MAX = 500;

export interface ShootData {
  todayTh: string;
  weekFrom: string;
  rows: PieceRow[];
  truncated: boolean;
}

export async function getShootData(weekParam?: string | null): Promise<PieceResult<ShootData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const weekFrom = shootWeekFrom(todayTh, weekParam);
  const weekTo = addDays(weekFrom, 6);
  try {
    const { data, error } = await analyticsDb()
      .from("v_content_piece")
      .select(`${PIECE_LIGHT_COLUMNS}, clip_brief`)
      .eq("shop_id", shopId())
      .eq("piece_status", "approved")
      .eq("footage_status", "needs_shoot")
      .gte("resolved_start", weekFrom)
      .lte("resolved_start", weekTo)
      .order("resolved_start", { ascending: true })
      .order("step_id", { ascending: true })
      .limit(SHOOT_LIMIT);
    if (error) throw error;
    return { ok: true, data: { todayTh, weekFrom, rows: asRows(data).map(mapPieceRow), truncated: Array.isArray(data) && data.length >= SHOOT_LIMIT } };
  } catch (err) {
    logRpcFailure("getShootData", err);
    return { ok: false, error: "โหลดรอบถ่ายไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export interface ShootFinishInput {
  /** ชิ้นที่ติ๊ก "ถ่ายครบ" */
  stepIds: string[];
  /** ต่างจาก storyboard ตรงไหน (ใช้กับทุกชิ้นที่เลือก) — ว่าง = ไม่เขียน */
  note?: string;
  /** ลิงก์โฟลเดอร์ไฟล์ (ใช้กับทุกชิ้นที่เลือก) — ว่าง = ไม่เขียน · ต้องเป็น http(s) */
  folderUrl?: string;
}

export interface ShootFinishResult {
  results: { stepId: string; ok: boolean; error?: string }[];
}

/** จบรอบถ่าย — ชิ้นที่ล้มรายงานรายชิ้น (ชิ้นที่สำเร็จแล้วไม่ถูกย้อน) */
export async function finishShootRound(input: ShootFinishInput): Promise<PieceResult<ShootFinishResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!input || typeof input !== "object" || !Array.isArray(input.stepIds)) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  const ids = [...new Set(input.stepIds)];
  if (ids.length === 0) return { ok: false, error: "ติ๊ก “ถ่ายครบ” อย่างน้อยหนึ่งชิ้นก่อน" };
  if (ids.length > MAX_ROUND || ids.some((id) => typeof id !== "string" || !isUuid(id))) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };

  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > NOTE_MAX) return { ok: false, error: `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร` };
  const rawUrl = typeof input.folderUrl === "string" ? input.folderUrl.trim() : "";
  const url = rawUrl ? safeHttpUrl(rawUrl) : null;
  if (rawUrl && (!url || url.length > 500)) return { ok: false, error: "ลิงก์โฟลเดอร์ต้องเป็น http:// หรือ https:// และไม่ยาวเกิน 500 ตัวอักษร" };

  const set: Record<string, unknown> = {};
  if (note) set.shoot_note = note;
  if (url) set.footage_url = url; // ค่าที่ผ่าน safeHttpUrl แล้ว (normalize) — ไม่ส่งสตริงดิบจากผู้ใช้ลง DB

  const results: ShootFinishResult["results"] = [];
  for (const stepId of ids) {
    if (Object.keys(set).length > 0) {
      const p = await setPlan(stepId, set);
      if (!p.ok) {
        results.push({ stepId, ok: false, error: p.error });
        continue;
      }
    }
    const a = await advancePiece(stepId, "produced");
    results.push(a.ok ? { stepId, ok: true } : { stepId, ok: false, error: a.error });
  }
  revalidatePath("/marketing");
  revalidatePath("/marketing/shoot");
  revalidatePath("/marketing/calendar");
  return { ok: true, data: { results } };
}
