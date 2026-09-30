"use server";

// lib/actions/live-metrics.ts — /tiktok/live-log's server actions.
//
// Two independent write paths, one page (Tech Lead brief 30 ก.ย. 69 — เจ้าของ
// สัญญาจะเริ่มจดคนดูพีคไลฟ์ตั้งแต่ 1 ต.ค. 69 แต่ backend ที่มีอยู่แล้วไม่เคยมี
// หน้าจอให้กรอกเลยสักหน้า):
//   1. คนดูพีคไลฟ์รายคืน — analytics.live_session_upsert (0121, RPC เดิม
//      ไม่แตะ, ใช้งานผ่านแชทกับ Tech Lead มาตลอด — ฟอร์มนี้ส่ง
//      p_source: 'admin_ui' เสมอ แยกจาก 'owner_chat' ที่ใช้ตอนกรอกแทนผ่านแชท).
//   2. จำนวนเพื่อน LINE — analytics.channel_follower_upsert (0153, RPC ใหม่ —
//      analytics.channel_follower_log มีอยู่แล้วตั้งแต่ 0146 แต่เขียนได้แค่
//      ผ่าน service_role/migration ตรงๆ เท่านั้นจนกว่าจะมี RPC นี้).
//
// Deliberately its OWN file, not folded into lib/actions/content.ts — คนละ
// โดเมน (คนดูไลฟ์/follower ต่อช่องทาง ไม่ใช่ content post/metric) แม้จะอยู่ใต้
// analytics schema เดียวกันและใช้ pattern เดียวกันทุกอย่าง (Tech Lead brief).
//
// Pattern ลอกจาก lib/actions/content.ts 1:1: getServiceClient() (service
// role — bypass RLS) + module-private requireOwnerAdmin() (app-layer gate
// จาก getEffectiveRole() — คนละชั้นกับ analytics.crm_require_owner_admin ที่
// RPC เช็คซ้ำอีกที, RPC เป็นด่านจริง ชั้นนี้แค่คืนข้อความไทยเร็วกว่าไม่ต้องรอ
// round-trip) + ActionResult<T> + error mapper แยกไฟล์
// (lib/marketing/live-metrics-errors.ts) + console.error แบบไม่ log error
// ดิบทั้งก้อน (memory: supabase-error-logging-trap) + revalidatePath หลัง
// เขียนสำเร็จ.
//
// 🔴 ห้าม validate เลขที่มีผลจริงที่ client — ด่านจริงทั้งหมดอยู่ที่ RPC
// (ปฏิเสธติดลบ, ปฏิเสธอนาคต) การเช็คในไฟล์นี้เป็นแค่ UX (คืนข้อความไทยเร็ว
// กว่ารอ round-trip ไป DB) ไม่ใช่ด่านที่พึ่งพาได้ — RPC ยังเช็คซ้ำทุกอย่างเอง.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import {
  mapChannelFollowerUpsertRpcError,
  mapLiveSessionUpsertRpcError,
} from "@/lib/marketing/live-metrics-errors";
import { readErrorCode, readErrorMessage, redactUrls } from "@/lib/supabase/postgrest-error";

const SCHEMA = "analytics";

// Module-private เหมือน content.ts's requireOwnerAdmin — ก็อปแทนแชร์ ตาม
// convention เดิมของทุก "use server" action file ในโปรเจกต์นี้ (ไม่มี
// cross-module import ของ gate helper — ดูคอมเมนต์หัว content.ts's ตัวเอง).
async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่บันทึกข้อมูลไลฟ์ได้" };
  }
  return null;
}

export type ChannelCode = "line_oa" | "tiktok" | "facebook" | "instagram";

// ============================================================================
// คนดูพีคไลฟ์ — analytics.live_session_upsert (0121, RPC เดิม ไม่แตะ)
// ============================================================================

