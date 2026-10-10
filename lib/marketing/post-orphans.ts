// lib/marketing/post-orphans.ts — โพสต์ที่ยังไม่ผูกชิ้นงาน (content_post.step_id is null) + ตัวเลือกชิ้นงานที่ผูกได้ · แผน §2.6 ค
// pure: ที่นี่คัดตัวเลือก "ไม่ให้เลือกแล้วฟ้อง" ตามกติกาที่ DB บังคับ (content_post_link_step) พร้อมบอกเหตุผลที่ disable — DB ยังเป็นด่านจริง

import { platformsForKind } from "@/lib/marketing/post-link";
import { PIECE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import { PLATFORM_LABEL } from "@/lib/marketing/content-types";
import type { ContentTypeOption, Part, PieceRow } from "@/lib/marketing/piece-types";

export interface OrphanPost {
  postId: string;
  platform: string;
  postUrl: string;
  postedAt: string | null;
  postedDateTh: string | null;
  caption: string | null;
}

function s(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** แถว content_post ดิบ → OrphanPost (id/platform/url ไม่ครบ = ทิ้ง ไม่เดา) */
export function mapOrphanPost(r: Record<string, unknown>): OrphanPost | null {
  const postId = s(r.id);
  const platform = s(r.platform);
  const postUrl = s(r.post_url);
  if (!postId || !platform || !postUrl) return null;
  return { postId, platform, postUrl, postedAt: s(r.posted_at), postedDateTh: s(r.posted_date_th)?.slice(0, 10) ?? null, caption: s(r.caption_snapshot) };
}

export type LinkChoice = { ok: true } | { ok: false; reason: string };

const platformName = (p: string): string => (PLATFORM_LABEL as Record<string, string>)[p] ?? p;
const kindName = (k: string | null): string => (k ? ((PIECE_KIND_LABEL as Record<string, string>)[k] ?? k) : "ยังไม่ระบุ");

/**
 * ชิ้นนี้ผูกกับโพสต์นี้ได้ไหม — ตรงกับด่านใน content_post_link_step (0160):
 * สถานะ approved/produced (หรือ ig_fb_post ที่โพสต์แล้ว) · ไม่ถูกพัก · ช่องทางตรงกับชนิด · ชิ้นยังไม่มีโพสต์ active ช่องนั้น
 */
export function linkChoiceFor(piece: PieceRow, post: Pick<OrphanPost, "platform">): LinkChoice {
  if (piece.holdReason) return { ok: false, reason: "รอเงื่อนไขอยู่ — กดกลับมาทำต่อก่อน" };
  const status = piece.pieceStatus;
  const okStatus = status === "approved" || status === "produced" || (status === "posted" && piece.pieceKind === "ig_fb_post");
  if (!okStatus) return { ok: false, reason: "ผูกได้เฉพาะชิ้นที่อนุมัติแล้ว/ถ่ายแล้ว" };
  const platforms = platformsForKind(piece.pieceKind) as string[];
  if (platforms.length === 0) return { ok: false, reason: `ชนิด ${kindName(piece.pieceKind)} ไม่มีลิงก์โพสต์` };
  if (!platforms.includes(post.platform)) return { ok: false, reason: `ชนิด ${kindName(piece.pieceKind)} ผูกกับโพสต์ ${platformName(post.platform)} ไม่ได้` };
  if (piece.posts.some((p) => p.status === "active" && p.platform === post.platform)) {
    return { ok: false, reason: `ชิ้นนี้มีโพสต์ ${platformName(post.platform)} อยู่แล้ว` };
  }
  return { ok: true };
}

/** เรียงตัวเลือก: ผูกได้ก่อน แล้ววันใกล้โพสต์ก่อน */
export function sortLinkCandidates(pieces: readonly PieceRow[], post: Pick<OrphanPost, "platform">): { piece: PieceRow; choice: LinkChoice }[] {
  return pieces
    .map((piece) => ({ piece, choice: linkChoiceFor(piece, post) }))
    .sort((a, b) => {
      if (a.choice.ok !== b.choice.ok) return a.choice.ok ? -1 : 1;
      return (a.piece.resolvedStart ?? "9999").localeCompare(b.piece.resolvedStart ?? "9999") || a.piece.title.localeCompare(b.piece.title, "th");
    });
}

// ---------------------------------------------------------------------------
// รูปข้อมูลของหน้า /marketing/posts (แต่ละส่วนล้มอิสระ)
// ---------------------------------------------------------------------------

export interface PostsPageData {
  todayTh: string;
  /** กอง "วันนี้ต้องโพสต์" — ชุดเดียวกับหน้า "งานที่รอฉัน" */
  postRows: Part<PieceRow[]>;
  postCount: Part<number>;
  overdueNoLinkIds: string[];
  orphans: Part<{ rows: OrphanPost[]; truncated: boolean }>;
  /** ชิ้นที่อาจผูกได้ (โหลดเมื่อมีโพสต์ค้างเท่านั้น) */
  candidates: Part<PieceRow[]>;
  contentTypes: ContentTypeOption[];
}
