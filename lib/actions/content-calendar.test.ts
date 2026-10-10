// lib/actions/content-calendar.test.ts — ด่านที่ action ปฏิทินต้องบังคับเอง: shop_id ทุก query · overlap · legacy ไม่รวมชิ้น workflow · ช่วงวัน · createPiece
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const getCampaignCalendarMock = vi.fn();

interface Op {
  table: string;
  ops: Array<[string, ...unknown[]]>;
}
const calls: Op[] = [];
const tableResults: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "lte", "lt", "gte", "gt", "or", "not", "order", "limit", "is"]) {
    b[m] = (...a: unknown[]) => {
      call.ops.push([m, ...a]);
      return b;
    };
  }
  const result = () => tableResults[table] ?? { data: [], error: null };
  b.maybeSingle = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return b;
}
const ops = (table: string, name: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter((o) => o[0] === name));

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/marketing", () => ({ getCampaignCalendar: () => getCampaignCalendarMock() }));

import { createPiece, getCalendarData } from "./content-calendar";

const OVERLAP = "resolved_end.gte.2026-10-26,and(resolved_end.is.null,resolved_start.gte.2026-10-26)";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-09T05:00:00Z")); // วันนี้ (ไทย) = 2026-10-09 — action คำนวณเอง
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: "11111111-1111-4111-8111-111111111111", error: null });
  getCampaignCalendarMock.mockResolvedValue({ ok: true, data: [{ nameTh: "กินเจ", eventDate: "2026-10-10", durationDays: 9 }] });
});

afterEach(() => vi.useRealTimers());

