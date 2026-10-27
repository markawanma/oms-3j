// lib/actions/catalog-sku.reads.test.ts — H1 Phase 2: owner-level read gate on listSkuPrefixes.
// Callers: /catalog/sku-prefix, ProductionAddItemForm (/production/*), QuoteCalculatorClient (/oem/quote) — all
// owner/admin-only at the page, so the gate removes no working flow (design §1.4). Writes already guard — not touched.
//   ห้ามผ่าน  : anonymous / pending / staff member / DEV_ROLE=staff -> {ok:false}, DB never touched
//             (including withLastNo:true, so an outsider cannot trigger the N+1 RPC fan-out)
//   ต้องไม่พัง: owner -> prefix rows as before · withLastNo:true -> one sku_prefix_preview_seed RPC per prefix (fan-out unchanged)
//             · withLastNo default/false -> zero RPCs
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

import { listSkuPrefixes } from "./catalog-sku";

const DENIED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไข prefix/สินค้าได้";

const PREFIX_ROWS = [
  { id: "pf-1", kind_label: "แหวน", work_type: "oem", prefix: "R", pad_width: 3, created_at: "2026-01-01" },
  { id: "pf-2", kind_label: "สร้อย", work_type: "oem", prefix: "N", pad_width: "4", created_at: "2026-01-02" },
];
const SEED_RPC = { data: [{ suggested_seed: 7, suggested_pad_width: 3 }], error: null };

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

describe("listSkuPrefixes — READ-owner gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(h, "owner", { call: () => listSkuPrefixes(), tables: { sku_prefix: { data: PREFIX_ROWS, error: null } } }, DENIED);
});

describe("listSkuPrefixes({ withLastNo: true }) — READ-owner gate", () => {
  gateMatrix(
    h,
    "owner",
    {
      call: () => listSkuPrefixes({ withLastNo: true }),
      tables: { sku_prefix: { data: PREFIX_ROWS, error: null } },
      rpcResult: SEED_RPC,
    },
    DENIED,
  );
});

describe("listSkuPrefixes — owner path เท่าเดิม", () => {
  it("withLastNo:true + owner -> fan-out RPC ต่อ prefix (2 ครั้ง) ด้วย arg เดิม และได้ lastNo", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { sku_prefix: { data: PREFIX_ROWS, error: null } }, SEED_RPC);

    const r = await listSkuPrefixes({ withLastNo: true });

    expect(h.rpcMock).toHaveBeenCalledTimes(2);
    expect(h.rpcMock).toHaveBeenCalledWith("sku_prefix_preview_seed", { p_shop_id: "shop-1", p_prefix: "R" });
    expect(h.rpcMock).toHaveBeenCalledWith("sku_prefix_preview_seed", { p_shop_id: "shop-1", p_prefix: "N" });
    expect(r).toMatchObject({
      ok: true,
      data: [
        { id: "pf-1", prefix: "R", lastNo: 7, padWidth: 3 },
        { id: "pf-2", prefix: "N", lastNo: 7, padWidth: 4 },
      ],
    });
  });

  it("withLastNo ไม่ส่ง + owner -> ไม่มี RPC เลย (QuoteCalculatorClient/ProductionAddItemForm ไม่โดน N+1) และ lastNo เป็น null", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { sku_prefix: { data: PREFIX_ROWS, error: null } });

    const r = await listSkuPrefixes();

    expect(h.rpcMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, data: [{ lastNo: null }, { lastNo: null }] });
  });

  it("withLastNo:true + staff member / pending / ไม่มี session -> ไม่มี RPC fan-out และไม่แตะ DB", async () => {
    for (const auth of [AUTH.staffMember, AUTH.pending, AUTH.noSession]) {
      h.fromMock.mockClear();
      h.rpcMock.mockClear();
      setAuth(h, auth);
      setTables(h, { sku_prefix: { data: PREFIX_ROWS, error: null } }, SEED_RPC);

      await expect(listSkuPrefixes({ withLastNo: true })).resolves.toMatchObject({ ok: false });
      expect(touchedDb(h)).toBe(false);
    }
  });

  it("guard อยู่นอก try/catch: ข้อความ denied ไม่ถูกทับเป็น 'โหลดรายการ prefix ไม่สำเร็จ'", async () => {
    setAuth(h, AUTH.staffMember);

    const r = (await listSkuPrefixes()) as { ok: false; error: string };
    expect(r.error).toBe(DENIED);
    expect(r.error).not.toMatch(/ไม่สำเร็จ/);
  });
});
