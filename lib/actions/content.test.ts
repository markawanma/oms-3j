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

// QA I1/I2 (7 ต.ค. 69): คิวเดิมของ DB ไม่ตรวจขอบเขต posted_at — '-infinity'/1990 ทำ view พังทั้งร้าน
// ⇒ ด่านชั้นแอปต้องตัดก่อนถึง RPC (ไม่ canonicalize ไม่ยิงเน็ตด้วย) และเคสวันปกติต้องไม่พัง
describe("upsertContentPost — posted_at ต้อง parse ได้และอยู่ในช่วง 2025-01-01 ถึงพรุ่งนี้", () => {
  const BAD = "วันที่โพสต์ไม่ถูกต้อง";
  const rejects: Array<[string, string]> = [
    ["-infinity", "-infinity"],
    ["infinity", "infinity"],
    ["ข้อความที่ไม่ใช่วันที่", "abc"],
    ["ปี 1990", "1990-01-01T00:00:00+07:00"],
    ["ก่อนขอบล่าง 1 วินาที (2024-12-31 23:59:59 ไทย)", "2024-12-31T23:59:59+07:00"],
    ["อนาคต +2 วัน", new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()],
  ];

  it.each(rejects)("ปฏิเสธ %s ⇒ ไม่แตะ canonicalize/RPC เลย", async (_label, postedAt) => {
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt });
    expect(result).toEqual({ ok: false, error: BAD });
    expect(canonicalizeTikTokLinkMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ค่าว่าง ⇒ ข้อความเดิม 'กรุณาระบุวันที่โพสต์' (ไม่ถูกกลบด้วยข้อความใหม่)", async () => {
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt: "" });
    expect(result).toEqual({ ok: false, error: "กรุณาระบุวันที่โพสต์" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ต้องไม่พัง: วันปกติ (2 ชม. ก่อน) · ขอบล่าง 2025-01-01 00:00 ไทยพอดี · +12 ชม. ⇒ ผ่าน และส่ง ISO ที่ parse แล้วเข้า RPC", async () => {
    const { upsertContentPost } = await import("./content");
    const cases = [
      new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      "2025-01-01T00:00:00+07:00",
      new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    ];
    for (const postedAt of cases) {
      rpcMock.mockClear();
      const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt });
      expect(result.ok).toBe(true);
      const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(params.p_posted_at).toBe(new Date(postedAt).toISOString());
    }
  });

  it("สตริงที่ไม่มี timezone ถูก normalize เป็น ISO UTC — ค่าที่ตรวจ = ค่าที่เขียน (ไม่ให้ Postgres ตีความเอง)", async () => {
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt: "2026-09-26T10:00" });
    expect(result.ok).toBe(true);
    const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_posted_at).toBe(new Date("2026-09-26T10:00").toISOString());
  });
});

