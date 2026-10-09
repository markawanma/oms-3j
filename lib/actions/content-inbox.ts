"use server";

// lib/actions/content-inbox.ts — "งานที่รอฉัน" (/marketing) และ "คำถามจาก AI" (/marketing/questions)
// (content-ui-build-plan.md §1.3 board 1+2, §2.3, §4 P1a ข้อ 4/5/11)
//
// ไฟล์ "use server": export ได้เฉพาะ async function (type/const อยู่ lib/marketing/*) — next build ล้มถ้าฝ่าฝืน
// ทุก query: .eq("shop_id", getDevShopId()) เอง (view ไม่กรองร้านให้) · list มี .limit() เสมอ (D15: v_content_piece ~4ms/แถว)

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import {
  PIECE_FULL_COLUMNS,
  PIECE_LIGHT_COLUMNS,
  mapInboxCounts,
  mapPieceRow,
  mapRecoRow,
  mapWeeklySummary,
} from "@/lib/marketing/piece-types";
import type {
  InboxData,
  LineQuota,
  NextScheduled,
  Part,
  PieceRow,
  RecoInboxRow,
  WeeklySummaryRow,
} from "@/lib/marketing/piece-types";
import { thaiWeekRange } from "@/lib/marketing/inbox-piles";
import { checkRecoResponse, isRecord } from "@/lib/marketing/piece-input";
import { callRpc, isUuid, logRpcFailure, requireOwnerAdmin, SCHEMA, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";

/** เพดานแถวต่อกอง — กันหน้าแรกหนัก (แสดง "แสดง n จาก m" เมื่อ count จาก view มากกว่า) */
const POST_LIMIT = 30;
const REVIEW_LIMIT = 20;
const WEEK_LIMIT = 100;
const RECO_LIMIT = 100;

async function part<T>(label: string, fn: () => Promise<T>, fallbackMessage: string): Promise<Part<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    logRpcFailure(label, err);
    return { ok: false, error: fallbackMessage };
  }
}

function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/**
 * ข้อมูลทั้งหมดของหน้า /marketing — แต่ละส่วนล้มได้อิสระ (กองหนึ่งล้ม กองอื่นยังแสดง · §3)
 * ≤ 9 query ขนานกัน · ไม่ select ทั้งตาราง
 */
export async function getInboxData(): Promise<PieceResult<InboxData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  let shop: string;
  try {
    shop = shopId();
  } catch (err) {
    logRpcFailure("getInboxData", err);
    return { ok: false, error: "ยังไม่ได้ตั้งค่าร้าน — ติดต่อทีมพัฒนา" };
  }

  const supabase = getServiceClient();
  const db = () => supabase.schema(SCHEMA);
  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const week = thaiWeekRange(todayTh) ?? { from: todayTh, to: todayTh };

  const overdueIds: string[] = [];

  const [counts, postRows, reviewRows, weekRows, reco, weekly, entryCount, lineQuota, nextScheduled] = await Promise.all([
    part(
      "inbox.counts",
      async () => {
        const { data, error } = await db().from("v_content_inbox_counts").select("*").eq("shop_id", shop).maybeSingle();
        if (error) throw error;
        return mapInboxCounts((data as Record<string, unknown> | null) ?? null);
      },
      "โหลดตัวเลขกองงานไม่สำเร็จ"
    ),
    part(
      "inbox.post",
      async () => {
        const { data, error } = await db()
          .from("v_content_piece_calendar")
          .select(`${PIECE_LIGHT_COLUMNS}, content_body, flag_no_link_overdue`)
          .eq("shop_id", shop)
          .in("piece_status", ["approved", "produced"])
          .lte("resolved_start", todayTh)
          .order("resolved_start", { ascending: true })
          .limit(POST_LIMIT);
        if (error) throw error;
        const rows = asRows(data);
        for (const r of rows) if (r.flag_no_link_overdue === true && typeof r.step_id === "string") overdueIds.push(r.step_id);
        return rows.map(mapPieceRow);
      },
      "โหลดกอง \"วันนี้ต้องโพสต์\" ไม่สำเร็จ"
    ),
    part(
      "inbox.review",
      async () => {
        const { data, error } = await db()
          .from("v_content_piece")
          .select(PIECE_FULL_COLUMNS)
          .eq("shop_id", shop)
          .eq("piece_status", "in_review")
          .order("resolved_start", { ascending: true, nullsFirst: false })
          .limit(REVIEW_LIMIT);
        if (error) throw error;
        return asRows(data).map(mapPieceRow);
      },
      "โหลดกอง \"รออนุมัติ\" ไม่สำเร็จ"
    ),
    part(
      "inbox.week",
      async () => {
        // overlap: เริ่ม <= ปลายสัปดาห์ และ (จบ หรือเริ่ม) >= ต้นสัปดาห์ — ไม่กรองแค่ resolved_start (บั๊กงานข้ามช่วงของปฏิทินเดิม)
        const { data, error } = await db()
          .from("v_content_piece_calendar")
          .select(PIECE_LIGHT_COLUMNS)
          .eq("shop_id", shop)
          .lte("resolved_start", week.to)
          .or(`resolved_end.gte.${week.from},and(resolved_end.is.null,resolved_start.gte.${week.from})`)
          .limit(WEEK_LIMIT);
        if (error) throw error;
        return asRows(data).map(mapPieceRow);
      },
      "โหลดภาพรวมสัปดาห์นี้ไม่สำเร็จ"
    ),
    part(
      "inbox.reco",
      async () => {
        const { data, error } = await db()
          .from("v_recommendation_inbox")
          .select("*")
          .eq("shop_id", shop)
          .eq("effective_action", "pending")
          .limit(RECO_LIMIT);
        if (error) throw error;
        return asRows(data).map(mapRecoRow);
      },
      "โหลดคำถามจาก AI ไม่สำเร็จ"
    ),
    part<WeeklySummaryRow | null>(
      "inbox.weekly",
      async () => {
        const { data, error } = await db()
          .from("content_weekly_summary")
          .select("id, week_start, brief_date, brief_no, summary_lines")
          .eq("shop_id", shop)
          .order("week_start", { ascending: false })
          .limit(1);
        if (error) throw error;
        const first = asRows(data)[0];
        return first ? mapWeeklySummary(first) : null;
      },
      "โหลดสรุปสัปดาห์ไม่สำเร็จ"
    ),
    part<number>(
      "inbox.entry",
      async () => {
        const { count, error } = await db()
          .from("v_content_entry_queue")
          .select("post_id", { count: "exact", head: true })
          .eq("shop_id", shop);
        if (error) throw error;
        return count ?? 0;
      },
      "โหลดคิวกรอกยอดไม่สำเร็จ"
    ),
    part<LineQuota | null>(
      "inbox.line",
      async () => {
        const { data, error } = await db().from("v_line_quota_28d").select("*").eq("shop_id", shop).maybeSingle();
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
      },
      "โหลดโควตา LINE ไม่สำเร็จ"
    ),
    part<NextScheduled | null>(
      "inbox.next",
      async () => {
        const { data, error } = await db()
          .from("v_content_piece_calendar")
          .select("step_id, title, resolved_start")
          .eq("shop_id", shop)
          .in("piece_status", ["planned", "drafting", "in_review", "approved", "produced"])
          .gt("resolved_start", todayTh)
          .order("resolved_start", { ascending: true })
          .limit(1);
        if (error) throw error;
        const r = asRows(data)[0];
        if (!r || typeof r.step_id !== "string" || typeof r.resolved_start !== "string") return null;
        return { stepId: r.step_id, title: typeof r.title === "string" ? r.title : "(ไม่มีชื่อ)", resolvedStart: r.resolved_start.slice(0, 10) };
      },
      "โหลดงานถัดไปไม่สำเร็จ"
    ),
  ]);

  return {
    ok: true,
    data: {
      todayTh,
      counts,
      postRows,
      overdueNoLinkIds: overdueIds,
      reviewRows,
      weekRows,
      weekFrom: week.from,
      weekTo: week.to,
      reco,
      weekly,
      entryTodayCount: entryCount,
      lineQuota,
      nextScheduled,
    },
  };
}

