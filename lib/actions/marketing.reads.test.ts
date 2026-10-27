// lib/actions/marketing.reads.test.ts — H1 Phase 2: owner-level read gate on the two
// money reads in marketing.ts (design §1.4 / §5 READ-owner). Both callers
// (/marketing/copilot, /marketing/ad-spend) are owner/admin-only at the page, so
// gating the action itself removes nothing a real user can do.
//   ห้ามผ่าน  : anonymous / auth-env broken / pending / staff member / DEV_ROLE=staff -> {ok:false}, DB never touched
//   ต้องไม่พัง: owner / admin (gate on) and DEV_ROLE=owner reach the DB and get the mapped rows as before
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

import { getAdSpendWeekly, getChannelRoas } from "./marketing";

const DENIED = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนการตลาดได้";

const ROAS_ROW = {
  month: "2026-09-01",
  channel_code: "tiktok",
  channel_name: "TikTok",
  orders: "12",
  revenue: "34000.50",
  aov: "2833.38",
  new_customers: 5,
  spend: "4000",
  roas: "8.5",
  profit_roas: "1.7",
  cac: "800",
  break_even_roas: "5",
  target_roas: "10",
};
const SPEND_ROW = {
  week_start: "2026-10-19",
  week_end: "2026-10-25",
  channel_code: "tiktok",
  channel_name: "TikTok",
  spend: "1500",
  impressions: 1000,
  clicks: 40,
  days_entered: 7,
};

const CASES: [string, GateCase][] = [
  ["getChannelRoas", { call: () => getChannelRoas(), tables: { v_channel_perf_roas: { data: [ROAS_ROW], error: null } } }],
  ["getAdSpendWeekly", { call: () => getAdSpendWeekly(), tables: { v_ad_spend_weekly: { data: [SPEND_ROW], error: null } } }],
];

for (const [name, c] of CASES) {
  describe(`${name} — READ-owner gate (requireWriteAccess + requireOwnerAdmin)`, () => {
    gateMatrix(h, "owner", c, DENIED);
  });
}

describe("marketing reads — owner path เท่าเดิม", () => {
  it("getChannelRoas: owner ได้ตัวเลขที่ map แล้ว (Number()) เหมือนก่อนใส่ guard", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { v_channel_perf_roas: { data: [ROAS_ROW], error: null } });

    await expect(getChannelRoas()).resolves.toEqual({
      ok: true,
      data: [
        {
          month: "2026-09-01",
          channelCode: "tiktok",
          channelName: "TikTok",
          orders: 12,
          revenue: 34000.5,
          aov: 2833.38,
          newCustomers: 5,
          spend: 4000,
          roas: 8.5,
          profitRoas: 1.7,
          cac: 800,
          breakEvenRoas: 5,
          targetRoas: 10,
        },
      ],
    });
  });

  it("guard อยู่นอก try/catch: ข้อความ denied ไม่ถูกทับเป็น 'โหลดข้อมูล ROAS ไม่สำเร็จ'", async () => {
    setAuth(h, AUTH.staffMember);

    const r = (await getChannelRoas()) as { ok: false; error: string };
    expect(r.error).toBe(DENIED);
    expect(r.error).not.toMatch(/ไม่สำเร็จ/);
    expect(touchedDb(h)).toBe(false);
  });

  it("DB error + owner -> ข้อความ error เดิมของ action (guard ไม่กลบความล้มเหลวของ DB)", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { v_ad_spend_weekly: { data: null, error: new Error("boom") } });

    await expect(getAdSpendWeekly()).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/ไม่สำเร็จ/) });
  });
});
