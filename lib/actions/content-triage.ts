"use server";

// lib/actions/content-triage.ts — หน้า "คัดไอเดีย" /marketing/triage (content-ui-build-plan.md §4 P1b ข้อ 1)
// ไฟล์ "use server": export ได้เฉพาะ async function · ทุก action เรียก requireOwnerAdmin() เป็นบรรทัดแรก
// ✓ ทำ = setPlan({date}) แล้ว advance('planned') — วันต้องมาจากผู้ใช้เลือก (ไม่เลือกให้อัตโนมัติ) · DB ตัดสินว่าวางแผนได้ไหม (55000)
// ✗ ไม่ทำ = advance('cancelled', เหตุผล ≥3) · ↷ เลื่อน = advance('hold', เหตุผล) · กลับมาคัด = advance('resume')
// ยกเลิกการเลือก = advance('idea') — set_plan ล้างวันไม่ได้ (0159: date ล้างไม่ได้ · D11) จึงไม่เรียกล้างวัน

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { PIECE_LIGHT_COLUMNS, mapPieceRow } from "@/lib/marketing/piece-types";
import { isCalendarDate } from "@/lib/marketing/calendar-view";
import { triageWeekDays, triageWeekFrom } from "@/lib/marketing/triage";
import type { TriageData } from "@/lib/marketing/triage";
import { analyticsDb, asRows, loadContentTypeOptions, loadHosts, loadInboxCounts, loadLineQuota, part } from "@/lib/marketing/piece-queries";
import { isUuid, requireOwnerAdmin, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";
import { advancePiece, setPlan } from "@/lib/actions/content-pieces";

const IDEA_LIMIT = 40;
const WEEK_LIMIT = 100;

const IDEA_COLUMNS = `${PIECE_LIGHT_COLUMNS}, hypothesis, metric_code, baseline_value, baseline_as_of, pass_threshold, pass_op, baseline_spread, threshold_too_narrow`;

/** ข้อมูลหน้าคัดไอเดียของสัปดาห์ที่ระบุ (?w= — วันใดก็ได้ในสัปดาห์) · แต่ละส่วนล้มได้อิสระ */
export async function getTriageData(weekParam?: string | null): Promise<PieceResult<TriageData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const weekFrom = triageWeekFrom(todayTh, weekParam);
  const days = triageWeekDays(weekFrom);
  const weekTo = days[6];
  const shop = shopId();
  const db = analyticsDb();

  let weekTruncated = false;

  const [ideas, weekRows, lineQuota, counts, lastWeekLine, hostsRes, typesRes] = await Promise.all([
    part(
      "triage.ideas",
      async () => {
        const { data, error } = await db
          .from("v_content_piece")
          .select(IDEA_COLUMNS)
          .eq("shop_id", shop)
          .eq("piece_status", "idea")
          .order("last_event_at", { ascending: false, nullsFirst: false })
          .limit(IDEA_LIMIT);
        if (error) throw error;
        const rows = asRows(data).map(mapPieceRow);
        const signalIds = [...new Set(rows.map((r) => r.sourceSignalId).filter((s): s is string => !!s && isUuid(s)))];
        const signals: Record<string, { kind: string; summary: string; seenOn: string | null }> = {};
        if (signalIds.length > 0) {
          const sg = await db.from("v_content_signal").select("id, kind, summary, seen_on").eq("shop_id", shop).in("id", signalIds).limit(IDEA_LIMIT);
          if (sg.error) throw sg.error;
          for (const s of asRows(sg.data)) {
            if (typeof s.id !== "string") continue;
            signals[s.id] = {
              kind: typeof s.kind === "string" ? s.kind : "",
              summary: typeof s.summary === "string" ? s.summary : "",
              seenOn: typeof s.seen_on === "string" ? s.seen_on.slice(0, 10) : null,
            };
          }
        }
        return { rows, truncated: data !== null && Array.isArray(data) && data.length >= IDEA_LIMIT, signals };
      },
      "โหลดรายการไอเดียไม่สำเร็จ"
    ),
    part(
      "triage.week",
      async () => {
        // overlap: เริ่ม <= ปลายสัปดาห์ และ (จบ หรือเริ่ม) >= ต้นสัปดาห์ — ไม่กรองแค่ resolved_start
        const { data, error } = await db
          .from("v_content_piece_calendar")
          .select(PIECE_LIGHT_COLUMNS)
          .eq("shop_id", shop)
          // ไอเดียที่ค้างวันเดิม (ยกเลิกการเลือก/✓ ไม่ผ่าน) ยังไม่ถูกจัดลงวัน — ตัดที่ต้นทาง ครอบตัวนับต่อวัน/ต่อช่อง/วันว่างทุกตัว
          .neq("piece_status", "idea")
          .lte("resolved_start", weekTo)
          .or(`resolved_end.gte.${weekFrom},and(resolved_end.is.null,resolved_start.gte.${weekFrom})`)
          .limit(WEEK_LIMIT);
        if (error) throw error;
        if (Array.isArray(data) && data.length >= WEEK_LIMIT) weekTruncated = true;
        return asRows(data).map(mapPieceRow);
      },
      "โหลดภาพรวมสัปดาห์ไม่สำเร็จ"
    ),
    part("triage.line", () => loadLineQuota(db), "โหลดโควตา LINE ไม่สำเร็จ"),
    part("triage.counts", () => loadInboxCounts(db), "โหลดตัวเลขคิวไม่สำเร็จ"),
    part<string | null>(
      "triage.lastWeek",
      async () => {
        const { data, error } = await db
          .from("content_weekly_summary")
          .select("summary_lines")
          .eq("shop_id", shop)
          .order("week_start", { ascending: false })
          .limit(1);
        if (error) throw error;
        const lines = asRows(data)[0]?.summary_lines;
        const first = Array.isArray(lines) ? lines.find((l): l is string => typeof l === "string" && l.trim() !== "") : undefined;
        return first ?? null;
      },
      "โหลดผลสัปดาห์ก่อนไม่สำเร็จ"
    ),
    part("triage.hosts", () => loadHosts(db), "โหลดรายชื่อโฮสต์ไม่สำเร็จ"),
    part("triage.types", () => loadContentTypeOptions(), "โหลดชนิดเนื้อหาไม่สำเร็จ"),
  ]);

  return {
    ok: true,
    data: {
      todayTh,
      weekFrom,
      ideas,
      weekRows,
      weekTruncated,
      lineQuota,
      counts,
      lastWeekLine,
      hosts: hostsRes.ok ? hostsRes.data : [],
      contentTypes: typesRes.ok ? typesRes.data : [],
    },
  };
}

