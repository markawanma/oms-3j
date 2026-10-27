// lib/actions/orders.test.ts — H1 Phase 2: in-action authz guard on orders.ts
// (design §1.1 / §5). A server action is a public POST endpoint; the page gate
// does not cover it. These cases pin, per action:
//   ห้ามผ่าน  : gate on + anonymous / pending / auth-env broken -> {ok:false}, DB never touched;
//              WRITE additionally refuses a staff member; guard text wins over input validation
//   ต้องไม่พัง : gate off DEV flow unchanged; owner passes; a staff MEMBER keeps every READ
//              (no extra masking) — only the WRITEs are owner/admin-level
// Mocks sit on the session/role-input layer (see test-support/h1-harness.ts) —
// action-guard.ts and role.ts are the REAL modules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, MSG, setAuth, setTables, touchedDb, type AuthState } from "./test-support/h1-harness";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getMembership: vi.fn(),
  devRole: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", async () => (await import("./test-support/h1-harness")).sessionModuleMock(h));
vi.mock("@/lib/dev/context", async () => (await import("./test-support/h1-harness")).devContextMock(h));
vi.mock("@/lib/supabase/server", async () => (await import("./test-support/h1-harness")).supabaseServerMock(h));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  advanceOrder,
  cancelOrder,
  countNewOrdersSince,
  getOrderDetail,
  getPrioritySummary,
  listOrders,
  markShipped,
} from "./orders";

const ORDER_ID = "0b6f1d52-3c1e-4a53-9f55-2a7d6b1c9e01";
const LIST_PARAMS = { channel: "all", status: "all", search: "", cursor: null } as const;
const ORDER_ROW = {
  id: ORDER_ID,
  external_order_id: "EXT-1",
  status: "new",
  buyer_name: "คุณเอ",
  total_amount: "1290.00",
  currency: "THB",
  placed_at: "2026-10-01T03:00:00Z",
  created_at: "2026-10-01T03:00:00Z",
  channel_account_id: "ca-1",
};
const DETAIL_ROW = {
  ...ORDER_ROW,
  external_status: "UNPAID",
  buyer_phone: "0800000000",
  shipping_address: "99 ถนนทดสอบ",
  cancel_reason: null,
};

const originalAuthGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  setAuth(h, AUTH.gateOffOwner);
  setTables(h, {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
});

// ---------------------------------------------------------------------------
// READ-member: listOrders / getOrderDetail / getPrioritySummary / countNewOrdersSince
// ---------------------------------------------------------------------------
const READS: [string, () => Promise<unknown>][] = [
  ["listOrders", () => listOrders({ ...LIST_PARAMS })],
  ["getOrderDetail", () => getOrderDetail(ORDER_ID)],
  ["getPrioritySummary", () => getPrioritySummary()],
  ["countNewOrdersSince", () => countNewOrdersSince("2026-10-01T00:00:00Z")],
];

describe.each(READS)("%s — READ-member gate", (_name, call) => {
  const denied: [string, AuthState, string][] = [
    ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
    ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
    ["gate on + pending (มี session ไม่มี shop_member)", AUTH.pending, MSG.notApproved],
  ];

  it.each(denied)("ห้ามผ่าน: %s -> {ok:false} และ DB ไม่ถูกแตะ", async (_label, auth, error) => {
    setAuth(h, auth);

    await expect(call()).resolves.toEqual({ ok: false, error });
    expect(touchedDb(h)).toBe(false);
  });

  it.each([
    ["gate off + DEV_ROLE=staff (DEV flow เดิม)", AUTH.gateOffStaff],
    ["gate off + DEV_ROLE=owner", AUTH.gateOffOwner],
    ["gate on + owner", AUTH.ownerMember],
    ["gate on + staff member", AUTH.staffMember],
  ])("ต้องไม่พัง: %s -> เข้าถึง DB ได้ตามเดิม", async (_label, auth) => {
    setAuth(h, auth);
    setTables(h, { orders: { data: [ORDER_ROW], error: null, count: 4 } });

    const result = (await call()) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(touchedDb(h)).toBe(true);
  });
});

