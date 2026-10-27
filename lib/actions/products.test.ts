// lib/actions/products.test.ts — H1 Phase 3: WRITE gate on createProduct (design §1.5 / §5).
//   ห้ามผ่าน  : gate on + anonymous / auth-env broken -> needLogin; pending / staff member / DEV_ROLE=staff -> denied;
//              DB never touched; guard text wins over input validation (guard is the FIRST statement)
//   ต้องไม่พัง: gate off + DEV_ROLE=owner · owner · admin create the product + its central_stock row exactly as before;
//              duplicate SKU (23505) keeps its message; stock-insert failure still rolls the product back
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

import { createProduct } from "./products";

const DENIED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่เพิ่มสินค้าได้";
const INPUT = { sku: "R-001", name: "แหวนทดสอบ", initialStock: 3 };
const OK_TABLES = {
  product: { data: { id: "p-1" }, error: null },
  central_stock: { data: null, error: null },
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

describe("createProduct — WRITE gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(
    h,
    "owner",
    { call: () => createProduct({ ...INPUT }), tables: OK_TABLES, allowed: (r) => r.ok === true && r.data.productId === "p-1" },
    DENIED,
  );
});

describe("createProduct — guard อยู่บรรทัดแรก ก่อน validate input", () => {
  it("SKU ว่าง + ไม่มี session -> ข้อความ guard ไม่ใช่ 'กรุณากรอก SKU'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(createProduct({ sku: "", name: "x", initialStock: 0 })).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("SKU ว่าง + staff member -> ข้อความ denied ของโดเมน", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(createProduct({ sku: " ", name: "x", initialStock: 0 })).resolves.toEqual({ ok: false, error: DENIED });
  });

  it("SKU ว่าง + owner -> ยัง validate ตามเดิม ไม่แตะ DB", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(createProduct({ sku: " ", name: "x", initialStock: 0 })).resolves.toEqual({ ok: false, error: "กรุณากรอก SKU" });
    expect(touchedDb(h)).toBe(false);
  });

  it("สต็อกเริ่มต้นติดลบ + owner -> ข้อความเดิม", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(createProduct({ ...INPUT, initialStock: -1 })).resolves.toEqual({
      ok: false,
      error: "สต็อกเริ่มต้นต้องเป็นจำนวนเต็มไม่ติดลบ",
    });
  });
});

describe("createProduct — owner path เท่าเดิม", () => {
  it("owner: insert product ก่อน แล้วตาม central_stock (ลำดับตารางเดิม)", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, OK_TABLES);

    await expect(createProduct({ ...INPUT })).resolves.toEqual({ ok: true, data: { productId: "p-1" } });
    expect(h.fromMock.mock.calls.map((c) => c[0])).toEqual(["product", "central_stock"]);
  });

  it("owner: SKU ซ้ำ (23505) -> ข้อความเดิม", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { product: { data: null, error: { code: "23505", message: "dup" } } });

    await expect(createProduct({ ...INPUT })).resolves.toEqual({ ok: false, error: 'SKU "R-001" มีอยู่แล้วในร้านนี้' });
  });

  it("owner: central_stock insert พัง -> rollback ลบ product แล้วคืนข้อความทั่วไป (product ถูกเรียกซ้ำเพื่อ delete)", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { product: { data: { id: "p-1" }, error: null }, central_stock: { data: null, error: { code: "XX000", message: "boom" } } });

    await expect(createProduct({ ...INPUT })).resolves.toEqual({ ok: false, error: "เพิ่มสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(h.fromMock.mock.calls.map((c) => c[0])).toEqual(["product", "central_stock", "product"]);
  });
});