// map error ของ content_post_upsert (0160): 55000 = โพสต์ผูกชิ้นงานแล้ว (ลองใหม่ไม่ช่วย) · 22023 จาก trigger
// ข้อความต้องตายตัว — ห้ามส่ง message/detail ดิบของ DB ถึง client (memory supabase-error-logging-trap)
describe("upsertContentPost — map error จาก RPC/trigger ของ 0160", () => {
  const OK_DATE = "2026-09-26T10:00:00+07:00";
  const RAW_LEAK = "https://www.tiktok.com/@secret/video/1?_t=SESSIONTOKEN ชื่อภายใน";

  it("55000 ⇒ ข้อความไทยตายตัวบอกให้แก้ผ่านหน้าชิ้นงาน (ไม่ใช่ 'ลองใหม่') และไม่รั่ว message ดิบ", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: `โพสต์นี้ผูกชิ้นงาน ${RAW_LEAK}`, details: RAW_LEAK } });
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt: OK_DATE });
    expect(result).toEqual({ ok: false, error: "โพสต์นี้ผูกกับชิ้นงานแล้ว แก้การผูกผ่านหน้าชิ้นงาน" });
    expect(JSON.stringify(result)).not.toContain("SESSIONTOKEN");
    // log ก็ต้องไม่มี URL ดิบ (redactUrls) — ไม่ log error ทั้งก้อน
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SESSIONTOKEN");
    spy.mockRestore();
  });

  it("22023 จาก trigger posted_at นอกช่วง ⇒ ข้อความไทยเฉพาะเรื่อง ไม่ตกไป fallback", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "โพสต์ที่ผูกชิ้นงานแล้ว เวลาโพสต์ต้องอยู่ในช่วง 2025-01-01 ถึงวันนี้" },
    });
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt: OK_DATE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("วันที่โพสต์ไม่ถูกต้อง");
      expect(result.error).not.toContain("ลองใหม่");
    }
    spy.mockRestore();
  });

  it("error อื่นที่ไม่รู้จัก ⇒ ยังตก fallback เดิม 'บันทึกลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง' (ต้องไม่พัง)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const { upsertContentPost } = await import("./content");
    const result = await upsertContentPost({ platform: "tiktok", postUrl: RAW_SHORT_LINK, postedAt: OK_DATE });
    expect(result).toEqual({ ok: false, error: "บันทึกลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    spy.mockRestore();
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

// ============================================================================
// getContentPostHistory — /marketing/content/history (27 ก.ย. 69, ระดับ S)
// ============================================================================

/** Builder for a fake query chain terminating at a specific method — same
 * "every non-terminal method returns `this`" shape as makeSelectChain
 * above, generalized because getContentPostHistory's two queries end on
 * DIFFERENT methods (content_post ends on `.limit()`, content_post_metric
 * ends on `.order()`), unlike every existing caller of makeSelectChain. */
function makeChain(result: { data: unknown; error: unknown }, terminalMethod: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "order", "in", "limit"]) {
    chain[m] = m === terminalMethod ? vi.fn(() => Promise.resolve(result)) : vi.fn(self);
  }
  return chain;
}

describe("getContentPostHistory — scope, latest-metric-per-post, ไม่ N+1", () => {
  it("rejects staff ก่อนเรียก query ใดๆ เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getContentPostHistory } = await import("./content");
    const result = await getContentPostHistory();
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("scope ด้วย shop_id + status=active, เรียง posted_at ใหม่ไปเก่า, จำกัด HISTORY_LIMIT", async () => {
    const postChain = makeChain({ data: [], error: null }, "limit");
    fromMock.mockImplementation((table: string) => {
      if (table === "content_post") return postChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const { getContentPostHistory } = await import("./content");
    const result = await getContentPostHistory();

    expect(result).toEqual({ ok: true, data: [] });
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(postChain.eq).toHaveBeenNthCalledWith(1, "shop_id", "shop-1");
    expect(postChain.eq).toHaveBeenNthCalledWith(2, "status", "active");
    expect(postChain.order).toHaveBeenCalledWith("posted_at", { ascending: false });
    expect(postChain.limit).toHaveBeenCalledWith(50);
    // ไม่มีโพสต์เลย ⇒ ไม่มี post_id ให้ .in() ก็ไม่ต้องยิง metric query เลย
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("เลือก metric ล่าสุดถูกต้องเมื่อมีหลายรอบ (captured_on มากสุดต่อโพสต์ ไม่ใช่แถวแรกที่เจอ)", async () => {
    const postChain = makeChain(
      {
        data: [
          {
            id: "post-a",
            platform: "tiktok",
            post_url: "https://www.tiktok.com/@x/video/1",
            posted_at: "2026-09-20T10:00:00Z",
            posted_date_th: "2026-09-20",
            content_type_code: null,
            caption_snapshot: null,
          },
          {
            id: "post-b",
            platform: "tiktok",
            post_url: "https://www.tiktok.com/@x/video/2",
            posted_at: "2026-09-19T10:00:00Z",
            posted_date_th: "2026-09-19",
            content_type_code: null,
            caption_snapshot: null,
          },
        ],
        error: null,
      },
      "limit"
    );
    // จำลองผลลัพธ์ที่ .order("captured_on", desc) จริงจะคืนมา — เรียงจาก
    // captured_on มากสุดไปน้อยสุด "ข้ามโพสต์" (สลับกันเหมือนของจริง ไม่ใช่
    // กลุ่มตาม post_id) เพื่อพิสูจน์ว่าตัวคัดใช้ "แถวแรกที่เจอต่อ post_id"
    // ถูกต้อง ไม่ใช่บังเอิญถูกเพราะ mock data มากลุ่มเรียงสวยอยู่แล้ว
    const metricChain = makeChain(
      {
        data: [
          { post_id: "post-a", captured_on: "2026-09-26", view_count: 500, like_count: null, comment_count: null, save_count: null, share_count: null },
          { post_id: "post-b", captured_on: "2026-09-25", view_count: 50, like_count: 5, comment_count: null, save_count: null, share_count: null },
          { post_id: "post-a", captured_on: "2026-09-20", view_count: 100, like_count: null, comment_count: null, save_count: null, share_count: null },
        ],
        error: null,
      },
      "order"
    );
    fromMock.mockImplementation((table: string) => {
      if (table === "content_post") return postChain;
      if (table === "content_post_metric") return metricChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const { getContentPostHistory } = await import("./content");
    const result = await getContentPostHistory();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const postA = result.data.find((r) => r.postId === "post-a");
    const postB = result.data.find((r) => r.postId === "post-b");
    // post-a ต้องได้แถว captured_on=2026-09-26 (view=500) ไม่ใช่แถวเก่ากว่า
    // (captured_on=2026-09-20, view=100) แม้จะมาทีหลังใน array ก็ตาม
    expect(postA?.latestMetric).toEqual({
      capturedOn: "2026-09-26",
      view: 500,
      like: null,
      comment: null,
      save: null,
      share: null,
    });
    expect(postB?.latestMetric).toEqual({
      capturedOn: "2026-09-25",
      view: 50,
      like: 5,
      comment: null,
      save: null,
      share: null,
    });
  });

  it("โพสต์ที่ไม่เคยมี metric เลย ⇒ latestMetric เป็น null ไม่ error", async () => {
    const postChain = makeChain(
      {
        data: [
          {
            id: "post-no-metric",
            platform: "facebook",
            post_url: "https://www.facebook.com/x/posts/1",
            posted_at: "2026-09-20T10:00:00Z",
            posted_date_th: "2026-09-20",
            content_type_code: "craft",
            caption_snapshot: "แคปชั่น",
          },
        ],
        error: null,
      },
      "limit"
    );
    const metricChain = makeChain({ data: [], error: null }, "order");
    fromMock.mockImplementation((table: string) => {
      if (table === "content_post") return postChain;
      if (table === "content_post_metric") return metricChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const { getContentPostHistory } = await import("./content");
    const result = await getContentPostHistory();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].latestMetric).toBeNull();
    expect(result.data[0].captionSnapshot).toBe("แคปชั่น");
  });

  it("ไม่ใช่ N+1 — หลายโพสต์ก็ยิง metric query แค่ครั้งเดียว แบบ batch เดียวกับ postIds ทั้งหมด", async () => {
    const postChain = makeChain(
      {
        data: [
          { id: "p1", platform: "tiktok", post_url: "https://www.tiktok.com/@x/video/1", posted_at: "2026-09-20T10:00:00Z", posted_date_th: "2026-09-20", content_type_code: null, caption_snapshot: null },
          { id: "p2", platform: "tiktok", post_url: "https://www.tiktok.com/@x/video/2", posted_at: "2026-09-19T10:00:00Z", posted_date_th: "2026-09-19", content_type_code: null, caption_snapshot: null },
          { id: "p3", platform: "tiktok", post_url: "https://www.tiktok.com/@x/video/3", posted_at: "2026-09-18T10:00:00Z", posted_date_th: "2026-09-18", content_type_code: null, caption_snapshot: null },
        ],
        error: null,
      },
      "limit"
    );
    const metricChain = makeChain({ data: [], error: null }, "order");
    fromMock.mockImplementation((table: string) => {
      if (table === "content_post") return postChain;
      if (table === "content_post_metric") return metricChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const { getContentPostHistory } = await import("./content");
    const result = await getContentPostHistory();

    expect(result.ok).toBe(true);
    // รวมทั้งหน้า: 1 query สำหรับโพสต์ + 1 query สำหรับ metric ทั้งหมด = 2
    // ครั้ง ไม่ว่าจะมีกี่โพสต์ก็ตาม (ถ้าเป็น N+1 จะเห็น fromMock ถูกเรียก
    // เพิ่มตามจำนวนโพสต์)
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect((metricChain.in as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((metricChain.in as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("post_id", ["p1", "p2", "p3"]);
  });
});

// ============================================================================
// getContentPostKpiDetail — /marketing/content/history/[postId] (28 ก.ย. 69)
//
// The DECISION logic (which of §4's 6 states, which suggestion) has its own
// full coverage in lib/marketing/content-kpi.test.ts (pure, no mocks). This
// suite only covers what's specific to THIS layer: the UUID gate, the
// not-found contract, that every DB row gets mapped into
// determineContentKpiState()'s input correctly, and — the brief's explicit
// requirement — that this stays a FIXED number of queries (4) no matter how
// many rows the comparison-set/format-wide queries return, i.e. genuinely
// not N+1.
// ============================================================================

const VALID_POST_ID = "11111111-2222-3333-4444-555555555555";

/** Chain builder for v_content_post_t7/content_post's specific method shape
 * here (select/eq/is/order/limit/maybeSingle) — a superset of
 * makeChain()/makeSelectChain() above (neither has `.is()` or
 * `.maybeSingle()`), so a new one rather than stretching those to fit. */
function makeKpiChain(result: { data: unknown; error: unknown; count?: number | null }, terminal: "limit" | "maybeSingle") {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.is = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = terminal === "limit" ? vi.fn(() => Promise.resolve(result)) : vi.fn(self);
  chain.maybeSingle = terminal === "maybeSingle" ? vi.fn(() => Promise.resolve(result)) : vi.fn(self);
  return chain;
}

const EMPTY_POST_ROW = {
  id: VALID_POST_ID,
  platform: "tiktok",
  post_url: "https://www.tiktok.com/@x/video/1",
  posted_at: "2026-09-20T10:00:00Z",
  posted_date_th: "2026-09-20",
  content_type_code: "knowledge",
  caption_snapshot: "แคปชั่นทดสอบ",
};

const T7_WAITING_ROW = {
  t7_view_count: null,
  t7_like_count: null,
  t7_comment_count: null,
  t7_save_count: null,
  t7_share_count: null,
  t7_captured_on: null,
  save_rate: null,
  share_rate: null,
  t7_unavailable_reason: "ยังไม่ถึง 7 วัน",
};

/** Wires up all 4 chains in the exact call order getContentPostKpiDetail's
 * Promise.all evaluates them (content_post, then v_content_post_t7 three
 * times) — see this describe block's own comment on why a call-order
 * counter, not table name alone, is needed to tell those three apart. */
function mockKpiQueries(opts: {
  postChain: ReturnType<typeof makeKpiChain>;
  targetT7Chain: ReturnType<typeof makeKpiChain>;
  comparisonChain: ReturnType<typeof makeKpiChain>;
  formatWideChain: ReturnType<typeof makeKpiChain>;
}) {
  let t7CallCount = 0;
  fromMock.mockImplementation((table: string) => {
    if (table === "content_post") return opts.postChain;
    if (table === "v_content_post_t7") {
      t7CallCount++;
      if (t7CallCount === 1) return opts.targetT7Chain;
      if (t7CallCount === 2) return opts.comparisonChain;
      return opts.formatWideChain;
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

describe("getContentPostKpiDetail — gate + UUID validation", () => {
  it("rejects staff before touching any query", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail(VALID_POST_ID);
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("invalid UUID shape -> {ok:true, data:null} without querying at all (can never match a real row)", async () => {
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail("not-a-uuid");
    expect(result).toEqual({ ok: true, data: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("empty string -> {ok:true, data:null} without querying", async () => {
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail("");
    expect(result).toEqual({ ok: true, data: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("valid UUID shape (uppercase accepted too) reaches the query layer", async () => {
    mockKpiQueries({
      postChain: makeKpiChain({ data: null, error: null }, "maybeSingle"),
      targetT7Chain: makeKpiChain({ data: null, error: null }, "maybeSingle"),
      comparisonChain: makeKpiChain({ data: [], error: null, count: 0 }, "limit"),
      formatWideChain: makeKpiChain({ data: [], error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    await getContentPostKpiDetail(VALID_POST_ID.toUpperCase());
    expect(fromMock).toHaveBeenCalled();
  });
});

describe("getContentPostKpiDetail — not found", () => {
  it("content_post query returns no row -> {ok:true, data:null}, same contract as getCalendarTask", async () => {
    mockKpiQueries({
      postChain: makeKpiChain({ data: null, error: null }, "maybeSingle"),
      targetT7Chain: makeKpiChain({ data: T7_WAITING_ROW, error: null }, "maybeSingle"),
      comparisonChain: makeKpiChain({ data: [], error: null, count: 0 }, "limit"),
      formatWideChain: makeKpiChain({ data: [], error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail(VALID_POST_ID);
    expect(result).toEqual({ ok: true, data: null });
  });

  it("content_post query scoped by shop_id + id + status=active", async () => {
    const postChain = makeKpiChain({ data: null, error: null }, "maybeSingle");
    mockKpiQueries({
      postChain,
      targetT7Chain: makeKpiChain({ data: null, error: null }, "maybeSingle"),
      comparisonChain: makeKpiChain({ data: [], error: null, count: 0 }, "limit"),
      formatWideChain: makeKpiChain({ data: [], error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    await getContentPostKpiDetail(VALID_POST_ID);
    expect(postChain.eq).toHaveBeenCalledWith("shop_id", "shop-1");
    expect(postChain.eq).toHaveBeenCalledWith("id", VALID_POST_ID);
    expect(postChain.eq).toHaveBeenCalledWith("status", "active");
  });
});

describe("getContentPostKpiDetail — maps a real snapshot correctly end-to-end (content.ts's wiring into content-kpi.ts)", () => {
  it("waiting state: header comes from content_post, state comes from v_content_post_t7's reason text", async () => {
    mockKpiQueries({
      postChain: makeKpiChain({ data: EMPTY_POST_ROW, error: null }, "maybeSingle"),
      targetT7Chain: makeKpiChain({ data: T7_WAITING_ROW, error: null }, "maybeSingle"),
      comparisonChain: makeKpiChain({ data: [], error: null, count: 0 }, "limit"),
      formatWideChain: makeKpiChain({ data: [], error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail(VALID_POST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("expected data");
    expect(result.data.header).toEqual({
      postId: VALID_POST_ID,
      platform: "tiktok",
      postUrl: "https://www.tiktok.com/@x/video/1",
      postedAt: "2026-09-20T10:00:00Z",
      postedDateTh: "2026-09-20",
      contentTypeCode: "knowledge",
      captionSnapshot: "แคปชั่นทดสอบ",
    });
    expect(result.data.state.kind).toBe("waiting_t7");
  });

  it("insufficient_global: globalCount comes from the comparison query's exact `count`, NOT data.length (proves count:'exact' is actually read)", async () => {
    const t7Row = {
      t7_view_count: 134,
      t7_like_count: 8,
      t7_comment_count: 2,
      t7_save_count: 1,
      t7_share_count: null,
      t7_captured_on: "2026-09-27",
      save_rate: 0.0075,
      share_rate: null,
      t7_unavailable_reason: null,
    };
    mockKpiQueries({
      postChain: makeKpiChain({ data: EMPTY_POST_ROW, error: null }, "maybeSingle"),
      targetT7Chain: makeKpiChain({ data: t7Row, error: null }, "maybeSingle"),
      // Only 4 rows returned (capped comparison set) but the TRUE count is
      // 4 as well here — separately verified below with a mismatched case.
      comparisonChain: makeKpiChain(
        { data: [{ t7_view_count: 100, save_rate: 0.01 }], error: null, count: 4 },
        "limit"
      ),
      formatWideChain: makeKpiChain({ data: [], error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail(VALID_POST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("expected data");
    expect(result.data.state).toEqual({
      kind: "insufficient_global",
      globalCount: 4,
      clip: {
        viewCount: 134,
        likeCount: 8,
        commentCount: 2,
        saveCount: 1,
        shareCount: null,
        saveRate: 0.0075,
        shareRate: null,
        capturedOn: "2026-09-27",
      },
    });
  });

  it("full state: comparison + format-wide rows get correctly reduced to medians/mean and passed through to determineContentKpiState", async () => {
    const t7Row = {
      t7_view_count: 50,
      t7_like_count: 3,
      t7_comment_count: 0,
      t7_save_count: 4,
      t7_share_count: 1,
      t7_captured_on: "2026-09-27",
      save_rate: 0.08, // high vs comparison median (see below)
      share_rate: 0.02,
      t7_unavailable_reason: null,
    };
    // Median t7_view_count of [10,20,30] = 20 -> clip view 50 is 2.5x -> high
    // Median save_rate of [0.01,0.02,0.03] = 0.02 -> clip save 0.08 is 4x -> high
    // (both high -> §4.8 same-direction -> no single-clip suggestion)
    const comparisonRows = [
      { t7_view_count: 10, save_rate: 0.01 },
      { t7_view_count: 20, save_rate: 0.02 },
      { t7_view_count: 30, save_rate: 0.03 },
    ];
    // Format-wide: 4 rows of the SAME content_type_code ("knowledge") ->
    // formatCount=4 (all-time, no window — matches §4 state table row 5's
    // gate, which names no time window). posted_date_th is deliberately
    // year-2000 on every row so the rolling-28-day baseline (which DOES
    // depend on wall-clock "today" via effectiveDateBangkok(new Date()) in
    // content.ts) is deterministically EMPTY regardless of what date this
    // suite actually runs on — content-kpi.test.ts's fixed-date tests are
    // the ones responsible for proving the baseline arithmetic itself is
    // correct; this test only needs to prove content.ts wires the
    // content_type_code filter correctly (5th "craft" row excluded from
    // formatCount) without becoming flaky against real-world dates.
    const formatWideRows = [
      { content_type_code: "knowledge", save_rate: 0.02, posted_date_th: "2000-01-01" },
      { content_type_code: "knowledge", save_rate: 0.04, posted_date_th: "2000-01-01" },
      { content_type_code: "knowledge", save_rate: 0.06, posted_date_th: "2000-01-01" },
      { content_type_code: "knowledge", save_rate: 0.08, posted_date_th: "2000-01-01" },
      { content_type_code: "craft", save_rate: 0.5, posted_date_th: "2000-01-01" },
    ];
    mockKpiQueries({
      postChain: makeKpiChain({ data: EMPTY_POST_ROW, error: null }, "maybeSingle"),
      targetT7Chain: makeKpiChain({ data: t7Row, error: null }, "maybeSingle"),
      comparisonChain: makeKpiChain({ data: comparisonRows, error: null, count: 10 }, "limit"),
      formatWideChain: makeKpiChain({ data: formatWideRows, error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail(VALID_POST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("expected data");
    const state = result.data.state;
    expect(state.kind).toBe("full");
    if (state.kind !== "full") throw new Error("unreachable");
    expect(state.viewLevel).toBe("high");
    expect(state.saveLevel).toBe("high");
    expect(state.singleClipSuggestion).toBeNull(); // both high -> §4.8, no invented suggestion
    expect(state.formatCount).toBe(4); // "craft" row excluded from the format grouping
    // Every formatWideRows entry is dated year-2000 -> falls outside the
    // rolling-28-day baseline window from whatever "today" really is ->
    // baselineMedianSaveRate is empty -> pickFormatSuggestion has nothing to
    // compare against -> null. This deterministically proves the
    // content_type_code / posted_date_th filters both apply (formatCount=4
    // still counts all-time regardless of date; the baseline specifically
    // does not) without the assertion depending on the real wall-clock date
    // the suite happens to run on.
    expect(state.formatSuggestion).toBeNull();
    expect(state.confidenceBadge).toBe("insufficient"); // no single-clip suggestion either (both high, §4.8)
  });
});

describe("getContentPostKpiDetail — not N+1: exactly 4 queries regardless of comparison/format-wide row counts", () => {
  it("large comparison + format-wide result sets still only call fromMock 4 times total", async () => {
    const t7Row = {
      t7_view_count: 100,
      t7_like_count: 1,
      t7_comment_count: 1,
      t7_save_count: 1,
      t7_share_count: 1,
      t7_captured_on: "2026-09-27",
      save_rate: 0.01,
      share_rate: 0.01,
      t7_unavailable_reason: null,
    };
    const manyComparisonRows = Array.from({ length: 10 }, (_, i) => ({ t7_view_count: 10 + i, save_rate: 0.01 }));
    const manyFormatRows = Array.from({ length: 200 }, (_, i) => ({
      content_type_code: i % 2 === 0 ? "knowledge" : "craft",
      save_rate: 0.01 + i / 10000,
      posted_date_th: "2026-09-01",
    }));
    mockKpiQueries({
      postChain: makeKpiChain({ data: EMPTY_POST_ROW, error: null }, "maybeSingle"),
      targetT7Chain: makeKpiChain({ data: t7Row, error: null }, "maybeSingle"),
      comparisonChain: makeKpiChain({ data: manyComparisonRows, error: null, count: 10 }, "limit"),
      formatWideChain: makeKpiChain({ data: manyFormatRows, error: null }, "limit"),
    });
    const { getContentPostKpiDetail } = await import("./content");
    const result = await getContentPostKpiDetail(VALID_POST_ID);
    expect(result.ok).toBe(true);
    // Exactly 4: content_post + v_content_post_t7(target) +
    // v_content_post_t7(comparison) + v_content_post_t7(format-wide) — never
    // one query per comparison clip, regardless of how many rows exist.
    expect(fromMock).toHaveBeenCalledTimes(4);
  });
});
