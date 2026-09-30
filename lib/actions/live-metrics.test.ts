// lib/actions/live-metrics.test.ts
//
// Mocking pattern ก็อปจาก lib/actions/content.test.ts (getEffectiveRole +
// getDevShopId + getServiceClient().schema().{rpc,from} + next/cache) —
// พิสูจน์ 4 เรื่องต่อ action ตามที่ Tech Lead brief สั่งไว้ตรงๆ: (1) gate
// ปฏิเสธ staff ก่อนอย่างอื่น (2) ส่ง p_source/p_channel ถูกค่าคงที่เสมอ
// (3) mapper error ทำงาน แปลง raw DB message เป็นไทย (4) read actions คืนค่า
// ที่มีอยู่ถูกต้อง/คืน null เมื่อยังไม่เคยกรอก ไม่ error.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock, from: fromMock };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** Chain builder for `.from(table).select(...).eq(...).eq(...).maybeSingle()`
 * — same "every non-terminal method returns `this`" shape as
 * content.test.ts's makeSelectChain/makeKpiChain, generalized for however
 * many `.eq()` calls a given query makes before `.maybeSingle()`. */
function makeMaybeSingleChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: "session-id-1", error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// upsertLiveSession — analytics.live_session_upsert (0121, RPC เดิม)
// ============================================================================

describe("upsertLiveSession", () => {
  const baseInput = {
    liveDate: "2026-10-01",
    startTime: "20:00",
    endTime: "23:00",
    peakViewers: 300,
  };

  it("rejects staff ก่อนเรียก RPC เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession(baseInput);
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง p_source: 'admin_ui' เสมอ — แยกจาก 'owner_chat' ที่ใช้กรอกแทนผ่านแชท", async () => {
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession(baseInput);

    expect(result).toEqual({ ok: true, data: "session-id-1" });
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(rpcMock).toHaveBeenCalledTimes(1);

    const [rpcName, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("live_session_upsert");
    expect(params).toEqual({
      p_shop: "shop-1",
      p_live_date: "2026-10-01",
      p_start: "20:00",
      p_end: "23:00",
      p_peak: 300,
      p_note: null,
      p_source: "admin_ui",
    });
  });

  it("ส่ง note ที่ trim แล้วเมื่อมีค่า (เก็บ note เดิมกันโดนทับเป็น null เงียบๆ)", async () => {
    const { upsertLiveSession } = await import("./live-metrics");
    await upsertLiveSession({ ...baseInput, note: "  หมายเหตุเดิม  " });
    const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_note).toBe("หมายเหตุเดิม");
  });

  it("note เป็นช่องว่างล้วน (หลัง trim เป็น '') ⇒ ส่ง null ไม่ใช่สตริงว่าง", async () => {
    const { upsertLiveSession } = await import("./live-metrics");
    await upsertLiveSession({ ...baseInput, note: "   " });
    const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_note).toBeNull();
  });

  it("peakViewers เป็น NaN ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession({ ...baseInput, peakViewers: NaN });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("peakViewers ติดลบ ⇒ ปฏิเสธก่อนเรียก RPC (UX เท่านั้น — ด่านจริงอยู่ที่ RPC)", async () => {
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession({ ...baseInput, peakViewers: -5 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ขาด liveDate/startTime/endTime ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession({ ...baseInput, liveDate: "" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("RPC ปฏิเสธ (P0001 — viewer ติดลบ ตรวจซ้ำฝั่ง DB) ⇒ คืนข้อความไทยที่ map แล้ว ไม่หลุด raw DB message", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "live_session_upsert: viewer สูงสุดต้องไม่ติดลบ", code: "P0001" },
    });
    const { upsertLiveSession } = await import("./live-metrics");
    // peakViewers ผ่านด่าน client (ไม่ติดลบ) แต่จำลองว่า RPC ปฏิเสธจริง —
    // พิสูจน์ว่า mapper ถูกเรียกจริง ไม่ใช่แค่ client-side gate ทำงาน
    const result = await upsertLiveSession({ ...baseInput, peakViewers: 5 });
    expect(result).toEqual({ ok: false, error: "คนดูพีคติดลบไม่ได้" });
  });

  it("RPC ปฏิเสธ (P0001 — เวลาเริ่ม-เลิกสลับกัน) ⇒ คืนข้อความไทยที่ map แล้ว", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "live_session_upsert: เวลาเริ่ม-เลิกน่าจะสลับกัน (ได้ไลฟ์ยาวเกิน 12 ชั่วโมง)", code: "P0001" },
    });
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession(baseInput);
    expect(result).toEqual({ ok: false, error: "เวลาเริ่ม-เลิกน่าจะสลับกัน (ได้ไลฟ์ยาวเกิน 12 ชั่วโมง) — ตรวจเวลาอีกครั้ง" });
  });

  it("RPC ปฏิเสธ (42501) ⇒ map เป็นข้อความสิทธิ์ภาษาไทย", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "crm: caller is not owner/admin of shop x", code: "42501" },
    });
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession(baseInput);
    expect(result).toEqual({ ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่บันทึกข้อมูลไลฟ์ได้" });
  });

  it("RPC ปฏิเสธด้วย error ที่ mapper ไม่รู้จัก ⇒ ได้ fallback แทน raw message", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "some unmapped db error", code: "XX000" },
    });
    const { upsertLiveSession } = await import("./live-metrics");
    const result = await upsertLiveSession(baseInput);
    expect(result).toEqual({ ok: false, error: "บันทึกคนดูพีคไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });
});

