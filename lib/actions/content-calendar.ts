"use server";

// lib/actions/content-calendar.ts — ปฏิทินใหม่ (/marketing/calendar) · content-ui-build-plan.md §1.3 #7, §2.6 ก, §4 P1b ข้อ 2
//
// ไฟล์ "use server": export ได้เฉพาะ async function (ชนิด/ค่าคงที่อยู่ lib/marketing/*)
// - ทุก query: .eq("shop_id", …) เอง · ช่วงวันจำกัด ≤ MAX_RANGE_DAYS + .limit() (D15: v_content_piece ช้าตามจำนวนแถว)
// - overlap query: resolved_start <= ปลายช่วง และ (resolved_end หรือ resolved_start) >= ต้นช่วง — ไม่ใช่กรองแค่ resolved_start
//   (บั๊กงานข้ามเดือนหล่นของปฏิทินเดิม)
// - แต่ละส่วนล้มได้อิสระ (คืนเป็น Part) — เทศกาลล้ม กริดยังแสดง

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getCampaignCalendar } from "@/lib/actions/marketing";
import { STEP_KIND_LABEL } from "@/lib/marketing/campaign-types";
import { MAX_CALENDAR_YEAR, MAX_RANGE_DAYS, MIN_CALENDAR_YEAR, daysInclusive, festivalSpansInRange, isCalendarDate, isRealDate } from "@/lib/marketing/calendar-view";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import type { FestivalSpan } from "@/lib/marketing/calendar-view";
import type { CalendarData, LegacyStep } from "@/lib/marketing/calendar-types";
import { PIECE_LIGHT_COLUMNS, mapPieceRow } from "@/lib/marketing/piece-types";
import type { LineQuota, Part, PieceRow } from "@/lib/marketing/piece-types";
import { cleanText, isRecord } from "@/lib/marketing/piece-input";
import { KIND_CHANNELS, CUSTOMER_GROUPS, PIECE_KINDS } from "@/lib/marketing/piece-labels";
import { callRpc, isUuid, logRpcFailure, requireOwnerAdmin, SCHEMA, shopId } from "@/lib/marketing/piece-server";
import { asRows as rows, loadLineQuota, part } from "@/lib/marketing/piece-queries";
import type { PieceResult } from "@/lib/marketing/piece-server";

const PIECE_LIMIT = 300;
const LEGACY_LIMIT = 300;
const OVERDUE_LIMIT = 12;
const CALENDAR_FLAGS = "flag_needs_shoot, flag_on_hold, flag_confirm_pending, flag_no_link_overdue, active_post_n";
const UNFINISHED = ["planned", "drafting", "in_review", "approved", "produced"];

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * ข้อมูลของช่วงที่แสดง (สัปดาห์/เดือน/รายการ) · วันนี้ (ไทย) คำนวณที่นี่เอง ไม่รับจาก client (ใช้กำหนดขอบ "ค้าง")
 * ช่วงที่ขอ clamp เข้า 2025-01-01..2030-12-31 ที่ขอบ (กริดเดือน ธ.ค. 2030 / ม.ค. 2025 ล้นไปปีข้างเคียงได้ — ส่วนที่ล้นว่างเฉยๆ ไม่ error) · นอกช่วงทั้งก้อน/ผิดรูป = ปฏิเสธ
 */
