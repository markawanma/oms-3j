// lib/actions/gem-quiz-stats.test.ts
//
// QA เพิ่ม (4 ต.ค. 69) — ไม่มีไฟล์เทสต์ไหนครอบ getGemQuizStats()/
// parseGemQuizStats() เลยก่อนหน้านี้ (backend-dev เองยอมรับในรายงานส่งมอบว่า
// "gem_quiz_stats type-guard" ยังไม่มีเทสต์ครอบจริง). ไฟล์นี้ปิดช่องนั้น:
// type guard ที่ parse jsonb จาก RPC ต้อง "คืน null แทน throw" เมื่อ shape ไม่
// ตรงสัญญา (เช่น RPC เปลี่ยนไปโดยไม่มีคนแก้ไฟล์นี้คู่กัน) ไม่ใช่แค่ happy path
//
// Mocking pattern copied จาก lib/actions/content.test.ts (getEffectiveRole +
// getDevShopId + getServiceClient().schema().rpc)
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock }),
  }),
}));

function validStatsPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    respondents: 10,
    by_src: { card: 7, share: 2, live: 0, direct: 1 },
    liked: [{ code: "pearl", label_th: "มุก", price_group: 2, count: 5 }],
    liked_none: 1,
    recommended: [{ code: "ruby", label_th: "ทับทิม", price_group: 2, count: 3 }],
    agreement: { recommended_in_liked: 4, eligible: 9 },
    crosstab: [{ question_code: "q_intent", option_code: "opt_a", stone_code: "pearl", count: 2 }],
    daily: [{ date: "2026-10-01", count: 3 }],
    by_src_liked: [{ src: "card", code: "pearl", count: 5 }],
    ...overrides,
  };
}

const VALID_INPUT = { from: "2026-09-01", to: "2026-10-01", includeRetake: false };

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: validStatsPayload(), error: null });
});

describe("getGemQuizStats — role gate", () => {
  it("staff role ⇒ ปฏิเสธก่อนเรียก RPC เลย", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    getEffectiveRoleMock.mockResolvedValue("staff");
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("owner/admin role ⇒ ผ่านด่าน, เรียก RPC", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("getGemQuizStats — date validation", () => {
  it.each([
    ["2026/10/01", "2026-10-01"],
    ["2026-10-01", "01-10-2026"],
    ["not-a-date", "2026-10-01"],
    ["", "2026-10-01"],
  ])("from=%s to=%s (รูปแบบผิด) ⇒ ปฏิเสธก่อนเรียก RPC", async (from, to) => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const result = await getGemQuizStats({ from, to, includeRetake: false });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("from > to ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const result = await getGemQuizStats({ from: "2026-10-02", to: "2026-10-01", includeRetake: false });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("from === to (ช่วงวันเดียว) ⇒ ผ่าน", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const result = await getGemQuizStats({ from: "2026-10-01", to: "2026-10-01", includeRetake: false });
    expect(result.ok).toBe(true);
  });
});

describe("getGemQuizStats — happy path shape", () => {
  it("RPC คืน shape ที่ถูกต้องครบ ⇒ parse สำเร็จ ค่าตรงกับที่ RPC ส่งมาทุกฟิลด์ (camelCase แปลงถูก)", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.respondents).toBe(10);
      expect(result.data.bySrc).toEqual({ card: 7, share: 2, live: 0, direct: 1 });
      expect(result.data.likedNone).toBe(1);
      expect(result.data.agreement).toEqual({ recommendedInLiked: 4, eligible: 9 });
      expect(result.data.crosstab).toEqual([{ questionCode: "q_intent", optionCode: "opt_a", stoneCode: "pearl", count: 2 }]);
      expect(result.data.bySrcLiked).toEqual([{ src: "card", code: "pearl", count: 5 }]);
    }
  });

  it("ทุก array เป็น [] (ไม่มีผู้ตอบเลยในช่วงนี้) ⇒ ยัง ok:true ไม่ throw", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({
        respondents: 0,
        liked: [],
        recommended: [],
        crosstab: [],
        daily: [],
        by_src_liked: [],
      }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.liked).toEqual([]);
      expect(result.data.daily).toEqual([]);
    }
  });
});