export interface UpsertLiveSessionInput {
  /** "YYYY-MM-DD" — วันทางธุรกิจของไทย ตรงกับ p_live_date ของ RPC */
  liveDate: string;
  /** "HH:MM" 24 ชม. */
  startTime: string;
  /** "HH:MM" 24 ชม. — น้อยกว่าหรือเท่ากับ startTime แปลว่าข้ามเที่ยงคืน (RPC
   * เดิมรองรับอยู่แล้ว, ดู 0121) */
  endTime: string;
  peakViewers: number;
  /** เก็บค่าเดิมที่เคยกรอกไว้ (ถ้ามี) มาส่งกลับ — ฟอร์มนี้ไม่มีช่องแก้หมายเหตุ
   * เอง (ไม่อยู่ใน scope งานนี้) แต่ RPC เป็น upsert เต็มแถว: ถ้าไม่ส่ง note
   * กลับไป ของเดิมที่เคยมี (เช่น จากที่ Tech Lead เคยกรอกแทนผ่านแชท,
   * source='owner_chat') จะถูกเขียนทับเป็น null เงียบๆ — เป็นการตัดสินใจของ
   * backend-dev เพิ่มจากบรีฟ เพื่อกัน data loss (แนวเดียวกับมติ "ค่าว่างห้าม
   * ทับ" ของ 0111) ไม่ได้ระบุในบรีฟ */
  note?: string | null;
}