describe("READ-member — ข้อมูลที่ staff member เห็นต้องเท่า owner เป๊ะ (ไม่ mask เพิ่ม)", () => {
  it("listOrders: staff member ได้ buyerName/ยอดเงิน เท่ากับ owner", async () => {
    setTables(h, {
      orders: { data: [ORDER_ROW], error: null, count: 1 },
      channel_account: { data: [{ id: "ca-1", channel: { code: "tiktok", name: "TikTok" } }], error: null },
    });

    setAuth(h, AUTH.ownerMember);
    const asOwner = await listOrders({ ...LIST_PARAMS });
    setAuth(h, AUTH.staffMember);
    const asStaff = await listOrders({ ...LIST_PARAMS });

    expect(asStaff).toEqual(asOwner);
    expect(asStaff).toMatchObject({
      ok: true,
      data: { rows: [{ buyerName: "คุณเอ", totalAmount: 1290, channelCode: "tiktok" }], nextCursor: null },
    });
  });

  it("getOrderDetail: staff member ได้เบอร์/ที่อยู่เหมือนเดิม (หน้า /orders/[id] เปิดให้ทุก role มาแต่เดิม)", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, {
      orders: { data: DETAIL_ROW, error: null },
      order_item: { data: [], error: null },
      channel_account: { data: { channel: { code: "line", name: "LINE" } }, error: null },
    });

    await expect(getOrderDetail(ORDER_ID)).resolves.toMatchObject({
      ok: true,
      data: { buyerPhone: "0800000000", shippingAddress: "99 ถนนทดสอบ" },
    });
  });

  it("countNewOrdersSince: staff member ผ่าน (poll ไม่พัง) และคืนจำนวนจาก DB", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, { orders: { data: null, error: null, count: 7 } });

    await expect(countNewOrdersSince("2026-10-01T00:00:00Z")).resolves.toEqual({ ok: true, data: 7 });
  });

  it("getPrioritySummary: staff member ผ่านและคืนตัวนับ 3 ช่อง", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, { orders: { data: null, error: null, count: 2 } });

    await expect(getPrioritySummary()).resolves.toEqual({
      ok: true,
      data: { newCount: 2, oversoldCount: 2, toShipCount: 2 },
    });
  });
});

describe("READ-member — guard อยู่บรรทัดแรก ก่อน validate input และนอก try/catch", () => {
  it("getOrderDetail: id ผิดรูป + ไม่มี session -> ได้ข้อความ guard ไม่ใช่ 'ไม่พบออเดอร์นี้'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(getOrderDetail("not-a-uuid")).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("getOrderDetail: id ผิดรูป + สมาชิก -> ยัง validate ได้ 'ไม่พบออเดอร์นี้' (guard ไม่กลบ validation ของคนที่มีสิทธิ์)", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(getOrderDetail("not-a-uuid")).resolves.toEqual({ ok: false, error: "ไม่พบออเดอร์นี้" });
    expect(touchedDb(h)).toBe(false);
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'โหลด...ไม่สำเร็จ' (pending ยิง listOrders)", async () => {
    setAuth(h, AUTH.pending);

    const result = (await listOrders({ ...LIST_PARAMS })) as { ok: false; error: string };
    expect(result.error).toBe(MSG.notApproved);
    expect(result.error).not.toMatch(/ไม่สำเร็จ/);
  });
});

// ---------------------------------------------------------------------------
// WRITE: advanceOrder / markShipped / cancelOrder
// ---------------------------------------------------------------------------
const DENIED_WRITE = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่เปลี่ยนสถานะออเดอร์ได้";

const WRITES: [string, () => Promise<unknown>][] = [
  ["advanceOrder", () => advanceOrder(ORDER_ID, "new")],
  ["markShipped", () => markShipped(ORDER_ID)],
  ["cancelOrder", () => cancelOrder(ORDER_ID, "ลูกค้าขอยกเลิก")],
];

