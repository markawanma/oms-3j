// lib/actions/stock.test.ts — H1 Phase 3: in-action authz guard on stock.ts (design §1.5 / §5).
//   listStock   -> READ-member : /stock is not role-gated at the page, so a staff MEMBER keeps the screen
//   adjustStock -> WRITE       : requireWriteAccess(requireOwnerAdmin) — rewrites the on_hand ledger
//   ห้ามผ่าน  : gate on + anonymous / auth-env broken / pending -> {ok:false}, DB never touched;
//              WRITE additionally refuses a staff member and DEV_ROLE=staff; guard text wins over input validation
//   ต้องไม่พัง: gate off DEV flow unchanged · owner passes · staff member keeps listStock · adjust_stock RPC args unchanged
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, chain, gateMatrix, MSG, setAuth, setTables, touchedDb } from "./test-support/h1-harness";

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

import { adjustStock, listStock } from "./stock";

const DENIED_WRITE = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ปรับสต็อกได้";
const STOCK_ROW = { product_id: "p-1", qty_on_hand: 5, qty_reserved: 1, product: { sku: "R-001", name: "แหวนทดสอบ" } };

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

/** adjust_stock is awaited via .maybeSingle(), so the rpc mock must return a builder, not a Promise. */
function wireAdjust(): void {
  h.rpcMock.mockReturnValue(chain({ data: { qty_on_hand: 8, qty_reserved: 1 }, error: null }));
}

describe("listStock — READ-member gate", () => {
  gateMatrix(h, "member", { call: () => listStock(""), tables: { central_stock: { data: [STOCK_ROW], error: null } } }, "");
});

describe("adjustStock — WRITE gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(
    h,
    "owner",
    { call: () => adjustStock("p-1", 8), tables: { central_stock: { data: STOCK_ROW, error: null } }, setup: wireAdjust },
    DENIED_WRITE,
  );
});

describe("listStock — ข้อมูลที่ staff member เห็นต้องเท่า owner (ไม่ mask เพิ่ม)", () => {
  it("staff member ได้ sku/ชื่อ/จำนวน เท่ากับ owner", async () => {
    setTables(h, { central_stock: { data: [STOCK_ROW], error: null } });

    setAuth(h, AUTH.ownerMember);
    const asOwner = await listStock("");
    setAuth(h, AUTH.staffMember);
    const asStaff = await listStock("");

    expect(asStaff).toEqual(asOwner);
    expect(asStaff).toEqual({
      ok: true,
      data: [{ productId: "p-1", sku: "R-001", name: "แหวนทดสอบ", qtyOnHand: 5, qtyReserved: 1 }],
    });
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'โหลดข้อมูลสต็อกไม่สำเร็จ' (pending ยิง listStock)", async () => {
    setAuth(h, AUTH.pending);

    const r = (await listStock("แหวน")) as { ok: false; error: string };
    expect(r.error).toBe(MSG.notApproved);
    expect(r.error).not.toMatch(/ไม่สำเร็จ/);
  });
});

describe("adjustStock — guard อยู่บรรทัดแรก ก่อน validate input และ owner path เท่าเดิม", () => {
  it("จำนวนติดลบ + ไม่มี session -> ข้อความ guard ไม่ใช่ validation", async () => {
    setAuth(h, AUTH.noSession);

    await expect(adjustStock("p-1", -1)).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("จำนวนติดลบ + staff member -> ข้อความ denied ของโดเมน", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(adjustStock("p-1", -1)).resolves.toEqual({ ok: false, error: DENIED_WRITE });
  });

  it("จำนวนติดลบ + owner -> ยัง validate ตามเดิม ไม่แตะ DB", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(adjustStock("p-1", -1)).resolves.toEqual({ ok: false, error: "จำนวนสต็อกต้องเป็นจำนวนเต็มไม่ติดลบ" });
    expect(touchedDb(h)).toBe(false);
  });

  it("owner: delta คำนวณจาก on_hand ปัจจุบัน -> adjust_stock ถูกเรียกด้วย arg เดิม และคืนแถวใหม่", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { central_stock: { data: STOCK_ROW, error: null } });
    wireAdjust();

    const r = await adjustStock("p-1", 8);

    expect(h.rpcMock).toHaveBeenCalledWith(
      "adjust_stock",
      expect.objectContaining({ p_shop_id: "shop-1", p_product_id: "p-1", p_qty_delta: 3, p_idem_key: expect.stringMatching(/^ui:adjust:p-1:/) }),
    );
    expect(r).toEqual({ ok: true, data: { productId: "p-1", sku: "R-001", name: "แหวนทดสอบ", qtyOnHand: 8, qtyReserved: 1 } });
  });

  it("owner: ค่าเท่าเดิม (delta 0) -> ไม่เรียก RPC (พฤติกรรมเดิม)", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { central_stock: { data: STOCK_ROW, error: null } });

    await expect(adjustStock("p-1", 5)).resolves.toMatchObject({ ok: true, data: { qtyOnHand: 5 } });
    expect(h.rpcMock).not.toHaveBeenCalled();
  });

  it("ห้ามผ่าน: staff member / pending ยิง adjustStock ตรง -> adjust_stock ไม่ถูกเรียกเลย", async () => {
    for (const auth of [AUTH.staffMember, AUTH.pending, AUTH.noSession, AUTH.gateOffStaff]) {
      h.rpcMock.mockClear();
      h.fromMock.mockClear();
      setAuth(h, auth);
      setTables(h, { central_stock: { data: STOCK_ROW, error: null } });
      wireAdjust();

      await expect(adjustStock("p-1", 99)).resolves.toMatchObject({ ok: false });
      expect(h.rpcMock).not.toHaveBeenCalled();
      expect(h.fromMock).not.toHaveBeenCalled();
    }
  });
});
