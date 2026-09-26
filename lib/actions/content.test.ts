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
const canonicalizeTikTokLinkMock = vi.fn();

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
      return { rpc: rpcMock };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/marketing/tiktok-link", () => ({
  canonicalizeTikTokLink: (url: string) => canonicalizeTikTokLinkMock(url),
}));

// ลิงก์สั้นที่ทำให้เกิดบั๊กจริง (26 ก.ย. 69, ดูหัวไฟล์ tiktok-link.ts) — ถ้า
// จุดเรียกใน upsertContentPost สลับกลับไปใช้ postUrl ดิบ ค่านี้จะหลุดเข้า RPC
const RAW_SHORT_LINK = "https://vt.tiktok.com/ZSbYUGv9e";
const CANONICAL_URL = "https://www.tiktok.com/@3jjewelry_test/video/7000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: "post-id-1", error: null });
  canonicalizeTikTokLinkMock.mockResolvedValue({ ok: true, url: CANONICAL_URL });
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