/** ข้อเสนอ/คำถามทั้งหมด (หน้า /marketing/questions) — รอตอบ + ประวัติ · เรียงฝั่ง page */
export async function getRecoInbox(): Promise<PieceResult<RecoInboxRow[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_recommendation_inbox")
      .select("*")
      .eq("shop_id", shopId())
      .order("created_at", { ascending: false })
      .limit(RECO_LIMIT);
    if (error) throw error;
    return { ok: true, data: asRows(data).map(mapRecoRow) };
  } catch (err) {
    logRpcFailure("getRecoInbox", err);
    return { ok: false, error: "โหลดคำถามจาก AI ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/**
 * ตอบข้อเสนอ/คำถาม AI → recommendation_respond
 * - token (content_token) คือค่าที่ view ให้ตอนโหลดหน้า ส่งกลับตามที่เห็น — ห้าม client สร้างเอง (F4)
 *   ถ้าไม่ตรงกับ DB = 55000 "ข้อมูลเปลี่ยนไปแล้ว" (CAS) ฝั่งจอโหลดใหม่และคงข้อความที่พิมพ์ไว้
 * - ข้อเสนอชนิด risk_gate / campaign_verdict ไม่ผ่านที่นี่ (ใช้ content_gate_record · หน้าแคมเปญตามลำดับ)
 */
export async function respondReco(input: {
  recoId: string;
  action: "done" | "rejected";
  response: string;
  token: string | null;
}): Promise<PieceResult<{ late: boolean; wasExpired: boolean }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!isRecord(input)) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  if (!isUuid(input.recoId)) return { ok: false, error: "ไม่พบข้อเสนอที่จะตอบ" };
  if (typeof input.token !== "string" || input.token.length === 0 || input.token.length > 200) {
    return { ok: false, error: "ข้อมูลข้อเสนอไม่ครบ — รีเฟรชหน้าแล้วลองใหม่", stale: true };
  }
  const checked = checkRecoResponse(input.action, input.response);
  if (!checked.ok) return { ok: false, error: checked.error };

  const res = await callRpc<Record<string, unknown>>(
    "recommendation_respond",
    {
      p_id: input.recoId,
      p_action: checked.value.action,
      p_response: checked.value.response,
      p_expected_token: input.token,
    },
    "ตอบข้อเสนอไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;

  revalidatePath("/marketing");
  revalidatePath("/marketing/questions");
  const d = res.data ?? {};
  return { ok: true, data: { late: d.late === true, wasExpired: d.was_expired === true } };
}