describe("getCalendarData", () => {
  it("staff / role ไม่รู้จัก ถูกปฏิเสธโดยไม่ query", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await getCalendarData("2026-10-05", "2026-10-11")).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("ช่วงวันที่ผิด/ยาวเกินเพดาน/กลับด้าน → ปฏิเสธ (ไม่ query view ที่ช้า)", async () => {
    const bad: Array<[string, string]> = [
      ["2026-10-11", "2026-10-05"],
      ["2026-02-30", "2026-03-05"],
      ["2026-01-01", "2026-12-31"],
      ["x", "y"],
    ];
    for (const [f, t] of bad) expect((await getCalendarData(f, t)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("ช่วงนอก 2025–2030 ทั้งก้อน/ผิดรูป → ปฏิเสธโดยไม่ query", async () => {
    for (const [f, t] of [
      ["2031-01-01", "2031-01-07"],
      ["2024-12-01", "2024-12-31"],
      ["0001-01-01", "0001-01-07"],
      ["9999-12-25", "9999-12-31"],
    ]) {
      expect((await getCalendarData(f, t)).ok, `${f} ${t}`).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("BUG-QA-4: กริดเดือน ธ.ค. 2030 / ม.ค. 2025 ที่ล้นปีข้างเคียง → clamp ที่ขอบ ไม่ error (query ไม่เกินขอบ)", async () => {
    expect((await getCalendarData("2030-11-26", "2031-01-05")).ok).toBe(true);
    const main = calls.find((c) => c.table === "v_content_piece_calendar")!.ops;
    expect(main).toContainEqual(["lte", "resolved_start", "2030-12-31"]);
    calls.length = 0;
    expect((await getCalendarData("2024-12-30", "2025-02-02")).ok).toBe(true);
    const m2 = calls.find((c) => c.table === "v_content_piece_calendar")!.ops;
    expect(String(m2.find((o) => o[0] === "or")?.[1])).toContain("resolved_end.gte.2025-01-01");
  });

  it("ถึงเพดานแถว → piecesTruncated / legacyTruncated = true (ไม่ตัดเงียบ) · ต่ำกว่าเพดาน = false", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ step_id: `s${i}`, campaign_id: "c", title: "t", piece_status: "planned", resolved_start: "2026-10-06" }));
    tableResults.v_content_piece_calendar = { data: mk(300), error: null };
    tableResults.v_campaign_board = { data: Array.from({ length: 300 }, (_, i) => ({ step_id: `old${i}`, campaign_id: "c", step_kind: "x", resolved_start: "2026-10-06" })), error: null };
    let r = await getCalendarData("2026-10-05", "2026-10-11");
    expect(r.ok && r.data.piecesTruncated).toBe(true);
    expect(r.ok && r.data.legacyTruncated).toBe(true);
    tableResults.v_content_piece_calendar = { data: mk(299), error: null };
    tableResults.v_campaign_board = { data: [], error: null };
    r = await getCalendarData("2026-10-05", "2026-10-11");
    expect(r.ok && r.data.piecesTruncated).toBe(false);
    expect(r.ok && r.data.legacyTruncated).toBe(false);
  });

  it("ทุก query กรอง shop_id · มีเพดานแถว · ใช้ overlap (ไม่ใช่กรองแค่ resolved_start)", async () => {
    const r = await getCalendarData("2026-10-26", "2026-11-01");
    expect(r.ok).toBe(true);
    for (const c of calls) {
      if (["v_line_quota_28d", "campaign_step", "v_campaign_board", "v_content_piece_calendar"].includes(c.table)) {
        expect(c.ops, c.table).toContainEqual(["eq", "shop_id", SHOP]);
      }
    }
    const pieceCalls = calls.filter((c) => c.table === "v_content_piece_calendar");
    expect(pieceCalls).toHaveLength(2); // ช่วงที่แสดง + ค้าง
    const main = pieceCalls[0].ops;
    expect(main).toContainEqual(["lte", "resolved_start", "2026-11-01"]);
    expect(main.find((o) => o[0] === "or")?.[1]).toBe(OVERLAP);
    expect(main.some((o) => o[0] === "limit")).toBe(true);
    expect(ops("v_campaign_board", "or")[0][1]).toBe(OVERLAP);
  });

  it("overdue: ก่อนขอบ min(ต้นช่วง, วันนี้) · เฉพาะสถานะที่ยังไม่โพสต์", async () => {
    await getCalendarData("2026-10-05", "2026-10-11");
    const o = calls.filter((c) => c.table === "v_content_piece_calendar")[1].ops;
    expect(o).toContainEqual(["lt", "resolved_start", "2026-10-05"]);
    expect(o.find((x) => x[0] === "in")?.[2]).toEqual(["planned", "drafting", "in_review", "approved", "produced"]);
    calls.length = 0;
    await getCalendarData("2026-10-19", "2026-10-25"); // ดูสัปดาห์อนาคต: ค้าง = ก่อนวันนี้ ไม่ใช่ก่อนสัปดาห์ที่ดู
    expect(calls.filter((c) => c.table === "v_content_piece_calendar")[1].ops).toContainEqual(["lt", "resolved_start", "2026-10-09"]);
  });

  it("แผนเดิม: ไม่รวมชิ้นใน workflow ใหม่ทุกสถานะ (รวมที่ยกเลิก) และตั้งชื่อ fallback เป็นไทย", async () => {
    tableResults.campaign_step = { data: [{ id: "wf-1" }, { id: "wf-cancelled" }], error: null };
    tableResults.v_campaign_board = {
      data: [
        { step_id: "wf-cancelled", campaign_id: "c", campaign_name: "x", step_kind: "content_task", resolved_start: "2026-10-07" },
        {
          step_id: "old-1",
          campaign_id: "c2",
          campaign_name: "โปร 9.9",
          campaign_type: "promo",
          step_kind: "line_broadcast",
          step_title: null,
          resolved_start: "2026-10-07",
          resolved_end: "2026-10-08",
          effective_status: "scheduled",
        },
      ],
      error: null,
    };
    const r = await getCalendarData("2026-10-05", "2026-10-11");
    const legacy = r.ok && r.data.legacy.ok ? r.data.legacy.data : [];
    expect(legacy.map((s) => s.stepId)).toEqual(["old-1"]);
    expect(legacy[0].title).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(ops("campaign_step", "not")).toContainEqual(["not", "piece_status", "is", null]);
  });

  it("ส่วนหนึ่งล้ม ส่วนอื่นยังมา (เทศกาลล้ม → กริดยังแสดง)", async () => {
    getCampaignCalendarMock.mockResolvedValue({ ok: false, error: "x" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await getCalendarData("2026-10-05", "2026-10-11");
    spy.mockRestore();
    expect(r.ok && !r.data.festivals.ok && r.data.pieces.ok).toBe(true);
  });

  it("เทศกาลคร่อมสัปดาห์ถูกตัดตามช่วง", async () => {
    const r = await getCalendarData("2026-10-05", "2026-10-11");
    expect(r.ok && r.data.festivals.ok && r.data.festivals.data.map((f) => f.name)).toEqual(["กินเจ"]);
    const r2 = await getCalendarData("2026-11-02", "2026-11-08");
    expect(r2.ok && r2.data.festivals.ok && r2.data.festivals.data).toEqual([]);
  });
});

describe("createPiece", () => {
  const ok = { title: " ชิ้นใหม่ ", pieceKind: "short_clip", channel: "tiktok", customerGroup: "silver_bar", date: "2026-10-12" };

  it("ส่ง RPC ด้วยค่าที่ตรวจแล้ว · actor/shop จาก server · ได้ step id", async () => {
    const r = await createPiece(ok);
    expect(r).toEqual({ ok: true, data: { stepId: "11111111-1111-4111-8111-111111111111" } });
    const [fn, p] = rpcMock.mock.calls[0];
    expect(fn).toBe("content_piece_create");
    expect(p).toMatchObject({
      p_title: "ชิ้นใหม่",
      p_piece_kind: "short_clip",
      p_channel: "tiktok",
      p_customer_group: "silver_bar",
      p_date: "2026-10-12",
      p_actor_role: "owner",
      p_shop_id: SHOP,
    });
    expect(p.p_campaign_id).toBeNull();
  });

  it("อินพุตผิดทุกแบบ → ข้อความไทย ไม่ถึง RPC", async () => {
    const bad: unknown[] = [
      { ...ok, title: "   " },
      { ...ok, title: "ก".repeat(201) },
      { ...ok, pieceKind: "video" },
      { ...ok, channel: "line_oa" }, // short_clip ใช้ line_oa ไม่ได้
      { ...ok, customerGroup: "gold" },
      { ...ok, date: "2026-02-30" },
      null,
      { ...ok, title: 5 },
    ];
    for (const b of bad) {
      const r = await createPiece(b as never);
      expect(r.ok).toBe(false);
      expect(!r.ok && /[฀-๿]/.test(r.error)).toBe(true);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("staff ปฏิเสธ · DB error แปลเป็นไทย ไม่รั่วชื่อฟังก์ชัน", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    expect((await createPiece(ok)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    getEffectiveRoleMock.mockResolvedValue("owner");
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "content_piece_create: วันที่อยู่นอกช่วงที่ยอมรับ" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await createPiece(ok);
    spy.mockRestore();
    expect(!r.ok && r.error).not.toMatch(/content_piece_create/);
  });
});

describe("BUG-QA-1 / ข้อ 15: ไอเดียไม่ลงปฏิทิน · แผนเดิมไม่พึ่งเพดาน id ทั้งร้าน", () => {
  it("ชิ้นหลักตัด piece_status = idea ที่ DB (neq) · ค้างใช้เฉพาะสถานะที่ยังไม่จบ (ไม่มี idea)", async () => {
    await getCalendarData("2026-10-05", "2026-10-11");
    const pieceCalls = calls.filter((c) => c.table === "v_content_piece_calendar");
    expect(pieceCalls[0].ops).toContainEqual(["neq", "piece_status", "idea"]);
    const overdueIn = pieceCalls[1].ops.find((o) => o[0] === "in" && o[1] === "piece_status");
    expect(overdueIn?.[2]).not.toContain("idea");
  });

  it("แผนเดิม: ถาม workflow id เฉพาะ id ในแถวบอร์ด (in ids) ไม่ดึงทั้งร้านด้วย limit 2000 · ชิ้น workflow ไม่โผล่ซ้ำ", async () => {
    tableResults.v_campaign_board = {
      data: [
        { step_id: "wf-1", campaign_id: "c", step_kind: "x", resolved_start: "2026-10-06", step_title: "ใน workflow" },
        { step_id: "old-1", campaign_id: "c", step_kind: "x", resolved_start: "2026-10-06", step_title: "แผนเดิมจริง" },
      ],
      error: null,
    };
    tableResults.campaign_step = { data: [{ id: "wf-1" }], error: null };
    const r = await getCalendarData("2026-10-05", "2026-10-11");
    expect(r.ok && r.data.legacy.ok && r.data.legacy.data.map((x) => x.stepId)).toEqual(["old-1"]);
    const wf = calls.find((c) => c.table === "campaign_step")!.ops;
    expect(wf).toContainEqual(["in", "id", ["wf-1", "old-1"]]);
    expect(wf).toContainEqual(["eq", "shop_id", SHOP]);
    expect(wf.some((o) => o[0] === "limit" && o[1] === 2000)).toBe(false);
  });

  it("บอร์ดว่าง → ไม่ query campaign_step เลย", async () => {
    await getCalendarData("2026-10-05", "2026-10-11");
    expect(calls.some((c) => c.table === "campaign_step")).toBe(false);
  });
});
