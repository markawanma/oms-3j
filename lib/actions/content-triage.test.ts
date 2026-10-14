// lib/actions/content-triage.test.ts — หน้าคัดไอเดีย: สิทธิ์ · shop_id ทุก query · ✓ = setPlan(date) แล้ว planned (ล้มกลางทางไม่เดินต่อ) · ✗/↷/กลับมาคัด ส่งสถานะถูก
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const STEP = "11111111-1111-4111-8111-111111111111";
const getEffectiveRoleMock = vi.fn();
const setPlanMock = vi.fn();
const advanceMock = vi.fn();

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

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: vi.fn(), from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [{ code: "knowledge", labelTh: "ความรู้", colorHex: "#123456" }] }) }));
vi.mock("@/lib/actions/content-pieces", () => ({
  setPlan: (...a: unknown[]) => setPlanMock(...a),
  advancePiece: (...a: unknown[]) => advanceMock(...a),
}));

import { chooseIdea, getTriageData, holdIdea, resumeIdea, skipIdea, unchooseIdea } from "./content-triage";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
  setPlanMock.mockResolvedValue({ ok: true, data: undefined });
  advanceMock.mockResolvedValue({ ok: true, data: { to: "planned" } });
});

describe("สิทธิ์", () => {
  it("staff / role ไม่รู้จัก: ไม่ query ไม่เรียก setPlan/advance ทุก action", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await getTriageData()).ok).toBe(false);
      expect((await chooseIdea(STEP, "2026-10-14")).ok).toBe(false);
      expect((await unchooseIdea(STEP)).ok).toBe(false);
      expect((await skipIdea(STEP, "ไม่เหมาะ")).ok).toBe(false);
      expect((await holdIdea(STEP, "รอภาพ")).ok).toBe(false);
      expect((await resumeIdea(STEP)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
  });
});

describe("getTriageData", () => {
  it("ทุก query กรอง shop_id · ไอเดียมีเพดาน · ใช้ overlap ของสัปดาห์ · ?w ผิด = สัปดาห์นี้ไม่พัง", async () => {
    const r = await getTriageData("9999-01-01");
    expect(r.ok).toBe(true);
    for (const c of calls) {
      if (["v_content_piece", "v_content_piece_calendar", "v_line_quota_28d", "v_content_inbox_counts", "content_weekly_summary", "live_host", "v_content_signal"].includes(c.table)) {
        expect(c.ops, c.table).toContainEqual(["eq", "shop_id", SHOP]);
      }
    }
    const ideaCall = calls.find((c) => c.table === "v_content_piece");
    expect(ideaCall?.ops).toContainEqual(["eq", "piece_status", "idea"]);
    expect(ideaCall?.ops.some((o) => o[0] === "limit")).toBe(true);
    const weekCall = calls.find((c) => c.table === "v_content_piece_calendar");
    expect(weekCall?.ops.some((o) => o[0] === "or" && String(o[1]).includes("resolved_end.is.null"))).toBe(true);
    expect(weekCall?.ops.some((o) => o[0] === "limit")).toBe(true);
    expect(weekCall?.ops).toContainEqual(["neq", "piece_status", "idea"]); // ไอเดียที่มีวันค้างไม่เข้าตัวนับ
  });

  it("ส่วนหนึ่งล้ม (counts) ส่วนอื่นยังมาครบ · ไม่รั่วข้อความดิบ", async () => {
    tableResults.v_content_inbox_counts = { data: null, error: { code: "XX000", message: "relation analytics.secret exploded" } };
    const r = await getTriageData("2026-10-14");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.weekFrom).toBe("2026-10-12");
    expect(r.data.counts.ok).toBe(false);
    expect(JSON.stringify(r.data.counts)).not.toContain("secret");
    expect(r.data.ideas.ok).toBe(true);
    expect(r.data.contentTypes).toHaveLength(1);
  });

  it("ไอเดียที่อ้างสัญญาณ → ดึง v_content_signal ด้วย shop_id · ถึงเพดาน = truncated", async () => {
    const SIG = "22222222-2222-4222-8222-222222222222";
    tableResults.v_content_piece = {
      data: Array.from({ length: 40 }, (_, i) => ({ step_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `t${i}`, piece_status: "idea", source_signal_id: i === 0 ? SIG : null })),
      error: null,
    };
    tableResults.v_content_signal = { data: [{ id: SIG, kind: "trend", summary: "เทรนด์", seen_on: "2026-10-06" }], error: null };
    const r = await getTriageData(null);
    expect(r.ok && r.data.ideas.ok && r.data.ideas.data.truncated).toBe(true);
    expect(r.ok && r.data.ideas.ok && r.data.ideas.data.signals[SIG]?.summary).toBe("เทรนด์");
    const sig = calls.find((c) => c.table === "v_content_signal");
    expect(sig?.ops).toContainEqual(["eq", "shop_id", SHOP]);
  });
});