// ============================================================================
// getLiveSessionForDate — อ่านค่า pre-fill
// ============================================================================

describe("getLiveSessionForDate", () => {
  it("rejects staff ก่อนเรียก query เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getLiveSessionForDate } = await import("./live-metrics");
    const result = await getLiveSessionForDate("2026-10-01");
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("คืนค่าที่มีอยู่ถูกต้อง พร้อม scope shop_id + live_date", async () => {
    const chain = makeMaybeSingleChain({
      data: {
        live_date: "2026-10-01",
        started_at: "2026-10-01T13:00:00.000Z",
        ended_at: "2026-10-01T16:00:00.000Z",
        peak_viewers: 320,
        note: "หมายเหตุ",
      },
      error: null,
    });
    fromMock.mockReturnValue(chain);

    const { getLiveSessionForDate } = await import("./live-metrics");
    const result = await getLiveSessionForDate("2026-10-01");

    expect(result).toEqual({
      ok: true,
      data: {
        liveDate: "2026-10-01",
        startedAt: "2026-10-01T13:00:00.000Z",
        endedAt: "2026-10-01T16:00:00.000Z",
        peakViewers: 320,
        note: "หมายเหตุ",
      },
    });
    expect(fromMock).toHaveBeenCalledWith("live_session_log");
    expect(chain.eq).toHaveBeenNthCalledWith(1, "shop_id", "shop-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "live_date", "2026-10-01");
  });

  it("คืน null ถ้ายังไม่เคยกรอกวันนั้น ไม่ error", async () => {
    const chain = makeMaybeSingleChain({ data: null, error: null });
    fromMock.mockReturnValue(chain);
    const { getLiveSessionForDate } = await import("./live-metrics");
    const result = await getLiveSessionForDate("2026-10-02");
    expect(result).toEqual({ ok: true, data: null });
  });

  it("peak_viewers เป็น null จริงจาก DB (ยังไม่กรอก) ⇒ ส่งต่อเป็น null ไม่ใช่ 0", async () => {
    const chain = makeMaybeSingleChain({
      data: {
        live_date: "2026-10-01",
        started_at: "2026-10-01T13:00:00.000Z",
        ended_at: "2026-10-01T16:00:00.000Z",
        peak_viewers: null,
        note: null,
      },
      error: null,
    });
    fromMock.mockReturnValue(chain);
    const { getLiveSessionForDate } = await import("./live-metrics");
    const result = await getLiveSessionForDate("2026-10-01");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.peakViewers).toBeNull();
    }
  });

  it("วันที่ว่าง ⇒ ปฏิเสธก่อนเรียก query", async () => {
    const { getLiveSessionForDate } = await import("./live-metrics");
    const result = await getLiveSessionForDate("");
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// upsertChannelFollowerCount — analytics.channel_follower_upsert (0153, ใหม่)
// ============================================================================

describe("upsertChannelFollowerCount", () => {
  const baseInput = { asOfDate: "2026-10-01", followerCount: 4200 };

  it("rejects staff ก่อนเรียก RPC เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount(baseInput);
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง p_channel: 'line_oa' เสมอ — ไม่เปิดให้ caller เลือกช่องอื่น", async () => {
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount(baseInput);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    const [rpcName, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("channel_follower_upsert");
    expect(params).toEqual({
      p_shop_id: "shop-1",
      p_channel: "line_oa",
      p_as_of_date: "2026-10-01",
      p_follower_count: 4200,
    });
  });

  it("followerCount เป็น NaN ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount({ ...baseInput, followerCount: NaN });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("followerCount ติดลบ ⇒ ปฏิเสธก่อนเรียก RPC (UX เท่านั้น — ด่านจริงอยู่ที่ RPC)", async () => {
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount({ ...baseInput, followerCount: -1 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("asOfDate ว่าง ⇒ ปฏิเสธก่อนเรียก RPC", async () => {
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount({ ...baseInput, asOfDate: "" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("RPC ปฏิเสธ (22023 — as_of_date อนาคต) ⇒ คืนข้อความไทยที่ map แล้ว", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "channel_follower_upsert: as_of_date (2099-01-01) อยู่ในอนาคต — ยังบันทึกไม่ได้จนกว่าจะถึงวันนั้นจริง",
        code: "22023",
      },
    });
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount({ asOfDate: "2099-01-01", followerCount: 100 });
    expect(result).toEqual({ ok: false, error: "วันที่นี้อยู่ในอนาคต — ระบบบันทึกให้เฉพาะวันนี้เท่านั้น" });
  });

  it("RPC ปฏิเสธ (22023 — channel ไม่ถูกต้อง) ⇒ คืนข้อความไทยที่ map แล้ว", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "channel_follower_upsert: ช่องทางไม่ถูกต้อง: youtube", code: "22023" },
    });
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount(baseInput);
    expect(result).toEqual({ ok: false, error: "ช่องทางไม่ถูกต้อง — ติดต่อทีมพัฒนา" });
  });

  it("RPC ปฏิเสธ (42501) ⇒ map เป็นข้อความสิทธิ์ภาษาไทย", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "crm: caller is not owner/admin of shop x", code: "42501" },
    });
    const { upsertChannelFollowerCount } = await import("./live-metrics");
    const result = await upsertChannelFollowerCount(baseInput);
    expect(result).toEqual({ ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่บันทึกจำนวนเพื่อน LINE ได้" });
  });
});

// ============================================================================
// getChannelFollowerCount — อ่านค่า pre-fill
// ============================================================================

describe("getChannelFollowerCount", () => {
  it("rejects staff ก่อนเรียก query เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getChannelFollowerCount } = await import("./live-metrics");
    const result = await getChannelFollowerCount("line_oa", "2026-10-01");
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("คืนค่าที่มีอยู่ถูกต้อง พร้อม scope shop_id + channel + as_of_date", async () => {
    const chain = makeMaybeSingleChain({
      data: { as_of_date: "2026-10-01", follower_count: 4200 },
      error: null,
    });
    fromMock.mockReturnValue(chain);

    const { getChannelFollowerCount } = await import("./live-metrics");
    const result = await getChannelFollowerCount("line_oa", "2026-10-01");

    expect(result).toEqual({ ok: true, data: { asOfDate: "2026-10-01", followerCount: 4200 } });
    expect(fromMock).toHaveBeenCalledWith("channel_follower_log");
    expect(chain.eq).toHaveBeenNthCalledWith(1, "shop_id", "shop-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "channel", "line_oa");
    expect(chain.eq).toHaveBeenNthCalledWith(3, "as_of_date", "2026-10-01");
  });

  it("คืน null ถ้ายังไม่เคยกรอก ไม่ error", async () => {
    const chain = makeMaybeSingleChain({ data: null, error: null });
    fromMock.mockReturnValue(chain);
    const { getChannelFollowerCount } = await import("./live-metrics");
    const result = await getChannelFollowerCount("line_oa", "2026-10-08");
    expect(result).toEqual({ ok: true, data: null });
  });

  it("asOfDate ว่าง ⇒ ปฏิเสธก่อนเรียก query", async () => {
    const { getChannelFollowerCount } = await import("./live-metrics");
    const result = await getChannelFollowerCount("line_oa", "");
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
