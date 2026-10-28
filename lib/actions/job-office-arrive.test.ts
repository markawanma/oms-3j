// lib/actions/job-office-arrive.test.ts — 0183 (ออฟฟิศ): กรอก "ได้รับเพิ่มแล้ว" แทนช่าง (ส่วนต่างทางที่ 3 · มติ 20 ต.ค.)
// ตรวจ: สิทธิ์ก่อนถึง DB · input ผิดไม่ถึง RPC · actor/shop ใส่ฝั่ง server (client ทับไม่ได้) · ส่งเฉพาะ params ที่ระบุ · วันที่ ≤ 14 วัน ไม่อนาคต · ผลลัพธ์กรองทีละ key
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const LOT = "22222222-2222-4222-8222-222222222222";
const DISC = "44444444-4444-4444-8444-444444444444";
const DISC2 = "55555555-5555-4555-8555-555555555555";
const WID = "11111111-1111-4111-8111-111111111111";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
let hdrs: Record<string, string> = {};

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }) }));

import { arriveDiscrepancyOffice } from "./job-lots";

const OK_RESULT = { ok: true, action: "arrive", qty: 1, qty_remaining: 1, discrepancy_id: DISC2, arrived_id: "x", lot_job_id: LOT, lot_seq: 1, label: "JB-0038 · ส่วนที่ 1", stage_seq: 7, stage_code: "qc" };
const lastRpc = () => rpcMock.mock.calls.at(-1) as [string, Record<string, unknown>];
const THAI = /[฀-๿]/;

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T05:00:00Z")); // วันไทย 2026-10-12
  vi.clearAllMocks();
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: OK_RESULT, error: null });
  hdrs = { host: "app.example.test", "x-forwarded-proto": "https" };
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("arriveDiscrepancyOffice — สิทธิ์", () => {
  it("staff / ไม่มี session / ไม่มี actor = ไม่ถึง DB", async () => {
    roleMock.mockResolvedValue("staff");
    expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 })).ok).toBe(false);
    roleMock.mockResolvedValue("owner");
    requireSessionMock.mockRejectedValue(new Error("no session"));
    expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 })).ok).toBe(false);
    requireSessionMock.mockResolvedValue(undefined);
    sessionUserMock.mockResolvedValue(null);
    expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("arriveDiscrepancyOffice — params + ผลลัพธ์", () => {
  it("ส่งเฉพาะที่ระบุ · actor/shop มาจาก server (client ทับไม่ได้) · ผลประกอบทีละ key", async () => {
    const r = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: "1", p_actor: "x", p_shop_id: "y", p_weight_g: 99 } as never);
    expect(r).toEqual({ ok: true, data: { qty: 1, qtyRemaining: 1, remainingDiscrepancyId: DISC2, lot: { lotJobId: LOT, lotSeq: 1, label: "JB-0038 · ส่วนที่ 1", stageCode: "qc" } } });
    const [fn, p] = lastRpc();
    expect(fn).toBe("job_discrepancy_arrive");
    expect(p).toEqual({ p_discrepancy_id: DISC, p_qty: 1, p_shop_id: SHOP, p_actor: USER });
  });
  it("ระบุครบ: น้ำหนัก · วันรับ (วันนี้ / ย้อน 14 วันพอดี) · ผู้ถือ · expectedOpen → ส่งทุกตัวด้วยชื่อที่ถูก", async () => {
    await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 2, weightG: "1.234", receivedOn: "2026-10-12", workerId: WID, expectedOpen: 3 });
    expect(lastRpc()[1]).toEqual({ p_discrepancy_id: DISC, p_qty: 2, p_weight_g: 1.234, p_received_on: "2026-10-12", p_worker_id: WID, p_expected_open: 3, p_shop_id: SHOP, p_actor: USER });
    await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, receivedOn: "2026-09-28" });
    expect(lastRpc()[1]).toMatchObject({ p_received_on: "2026-09-28" });
  });
  it("ค่าว่างทุกตัว (null/\"\") = ไม่ส่ง param นั้น (ใช้ค่าเริ่มของ RPC: วันนี้/ผู้รับเดิม)", async () => {
    await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, weightG: null, receivedOn: "", workerId: null, expectedOpen: "" });
    expect(Object.keys(lastRpc()[1]).sort()).toEqual(["p_actor", "p_discrepancy_id", "p_qty", "p_shop_id"]);
  });
  it("ครบทั้งก้อน → remainingDiscrepancyId = null · ผลที่มี key เกินไม่หลุด", async () => {
    rpcMock.mockResolvedValue({ data: { ...OK_RESULT, qty_remaining: 0, discrepancy_id: null, cost_thb: 5, customer: "x" }, error: null });
    const r = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 });
    expect(r.ok && r.data.remainingDiscrepancyId).toBeNull();
    expect(JSON.stringify(r)).not.toContain("cost");
    expect(JSON.stringify(r)).not.toContain("customer");
  });
  it("ผลที่รูปไม่ครบ = ข้อความกลาง (ไม่ ok)", async () => {
    for (const data of [{ ...OK_RESULT, lot_job_id: "x" }, { ...OK_RESULT, qty: null }, { ...OK_RESULT, qty_remaining: "1" }, { ...OK_RESULT, lot_seq: null }]) {
      rpcMock.mockResolvedValue({ data, error: null });
      const r = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 });
      expect(r).toEqual({ ok: false, error: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" });
    }
  });
});