describe("chooseIdea (✓ ทำ)", () => {
  it("setPlan({date}) ก่อน แล้ว advance planned ตามลำดับ", async () => {
    const order: string[] = [];
    setPlanMock.mockImplementation(async () => (order.push("plan"), { ok: true, data: undefined }));
    advanceMock.mockImplementation(async () => (order.push("advance"), { ok: true, data: { to: "planned" } }));
    const r = await chooseIdea(STEP, "2026-10-14");
    expect(r.ok).toBe(true);
    expect(order).toEqual(["plan", "advance"]);
    expect(setPlanMock).toHaveBeenCalledWith(STEP, { date: "2026-10-14" });
    expect(advanceMock).toHaveBeenCalledWith(STEP, "planned");
  });

  it("ไม่ได้เลือกวัน/วันผิด/ปีนอกช่วง/id ผิด → ไม่เรียกอะไรเลย (ไม่เลือกวันให้เอง)", async () => {
    for (const d of ["", "2026-02-30", "9999-12-31", "abc", undefined as unknown as string]) {
      expect((await chooseIdea(STEP, d)).ok, String(d)).toBe(false);
    }
    expect((await chooseIdea("not-a-uuid", "2026-10-14")).ok).toBe(false);
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("setPlan ล้ม → ไม่ advance · คืนข้อความเดิม", async () => {
    setPlanMock.mockResolvedValue({ ok: false, error: "บันทึกแผนไม่สำเร็จ" });
    const r = await chooseIdea(STEP, "2026-10-14");
    expect(r).toEqual({ ok: false, error: "บันทึกแผนไม่สำเร็จ" });
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("advance ล้ม 55000 → คืนข้อความ 'วางแผนไม่ได้ — …' ไม่กลืน", async () => {
    advanceMock.mockResolvedValue({ ok: false, error: "วางแผนไม่ได้ — ยังไม่มีเกณฑ์ผ่าน" });
    const r = await chooseIdea(STEP, "2026-10-14");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("วางแผนไม่ได้");
    expect(!r.ok && r.stale).toBe(true); // วันถูกบันทึกแล้ว → จอต้องรีเฟรช
  });
});

describe("ไม่ทำ / เลื่อน / กลับมาคัด / ยกเลิกการเลือก", () => {
  it("ส่งสถานะถูกพร้อมเหตุผล (ยกเลิกการเลือกไม่ส่งเหตุผล · ไม่ล้างวัน)", async () => {
    await skipIdea(STEP, "ไม่เหมาะกับแบรนด์");
    expect(advanceMock).toHaveBeenLastCalledWith(STEP, "cancelled", { reason: "ไม่เหมาะกับแบรนด์" });
    await holdIdea(STEP, "รอภาพ");
    expect(advanceMock).toHaveBeenLastCalledWith(STEP, "hold", { reason: "รอภาพ" });
    await resumeIdea(STEP);
    expect(advanceMock).toHaveBeenLastCalledWith(STEP, "resume");
    await unchooseIdea(STEP);
    expect(advanceMock).toHaveBeenLastCalledWith(STEP, "idea");
    expect(setPlanMock).not.toHaveBeenCalled(); // D11: set_plan ล้างวันไม่ได้ — ห้ามพยายาม
  });

  it("id ผิด → ไม่เรียก · advance ล้ม → คืน error ตามเดิม", async () => {
    expect((await unchooseIdea("x")).ok).toBe(false);
    expect((await resumeIdea("x")).ok).toBe(false);
    expect(advanceMock).not.toHaveBeenCalled();
    advanceMock.mockResolvedValue({ ok: false, error: "ชิ้นงานนี้ไม่ได้รอเงื่อนไขอยู่", stale: true });
    const r = await resumeIdea(STEP);
    expect(r).toEqual({ ok: false, error: "ชิ้นงานนี้ไม่ได้รอเงื่อนไขอยู่", stale: true });
  });
});