describe.each(WRITES)("%s — WRITE gate (requireWriteAccess + requireOwnerAdmin)", (_name, call) => {
  const denied: [string, AuthState, string][] = [
    ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
    ["gate on + getSessionUser throw", AUTH.sessionThrows, MSG.needLogin],
    ["gate on + pending (role ยุบเป็น staff)", AUTH.pending, DENIED_WRITE],
    ["gate on + staff member", AUTH.staffMember, DENIED_WRITE],
    ["gate off + DEV_ROLE=staff (default ของ repo)", AUTH.gateOffStaff, DENIED_WRITE],
  ];

  it.each(denied)("ห้ามผ่าน: %s -> {ok:false} และ DB ไม่ถูกแตะ", async (_label, auth, error) => {
    setAuth(h, auth);

    await expect(call()).resolves.toEqual({ ok: false, error });
    expect(touchedDb(h)).toBe(false);
  });

  it.each([
    ["gate off + DEV_ROLE=owner", AUTH.gateOffOwner],
    ["gate on + owner", AUTH.ownerMember],
    ["gate on + admin", AUTH.adminMember],
  ])("ต้องไม่พัง: %s -> ผ่าน guard แล้วทำงานตามเดิม", async (_label, auth) => {
    setAuth(h, auth);
    setTables(h, {
      orders: { data: { status: "to_ship" }, error: null },
      order_item: { data: [{ product_id: "p-1", qty: 2 }], error: null },
    });

    await expect(call()).resolves.toEqual({ ok: true, data: undefined });
    expect(touchedDb(h)).toBe(true);
  });
});

describe("WRITE — guard อยู่บรรทัดแรก ก่อน validate input", () => {
  it("advanceOrder: transition ที่ไม่รองรับ + ไม่มี session -> ข้อความ guard ไม่ใช่ 'ไม่รองรับ'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(advanceOrder(ORDER_ID, "completed")).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("advanceOrder: transition ที่ไม่รองรับ + owner -> ยัง validate ตามเดิม (ต้องไม่พัง)", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(advanceOrder(ORDER_ID, "completed")).resolves.toEqual({
      ok: false,
      error: "การเปลี่ยนสถานะนี้ไม่รองรับผ่านฟังก์ชันนี้",
    });
    expect(touchedDb(h)).toBe(false);
  });

  it("cancelOrder: เหตุผลว่าง + ไม่มี session -> ข้อความ guard ไม่ใช่ 'กรุณาระบุเหตุผล'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(cancelOrder(ORDER_ID, "")).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("cancelOrder: เหตุผลว่าง + staff member -> ข้อความ denied ของโดเมน ไม่ใช่ validation", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(cancelOrder(ORDER_ID, "   ")).resolves.toEqual({ ok: false, error: DENIED_WRITE });
  });

  it("cancelOrder: เหตุผลว่าง + owner -> ยัง validate ตามเดิม", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(cancelOrder(ORDER_ID, "  ")).resolves.toEqual({ ok: false, error: "กรุณาระบุเหตุผลการยกเลิก" });
    expect(touchedDb(h)).toBe(false);
  });
});

describe("WRITE — owner path เท่าเดิม (stock RPC ถูกเรียกด้วย arg เดิม)", () => {
  it("markShipped: owner -> commit_stock p_items จาก order_item + idem key เดิม", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { order_item: { data: [{ product_id: "p-1", qty: 2 }], error: null } });

    await expect(markShipped(ORDER_ID)).resolves.toEqual({ ok: true, data: undefined });
    expect(h.rpcMock).toHaveBeenCalledWith("commit_stock", {
      p_shop_id: "shop-1",
      p_order_id: ORDER_ID,
      p_idem_key: `ui:commit:${ORDER_ID}`,
      p_items: [{ product_id: "p-1", qty: 2 }],
    });
  });

  it("cancelOrder: owner + status new -> release_stock ถูกเรียก · oversold_hold -> ไม่เรียก", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, {
      orders: { data: { status: "new" }, error: null },
      order_item: { data: [{ product_id: "p-1", qty: 1 }], error: null },
    });
    await cancelOrder(ORDER_ID, "ทดสอบ");
    expect(h.rpcMock).toHaveBeenCalledWith("release_stock", expect.objectContaining({ p_order_id: ORDER_ID }));

    h.rpcMock.mockClear();
    setTables(h, { orders: { data: { status: "oversold_hold" }, error: null } });
    await expect(cancelOrder(ORDER_ID, "ทดสอบ")).resolves.toEqual({ ok: true, data: undefined });
    expect(h.rpcMock).not.toHaveBeenCalled();
  });
});
