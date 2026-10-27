// lib/actions/catalog.reads.test.ts — H1 Phase 2: owner-level read gate on the 4 catalog.ts reads
// (getProducts = unit_cost/margin of EVERY SKU · getSkuOrderAlerts · getShopSetting · getBlendedMarginSuggestion).
// Every caller (/catalog, /settings, /marketing/copilot) is owner/admin-only at the page (design §1.4).
// The write exports already carried requireWriteAccess(requireOwnerAdmin) — not touched here.
//   ห้ามผ่าน  : anonymous / auth-env broken / pending / staff member / DEV_ROLE=staff -> {ok:false}, DB never touched
//   ต้องไม่พัง: owner / admin (gate on) and DEV_ROLE=owner reach the DB and get the same mapped result as before
// Mocks sit on the session/role-input layer (test-support/h1-harness.ts) — action-guard.ts and role.ts are REAL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, gateMatrix, setAuth, setTables, touchedDb, type GateCase } from "./test-support/h1-harness";

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

import { getBlendedMarginSuggestion, getProducts, getShopSetting, getSkuOrderAlerts } from "./catalog";

const DENIED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไขสินค้า/ต้นทุนได้";

const SHOP_SETTING_ROW = {
  silver_spot_thb_per_gram: "30.5",
  silver_spot_updated_at: "2026-10-27T01:00:00Z",
  blended_margin_pct: "0.25",
  target_ad_gp_share: "0.5",
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

const CASES: [string, GateCase][] = [
  ["getProducts", { call: () => getProducts() }],
  ["getSkuOrderAlerts", { call: () => getSkuOrderAlerts() }],
  ["getShopSetting", { call: () => getShopSetting(), tables: { shop_setting: { data: SHOP_SETTING_ROW, error: null } } }],
  [
    "getBlendedMarginSuggestion",
    {
      call: () => getBlendedMarginSuggestion(),
      tables: { v_blended_margin_suggestion: { data: { products_with_margin: 10, suggested_margin_pct: "0.31" }, error: null } },
    },
  ],
];

for (const [name, c] of CASES) {
  describe(`${name} — READ-owner gate (requireWriteAccess + requireOwnerAdmin)`, () => {
    gateMatrix(h, "owner", c, DENIED);
  });
}

describe("catalog reads — owner path เท่าเดิม", () => {
  it("getShopSetting: owner ได้ค่า spot/margin และ ROAS ที่คำนวณเหมือนก่อนใส่ guard", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { shop_setting: { data: SHOP_SETTING_ROW, error: null } });

    await expect(getShopSetting()).resolves.toEqual({
      ok: true,
      data: {
        silverSpotThbPerGram: 30.5,
        silverSpotUpdatedAt: "2026-10-27T01:00:00Z",
        blendedMarginPct: 0.25,
        targetAdGpShare: 0.5,
        breakEvenRoas: 4,
        targetRoas: 8,
      },
    });
  });

  it("getBlendedMarginSuggestion: admin ได้ค่าที่ map แล้ว", async () => {
    setAuth(h, AUTH.adminMember);
    setTables(h, { v_blended_margin_suggestion: { data: { products_with_margin: 10, suggested_margin_pct: "0.31" }, error: null } });

    await expect(getBlendedMarginSuggestion()).resolves.toEqual({
      ok: true,
      data: { productsWithMargin: 10, suggestedMarginPct: 0.31 },
    });
  });

  it("getProducts: staff member ที่ยิง action ตรง (ข้ามหน้า /catalog) ไม่ได้ต้นทุนใดๆ — ไม่มี query ไปถึง DB", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, {
      v_dim_product: { data: [{ product_id: "p-1", sku: "R-001", effective_unit_cost: "123.45" }], error: null, count: 1 },
    });

    const r = await getProducts();
    expect(r).toEqual({ ok: false, error: DENIED });
    expect(JSON.stringify(r)).not.toContain("123.45");
    expect(touchedDb(h)).toBe(false);
  });

  it("guard อยู่นอก try/catch: ข้อความ denied ไม่ถูกทับเป็น 'โหลด...ไม่สำเร็จ'", async () => {
    setAuth(h, AUTH.pending);

    const r = (await getShopSetting()) as { ok: false; error: string };
    expect(r.error).toBe(DENIED);
    expect(r.error).not.toMatch(/ไม่สำเร็จ/);
  });

  it("DB error + owner -> ข้อความ error เดิมของ action (guard ไม่กลบความล้มเหลวของ DB)", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { shop_setting: { data: null, error: new Error("boom") } });

    await expect(getShopSetting()).resolves.toEqual({
      ok: false,
      error: "โหลดการตั้งค่าราคา/มาร์จิ้นไม่สำเร็จ ลองใหม่อีกครั้ง",
    });
  });
});
