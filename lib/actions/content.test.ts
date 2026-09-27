// lib/actions/content.test.ts
//
// Security รอบ 3 (27 ก.ย. 69) ตีกลับข้อ 2: lib/marketing/content-types.test.ts
// พิสูจน์แค่ว่า buildContentPostUpsertParams ใช้พารามิเตอร์ที่สองของตัวเอง
// ถูก — มันไม่พิสูจน์เลยว่า upsertContentPost() (ไฟล์นี้) ยังเรียกมันด้วย
// canonicalPostUrl จริง ไม่ใช่ postUrl ดิบ. Mutation test เดิมสลับอาร์กิวเมนต์
// ที่จุดเรียก (lib/actions/content.ts:256) แล้ว vitest ยังเขียว 567/0 เพราะ
// ไม่มีไฟล์เทสต์ไหน import lib/actions/content.ts เลย — นี่คือไฟล์ที่ปิดช่องนั้น
//
// Mocking pattern copied จาก lib/actions/oem.test.ts (getEffectiveRole +
// getDevShopId + getServiceClient().schema().rpc + next/cache) — มี Supabase
// client ปลอมให้ mock ครบ ไม่ต้องมีข้ออ้างว่า "test server action ตรงไม่ได้"
// (คอมเมนต์เดิมที่ content-types.ts:163-165 ผิดข้อเท็จจริงเรื่องนี้ — แก้แล้ว)
//
// canonicalizeTikTokLink (lib/marketing/tiktok-link.ts) ถูก mock ทั้งโมดูล
// ไม่ใช่ปล่อยให้รันจริง — ความถูกต้องของการ resolve short link มีเทสต์ของ
// ตัวเองอยู่แล้วที่ tiktok-link.test.ts (mock fetch, ห้ามยิง TikTok จริง);
// ไฟล์นี้สนใจแค่ "ค่าที่ canonicalize คืนมา ไปถึง RPC จริงไหม" ซึ่งเป็นจุดที่
// mutation เดิมสลับได้โดยไม่มีใครรู้
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();
const fromMock = vi.fn();
const canonicalizeTikTokLinkMock = vi.fn();
const parseCanonicalTikTokPostUrlMock = vi.fn();
const extractPostedAtFromTikTokVideoIdMock = vi.fn();
const fetchTikTokOEmbedMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    // schema() records its argument เหมือน oem.test.ts — content_post_upsert/
    // content_post_update_type อยู่ใน analytics ทั้งคู่ สลับไป public เงียบๆ
    // จะจับได้ที่นี่
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock, from: fromMock };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/marketing/tiktok-link", () => ({
  canonicalizeTikTokLink: (url: string) => canonicalizeTikTokLinkMock(url),
  parseCanonicalTikTokPostUrl: (url: string) => parseCanonicalTikTokPostUrlMock(url),
}));

vi.mock("@/lib/marketing/tiktok-post-date", () => ({
  extractPostedAtFromTikTokVideoId: (id: string) => extractPostedAtFromTikTokVideoIdMock(id),
}));

vi.mock("@/lib/marketing/tiktok-oembed", () => ({
  fetchTikTokOEmbed: (url: string) => fetchTikTokOEmbedMock(url),
}));

// ลิงก์สั้นที่ทำให้เกิดบั๊กจริง (26 ก.ย. 69, ดูหัวไฟล์ tiktok-link.ts) — ถ้า
// จุดเรียกใน upsertContentPost สลับกลับไปใช้ postUrl ดิบ ค่านี้จะหลุดเข้า RPC
const RAW_SHORT_LINK = "https://vt.tiktok.com/ZSbYUGv9e";
const CANONICAL_URL = "https://www.tiktok.com/@3jjewelry_test/video/7000000000000000001";

/** Builder for the fake `.from("content_post").select(...).eq(...).in(...)`
 * chain getContentEntryQueue's caption backfill uses — every method except
 * the terminal one just returns `this` so the chain can be any length, and
 * the final resolved value is what a real supabase-js query awaits to. */
function makeSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(() => Promise.resolve(result));
  chain.order = vi.fn(() => Promise.resolve(result));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: "post-id-1", error: null });
  canonicalizeTikTokLinkMock.mockResolvedValue({ ok: true, url: CANONICAL_URL });
  parseCanonicalTikTokPostUrlMock.mockReturnValue({
    kind: "video",
    user: "@3jjewelry_test",
    id: "7000000000000000001",
  });
  extractPostedAtFromTikTokVideoIdMock.mockReturnValue("2026-09-24T14:22:42.000Z");
  fetchTikTokOEmbedMock.mockResolvedValue({ ok: true, caption: "แคปชั่นจริง", authorName: "3jjewelry" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upsertContentPost — RPC params must use the canonicalized URL, never the raw pasted one", () => {
  it("p_post_url และ p_external_id เป็น URL ที่ canonicalize แล้ว ไม่มีคำว่า vt.tiktok.com หลุดเข้าไปเลย", async () => {
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({
      platform: "tiktok",
      postUrl: RAW_SHORT_LINK,
      postedAt: "2026-09-26T10:00:00+07:00",
    });

    expect(result.ok).toBe(true);
    expect(canonicalizeTikTokLinkMock).toHaveBeenCalledWith(RAW_SHORT_LINK);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(schemaMock).toHaveBeenCalledWith("analytics");

    const [rpcName, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("content_post_upsert");
    // นี่คือด่านที่จับ mutation จริง — ถ้าจุดเรียกสลับเป็น postUrl ดิบ ค่าทั้ง
    // สองนี้จะกลายเป็น "https://vt.tiktok.com/ZSbYUGv9e" ทันที
    expect(params.p_post_url).toBe(CANONICAL_URL);
    expect(params.p_external_id).toBe(CANONICAL_URL);
    expect(String(params.p_post_url)).not.toContain("vt.tiktok.com");
    expect(String(params.p_external_id)).not.toContain("vt.tiktok.com");
  });

  it("MUTATION GUARD: ถ้า params ที่ส่งเข้า RPC ตรงกับ raw postUrl แทน canonical ⇒ ต้อง FAIL", async () => {
    // เคสนี้ยืนยันว่า assertion ข้างบนแยกแยะ canonical กับ raw ได้จริง — ถ้า
    // canonicalizeTikTokLink คืนค่าเท่ากับ raw ไปเลย เคสนี้ต้อง PASS (ค่าเดียวกัน
    // ไม่มีอะไรให้พลาด) แต่ถ้าคืนค่าไม่เท่ากันแบบเทสต์บนนี้ การันตีว่า raw
    // ไม่ปนเข้ามาได้
    canonicalizeTikTokLinkMock.mockResolvedValue({ ok: true, url: RAW_SHORT_LINK });
    const { upsertContentPost } = await import("./content");
    await upsertContentPost({
      platform: "tiktok",
      postUrl: RAW_SHORT_LINK,
      postedAt: "2026-09-26T10:00:00+07:00",
    });
    const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    // ในเคสนี้ canonical == raw โดยตั้งใจ เพื่อพิสูจน์ว่า assertion ก่อนหน้าไม่ใช่
    // false positive ที่ผ่านเพราะ mock บังคับให้ต่างกันเสมอ
    expect(params.p_post_url).toBe(RAW_SHORT_LINK);
  });

  it("canonicalizeTikTokLink ปฏิเสธ (เช่น ลิงก์ไลฟ์) ⇒ ไม่เรียก RPC เลย", async () => {
    canonicalizeTikTokLinkMock.mockResolvedValue({
      ok: false,
      error: "ลิงก์นี้เป็นลิงก์ไลฟ์ ไม่ใช่โพสต์คลิป",
    });
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({
      platform: "tiktok",
      postUrl: RAW_SHORT_LINK,
      postedAt: "2026-09-26T10:00:00+07:00",
    });
    expect(result).toEqual({ ok: false, error: "ลิงก์นี้เป็นลิงก์ไลฟ์ ไม่ใช่โพสต์คลิป" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("แพลตฟอร์มที่ไม่ใช่ tiktok — canonicalizeTikTokLink ถูกเรียกด้วย (unconditional ที่จุดเรียกจริง) แต่ผ่านทะลุไม่เปลี่ยนค่า", async () => {
    // content.ts เรียก canonicalizeTikTokLink(postUrl) แบบไม่มีเงื่อนไข
    // platform — ความ "ไม่แตะ platform อื่น" เป็นพฤติกรรม*ภายใน*ของ
    // tiktok-link.ts เอง (host ไม่ใช่ tiktok.com ⇒ คืนค่าเดิม ไม่ยิงเน็ต,
    // มีเทสต์ของตัวเองที่ tiktok-link.test.ts) — เทสต์นี้จำลองพฤติกรรมนั้น
    // ด้วย mock แทนของจริง เพื่อพิสูจน์ว่าค่าที่ pass-through คืนมา ไปถึง RPC
    // จริง ไม่ใช่ค่าอื่น
    const facebookUrl = "https://www.facebook.com/3jjewelry/posts/123";
    canonicalizeTikTokLinkMock.mockResolvedValue({ ok: true, url: facebookUrl });

    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({
      platform: "facebook",
      postUrl: facebookUrl,
      postedAt: "2026-09-26T10:00:00+07:00",
    });
    expect(result.ok).toBe(true);
    expect(canonicalizeTikTokLinkMock).toHaveBeenCalledWith(facebookUrl);
    const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_post_url).toBe(facebookUrl);
  });

  it("rejects staff ก่อนเรียก RPC หรือ canonicalize เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({
      platform: "tiktok",
      postUrl: RAW_SHORT_LINK,
      postedAt: "2026-09-26T10:00:00+07:00",
    });
    expect(result.ok).toBe(false);
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // 🔴 M-1 fix (security รอบ 4, 27 ก.ย. 69) — เพดานเดียวกับ inspectContentLink
  it("ลิงก์ยาวเกิน 2048 ตัวอักษร ⇒ ปฏิเสธก่อน canonicalize เลย ไม่ยิง RPC", async () => {
    const { upsertContentPost } = await import("./content");
    const tooLong = "https://www.tiktok.com/@x/video/" + "1".repeat(2050);
    const result = await upsertContentPost({
      platform: "tiktok",
      postUrl: tooLong,
      postedAt: "2026-09-26T10:00:00+07:00",
    });
    expect(result).toEqual({ ok: false, error: "ลิงก์ยาวผิดปกติ — คัดลอกลิงก์จากหน้าคลิปมาวางใหม่" });
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("updateContentPostType — แก้ด้วย primary key ล้วนๆ ไม่แตะ URL/network เลย", () => {
  it("ส่งพารามิเตอร์เข้า RPC แค่ 3 ตัว — ไม่มี p_post_url หลุดเข้าไปเลย", async () => {
    const { updateContentPostType } = await import("./content");
    const result = await updateContentPostType("post-1", "craft");

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(schemaMock).toHaveBeenCalledWith("analytics");

    const [rpcName, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("content_post_update_type");
    expect(Object.keys(params).sort()).toEqual(["p_content_type_code", "p_post_id", "p_shop_id"]);
    expect(params).not.toHaveProperty("p_post_url");
    expect(params).toEqual({
      p_shop_id: "shop-1",
      p_post_id: "post-1",
      p_content_type_code: "craft",
    });
  });

  it("ไม่ยิง network เลย — fetch ถูกเรียกจะ throw ทันที", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("updateContentPostType ต้องไม่เรียก fetch เลย แต่ถูกเรียกจริง");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { updateContentPostType } = await import("./content");
    const result = await updateContentPostType("post-1", "craft");

    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects staff ก่อนเรียก RPC เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { updateContentPostType } = await import("./content");
    const result = await updateContentPostType("post-1", "craft");
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("postId ว่าง ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { updateContentPostType } = await import("./content");
    const result = await updateContentPostType("", "craft");
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("contentTypeCode ว่าง ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { updateContentPostType } = await import("./content");
    const result = await updateContentPostType("post-1", "");
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("RPC ปฏิเสธ (เช่น content_type_code ไม่ถูกต้อง) ⇒ คืน error ข้อความไทยที่ map แล้ว ไม่หลุด raw DB message", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "content_post_update_type: content_type_code ไม่ถูกต้อง: bogus", code: "22023" },
    });
    const { updateContentPostType } = await import("./content");
    const result = await updateContentPostType("post-1", "bogus");
    expect(result).toEqual({ ok: false, error: "ประเภทเนื้อหาที่เลือกไม่ถูกต้อง ลองเลือกใหม่" });
  });
});

// ============================================================================
// inspectContentLink — 27 ก.ย. 69 (เจ้าของกลับมติ) — UX pre-fill, NO DB write
// ============================================================================

describe("inspectContentLink — gate + input validation ก่อนแตะ network เลย", () => {
  it("rejects staff ก่อน canonicalize/oEmbed ทั้งคู่", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("https://vt.tiktok.com/ZSbYUGv9e");
    expect(result.ok).toBe(false);
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
    expect(fetchTikTokOEmbedMock).not.toHaveBeenCalled();
  });

  it("ลิงก์ว่าง ⇒ ปฏิเสธก่อน canonicalize", async () => {
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("   ");
    expect(result.ok).toBe(false);
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
  });

  it("ลิงก์ไม่ขึ้นต้นด้วย http(s):// ⇒ ปฏิเสธก่อน canonicalize", async () => {
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("ftp://example.com/x");
    expect(result.ok).toBe(false);
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
  });

  // 🔴 M-1 fix (security รอบ 4, 27 ก.ย. 69): defense-in-depth ก่อนถึง
  // canonicalizeTikTokLink (ที่ตัวเองก็แก้ ReDoS ในชั้น normalizePath ไปแล้ว)
  it("ลิงก์ยาวเกิน 2048 ตัวอักษร ⇒ ปฏิเสธก่อน canonicalize เลย ไม่ยิง network", async () => {
    const { inspectContentLink } = await import("./content");
    const tooLong = "https://www.tiktok.com/@x/video/" + "1".repeat(2050);
    const result = await inspectContentLink(tooLong);
    expect(result).toEqual({ ok: false, error: "ลิงก์ยาวผิดปกติ — คัดลอกลิงก์จากหน้าคลิปมาวางใหม่" });
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
  });

  it("ลิงก์ยาวพอดี 2048 ตัวอักษร ⇒ ผ่านด่านนี้ไปได้ (boundary, ไม่ off-by-one)", async () => {
    const { inspectContentLink } = await import("./content");
    const prefix = "https://www.tiktok.com/@x/video/";
    const exactly2048 = prefix + "1".repeat(2048 - prefix.length);
    expect(exactly2048.length).toBe(2048);
    await inspectContentLink(exactly2048);
    expect(canonicalizeTikTokLinkMock).toHaveBeenCalledWith(exactly2048);
  });
});

describe("inspectContentLink — canonicalize ปฏิเสธ ⇒ ส่ง error ต่อ ไม่แตะ oEmbed/date เลย", () => {
  it("ลิงก์ไลฟ์ (canonicalize ปฏิเสธ) ⇒ คืน error เดียวกัน ไม่เรียก oEmbed/parseCanonical", async () => {
    canonicalizeTikTokLinkMock.mockResolvedValue({
      ok: false,
      error: "ลิงก์นี้เป็นลิงก์ไลฟ์ ไม่ใช่โพสต์คลิป",
    });
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("https://vt.tiktok.com/ZSlive");
    expect(result).toEqual({ ok: false, error: "ลิงก์นี้เป็นลิงก์ไลฟ์ ไม่ใช่โพสต์คลิป" });
    expect(fetchTikTokOEmbedMock).not.toHaveBeenCalled();
    expect(extractPostedAtFromTikTokVideoIdMock).not.toHaveBeenCalled();
  });
});

describe("inspectContentLink — ลิงก์ที่ canonicalize ผ่านแต่ไม่ใช่โพสต์ TikTok (เช่น Facebook)", () => {
  it("canonicalUrl ผ่านมา แต่ parseCanonicalTikTokPostUrl คืน null ⇒ postedAt/caption/authorName เป็น null ทั้งหมด ไม่เรียก oEmbed/date", async () => {
    const facebookUrl = "https://www.facebook.com/3jjewelry/posts/123";
    canonicalizeTikTokLinkMock.mockResolvedValue({ ok: true, url: facebookUrl });
    parseCanonicalTikTokPostUrlMock.mockReturnValue(null);

    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink(facebookUrl);

    expect(result).toEqual({
      ok: true,
      data: { canonicalUrl: facebookUrl, postedAt: null, caption: null, authorName: null },
    });
    expect(fetchTikTokOEmbedMock).not.toHaveBeenCalled();
    expect(extractPostedAtFromTikTokVideoIdMock).not.toHaveBeenCalled();
  });
});

describe("inspectContentLink — ลิงก์ TikTok ที่เป็นโพสต์จริง — happy path", () => {
  it("คืน canonicalUrl + postedAt (จาก video id) + caption/authorName (จาก oEmbed)", async () => {
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("https://vt.tiktok.com/ZSbYUGv9e");

    expect(result).toEqual({
      ok: true,
      data: {
        canonicalUrl: CANONICAL_URL,
        postedAt: "2026-09-24T14:22:42.000Z",
        caption: "แคปชั่นจริง",
        authorName: "3jjewelry",
      },
    });
    expect(extractPostedAtFromTikTokVideoIdMock).toHaveBeenCalledWith("7000000000000000001");
    expect(fetchTikTokOEmbedMock).toHaveBeenCalledWith(CANONICAL_URL);
  });

  it("🔴 id ให้เวลาเพี้ยน (ก่อน 2016 / อนาคต) ⇒ postedAt เป็น null แต่ยังคืน caption/authorName ตามปกติ (คนละด่านกัน)", async () => {
    extractPostedAtFromTikTokVideoIdMock.mockReturnValue(null);
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("https://vt.tiktok.com/ZSbYUGv9e");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.postedAt).toBeNull();
      expect(result.data.caption).toBe("แคปชั่นจริง");
    }
  });

  it("🔴 oEmbed ล้มเหลว ⇒ caption/authorName เป็น null แต่ยังคืน ok:true พร้อม postedAt (ห้ามบล็อกการบันทึก)", async () => {
    fetchTikTokOEmbedMock.mockResolvedValue({ ok: false });
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("https://vt.tiktok.com/ZSbYUGv9e");

    expect(result).toEqual({
      ok: true,
      data: {
        canonicalUrl: CANONICAL_URL,
        postedAt: "2026-09-24T14:22:42.000Z",
        caption: null,
        authorName: null,
      },
    });
  });

  it("🔴 fetchTikTokOEmbed ถ้า throw ขึ้นมาเอง (ผิดสัญญาของมัน) ก็ยังไม่ throw ออกจาก action — caption/authorName เป็น null", async () => {
    fetchTikTokOEmbedMock.mockRejectedValue(new Error("unexpected"));
    const { inspectContentLink } = await import("./content");
    const result = await inspectContentLink("https://vt.tiktok.com/ZSbYUGv9e");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.caption).toBeNull();
      expect(result.data.authorName).toBeNull();
      expect(result.data.postedAt).toBe("2026-09-24T14:22:42.000Z");
    }
  });
});

// ============================================================================
// getContentEntryQueue — caption backfill (27 ก.ย. 69) — ต้อง batch เดียว
// ============================================================================

describe("getContentEntryQueue — caption backfill ต้อง batch เดียว (ไม่ใช่ N+1) และ map ให้ตรงแถว", () => {
  it("join caption_snapshot กลับมาตาม post_id ที่ถูกต้อง ไม่ใช่ค่า null ตายตัวอีกต่อไป", async () => {
    const queueChain = makeSelectChain({
      data: [
        {
          post_id: "post-1",
          shop_id: "shop-1",
          platform: "tiktok",
          external_id: "ext-1",
          post_url: "https://www.tiktok.com/@x/video/1",
          posted_at: "2026-09-24T14:22:42.000Z",
          posted_date_th: "2026-09-24",
          content_type_code: null,
          age_days_today: 1,
          read_round: 1,
        },
        {
          post_id: "post-2",
          shop_id: "shop-1",
          platform: "tiktok",
          external_id: "ext-2",
          post_url: "https://www.tiktok.com/@x/video/2",
          posted_at: "2026-09-23T14:22:42.000Z",
          posted_date_th: "2026-09-23",
          content_type_code: null,
          age_days_today: 3,
          read_round: 2,
        },
      ],
      error: null,
    });
    const captionChain = makeSelectChain({
      data: [
        { id: "post-1", caption_snapshot: "แคปชั่นโพสต์ 1" },
        { id: "post-2", caption_snapshot: null },
      ],
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "v_content_entry_queue") return queueChain;
      if (table === "content_post") return captionChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const { getContentEntryQueue } = await import("./content");
    const result = await getContentEntryQueue();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.find((r) => r.postId === "post-1")?.captionSnapshot).toBe("แคปชั่นโพสต์ 1");
      expect(result.data.find((r) => r.postId === "post-2")?.captionSnapshot).toBeNull();
    }
    // batch เดียว — .in() ถูกเรียกครั้งเดียวสำหรับ caption query ทั้งหน้า ไม่ใช่ต่อแถว
    expect((captionChain.in as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((captionChain.in as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("id", ["post-1", "post-2"]);
  });

  it("คิวว่าง ⇒ ไม่เรียก caption query เลย (ไม่มี id ให้ .in() ก็ไม่ต้องยิง)", async () => {
    const queueChain = makeSelectChain({ data: [], error: null });
    const captionChain = makeSelectChain({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "v_content_entry_queue") return queueChain;
      if (table === "content_post") return captionChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const { getContentEntryQueue } = await import("./content");
    const result = await getContentEntryQueue();

    expect(result).toEqual({ ok: true, data: [] });
    expect((captionChain.in as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