export async function upsertLiveSession(input: UpsertLiveSessionInput): Promise<ActionResult<string>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.liveDate || !input.startTime || !input.endTime) {
    return { ok: false, error: "กรุณากรอกวันที่ไลฟ์ เวลาเริ่ม และเวลาเลิกให้ครบ" };
  }
  if (input.peakViewers === null || input.peakViewers === undefined || Number.isNaN(input.peakViewers)) {
    return { ok: false, error: "กรุณากรอกจำนวนคนดูพีค" };
  }
  if (input.peakViewers < 0) {
    return { ok: false, error: "คนดูพีคติดลบไม่ได้" };
  }

  let data: unknown;
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const result = await supabase.schema(SCHEMA).rpc("live_session_upsert", {
      p_shop: shopId,
      p_live_date: input.liveDate,
      p_start: input.startTime,
      p_end: input.endTime,
      p_peak: input.peakViewers,
      p_note: input.note?.trim() ? input.note.trim() : null,
      // ฟอร์มนี้ (admin_ui) แยกจาก 'owner_chat' ที่ใช้ตอนกรอกแทนผ่านแชท —
      // ตามบรีฟ ต้องส่งค่านี้เสมอ ไม่ให้ client เลือกเอง
      p_source: "admin_ui",
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (err) {
    console.error("upsertLiveSession failed", {
      code: readErrorCode(err),
      message: redactUrls(readErrorMessage(err)),
    });
    return { ok: false, error: mapLiveSessionUpsertRpcError(err, "บันทึกคนดูพีคไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }

  revalidatePath("/tiktok/live-log");
  return { ok: true, data: data as string };
}

export interface LiveSessionRow {
  liveDate: string;
  /** ISO timestamptz (UTC) — แปลงเป็นเวลาไทยฝั่ง client ก่อนใส่ input type="time" */
  startedAt: string;
  endedAt: string;
  peakViewers: number | null;
  note: string | null;
}

/** อ่านค่าที่เคยกรอกของวันนั้น (สำหรับ pre-fill ตามบรีฟ: "ถ้าวันนั้นเคยกรอกไป
 * แล้ว → แสดงค่าที่เคยกรอกไว้ให้เห็นก่อน ไม่ใช่ช่องว่างเปล่าๆ") — null =
 * ยังไม่เคยกรอกวันนั้น ไม่ใช่ error. */
export async function getLiveSessionForDate(liveDate: string): Promise<ActionResult<LiveSessionRow | null>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!liveDate) return { ok: false, error: "กรุณาระบุวันที่" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("live_session_log")
      .select("live_date, started_at, ended_at, peak_viewers, note")
      .eq("shop_id", shopId)
      .eq("live_date", liveDate)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    const row = data as Record<string, unknown>;
    return {
      ok: true,
      data: {
        liveDate: String(row.live_date),
        startedAt: String(row.started_at),
        endedAt: String(row.ended_at),
        peakViewers: (row.peak_viewers as number | null) ?? null,
        note: (row.note as string | null) ?? null,
      },
    };
  } catch (err) {
    console.error("getLiveSessionForDate failed", err);
    return { ok: false, error: "โหลดข้อมูลไลฟ์คืนนั้นไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// เพื่อน LINE — analytics.channel_follower_upsert (0153, RPC ใหม่)
// ============================================================================

export interface UpsertChannelFollowerCountInput {
  /** "YYYY-MM-DD" — ฟอร์มนี้ส่งเป็น "วันนี้" (เขตเวลาไทย) เสมอตามบรีฟ ไม่ให้
   * เลือกวันที่ย้อนหลัง (นี่คือ "ระดับปัจจุบัน" ไม่ใช่ค่าย้อนหลัง) */
  asOfDate: string;
  followerCount: number;
}

/** ฟอร์มนี้ hardcode p_channel='line_oa' เสมอตามบรีฟ — RPC เองรับช่องอื่นได้
 * (tiktok/facebook/instagram) แต่ action นี้ตั้งใจไม่เปิดพารามิเตอร์ channel
 * ให้ caller เลือกเอง เพื่อไม่ให้ UI ที่ยังไม่มี (ยังไม่มีฟอร์มกรอกช่องอื่น)
 * เผลอส่งช่องผิด — เพิ่มพารามิเตอร์ channel ได้ทันทีถ้าทำฟอร์มช่องอื่นทีหลัง. */
export async function upsertChannelFollowerCount(
  input: UpsertChannelFollowerCountInput
): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.asOfDate) return { ok: false, error: "กรุณาระบุวันที่" };
  if (
    input.followerCount === null ||
    input.followerCount === undefined ||
    Number.isNaN(input.followerCount)
  ) {
    return { ok: false, error: "กรุณากรอกจำนวนเพื่อน LINE" };
  }
  if (input.followerCount < 0) {
    return { ok: false, error: "จำนวนเพื่อน LINE ติดลบไม่ได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("channel_follower_upsert", {
      p_shop_id: shopId,
      p_channel: "line_oa",
      p_as_of_date: input.asOfDate,
      p_follower_count: input.followerCount,
    });
    if (error) throw error;
  } catch (err) {
    console.error("upsertChannelFollowerCount failed", {
      code: readErrorCode(err),
      message: redactUrls(readErrorMessage(err)),
    });
    return {
      ok: false,
      error: mapChannelFollowerUpsertRpcError(err, "บันทึกจำนวนเพื่อน LINE ไม่สำเร็จ ลองใหม่อีกครั้ง"),
    };
  }

  revalidatePath("/tiktok/live-log");
  return { ok: true, data: undefined };
}

export interface ChannelFollowerRow {
  asOfDate: string;
  followerCount: number;
}

/** อ่านค่าที่เคยกรอกของ (channel, date) นั้น — null = ยังไม่เคยกรอก ไม่ error. */
export async function getChannelFollowerCount(
  channel: ChannelCode,
  asOfDate: string
): Promise<ActionResult<ChannelFollowerRow | null>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!asOfDate) return { ok: false, error: "กรุณาระบุวันที่" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("channel_follower_log")
      .select("as_of_date, follower_count")
      .eq("shop_id", shopId)
      .eq("channel", channel)
      .eq("as_of_date", asOfDate)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    const row = data as Record<string, unknown>;
    return {
      ok: true,
      data: {
        asOfDate: String(row.as_of_date),
        followerCount: Number(row.follower_count),
      },
    };
  } catch (err) {
    console.error("getChannelFollowerCount failed", err);
    return { ok: false, error: "โหลดจำนวนเพื่อน LINE ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