export async function getCalendarData(from: string, to: string): Promise<PieceResult<CalendarData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isRealDate(from) || !isRealDate(to)) return { ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" };
  const MIN_DATE = `${MIN_CALENDAR_YEAR}-01-01`;
  const MAX_DATE = `${MAX_CALENDAR_YEAR}-12-31`;
  from = from < MIN_DATE ? MIN_DATE : from;
  to = to > MAX_DATE ? MAX_DATE : to;
  const todayTh = effectiveDateBangkok(new Date().toISOString());
  if (from > to || daysInclusive(from, to) > MAX_RANGE_DAYS || !isCalendarDate(from) || !isCalendarDate(to)) {
    return { ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" };
  }

  let shop: string;
  try {
    shop = shopId();
  } catch (err) {
    logRpcFailure("getCalendarData", err);
    return { ok: false, error: "ยังไม่ได้ตั้งค่าร้าน — ติดต่อทีมพัฒนา" };
  }
  const db = () => getServiceClient().schema(SCHEMA);
  // ขอบบนของ "ค้าง": ก่อนช่วงที่แสดง และก่อนวันนี้ (ชิ้นที่ยังไม่ถึงวันไม่ใช่ค้าง)
  const overdueBefore = from < todayTh ? from : todayTh;
  let legacyRaw = 0; // จำนวนแถวดิบจาก v_campaign_board (ก่อนตัดชิ้น workflow) — ใช้ตัดสินว่าชนเพดานไหม

  const [pieces, legacy, overdue, lineQuota, festivals] = await Promise.all([
    part<PieceRow[]>(
      "calendar.pieces",
      async () => {
        const { data, error } = await db()
          .from("v_content_piece_calendar")
          .select(`${PIECE_LIGHT_COLUMNS}, ${CALENDAR_FLAGS}`)
          .eq("shop_id", shop)
          // ไอเดียยังไม่ถูกจัดลงวัน — วันที่ที่ค้างจากการ "ยกเลิกการเลือก"/✓ ไม่ผ่าน (set_plan ล้างวันไม่ได้ D11) ต้องไม่โผล่เป็นการ์ดในปฏิทิน
          .neq("piece_status", "idea")
          .lte("resolved_start", to)
          .or(`resolved_end.gte.${from},and(resolved_end.is.null,resolved_start.gte.${from})`)
          .order("resolved_start", { ascending: true })
          .limit(PIECE_LIMIT);
        if (error) throw error;
        return rows(data).map(mapPieceRow);
      },
      "โหลดชิ้นงานในปฏิทินไม่สำเร็จ"
    ),
    part<LegacyStep[]>(
      "calendar.legacy",
      async () => {
        const { data, error } = await db()
          .from("v_campaign_board")
          .select(
            "step_id, campaign_id, campaign_name, campaign_type, step_kind, step_title, resolved_start, resolved_end, channel, start_time, effective_status, content_type_code, step_origin"
          )
          .eq("shop_id", shop)
          .lte("resolved_start", to)
          .or(`resolved_end.gte.${from},and(resolved_end.is.null,resolved_start.gte.${from})`)
          .order("resolved_start", { ascending: true })
          .limit(LEGACY_LIMIT);
        if (error) throw error;
        legacyRaw = rows(data).length;
        // ชิ้นใน workflow ใหม่ (รวมที่ยกเลิก — v_content_piece_calendar ไม่แสดง cancelled แต่ v_campaign_board ยังมี) ต้องไม่โผล่เป็น "แผนเดิม"
        // ถามเฉพาะ id ที่อยู่ในแถวบอร์ดช่วงนี้ (≤ LEGACY_LIMIT) แทนดึง id ของทุกชิ้น workflow — ไม่มีเพดาน 2,000 ที่ทำให้ชิ้นหลุดมาซ้ำ
        const boardIds = rows(data).map((r) => r.step_id).filter((x): x is string => typeof x === "string");
        const workflowIds = new Set<unknown>();
        if (boardIds.length > 0) {
          const wf = await db().from("campaign_step").select("id").eq("shop_id", shop).in("id", boardIds).not("piece_status", "is", null).limit(LEGACY_LIMIT);
          if (wf.error) throw wf.error;
          for (const r of rows(wf.data)) workflowIds.add(r.id);
        }
        return rows(data)
          .filter((r) => typeof r.step_id === "string" && !workflowIds.has(r.step_id))
          .map((r): LegacyStep => {
            const kind = str(r.step_kind) ?? "";
            return {
              stepId: String(r.step_id),
              campaignId: String(r.campaign_id ?? ""),
              campaignName: str(r.campaign_name) ?? "",
              campaignType: str(r.campaign_type),
              title: str(r.step_title) ?? STEP_KIND_LABEL[kind] ?? "งานการตลาด",
              resolvedStart: str(r.resolved_start)?.slice(0, 10) ?? null,
              resolvedEnd: str(r.resolved_end)?.slice(0, 10) ?? null,
              channel: str(r.channel),
              startTime: str(r.start_time),
              effectiveStatus: str(r.effective_status) ?? "todo",
              contentTypeCode: str(r.content_type_code),
              stepOrigin: str(r.step_origin),
            };
          });
      },
      "โหลดแผนเดิมไม่สำเร็จ"
    ),
    part<PieceRow[]>(
      "calendar.overdue",
      async () => {
        const { data, error } = await db()
          .from("v_content_piece_calendar")
          .select(`${PIECE_LIGHT_COLUMNS}, ${CALENDAR_FLAGS}`)
          .eq("shop_id", shop)
          .in("piece_status", UNFINISHED)
          .lt("resolved_start", overdueBefore)
          .order("resolved_start", { ascending: false })
          .limit(OVERDUE_LIMIT * 4);
        if (error) throw error;
        // ชิ้นหลายวันที่ยังไม่จบ (resolved_end ≥ ขอบ) ไม่ใช่ "ค้าง" — อยู่ในกริดแล้ว
        return rows(data)
          .map(mapPieceRow)
          .filter((p) => (p.resolvedEnd ?? p.resolvedStart ?? "") < overdueBefore)
          .slice(0, OVERDUE_LIMIT);
      },
      "โหลดงานที่ค้างไม่สำเร็จ"
    ),
    part<LineQuota | null>("calendar.line", () => loadLineQuota(db()), "โหลดโควตา LINE ไม่สำเร็จ"),
    part<FestivalSpan[]>(
      "calendar.festivals",
      async () => {
        const res = await getCampaignCalendar();
        if (!res.ok) throw new Error("festival read failed");
        return festivalSpansInRange(res.data, from, to);
      },
      "โหลดเทศกาลไม่สำเร็จ"
    ),
  ]);

  return {
    ok: true,
    data: {
      from,
      to,
      pieces,
      legacy,
      overdue,
      lineQuota,
      festivals,
      // ชนเพดานแถว = ข้อมูลอาจไม่ครบ → หน้าต้องเตือน ไม่ตัดเงียบ
      piecesTruncated: pieces.ok && pieces.data.length >= PIECE_LIMIT,
      legacyTruncated: legacy.ok && legacyRaw >= LEGACY_LIMIT,
    },
  };
}

export interface CreatePieceInput {
  title: string;
  pieceKind: string;
  channel: string;
  customerGroup: string;
  /** YYYY-MM-DD */
  date: string;
}

/**
 * "+ เพิ่มชิ้นงาน" → content_piece_create (ทางสร้าง step ของ workflow ใหม่ — D10) · เจ้าของ + มีวัน = planned
 * ตรวจชนิด↔ช่องทางที่นี่ด้วยตารางเดียวกับ DB (ข้อความไทยที่ช่อง) · DB ยังเป็นผู้ตัดสินจริง
 */
export async function createPiece(input: CreatePieceInput): Promise<PieceResult<{ stepId: string }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isRecord(input)) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };

  const title = cleanText(input.title);
  if (title.length < 1 || title.length > 200) return { ok: false, error: "ชื่อชิ้นงานต้องยาว 1–200 ตัวอักษร" };
  if (typeof input.pieceKind !== "string" || !(PIECE_KINDS as readonly string[]).includes(input.pieceKind)) {
    return { ok: false, error: "เลือกชนิดชิ้นงาน" };
  }
  const kind = input.pieceKind as (typeof PIECE_KINDS)[number];
  if (typeof input.channel !== "string" || !(KIND_CHANNELS[kind] as readonly string[]).includes(input.channel)) {
    return { ok: false, error: "เลือกช่องทางที่ใช้กับชนิดนี้ได้" };
  }
  if (typeof input.customerGroup !== "string" || !(CUSTOMER_GROUPS as readonly string[]).includes(input.customerGroup)) {
    return { ok: false, error: "เลือกกลุ่มลูกค้า" };
  }
  if (!isRealDate(input.date)) return { ok: false, error: "เลือกวันที่ให้ถูกต้อง" };

  const res = await callRpc<string>(
    "content_piece_create",
    {
      p_title: title,
      p_piece_kind: input.pieceKind,
      p_channel: input.channel,
      p_customer_group: input.customerGroup,
      p_date: input.date,
      p_source_signal_id: null,
      p_campaign_id: null,
    },
    "เพิ่มชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  if (typeof res.data !== "string" || !isUuid(res.data)) return { ok: false, error: "เพิ่มชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง" };
  revalidatePath("/marketing/calendar");
  revalidatePath("/marketing");
  return { ok: true, data: { stepId: res.data } };
}