describe("arriveDiscrepancyOffice — เคสห้ามผ่าน (ไม่ถึง DB)", () => {
  it("id ไม่ใช่ uuid · input ไม่ใช่ object · จำนวน 0/ติดลบ/ทศนิยม/คอมมา/เกินเพดาน/NaN/ว่าง", async () => {
    const bads: unknown[] = [
      { discrepancyId: "x", qty: 1 }, { discrepancyId: DISC.toUpperCase().slice(1), qty: 1 }, null, "abc", { qty: 1 },
      { discrepancyId: DISC, qty: 0 }, { discrepancyId: DISC, qty: -2 }, { discrepancyId: DISC, qty: 1.5 }, { discrepancyId: DISC, qty: "1,5" },
      { discrepancyId: DISC, qty: 100001 }, { discrepancyId: DISC, qty: NaN }, { discrepancyId: DISC, qty: "" }, { discrepancyId: DISC },
    ];
    for (const b of bads) expect((await arriveDiscrepancyOffice(b as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("น้ำหนัก 0/ติดลบ/4 ทศนิยม/ข้อความ/NaN/เกินเพดาน · ผู้ถือไม่ใช่ uuid · expectedOpen ผิด", async () => {
    for (const w of [0, "0", -1, "1.2345", "abc", NaN, 100001]) expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, weightG: w } as never)).ok).toBe(false);
    for (const wk of ["x", 123, "11111111-1111-1111-1111-11111111111"]) expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, workerId: wk } as never)).ok).toBe(false);
    for (const e of [0, "x", -1, 2.5]) expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, expectedOpen: e } as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("วันรับ: รูปผิด / วันที่ไม่มีจริง / พรุ่งนี้ / ย้อน 15 วัน = ไม่ถึง DB · วันนี้และย้อน 14 วันพอดี = ผ่าน", async () => {
    for (const d of ["12/10/2026", "2026-02-30", "2026-10-13", "2026-09-27", "x", 20261012, "2024-10-12"]) {
      const r = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, receivedOn: d } as never);
      expect(r.ok, String(d)).toBe(false);
      if (!r.ok) expect(THAI.test(r.error)).toBe(true);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, receivedOn: "2026-10-12" })).ok).toBe(true);
    expect((await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, receivedOn: "2026-09-28" })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});

describe("arriveDiscrepancyOffice — DB ปฏิเสธ (22023 + hint) → ข้อความไทย + code = hint", () => {
  const CASES: [string, string][] = [
    ["arrive_weight_required", "ทอง: ต้องชั่งน้ำหนักชิ้นที่มาถึงก่อน"],
    ["arrive_heavy", "น้ำหนักชิ้นที่มาถึงไม่ตรงกับส่วนที่ขาด — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ"],
    ["weight_unexpected", "ขั้นนี้ไม่ต้องชั่งน้ำหนักชิ้นที่ได้รับเพิ่ม (นับจำนวนอย่างเดียว) — โหลดหน้าใหม่"],
    ["stage_changed", "ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่"],
    ["already_resolved", "ส่วนต่างนี้ชี้แจงแล้วหรือถูกยกเลิกแล้ว"],
    ["who_invalid", "ไม่พบช่างที่เลือก หรือช่างคนนี้ปิดใช้งานอยู่"],
    ["qty_invalid", "จำนวนที่ได้รับเพิ่มต้องมากกว่า 0 และไม่เกินส่วนต่างที่ค้างอยู่"],
    ["date_invalid", "วันที่รับต้องไม่ใช่อนาคต ไม่ก่อนวันที่ขั้นก่อนส่งของ และย้อนหลังได้ไม่เกิน 14 วัน"],
    ["job_closed", "ใบงานนี้ปิดแล้ว รับของเพิ่มไม่ได้"],
    ["discrepancy_not_found", "ไม่พบส่วนต่างนี้ในร้านนี้"],
  ];
  it.each(CASES)("%s", async (hint, message) => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message, hint } });
    const r = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 });
    expect(r).toEqual({ ok: false, error: message, code: hint });
  });
  it("ข้อความ DB ไม่สะอาด (มี snake_case) = ใช้ข้อความสำรองของ hint (ไม่รั่ว internal)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "analytics.job_discrepancy_arrive_core failed p_qty", hint: "arrive_heavy" } });
    const r = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1, weightG: 5 });
    expect(r).toEqual({ ok: false, error: "น้ำหนักชิ้นที่มาถึงไม่ตรงกับส่วนที่ขาด — ชั่งใหม่", code: "arrive_heavy" });
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(DISC);
  });
  it("42501 = ไม่มีสิทธิ์ · error ระบบ = ข้อความกลาง · log ไม่มี id ส่วนต่าง", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied", hint: null } });
    const a = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 });
    expect(!a.ok && a.error).toBe("เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนนี้ได้");
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: `boom ${DISC}`, hint: null } });
    const b = await arriveDiscrepancyOffice({ discrepancyId: DISC, qty: 1 });
    expect(!b.ok && b.error).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(DISC);
  });
});
