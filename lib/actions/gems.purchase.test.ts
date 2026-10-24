// lib/actions/gems.ts — พลอยที่ต้องสั่งซื้อ (0192 G1b): guard owner/admin ทุก action · shop/actor จาก server · ชื่อ arg ตรง migration · input ผิดไม่ถึง DB · summary ไม่เรียก RPC ต้นทุน
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: () => ({}) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidateMock(...a) }));

import * as gems from "./gems";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const markOk = { requested: 1, changed: 1, unchanged: 0, ordered: true, lines: [{ line_id: L1, job_id: U(1), job_no: "JB-0001", canonical_item_id: U(2), is_ordered: true, qty_needed_now: 6, qty_ordered: 6, qty_remaining: 0, qty_excess: 0, changed_after_order: false }] };

beforeEach(() => {
  vi.clearAllMocks();
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: {}, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("สิทธิ์: ทุก action ของหน้าสั่งพลอยต้อง owner/admin — role อื่น/ไม่ login ไม่แตะ DB", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["getGemPurchaseSummary", () => gems.getGemPurchaseSummary()],
    ["getGemPurchaseCost", () => gems.getGemPurchaseCost()],
    ["markGemPurchase", () => gems.markGemPurchase({ lineIds: [L1], ordered: true })],
  ];
  it.each(calls)("%s: staff/ไม่ระบุ role/viewer → ok:false · ไม่เรียก RPC", async (_n, run) => {
    for (const role of ["staff", undefined, "viewer"]) {
      roleMock.mockResolvedValue(role);
      expect(((await run()) as { ok: boolean }).ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it.each(calls)("%s: ไม่มี session → ไม่เรียก RPC", async (_n, run) => {
    requireSessionMock.mockRejectedValue(new Error("no session"));
    expect(((await run()) as { ok: boolean }).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ไม่มี actor (session user) → ไม่เรียก RPC", async () => {
    sessionUserMock.mockResolvedValue(null);
    expect((await gems.markGemPurchase({ lineIds: [L1], ordered: true })).ok).toBe(false);
    expect((await gems.getGemPurchaseSummary()).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("พารามิเตอร์ที่ส่ง RPC: shop/actor จาก server · ชื่อ arg ตรง migration 0192", () => {
  it("getGemPurchaseSummary → gem_purchase_summary เฉพาะ p_shop_id + p_actor · ไม่เรียก RPC ต้นทุนเลย (ต้นทุนแยก action)", async () => {
    rpcMock.mockResolvedValue({ data: { server_now: "2026-10-24T14:00:00+07:00", today_bkk: "2026-10-24", groups: [], unspecified_jobs: [], totals: { groups: 0, jobs: 0, qty_needed_now: 0, qty_ordered: 0, qty_remaining: 0, qty_excess: 0, unspecified_jobs: 0 } }, error: null });
    const r = await gems.getGemPurchaseSummary();
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("gem_purchase_summary", { p_shop_id: SHOP, p_actor: USER });
  });
  it("getGemPurchaseCost → gem_purchase_summary_cost", async () => {
    rpcMock.mockResolvedValue({ data: { today_bkk: "2026-10-24", groups: [], totals: { groups: 0, groups_missing_price: 0, cost_remaining_thb: 0, cost_ordered_thb: 0, complete: true } }, error: null });
    const r = await gems.getGemPurchaseCost();
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("gem_purchase_summary_cost", { p_shop_id: SHOP, p_actor: USER });
  });
  it("markGemPurchase: p_line_ids ไม่ซ้ำ · p_ordered · shop/actor ทับค่าที่ client ยัดมา · revalidate หน้า", async () => {
    rpcMock.mockResolvedValue({ data: markOk, error: null });
    const r = await gems.markGemPurchase({ lineIds: [L1, L1, L2], ordered: true, ...({ p_actor: "evil", p_shop_id: "evil" } as object) } as never);
    expect(r.ok && r.data.changed === 1 && r.data.lines[0].lineId === L1).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("gem_purchase_mark", { p_line_ids: [L1, L2], p_ordered: true, p_shop_id: SHOP, p_actor: USER });
    expect(revalidateMock).toHaveBeenCalledWith("/jobs/gems-to-buy");
  });
  it("ยกเลิกติ๊ก (undo) ส่ง p_ordered=false", async () => {
    rpcMock.mockResolvedValue({ data: { ...markOk, ordered: false }, error: null });
    await gems.markGemPurchase({ lineIds: [L1], ordered: false });
    expect(rpcMock).toHaveBeenCalledWith("gem_purchase_mark", { p_line_ids: [L1], p_ordered: false, p_shop_id: SHOP, p_actor: USER });
  });
});

describe("input ผิด → ปฏิเสธก่อนถึง DB (purchase_lines_invalid)", () => {
  const bad: [string, unknown][] = [
    ["ไม่ใช่ object", null],
    ["lineIds ไม่ใช่ array", { lineIds: L1, ordered: true }],
    ["lineIds ว่าง", { lineIds: [], ordered: true }],
    ["มี id ไม่ใช่ uuid", { lineIds: [L1, "x"], ordered: true }],
    ["มี null", { lineIds: [L1, null], ordered: true }],
    ["เกิน 200 แถว", { lineIds: Array.from({ length: 201 }, (_v, i) => U(i + 1)), ordered: true }],
    ["ordered ไม่ใช่ boolean", { lineIds: [L1], ordered: "true" }],
    ["ไม่ส่ง ordered", { lineIds: [L1] }],
  ];
  it.each(bad)("%s", async (_n, input) => {
    const r = await gems.markGemPurchase(input as never);
    expect(r.ok === false && r.code === "purchase_lines_invalid").toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("200 แถวพอดีผ่าน (ต้องไม่พัง)", async () => {
    rpcMock.mockResolvedValue({ data: markOk, error: null });
    const r = await gems.markGemPurchase({ lineIds: Array.from({ length: 200 }, (_v, i) => U(i + 1)), ordered: true });
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("error ของ DB → ข้อความไทย + code (ไม่ส่งข้อความดิบ/ราคา)", () => {
  it.each([
    ["job_closed", "22023"],
    ["gem_stage_started", "22023"],
    ["purchase_line_not_found", "22023"],
  ])("hint %s → ok:false พร้อม code เดียวกัน", async (hint, code) => {
    rpcMock.mockResolvedValue({ data: null, error: { code, hint, message: "ใบงาน JB-0001 ปิดหรือยกเลิกแล้ว — ติ๊กสั่งแล้วไม่ได้" } });
    const r = await gems.markGemPurchase({ lineIds: [L1], ordered: true });
    expect(r.ok === false && r.code === hint && /[ก-๛]/.test(r.error)).toBe(true);
    expect(revalidateMock).not.toHaveBeenCalled();
  });
  it("42501 (ไม่ใช่ owner/admin ที่ DB) → ข้อความไม่มีสิทธิ์ ไม่ใช่ข้อความดิบ", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", hint: "gem_actor_forbidden", message: "raw db text" } });
    const r = await gems.getGemPurchaseCost();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("raw db text");
  });
  it("ผลจาก DB ผิดรูป → GENERIC error (ไม่แสดงยอดที่ตรวจไม่ได้)", async () => {
    rpcMock.mockResolvedValue({ data: { groups: "x" }, error: null });
    expect((await gems.getGemPurchaseSummary()).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: { nope: 1 }, error: null });
    expect((await gems.markGemPurchase({ lineIds: [L1], ordered: true })).ok).toBe(false);
    expect((await gems.getGemPurchaseCost()).ok).toBe(false);
  });
});
