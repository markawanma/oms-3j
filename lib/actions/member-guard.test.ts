// lib/actions/member-guard.test.ts — second auth layer inside server actions
// (security fix 25 ต.ค. 69, extension-gate bypass).
//
// The bug: a path-matcher mistake let an anonymous caller POST `Next-Action` to
// real routes, so every exported action WITHOUT its own guard ran for an
// outsider (role resolves to `staff`). Each action below now starts with
// denyIfNotMember() / requireMemberIfGateOn().
//
// Three questions per action, driven off one table so a new row = full coverage:
//   1. gate on + NO session     -> denied, DB never touched, and denied BEFORE
//      input validation (args are deliberately omitted: if the guard were not
//      the first statement the call would blow up / return a validation error)
//   2. gate on + PENDING signup -> denied (a session alone is not enough)
//   3. gate on + approved member (role staff) -> NOT denied (the "must not
//      break" side: logged-in staff keep working) — gate off likewise
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DENIED = { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };

let sessionUser: { id: string } | null = null;
let memberRow: { shop_id: string; role: string } | null = null;
const dataTouched = vi.fn();

/** Thenable chain: any method returns itself, awaiting yields an empty successful result. */
function dataChain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === "maybeSingle" || k === "single") return () => Promise.resolve({ data: null, error: null });
      if (k === "then") return (res: (v: unknown) => unknown) => res({ data: [], error: null, count: 0 });
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

function memberChain() {
  const p: Record<string, unknown> = {
    select: () => p,
    eq: () => p,
    maybeSingle: () => Promise.resolve({ data: memberRow, error: null }),
  };
  return p;
}

vi.mock("@/lib/supabase/server", () => ({
  getUserClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser }, error: null }) } }),
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "shop_member") return memberChain();
      dataTouched(`from:${table}`);
      return dataChain();
    },
    schema: (s: string) => {
      dataTouched(`schema:${s}`);
      return { from: () => dataChain(), rpc: () => dataChain() };
    },
    rpc: (fn: string) => {
      dataTouched(`rpc:${fn}`);
      return dataChain();
    },
  }),
}));
vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
  getDevRole: () => "staff",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Case = { mod: string; fn: string; args: unknown[]; style?: "throw" };

const UUID = "00000000-0000-4000-8000-000000000000";

// Every exported action that got the member guard. Keep in sync with
// lib/auth/server-action-guard-coverage.test.ts (which fails if a NEW unguarded
// action appears anywhere under a "use server" file).
const CASES: Case[] = [
  { mod: "orders", fn: "listOrders", args: [{ channel: "all", status: "all", search: "", cursor: null }] },
  { mod: "orders", fn: "getPrioritySummary", args: [] },
  { mod: "orders", fn: "countNewOrdersSince", args: ["2026-01-01T00:00:00Z"] },
  { mod: "orders", fn: "getOrderDetail", args: [UUID] },
  { mod: "orders", fn: "advanceOrder", args: [UUID, "new"] },
  { mod: "orders", fn: "markShipped", args: [UUID] },
  { mod: "orders", fn: "cancelOrder", args: [UUID, "reason"] },
  { mod: "live", fn: "startLiveSession", args: [{ title: "t" }] },
  { mod: "live", fn: "closeLiveSession", args: ["live-1"] },
  { mod: "live", fn: "getOpenSession", args: [] },
  { mod: "live", fn: "listLiveSessions", args: [] },
  { mod: "live", fn: "getLiveSessionStats", args: ["live-1"] },
  { mod: "live", fn: "getTopSkus", args: ["live-1"] },
  { mod: "live", fn: "getManualTiktokChannelAccountId", args: ["shop-1"], style: "throw" },
  { mod: "quick-order", fn: "searchProductsForLive", args: ["ring"] },
  {
    mod: "quick-order",
    fn: "createQuickOrder",
    args: [{ liveSessionId: "live-1", buyerName: "b", items: [{ productId: UUID, qty: 1, unitPrice: 100 }] }],
  },
  { mod: "stock", fn: "listStock", args: [""] },
  { mod: "stock", fn: "adjustStock", args: [UUID, 3] },
  { mod: "products", fn: "createProduct", args: [{ sku: "S-1", name: "n", initialStock: 1 }] },
  { mod: "tiktok-sales", fn: "getSalesSummary", args: [{ from: "2026-01-01", to: "2026-01-31", granularity: "day" }] },
  { mod: "crm", fn: "getCrmOverview", args: [] },
  { mod: "crm", fn: "getCrmCustomerDimensions", args: [] },
  { mod: "crm", fn: "getCrmCustomers", args: [] },
  { mod: "crm", fn: "getCrmOrders", args: [] },
  { mod: "crm", fn: "getCrmCustomerDetail", args: ["cust-1"] },
  { mod: "crm", fn: "getCrmCustomerNotes", args: ["cust-1"] },
  { mod: "crm", fn: "getCrmEditOptions", args: [] },
  { mod: "crm", fn: "getCrmImportErrors", args: [] },
  { mod: "crm-retention", fn: "getCrmRetention", args: [] },
  { mod: "dashboard", fn: "getDashboard", args: [{ from: "2026-01-01", to: "2026-01-31" }] },
  { mod: "dashboard", fn: "getDashboardCharts", args: [{ from: "2026-01-01", to: "2026-01-31" }] },
  { mod: "catalog", fn: "getProducts", args: [] },
  { mod: "catalog", fn: "getSkuOrderAlerts", args: [] },
  { mod: "catalog", fn: "getShopSetting", args: [] },
  { mod: "catalog", fn: "getBlendedMarginSuggestion", args: [] },
  { mod: "catalog-images", fn: "getProductImages", args: [UUID] },
  { mod: "catalog-sku", fn: "listSkuPrefixes", args: [] },
  { mod: "marketing", fn: "getChannelRoas", args: [] },
  { mod: "marketing", fn: "getAdSpendWeekly", args: [] },
];

