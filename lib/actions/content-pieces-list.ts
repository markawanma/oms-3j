"use server";

// lib/actions/content-pieces-list.ts — "ชิ้นงานทั้งหมด" /marketing/pieces (content-ui-build-plan.md §2.6 ข)
// D15: v_content_piece ช้าต่อแถว → กรองสถานะ/ช่วงวันเสมอ · ดึง PAGE_SIZE+1 แถวแทน count เต็ม · เรียงให้แบ่งหน้านิ่ง (step_id เป็น tie-break)
// กู้คืนชิ้นที่ยกเลิก = advancePiece(restore) ผ่านกล่องเหตุผล (ใช้ action เดิม ไม่มี action ใหม่)

import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { PIECE_LIGHT_COLUMNS, mapPieceRow } from "@/lib/marketing/piece-types";
import type { PieceRow } from "@/lib/marketing/piece-types";
import { OPEN_STATUSES, PAGE_SIZE, ilikePattern, parsePiecesQuery, postedSince, sortAscending } from "@/lib/marketing/pieces-list";
import type { PiecesQuery } from "@/lib/marketing/pieces-list";
import { analyticsDb, asRows, loadContentTypeOptions, part } from "@/lib/marketing/piece-queries";
import { logRpcFailure, requireOwnerAdmin, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";
import type { ContentTypeOption, Part } from "@/lib/marketing/piece-types";

export interface PiecesListData {
  todayTh: string;
  query: PiecesQuery;
  rows: PieceRow[];
  /** มีหน้าถัดไป (ดึงเกิน 1 แถว) */
  hasNext: boolean;
  campaigns: Part<{ id: string; name: string }[]>;
  contentTypes: ContentTypeOption[];
}

/** searchParams ดิบ → parse + ตรวจซ้ำฝั่ง server (ไม่เชื่อค่าจาก client) */
export async function getPiecesList(rawParams: Record<string, string | string[] | undefined>): Promise<PieceResult<PiecesListData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const query = parsePiecesQuery(rawParams ?? {});
  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const since = postedSince(todayTh);
  const shop = shopId();
  const db = analyticsDb();
  const offset = (query.page - 1) * PAGE_SIZE;

  try {
    let q = db.from("v_content_piece").select(PIECE_LIGHT_COLUMNS).eq("shop_id", shop);

    // สถานะ — ต้องกรองเสมอ (ไม่มีโหมด "ทั้งหมดไม่จำกัด")
    if (query.status === "open") {
      q = query.withPosted
        ? q.or(`piece_status.in.(${OPEN_STATUSES.join(",")}),and(piece_status.eq.posted,resolved_start.gte.${since})`)
        : q.in("piece_status", [...OPEN_STATUSES]);
    } else if (query.status === "posted") {
      q = q.eq("piece_status", "posted").gte("resolved_start", since);
    } else {
      q = q.eq("piece_status", query.status);
    }
    if (query.campaign) q = q.eq("campaign_id", query.campaign);
    if (query.channel) q = q.eq("channel", query.channel);
    if (query.q) q = q.ilike("title", ilikePattern(query.q));

    const asc = sortAscending(query);
    const { data, error } = await q
      .order("resolved_start", { ascending: asc, nullsFirst: false })
      .order("step_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE); // PAGE_SIZE + 1 แถว
    if (error) throw error;
    const all = asRows(data).map(mapPieceRow);
    const hasNext = all.length > PAGE_SIZE;

    const [campaigns, types] = await Promise.all([
      part(
        "pieces.campaigns",
        async () => {
          const res = await db.from("campaign").select("id, name").eq("shop_id", shop).order("created_at", { ascending: false }).limit(100);
          if (res.error) throw res.error;
          return asRows(res.data)
            .filter((c) => typeof c.id === "string" && typeof c.name === "string")
            .map((c) => ({ id: c.id as string, name: c.name as string }));
        },
        "โหลดรายชื่อแคมเปญไม่สำเร็จ"
      ),
      part("pieces.types", () => loadContentTypeOptions(), "โหลดชนิดเนื้อหาไม่สำเร็จ"),
    ]);

    return {
      ok: true,
      data: { todayTh, query, rows: all.slice(0, PAGE_SIZE), hasNext, campaigns, contentTypes: types.ok ? types.data : [] },
    };
  } catch (err) {
    logRpcFailure("getPiecesList", err);
    return { ok: false, error: "โหลดรายการชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
