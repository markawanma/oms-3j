// lib/marketing/piece-queries.ts — query ฝั่ง server ที่หลายหน้าใช้ร่วมกัน (คัดไอเดีย · รอบถ่าย · รายการชิ้นงาน · โพสต์วันนี้)
// ไม่ใช่ "use server" (export ได้ทุกชนิด) · server-only · ทุก query .eq("shop_id") เองและมี .limit() (D15: v_content_piece ช้าต่อแถว)
// ผู้เรียกต้อง requireOwnerAdmin() ก่อนเสมอ — ไฟล์นี้ไม่ตรวจสิทธิ์

import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { getContentTypes } from "@/lib/actions/content";
import { PIECE_LIGHT_COLUMNS, mapInboxCounts, mapPieceRow } from "@/lib/marketing/piece-types";
import type { ContentTypeOption, HostOption, InboxCounts, LineQuota, Part, PieceRow } from "@/lib/marketing/piece-types";
import { logRpcFailure, SCHEMA, shopId } from "@/lib/marketing/piece-server";

export type Db = ReturnType<ReturnType<typeof getServiceClient>["schema"]>;

export function analyticsDb(): Db {
  return getServiceClient().schema(SCHEMA);
}

/** กัน query หนึ่งล้มแล้วทั้งหน้าล้ม — ส่วนที่ล้มกลายเป็น { ok:false, error } แล้วหน้าแสดง SectionError เฉพาะส่วน */
export async function part<T>(label: string, fn: () => Promise<T>, fallbackMessage: string): Promise<Part<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    logRpcFailure(label, err);
    return { ok: false, error: fallbackMessage };
  }
}

export function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** โฮสต์ที่ใช้งาน — 🔴 เฉพาะ id + public_label (display_name ห้ามเข้า payload) */
export async function loadHosts(db: Db = analyticsDb()): Promise<HostOption[]> {
  const { data, error } = await db
    .from("live_host")
    .select("id, public_label, is_active")
    .eq("shop_id", shopId())
    .eq("is_active", true)
    .order("public_label", { ascending: true })
    .limit(20);
  if (error) throw error;
  return asRows(data)
    .filter((h) => typeof h.id === "string" && typeof h.public_label === "string")
    .map((h) => ({ id: h.id as string, publicLabel: h.public_label as string }));
}

export async function loadContentTypeOptions(): Promise<ContentTypeOption[]> {
  const res = await getContentTypes();
  if (!res.ok) throw new Error("content types");
  return res.data.map((c) => ({ code: c.code, labelTh: c.labelTh, colorHex: c.colorHex }));
}

/** v_line_quota_28d — ตัวเลขทุกตัวมาจาก DB (ไม่คำนวณโควตาเอง) */
export async function loadLineQuota(db: Db = analyticsDb()): Promise<LineQuota | null> {
  const { data, error } = await db.from("v_line_quota_28d").select("*").eq("shop_id", shopId()).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    used28d: Number(r.used_28d ?? 0),
    planned28d: Number(r.planned_28d ?? 0),
    quota: Number(r.quota ?? 0),
    remaining28d: Number(r.remaining_28d ?? 0),
    overQuotaPlanned: r.over_quota_planned === true,
  };
}

export async function loadInboxCounts(db: Db = analyticsDb()): Promise<InboxCounts> {
  const { data, error } = await db.from("v_content_inbox_counts").select("*").eq("shop_id", shopId()).maybeSingle();
  if (error) throw error;
  return mapInboxCounts((data as Record<string, unknown> | null) ?? null);
}

/**
 * กอง "วันนี้ต้องโพสต์" — approved/produced ที่ถึงวัน (resolved_start ≤ วันนี้) เรียงวันใกล้ก่อนแล้ว step_id (นิ่ง)
 * ใช้ทั้งหน้า "งานที่รอฉัน" และ "โพสต์วันนี้" — query เดียว ลำดับเดียว · overdueNoLinkIds = ชิ้นที่ DB ตั้งธง flag_no_link_overdue (ไม่คำนวณซ้ำ)
 */
export async function loadPostTodayRows(db: Db, todayTh: string, limit: number): Promise<{ rows: PieceRow[]; overdueNoLinkIds: string[] }> {
  const { data, error } = await db
    .from("v_content_piece_calendar")
    .select(`${PIECE_LIGHT_COLUMNS}, content_body, flag_no_link_overdue`)
    .eq("shop_id", shopId())
    .in("piece_status", ["approved", "produced"])
    .lte("resolved_start", todayTh)
    .order("resolved_start", { ascending: true })
    .order("step_id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const raw = asRows(data);
  const overdueNoLinkIds = raw.filter((r) => r.flag_no_link_overdue === true && typeof r.step_id === "string").map((r) => r.step_id as string);
  return { rows: raw.map(mapPieceRow), overdueNoLinkIds };
}