type ActionModule = Record<string, (...a: unknown[]) => Promise<unknown>>;
// explicit loaders (not a template-literal import): keeps Vite's dynamic-import analysis quiet and the module list greppable
const LOADERS: Record<string, () => Promise<ActionModule>> = {
  orders: () => import("./orders") as Promise<ActionModule>,
  live: () => import("./live") as Promise<ActionModule>,
  "quick-order": () => import("./quick-order") as Promise<ActionModule>,
  stock: () => import("./stock") as Promise<ActionModule>,
  products: () => import("./products") as Promise<ActionModule>,
  "tiktok-sales": () => import("./tiktok-sales") as Promise<ActionModule>,
  crm: () => import("./crm") as Promise<ActionModule>,
  "crm-retention": () => import("./crm-retention") as Promise<ActionModule>,
  dashboard: () => import("./dashboard") as Promise<ActionModule>,
  catalog: () => import("./catalog") as Promise<ActionModule>,
  "catalog-images": () => import("./catalog-images") as Promise<ActionModule>,
  "catalog-sku": () => import("./catalog-sku") as Promise<ActionModule>,
  marketing: () => import("./marketing") as Promise<ActionModule>,
};

async function load(c: Case): Promise<(...a: unknown[]) => Promise<unknown>> {
  const mod = await LOADERS[c.mod]();
  expect(typeof mod[c.fn], `${c.mod}.${c.fn} must be exported`).toBe("function");
  return mod[c.fn];
}

const originalGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  memberRow = null;
  delete process.env.AUTH_GATE;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (originalGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalGate;
  vi.restoreAllMocks();
});

describe("gate on + no session — every guarded action is denied before anything else runs", () => {
  it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
    process.env.AUTH_GATE = "on";
    const fn = await load(c);
    // no args on purpose: the guard must run before any validation reads them
    if (c.style === "throw") {
      await expect(fn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
    } else {
      await expect(fn()).resolves.toEqual(DENIED);
    }
    expect(dataTouched).not.toHaveBeenCalled();
  });
});

describe("gate on + pending signup (session, no shop_member) — denied", () => {
  it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
    process.env.AUTH_GATE = "on";
    sessionUser = { id: "user-pending" };
    memberRow = null;
    const fn = await load(c);
    if (c.style === "throw") {
      await expect(fn(...c.args)).rejects.toThrow("บัญชียังไม่ได้รับอนุมัติ");
    } else {
      await expect(fn(...c.args)).resolves.toEqual(DENIED);
    }
    expect(dataTouched).not.toHaveBeenCalled();
  });
});

describe("gate on + approved member (role staff) — NOT denied (logged-in staff must keep working)", () => {
  it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
    process.env.AUTH_GATE = "on";
    sessionUser = { id: "user-staff" };
    memberRow = { shop_id: "shop-1", role: "staff" };
    const fn = await load(c);
    let outcome: unknown;
    try {
      outcome = await fn(...c.args);
    } catch (err) {
      // throw-style action reached its own body (e.g. "channel_account not found") — not an auth error
      outcome = { thrown: (err as Error).message };
    }
    const text = JSON.stringify(outcome ?? null);
    expect(text).not.toContain("ต้องเข้าสู่ระบบก่อน");
    expect(text).not.toContain("ไม่ได้เข้าสู่ระบบ");
    expect(text).not.toContain("บัญชียังไม่ได้รับอนุมัติ");
  });

  it("the guard actually lets the call through to the data layer (orders.listOrders touches the DB)", async () => {
    process.env.AUTH_GATE = "on";
    sessionUser = { id: "user-staff" };
    memberRow = { shop_id: "shop-1", role: "staff" };
    const { listOrders } = await import("./orders");
    const r = await listOrders({ channel: "all", status: "all", search: "", cursor: null });
    expect(r.ok).toBe(true);
    expect(dataTouched).toHaveBeenCalledWith("from:orders");
  });

  it("throw-style: getManualTiktokChannelAccountId reaches its own body for a member (its own not-found error, not an auth error)", async () => {
    process.env.AUTH_GATE = "on";
    sessionUser = { id: "user-staff" };
    memberRow = { shop_id: "shop-1", role: "staff" };
    const { getManualTiktokChannelAccountId } = await import("./live");
    await expect(getManualTiktokChannelAccountId("shop-1")).rejects.toThrow("ไม่พบ channel_account");
    expect(dataTouched).toHaveBeenCalledWith("from:channel_account");
  });
});

describe("gate off — behaves exactly as before (dev / rollback lever)", () => {
  it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s never consults the session", async (_name, c) => {
    // sessionUser stays null; with the gate off that must not matter
    const fn = await load(c);
    let outcome: unknown;
    try {
      outcome = await fn(...c.args);
    } catch (err) {
      outcome = { thrown: (err as Error).message };
    }
    const text = JSON.stringify(outcome ?? null);
    expect(text).not.toContain("ต้องเข้าสู่ระบบก่อน");
    expect(text).not.toContain("ไม่ได้เข้าสู่ระบบ");
  });
});
