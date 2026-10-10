"use server";

// lib/actions/content-posts.ts — "โพสต์วันนี้" /marketing/posts (content-ui-build-plan.md §2.6 ค)
// ส่วนบน = กอง "วันนี้ต้องโพสต์" (query เดียวกับหน้า "งานที่รอฉัน") · ส่วนล่าง = โพสต์ active ที่ยังไม่ผูกชิ้นงาน → content_post_link_step
// ไฟล์ "use server": export ได้เฉพาะ async function · ทุก action requireOwnerAdmin เป็นบรรทัดแรก · ทุก query .eq("shop_id")

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { PIECE_LIGHT_COLUMNS, mapPieceRow } from "@/lib/marketing/piece-types";
import type { PieceRow } from "@/lib/marketing/piece-types";
import { mapOrphanPost } from "@/lib/marketing/post-orphans";
import type { OrphanPost, PostsPageData } from "@/lib/marketing/post-orphans";
import { postedSince } from "@/lib/marketing/pieces-list";
import { analyticsDb, asRows, loadContentTypeOptions, loadPostTodayRows, part } from "@/lib/marketing/piece-queries";
import { callRpc, isUuid, requireOwnerAdmin, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";

const POST_LIMIT = 30;
const ORPHAN_LIMIT = 50;
const CANDIDATE_LIMIT = 60;
const LINKABLE_PLATFORMS = ["tiktok", "facebook", "instagram"];
const LINKABLE_KINDS = ["short_clip", "live_cut", "ig_fb_post"];

export async function getPostsPageData(): Promise<PieceResult<PostsPageData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const shop = shopId();
  const db = analyticsDb();
  const overdueIds: string[] = [];

  const [postRows, postCount, orphans, types] = await Promise.all([
    part("posts.today", async () => {
      const r = await loadPostTodayRows(db, todayTh, POST_LIMIT);
      overdueIds.push(...r.overdueNoLinkIds);
      return r.rows;
    }, "โหลดกอง \"วันนี้ต้องโพสต์\" ไม่สำเร็จ"),
    part(
      "posts.count",
      async () => {
        const { data, error } = await db.from("v_content_inbox_counts").select("post_today").eq("shop_id", shop).maybeSingle();
        if (error) throw error;
        return Number((data as Record<string, unknown> | null)?.post_today ?? 0);
      },
      "โหลดตัวเลขกองไม่สำเร็จ"
    ),
    part(
      "posts.orphans",
      async () => {
        const { data, error } = await db
          .from("content_post")
          .select("id, platform, post_url, posted_at, posted_date_th, caption_snapshot")
          .eq("shop_id", shop)
          .eq("status", "active")
          .is("step_id", null)
          .in("platform", LINKABLE_PLATFORMS)
          .order("posted_at", { ascending: false })
          .limit(ORPHAN_LIMIT);
        if (error) throw error;
        const rows = asRows(data)
          .map(mapOrphanPost)
          .filter((p): p is OrphanPost => p !== null);
        return { rows, truncated: Array.isArray(data) && data.length >= ORPHAN_LIMIT };
      },
      "โหลดโพสต์ที่ยังไม่ผูกชิ้นงานไม่สำเร็จ"
    ),
    part("posts.types", () => loadContentTypeOptions(), "โหลดชนิดเนื้อหาไม่สำเร็จ"),
  ]);

  // ผู้สมัครผูก — โหลดเมื่อมีโพสต์ค้างเท่านั้น (v_content_piece ช้าต่อแถว D15)
  const hasOrphans = orphans.ok && orphans.data.rows.length > 0;
  const candidates = hasOrphans
    ? await part(
        "posts.candidates",
        async () => {
          const since = postedSince(todayTh);
          const { data, error } = await db
            .from("v_content_piece")
            .select(PIECE_LIGHT_COLUMNS)
            .eq("shop_id", shop)
            .in("piece_kind", LINKABLE_KINDS)
            .or(`piece_status.in.(approved,produced),and(piece_status.eq.posted,piece_kind.eq.ig_fb_post,posted_on.gte.${since})`)
            .order("resolved_start", { ascending: true, nullsFirst: false })
            .order("step_id", { ascending: true })
            .limit(CANDIDATE_LIMIT);
          if (error) throw error;
          return asRows(data).map(mapPieceRow);
        },
        "โหลดรายการชิ้นงานที่ผูกได้ไม่สำเร็จ"
      )
    : ({ ok: true, data: [] as PieceRow[] } as { ok: true; data: PieceRow[] });

  return {
    ok: true,
    data: {
      todayTh,
      postRows,
      postCount,
      overdueNoLinkIds: overdueIds,
      orphans,
      candidates,
      contentTypes: types.ok ? types.data : [],
    },
  };
}

/** ผูกโพสต์ที่อยู่นอกแผนเข้ากับชิ้นงาน (content_post_link_step) — DB ตัดสินทุกด่าน (ช่องทาง/สถานะ/ซ้ำ/เวลาโพสต์) */
export async function linkOrphanPost(postId: string, stepId: string, hookId?: string | null): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(postId)) return { ok: false, error: "ไม่พบโพสต์" };
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  if (hookId !== undefined && hookId !== null && !isUuid(hookId)) return { ok: false, error: "เลือก hook ไม่ถูกต้อง" };

  const res = await callRpc(
    "content_post_link_step",
    { p_post_id: postId, p_step_id: stepId, p_hook_id: hookId ?? null },
    "ผูกโพสต์กับชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  revalidatePath("/marketing");
  revalidatePath("/marketing/posts");
  revalidatePath(`/marketing/pieces/${stepId}`);
  return { ok: true, data: undefined };
}
