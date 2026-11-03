// lib/auth/role-gate.actions.qa.test.ts — QA (R2-D2) 3 พ.ย. 69, branch fix/dev-role-prod-fallback.
// ด่านใน action ถูกแปลงจาก denylist (`=== "staff"`) เป็น allowlist (`!isOwnerOrAdmin(...)`) ทั้งระบบ.
// ไฟล์นี้พิสูจน์ที่ "ชั้น action จริง" (ไม่ mock isOwnerOrAdmin) ว่า:
//   - role แปลกที่ cast เข้ามา (ซึ่ง denylist เดิมปล่อยผ่าน) ถูกปฏิเสธ / ถูกซ่อนเงิน
//   - owner/admin ยังผ่าน (ต้องไม่พัง)
// Mock เฉพาะ getEffectiveRole + supabase + dev context — เหมือนเทสต์ action ไฟล์อื่นของ repo.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));
vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));
vi.mock("@/lib/auth/action-guard", () => ({
  denyIfNotMember: async () => null,
  requireWriteAccess: async (fn: () => unknown) => await fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

// roles the old denylist (`=== "staff"` / `!== "staff"`) would have let through as "elevated"
const WEIRD_ROLES: unknown[] = ["superadmin", "viewer", "Owner", "ADMIN", "", " owner", null, undefined, 0, {}];
const label = (r: unknown): string =>
  typeof r === "string" ? JSON.stringify(r) : typeof r === "object" && r !== null ? "{}" : String(r);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("gem-quiz-stats: getGemQuizStats (owner/admin only)", () => {
  const INPUT = { from: "2026-09-01", to: "2026-10-01", includeRetake: false };

  for (const r of ["staff", ...WEIRD_ROLES]) {
    it(`role=${label(r)} -> denied, RPC never called`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { getGemQuizStats } = await import("@/lib/actions/gem-quiz-stats");
      const res = await getGemQuizStats(INPUT);
      expect(res.ok).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    });
  }

  for (const r of ["owner", "admin"]) {
    it(`role=${r} -> passes the gate (RPC reached)`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { getGemQuizStats } = await import("@/lib/actions/gem-quiz-stats");
      await getGemQuizStats(INPUT);
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });
  }

  it("getEffectiveRole rejects -> never reaches the RPC (fail closed)", async () => {
    getEffectiveRoleMock.mockRejectedValue(new Error("auth down"));
    const { getGemQuizStats } = await import("@/lib/actions/gem-quiz-stats");
    const res = await getGemQuizStats(INPUT).catch(() => ({ ok: false as const }));
    expect(res.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("oem: saveMetalPrice / saveMetalPriceInput (cost-structure actions, owner/admin only)", () => {
  for (const r of ["staff", ...WEIRD_ROLES]) {
    it(`saveMetalPrice role=${label(r)} -> denied, RPC never called`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { saveMetalPrice } = await import("@/lib/actions/oem");
      const res = await saveMetalPrice({ metal: "silver", priceThbPerGram: 67.7 });
      expect(res.ok).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it(`saveMetalPriceInput role=${label(r)} -> denied, RPC never called`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { saveMetalPriceInput } = await import("@/lib/actions/oem");
      const res = await saveMetalPriceInput({ metal: "gold", inputValue: 41250 });
      expect(res.ok).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    });
  }

  for (const r of ["owner", "admin"]) {
    it(`saveMetalPrice role=${r} -> passes the gate (RPC reached)`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { saveMetalPrice } = await import("@/lib/actions/oem");
      await saveMetalPrice({ metal: "silver", priceThbPerGram: 67.7 });
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });
  }
});

describe("crm-retention: getCrmRetention hides THB figures + pull-list unless owner/admin", () => {
  const LADDER = { as_of: "2026-11-01", max_order_date: null, customers_total: 0, cells: [] };
  const COHORT = { as_of: null, excluded_orders_no_customer: 0, weeks: [], baseline: [] };

  function wireRpc(): void {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "crm_recency_ladder" ? { data: LADDER, error: null } : { data: COHORT, error: null },
    );
  }
  function ladderArgs(): Record<string, unknown> {
    const call = rpcMock.mock.calls.find((c) => c[0] === "crm_recency_ladder");
    expect(call).toBeDefined();
    return call![1] as Record<string, unknown>;
  }

  for (const r of ["staff", ...WEIRD_ROLES]) {
    it(`role=${label(r)} -> p_include_money=false and canPullList=false`, async () => {
      wireRpc();
      getEffectiveRoleMock.mockResolvedValue(r);
      const { getCrmRetention } = await import("@/lib/actions/crm-retention");
      const res = await getCrmRetention();
      expect(ladderArgs().p_include_money).toBe(false);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.canPullList).toBe(false);
    });
  }

  for (const r of ["owner", "admin"]) {
    it(`role=${r} -> p_include_money=true and canPullList=true (must not break)`, async () => {
      wireRpc();
      getEffectiveRoleMock.mockResolvedValue(r);
      const { getCrmRetention } = await import("@/lib/actions/crm-retention");
      const res = await getCrmRetention();
      expect(ladderArgs().p_include_money).toBe(true);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.canPullList).toBe(true);
    });
  }
});

describe("marketing/piece-server: requireOwnerAdmin (first line of every content action)", () => {
  for (const r of ["staff", ...WEIRD_ROLES]) {
    it(`role=${label(r)} -> denied`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { requireOwnerAdmin } = await import("@/lib/marketing/piece-server");
      const res = await requireOwnerAdmin();
      expect(res).not.toBeNull();
      expect(res?.ok).toBe(false);
    });
  }
  for (const r of ["owner", "admin"]) {
    it(`role=${r} -> null (allowed)`, async () => {
      getEffectiveRoleMock.mockResolvedValue(r);
      const { requireOwnerAdmin } = await import("@/lib/marketing/piece-server");
      expect(await requireOwnerAdmin()).toBeNull();
    });
  }
});
