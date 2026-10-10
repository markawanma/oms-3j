import { describe, expect, it } from "vitest";
import { linkChoiceFor, mapOrphanPost, sortLinkCandidates } from "./post-orphans";
import type { PieceRow } from "./piece-types";

const piece = (o: Partial<PieceRow>): PieceRow =>
  ({ stepId: "s", title: "t", pieceStatus: "approved", pieceKind: "short_clip", holdReason: null, posts: [], resolvedStart: "2026-10-10", ...o }) as PieceRow;
const active = (platform: string) => ({ postId: "p", platform, postUrl: "x", postedAt: null, status: "active", hookId: null });

describe("mapOrphanPost", () => {
  it("แถวครบ → map · ขาด id/platform/url → null (ไม่เดา)", () => {
    expect(mapOrphanPost({ id: "a", platform: "tiktok", post_url: "https://x", posted_at: "2026-10-09T10:00:00Z", posted_date_th: "2026-10-09", caption_snapshot: null })).toMatchObject({ postId: "a", platform: "tiktok", postedDateTh: "2026-10-09", caption: null });
    expect(mapOrphanPost({ id: "a", platform: "tiktok" })).toBeNull();
    expect(mapOrphanPost({ platform: "tiktok", post_url: "u" })).toBeNull();
    expect(mapOrphanPost({ id: "a", platform: "", post_url: "u" })).toBeNull();
  });
});

describe("linkChoiceFor — ตรงกับด่าน content_post_link_step", () => {
  it("ผูกได้: คลิป approved/produced กับโพสต์ TikTok · ig_fb_post กับ FB/IG", () => {
    expect(linkChoiceFor(piece({}), { platform: "tiktok" }).ok).toBe(true);
    expect(linkChoiceFor(piece({ pieceStatus: "produced", pieceKind: "live_cut" }), { platform: "tiktok" }).ok).toBe(true);
    expect(linkChoiceFor(piece({ pieceKind: "ig_fb_post" }), { platform: "facebook" }).ok).toBe(true);
    expect(linkChoiceFor(piece({ pieceKind: "ig_fb_post" }), { platform: "instagram" }).ok).toBe(true);
  });

  it("ig_fb_post ที่โพสต์แล้ว ผูกใบที่ 2 ได้ · คลิปที่โพสต์แล้วผูกไม่ได้", () => {
    expect(linkChoiceFor(piece({ pieceStatus: "posted", pieceKind: "ig_fb_post", posts: [active("facebook")] }), { platform: "instagram" }).ok).toBe(true);
    const r = linkChoiceFor(piece({ pieceStatus: "posted" }), { platform: "tiktok" });
    expect(r.ok).toBe(false);
  });

  it("ห้ามผ่าน: ช่องทางไม่ตรงชนิด · มีโพสต์ช่องเดียวกันแล้ว · ถูกพัก · สถานะยังไม่ถึง · ชนิด LINE/สตอรี่/ไม่ระบุ", () => {
    const cases: [Partial<PieceRow>, string, RegExp][] = [
      [{}, "facebook", /ผูกกับโพสต์ Facebook ไม่ได้/],
      [{ pieceKind: "ig_fb_post" }, "tiktok", /ผูกกับโพสต์ TikTok ไม่ได้/],
      [{ posts: [active("tiktok")] }, "tiktok", /มีโพสต์ TikTok อยู่แล้ว/],
      [{ holdReason: "รอภาพ" }, "tiktok", /รอเงื่อนไข/],
      [{ pieceStatus: "in_review" }, "tiktok", /อนุมัติแล้ว/],
      [{ pieceStatus: "cancelled" }, "tiktok", /อนุมัติแล้ว/],
      [{ pieceKind: "line_message" }, "tiktok", /ไม่มีลิงก์โพสต์/],
      [{ pieceKind: "story" }, "instagram", /ไม่มีลิงก์โพสต์/],
      [{ pieceKind: null }, "tiktok", /ไม่มีลิงก์โพสต์/],
    ];
    for (const [o, platform, re] of cases) {
      const r = linkChoiceFor(piece(o), { platform });
      expect(r.ok, JSON.stringify(o) + platform).toBe(false);
      expect(!r.ok && r.reason).toMatch(re);
    }
  });

  it("ต้องไม่พัง: โพสต์ที่ถูกลบ (status deleted) ของชิ้นไม่นับว่าซ้ำ", () => {
    const p = piece({ posts: [{ ...active("tiktok"), status: "deleted" }] });
    expect(linkChoiceFor(p, { platform: "tiktok" }).ok).toBe(true);
  });
});

describe("sortLinkCandidates", () => {
  it("ผูกได้ก่อน แล้ววันใกล้ก่อน", () => {
    const list = sortLinkCandidates(
      [
        piece({ stepId: "a", title: "ก", resolvedStart: "2026-10-12", holdReason: "x" }),
        piece({ stepId: "b", title: "ข", resolvedStart: "2026-10-15" }),
        piece({ stepId: "c", title: "ค", resolvedStart: "2026-10-11" }),
        piece({ stepId: "d", title: "ง", resolvedStart: null }),
      ],
      { platform: "tiktok" }
    );
    expect(list.map((x) => x.piece.stepId)).toEqual(["c", "b", "d", "a"]);
  });
});
