// lib/actions/quick-order.test.ts — H1 Phase 3: in-action authz guard on quick-order.ts (design §1.5 / §5).
//   searchProductsForLive -> READ-member : any shop member incl. staff
//   createQuickOrder      -> WRITE       : requireWriteAccess(requireOwnerAdmin), FIRST statement (before validateInput)
//   ห้ามผ่าน  : anonymous / auth-env broken / pending -> {ok:false}; WRITE also refuses staff member + DEV_ROLE=staff;
//              DB never touched (no order row, no reserve_stock) — guard text wins over input validation
//   ต้องไม่พัง: owner path identical, INCLUDING the oversell path: reserve_stock fails -> order flips to oversold_hold and
//              the caller still gets ok:true + oversold:true + availableQty; channel_account is still resolved through the
//              helper that moved to lib/live/channel-account.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, gateMatrix, MSG, setAuth, setTables, touchedDb } from "./test-support/h1-harness";

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

import { createQuickOrder, searchProductsForLive } from "./quick-order";

const DENIED_WRITE = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จดออเดอร์ไลฟ์ได้";
const INPUT = { liveSessionId: "ls-1", buyerName: "คุณเอ", items: [{ productId: "p-1", qty: 2, unitPrice: 100 }] };

const ORDER_TABLES = {
  channel_account: { data: { id: "ca-1" }, error: null },
  live_session: { data: { id: "ls-1", status: "open" }, error: null },
  product: { data: [{ id: "p-1", sku: "R-001" }], error: null },
  orders: { data: { id: "o-1", external_order_id: "LIVE-20261027-abc123" }, error: null },
  order_item: { data: null, error: null },
  central_stock: { data: [{ product_id: "p-1", qty_on_hand: 1, qty_reserved: 0 }], error: null },
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

describe("searchProductsForLive — READ-member gate", () => {
  gateMatrix(
    h,
    "member",
    {
      call: () => searchProductsForLive("แหวน"),
      tables: { product: { data: [{ id: "p-1", sku: "R-001", name: "แหวน", central_stock: { qty_on_hand: 5, qty_reserved: 2 } }], error: null } },
    },
    "",
  );
});

describe("createQuickOrder — WRITE gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(
    h,
    "owner",
    { call: () => createQuickOrder({ ...INPUT, items: [...INPUT.items] }), tables: ORDER_TABLES, allowed: (r) => r.ok === true && r.data.oversold === false },
    DENIED_WRITE,
  );
});

describe("searchProductsForLive — staff member ได้ available เท่าเดิม", () => {
  it("staff member: available = on_hand - reserved", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, { product: { data: [{ id: "p-1", sku: "R-001", name: "แหวน", central_stock: [{ qty_on_hand: 5, qty_reserved: 2 }] }], error: null } });

    await expect(searchProductsForLive("")).resolves.toEqual({
      ok: true,
      data: [{ id: "p-1", sku: "R-001", name: "แหวน", available: 3 }],
    });
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'ค้นหาสินค้าไม่สำเร็จ' (pending)", async () => {
    setAuth(h, AUTH.pending);

    await expect(searchProductsForLive("x")).resolves.toEqual({ ok: false, error: MSG.notApproved });
  });
});

describe("createQuickOrder — guard อยู่บรรทัดแรก ก่อน validateInput", () => {
  it("items ว่าง + ไม่มี session -> ข้อความ guard ไม่ใช่ 'กรุณาเพิ่มสินค้า'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(createQuickOrder({ ...INPUT, items: [] })).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("items ว่าง + staff member -> ข้อความ denied ของโดเมน", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(createQuickOrder({ ...INPUT, items: [] })).resolves.toEqual({ ok: false, error: DENIED_WRITE });
  });

  it("items ว่าง + owner -> ยัง validate ตามเดิม ไม่แตะ DB", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(createQuickOrder({ ...INPUT, items: [] })).resolves.toEqual({ ok: false, error: "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ" });
    expect(touchedDb(h)).toBe(false);
  });

  it("ห้ามผ่าน: staff member / pending / ไม่มี session / DEV_ROLE=staff ยิงตรง -> ไม่มีออเดอร์ถูกสร้าง และ reserve_stock ไม่ถูกเรียก", async () => {
    for (const auth of [AUTH.staffMember, AUTH.pending, AUTH.noSession, AUTH.sessionThrows, AUTH.gateOffStaff]) {
      h.fromMock.mockClear();
      h.rpcMock.mockClear();
      setAuth(h, auth);
      setTables(h, ORDER_TABLES);

      await expect(createQuickOrder({ ...INPUT, items: [...INPUT.items] })).resolves.toMatchObject({ ok: false });
      expect(h.fromMock).not.toHaveBeenCalled();
      expect(h.rpcMock).not.toHaveBeenCalled();
    }
  });
});

