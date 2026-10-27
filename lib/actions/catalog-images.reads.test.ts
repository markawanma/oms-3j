// lib/actions/catalog-images.reads.test.ts — H1 Phase 2: owner-level read gate on getProductImages
// (signed URLs of product photos; only caller = ProductImageSection inside /catalog, owner/admin-only at the page).
// Writes (upload/delete/reorder) already call requireOwnerAdmin — not touched here.
//   ห้ามผ่าน  : anonymous / pending / staff member / DEV_ROLE=staff -> {ok:false}, DB (and storage signing) never touched
//   ต้องไม่พัง: owner / admin / DEV_ROLE=owner -> same rows as before; empty productId still validated for a permitted caller
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, gateMatrix, setAuth, setTables, touchedDb } from "./test-support/h1-harness";

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

import { getProductImages } from "./catalog-images";

const DENIED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการรูปสินค้าได้";

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

describe("getProductImages — READ-owner gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(h, "owner", { call: () => getProductImages("p-1"), tables: { product_image: { data: [], error: null } } }, DENIED);
});

describe("getProductImages — ลำดับ guard/validation + owner path", () => {
  it("productId ว่าง + ไม่มี session -> ข้อความ guard ไม่ใช่ 'ไม่พบสินค้า' (guard มาก่อน validation)", async () => {
    setAuth(h, AUTH.noSession);

    await expect(getProductImages("")).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
  });

  it("productId ว่าง + staff member -> ข้อความ denied ของโดเมน", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(getProductImages("  ")).resolves.toEqual({ ok: false, error: DENIED });
  });

  it("productId ว่าง + owner -> ยัง validate ตามเดิม ไม่แตะ DB", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(getProductImages("")).resolves.toEqual({ ok: false, error: "ไม่พบสินค้าที่จะดูรูป" });
    expect(touchedDb(h)).toBe(false);
  });

  it("owner: ไม่มีรูป -> ok:true data:[] (query ผูก product_image)", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { product_image: { data: [], error: null } });

    await expect(getProductImages("p-1")).resolves.toEqual({ ok: true, data: [] });
    expect(h.fromMock).toHaveBeenCalledWith("product_image");
  });
});
