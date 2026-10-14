// lib/actions/content-signals.test.ts — สิทธิ์ · shop_id/limit · allowlist พารามิเตอร์ · หยิบ/ไม่ใช้/เก็บไว้ก่อน · force เมื่อหยิบไปแล้ว
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const SIG = "11111111-1111-4111-8111-111111111111";
const STEP = "22222222-2222-4222-8222-222222222222";
const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

interface Op {
  table: string;
  ops: Array<[string, ...unknown[]]>;
}
const calls: Op[] = [];
const tableResults: Record<string, { data: unknown; error: unknown; count?: number }> = {};

function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "lte", "lt", "gte", "gt", "or", "not", "order", "limit", "is", "range"]) {
    b[m] = (...a: unknown[]) => {
      call.ops.push([m, ...a]);
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(tableResults[table] ?? { data: [], error: null, count: 0 }).then(res, rej);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [] }) }));

import { getSignals, pickSignal, setSignalStatus } from "./content-signals";

const PICK = { title: "ใส่อาบน้ำได้ไหม", pieceKind: "short_clip", channel: "tiktok", customerGroup: "jewelry_925" };
const future = "2029-01-01";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: STEP, error: null });
});

describe("สิทธิ์", () => {
  it("staff/role ไม่รู้จัก → ไม่ query ไม่เรียก RPC", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await getSignals({})).ok).toBe(false);
      expect((await pickSignal(SIG, PICK)).ok).toBe(false);
      expect((await setSignalStatus(SIG, { status: "rejected", reason: "ไม่เข้ากับแบรนด์" })).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("getSignals", () => {
  it("ค่าเริ่มต้น: status=new · shop_id · เรียงวันเห็นล่าสุด · range 0..30 (31 แถว)", async () => {
    const r = await getSignals({});
    expect(r.ok && r.data.query).toEqual({ kind: "", status: "new", id: "", page: 1 });
    const ops = calls[0].ops;
    expect(calls[0].table).toBe("v_content_signal");
    expect(ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(ops).toContainEqual(["eq", "status", "new"]);
    expect(ops).toContainEqual(["range", 0, 30]);
  });

  it("allowlist: kind/status/id/page ผิด → ค่าปลอดภัย · status=all ไม่กรองสถานะ · id เจาะจงไม่ใช้ตัวกรองอื่น", async () => {
    const r = await getSignals({ kind: "evil", status: "drop", id: "x", page: "-3" });
    expect(r.ok && r.data.query).toEqual({ kind: "", status: "new", id: "", page: 1 });
    calls.length = 0;
    await getSignals({ kind: "trend", status: "all" });
    expect(calls[0].ops).toContainEqual(["eq", "kind", "trend"]);
    expect(calls[0].ops.some((o) => o[0] === "eq" && o[1] === "status")).toBe(false);
    calls.length = 0;
    await getSignals({ id: SIG, kind: "trend", status: "rejected" });
    expect(calls[0].ops).toContainEqual(["eq", "id", SIG]);
    expect(calls[0].ops.some((o) => o[0] === "eq" && (o[1] === "kind" || o[1] === "status"))).toBe(false);
  });

  it("แถวที่หยิบแล้ว → ดึงชื่อชิ้นด้วย shop_id + limit · ถึงเพดาน = hasNext", async () => {
    tableResults.v_content_signal = {
      data: Array.from({ length: 31 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, kind: "reference_clip", status: "picked", picked_step_id: i === 0 ? STEP : null, summary: "x" })),
      error: null,
    };
    tableResults.v_content_piece = { data: [{ step_id: STEP, title: "ชิ้นที่หยิบ", effective_piece_status: "idea" }], error: null };
    const r = await getSignals({ status: "picked" });
    expect(r.ok && r.data.rows).toHaveLength(30);
    expect(r.ok && r.data.hasNext).toBe(true);
    expect(r.ok && r.data.pieces[STEP]).toEqual({ title: "ชิ้นที่หยิบ", status: "idea" });
    const pc = calls.find((c) => c.table === "v_content_piece");
    expect(pc?.ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(pc?.ops.some((o) => o[0] === "limit")).toBe(true);
  });

  it("query ล้ม → ข้อความไทย ไม่รั่ว error ดิบ", async () => {
    tableResults.v_content_signal = { data: null, error: { code: "XX000", message: "relation analytics.secret" } };
    const r = await getSignals({});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toContain("secret");
  });
});

describe("pickSignal", () => {
  it("เรียก content_signal_pick ด้วยพารามิเตอร์ถูก · shop/actor ฝั่ง server", async () => {
    const r = await pickSignal(SIG, PICK);
    expect(r).toEqual({ ok: true, data: { stepId: STEP } });
    expect(rpcMock).toHaveBeenCalledWith("content_signal_pick", expect.objectContaining({ p_signal_id: SIG, p_title: PICK.title, p_piece_kind: "short_clip", p_channel: "tiktok", p_customer_group: "jewelry_925", p_shop_id: SHOP, p_actor_role: "owner" }));
  });

  it("ห้ามผ่าน: id ผิด · ชื่อว่าง/ยาว · ชนิด/ช่องทางไม่เข้าคู่ · กลุ่มลูกค้านอก allowlist → ไม่ถึง RPC", async () => {
    const bad: [string, Record<string, unknown>][] = [
      ["x", PICK],
      [SIG, { ...PICK, title: "   " }],
      [SIG, { ...PICK, title: "ก".repeat(201) }],
      [SIG, { ...PICK, pieceKind: "nope" }],
      [SIG, { ...PICK, channel: "line_oa" }], // short_clip ↔ LINE ไม่เข้าคู่
      [SIG, { ...PICK, customerGroup: "gold" }],
    ];
    for (const [id, i] of bad) expect((await pickSignal(id, i as never)).ok, JSON.stringify(i)).toBe(false);
    expect((await pickSignal(SIG, null as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("หยิบซ้ำ (55000 + detail) → ข้อความไทย + id ชิ้นที่หยิบไปแล้ว", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: "content_signal_pick: สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว", details: STEP } });
    const r = await pickSignal(SIG, PICK);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.pickedStepId).toBe(STEP);
    expect(!r.ok && r.error).toContain("หยิบเป็นชิ้นงานแล้ว");
  });
});

describe("setSignalStatus", () => {
  it("ไม่ใช้ = เหตุผล ≥3 · เก็บไว้ก่อน = วันที่ถูกต้องและไม่ใช่อดีต · ส่ง p_force=false ตามเดิม", async () => {
    rpcMock.mockResolvedValue({ data: { id: SIG }, error: null });
    expect((await setSignalStatus(SIG, { status: "rejected", reason: "ซ้ำกับของเดิม" })).ok).toBe(true);
    expect(rpcMock).toHaveBeenLastCalledWith("content_signal_set_status", expect.objectContaining({ p_id: SIG, p_status: "rejected", p_reason: "ซ้ำกับของเดิม", p_review_on: null, p_force: false }));
    expect((await setSignalStatus(SIG, { status: "deferred", reviewOn: future })).ok).toBe(true);
    expect(rpcMock).toHaveBeenLastCalledWith("content_signal_set_status", expect.objectContaining({ p_status: "deferred", p_review_on: future, p_reason: null }));
  });

  it("ห้ามผ่าน: เหตุผลสั้น · วันกลับมาดูผิด/อดีต · status นอก allowlist (new/picked) · id ผิด", async () => {
    const bad: [string, Record<string, unknown>][] = [
      [SIG, { status: "rejected", reason: "ก" }],
      [SIG, { status: "rejected", reason: "ก".repeat(501) }],
      [SIG, { status: "deferred" }],
      [SIG, { status: "deferred", reviewOn: "2020-01-01" }],
      [SIG, { status: "deferred", reviewOn: "ไม่ใช่วัน" }],
      [SIG, { status: "picked" }],
      ["x", { status: "rejected", reason: "ไม่เหมาะ" }],
    ];
    for (const [id, i] of bad) expect((await setSignalStatus(id, i as never)).ok, JSON.stringify(i)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("หยิบเป็นชิ้นแล้ว → needsForce + id ชิ้น · ยืนยันซ้ำส่ง p_force=true", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "content_signal_set_status: สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว — ยืนยันซ้ำด้วย p_force", details: STEP } });
    const r = await setSignalStatus(SIG, { status: "rejected", reason: "ไม่ใช้แล้ว" });
    expect(r).toMatchObject({ ok: false, needsForce: true, pickedStepId: STEP });
    expect(!r.ok && r.error).not.toContain("p_force");
    rpcMock.mockResolvedValue({ data: { id: SIG }, error: null });
    expect((await setSignalStatus(SIG, { status: "rejected", reason: "ไม่ใช้แล้ว", force: true })).ok).toBe(true);
    expect(rpcMock).toHaveBeenLastCalledWith("content_signal_set_status", expect.objectContaining({ p_force: true }));
  });

  it("กลับมาใช้ (new) ไม่ต้องมีเหตุผลและวัน → ส่ง p_status=new", async () => {
    rpcMock.mockResolvedValue({ data: { id: SIG }, error: null });
    expect((await setSignalStatus(SIG, { status: "new" })).ok).toBe(true);
    expect(rpcMock).toHaveBeenLastCalledWith("content_signal_set_status", expect.objectContaining({ p_status: "new", p_reason: null, p_review_on: null }));
  });

  it("22023 ที่ไม่มี detail → ข้อความมาตรฐาน ไม่ถือเป็น force", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "content_signal_set_status: เก็บไว้ก่อนต้องระบุวันกลับมาดู" } });
    const r = await setSignalStatus(SIG, { status: "deferred", reviewOn: future });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.needsForce).toBeUndefined();
  });
});