describe("createQuickOrder — owner path เท่าเดิม (reserve / oversell ไม่เปลี่ยน)", () => {
  it("สต็อกพอ: reserve_stock ถูกเรียกด้วย arg เดิม · oversold:false · ไม่มี update oversold_hold", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, ORDER_TABLES);

    const r = await createQuickOrder({ ...INPUT, items: [...INPUT.items] });

    expect(r).toEqual({ ok: true, data: { orderId: "o-1", externalOrderId: "LIVE-20261027-abc123", oversold: false } });
    expect(h.rpcMock).toHaveBeenCalledTimes(1);
    expect(h.rpcMock).toHaveBeenCalledWith("reserve_stock", {
      p_shop_id: "shop-1",
      p_order_id: "o-1",
      p_idem_key: "ui:reserve:o-1",
      p_items: [{ product_id: "p-1", qty: 2 }],
    });
    // orders touched once (insert) — no hold update
    expect(h.fromMock.mock.calls.filter((c) => c[0] === "orders")).toHaveLength(1);
  });

  it("reserve_stock ล้ม (สต็อกไม่พอ): ออเดอร์ถูกพลิกเป็น oversold_hold (orders ถูกแตะ 2 ครั้ง: insert + update) และได้ oversold:true + availableQty", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, ORDER_TABLES, { data: null, error: { code: "P0001", message: "insufficient stock" } });

    const r = await createQuickOrder({ ...INPUT, items: [...INPUT.items] });

    expect(r).toEqual({
      ok: true,
      data: { orderId: "o-1", externalOrderId: "LIVE-20261027-abc123", oversold: true, availableQty: { "p-1": 1 } },
    });
    expect(h.fromMock.mock.calls.filter((c) => c[0] === "orders")).toHaveLength(2);
    expect(h.fromMock.mock.calls.filter((c) => c[0] === "central_stock")).toHaveLength(1);
  });

  it("ผลของ oversell path เท่ากันเป๊ะระหว่าง gate off (DEV owner) กับ gate on (owner)", async () => {
    setTables(h, ORDER_TABLES, { data: null, error: { code: "P0001", message: "insufficient stock" } });

    setAuth(h, AUTH.gateOffOwner);
    const dev = await createQuickOrder({ ...INPUT, items: [...INPUT.items] });
    setAuth(h, AUTH.ownerMember);
    const prod = await createQuickOrder({ ...INPUT, items: [...INPUT.items] });

    expect(prod).toEqual(dev);
    expect(prod).toMatchObject({ ok: true, data: { oversold: true } });
  });

  it("channel_account ยังถูกหาผ่าน helper ที่ย้ายไป lib/live/channel-account.ts: ไม่มี manual-live -> ล้มก่อนสร้างออเดอร์", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { ...ORDER_TABLES, channel_account: { data: null, error: null } });

    await expect(createQuickOrder({ ...INPUT, items: [...INPUT.items] })).resolves.toEqual({
      ok: false,
      error: "จดออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง",
    });
    expect(h.fromMock.mock.calls.filter((c) => c[0] === "orders")).toHaveLength(0);
    expect(h.rpcMock).not.toHaveBeenCalled();
  });

  it("ไลฟ์ปิดแล้ว (owner) -> ข้อความเดิม ไม่สร้างออเดอร์", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { ...ORDER_TABLES, live_session: { data: { id: "ls-1", status: "closed" }, error: null } });

    await expect(createQuickOrder({ ...INPUT, items: [...INPUT.items] })).resolves.toEqual({
      ok: false,
      error: "ไลฟ์นี้ปิดไปแล้ว ไม่สามารถจดออเดอร์เพิ่มได้",
    });
    expect(h.rpcMock).not.toHaveBeenCalled();
  });
});