function refreshTriage(stepId: string): void {
  revalidatePath("/marketing/triage");
  revalidatePath("/marketing/calendar");
  revalidatePath(`/marketing/pieces/${stepId}`);
}

/**
 * ✓ ทำ — วันที่ผู้ใช้เลือก → setPlan({date}) แล้ว advance('planned')
 * ล้มที่ขั้น planned (55000 "วางแผนไม่ได้ — …") → คืนข้อความจาก DB ตามเดิม · วันที่บันทึกไว้แล้ว (ไอเดียยังเป็น idea) ผู้ใช้กด "แก้แผน" ต่อได้
 */
export async function chooseIdea(stepId: string, date: string): Promise<PieceResult<{ date: string }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  if (typeof date !== "string" || !isCalendarDate(date)) return { ok: false, error: "เลือกวันที่จะลงก่อน" };

  const planned = await setPlan(stepId, { date });
  if (!planned.ok) return planned;
  const adv = await advancePiece(stepId, "planned");
  // setPlan ผ่านแล้ว (วันถูกบันทึก) แต่ planned ไม่ผ่าน → ข้อมูลฝั่งจอเก่ากว่า DB (ไอเดียมีวันแล้ว) — stale ให้จอรีเฟรช
  if (!adv.ok) return { ...adv, stale: true };
  refreshTriage(stepId);
  return { ok: true, data: { date } };
}

/** ยกเลิกการเลือก — planned → idea (ไม่ต้องมีเหตุผล · วันที่ตั้งไว้ยังค้าง เพราะ set_plan ล้างวันไม่ได้) */
export async function unchooseIdea(stepId: string): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const res = await advancePiece(stepId, "idea");
  if (!res.ok) return res;
  refreshTriage(stepId);
  return { ok: true, data: undefined };
}

/** ✗ ไม่ทำ — เหตุผล ≥ 3 ตัวอักษร (ตรวจซ้ำที่ advancePiece + DB) */
export async function skipIdea(stepId: string, reason: string): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const res = await advancePiece(stepId, "cancelled", { reason });
  if (!res.ok) return res;
  refreshTriage(stepId);
  return { ok: true, data: undefined };
}

/** ↷ เลื่อน — พักไอเดียไว้รอบหน้า (hold overlay) */
export async function holdIdea(stepId: string, reason: string): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const res = await advancePiece(stepId, "hold", { reason });
  if (!res.ok) return res;
  refreshTriage(stepId);
  return { ok: true, data: undefined };
}

/** กลับมาคัด — resume (ไม่ต้องมีเหตุผล) */
export async function resumeIdea(stepId: string): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const res = await advancePiece(stepId, "resume");
  if (!res.ok) return res;
  refreshTriage(stepId);
  return { ok: true, data: undefined };
}