describe("getGemQuizStats — type guard ต้องคืน ok:false (ไม่ throw) เมื่อ RPC คืน shape ที่ไม่ตรงสัญญา", () => {
  it.each([null, undefined, "a string", 123, true, [1, 2, 3]])(
    "RPC data ระดับบนสุด = %p (ไม่ใช่ object) ⇒ ok:false",
    async (badData) => {
      const { getGemQuizStats } = await import("./gem-quiz-stats");
      rpcMock.mockResolvedValue({ data: badData, error: null });
      const result = await getGemQuizStats(VALID_INPUT);
      expect(result.ok).toBe(false);
    }
  );

  it("respondents หายไป ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const payload = validStatsPayload();
    delete (payload as Record<string, unknown>).respondents;
    rpcMock.mockResolvedValue({ data: payload, error: null });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("respondents เป็น string ไม่ใช่ number ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({ data: validStatsPayload({ respondents: "10" }), error: null });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("by_src ขาด key 'live' ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ by_src: { card: 1, share: 1, direct: 1 } }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("liked ไม่ใช่ array (เป็น object เดี่ยว) ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ liked: { code: "pearl", label_th: "มุก", price_group: 2, count: 5 } }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("liked[].price_group เป็น 3 (นอก union 1|2) ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ liked: [{ code: "pearl", label_th: "มุก", price_group: 3, count: 5 }] }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("agreement.eligible หายไป ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ agreement: { recommended_in_liked: 4 } }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("crosstab[].count เป็น string ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({
        crosstab: [{ question_code: "q_intent", option_code: "opt_a", stone_code: "pearl", count: "2" }],
      }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("daily[].date หายไป (มีแค่ count) ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({ data: validStatsPayload({ daily: [{ count: 3 }] }), error: null });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("by_src_liked[].src เป็นค่าที่ไม่อยู่ใน whitelist ⇒ ok:false", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ by_src_liked: [{ src: "totally_bogus", code: "pearl", count: 5 }] }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("ฟิลด์เกินสัญญาปนมา (เช่น RPC เพิ่ม field ใหม่ในอนาคต) ⇒ ไม่กระทบ ยัง ok:true (ไม่ strict เกิน)", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({ data: validStatsPayload({ unexpected_future_field: 42 }), error: null });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(true);
  });
});

describe("getGemQuizStats — v2 field ใหม่จาก migration 0157 (liked_first/daily_breakdown)", () => {
  // 🔴 validStatsPayload() ด้านบนไม่มี liked_first/daily_breakdown เลย —
  // จำลองสถานะ "0157 ยังไม่ apply ขึ้น DB จริง" (raw.liked_first/
  // raw.daily_breakdown เป็น undefined ไม่ใช่ malformed) ต้อง parse สำเร็จ
  // เป็น [] ชั่วคราว ไม่ใช่ปฏิเสธทั้งก้อนจนหน้าสถิติพังไปด้วย
  it("ยังไม่มี field ใหม่เลย (ก่อน apply 0157) ⇒ ยัง ok:true, likedFirst/dailyBreakdown = []", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.likedFirst).toEqual([]);
      expect(result.data.dailyBreakdown).toEqual([]);
    }
  });

  it("มี field ใหม่ครบ shape ถูกต้อง (หลัง apply 0157) ⇒ parse สำเร็จ ค่าตรง", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({
        liked_first: [{ code: "garnet", count: 4 }],
        daily_breakdown: [{ date: "2026-10-01", dim: "intention", code: "career", count: 2 }],
      }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.likedFirst).toEqual([{ code: "garnet", count: 4 }]);
      expect(result.data.dailyBreakdown).toEqual([{ date: "2026-10-01", dim: "intention", code: "career", count: 2 }]);
    }
  });

  it("liked_first มีแต่ shape ผิด (ไม่ใช่ undefined) ⇒ ok:false ไม่ throw", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ liked_first: [{ code: "garnet" }] }), // ขาด count
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("daily_breakdown มีแต่ shape ผิด (ขาด dim) ⇒ ok:false ไม่ throw", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({
      data: validStatsPayload({ daily_breakdown: [{ date: "2026-10-01", code: "career", count: 2 }] }),
      error: null,
    });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("liked_first เป็น null (ไม่ใช่ undefined/array) ⇒ ok:false ไม่ throw", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({ data: validStatsPayload({ liked_first: null }), error: null });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });
});

describe("getGemQuizStats — RPC error", () => {
  it("RPC คืน error ⇒ ok:false, ไม่ throw", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });

  it("RPC throw ตรง (network/timeout) ⇒ ok:false, ไม่ throw ขึ้นไปหา caller", async () => {
    const { getGemQuizStats } = await import("./gem-quiz-stats");
    rpcMock.mockRejectedValue(new Error("network timeout"));
    const result = await getGemQuizStats(VALID_INPUT);
    expect(result.ok).toBe(false);
  });
});
