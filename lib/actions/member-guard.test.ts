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
//   3. gate on + approved member (staff; admin for rows flagged ownerAdmin, which
//      also need the owner/admin role) -> NOT denied (the "must not break" side:
//      logged-in staff keep working) — local dev with the gate off likewise
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

// ownerAdmin = L3 (3 พ.ย. 69, + getChannelRoas = security H2): อ่านต้นทุน/มาร์จิ้น/ราคา/ROAS ที่ derive จากมาร์จิ้น → member แล้วต้อง owner/admin ด้วย (staff ได้ข้อความ role)
type Case = { mod: string; fn: string; args: unknown[]; style?: "throw"; ownerAdmin?: true };

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
  { mod: "catalog", fn: "getProducts", args: [], ownerAdmin: true },
  { mod: "catalog", fn: "getSkuOrderAlerts", args: [] },
  { mod: "catalog", fn: "getShopSetting", args: [], ownerAdmin: true },
  { mod: "catalog", fn: "getBlendedMarginSuggestion", args: [], ownerAdmin: true },
  { mod: "catalog-images", fn: "getProductImages", args: [UUID] },
  { mod: "catalog-sku", fn: "listSkuPrefixes", args: [] },
  { mod: "marketing", fn: "getChannelRoas", args: [], ownerAdmin: true },
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
const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  memberRow = null;
  delete process.env.AUTH_GATE;
  delete process.env.VERCEL_ENV; // เคสเดิมจำลอง local dev · เคส real deployment ตั้ง VERCEL_ENV เองด้านล่าง
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs(); // ก่อน: มันคืนค่าก่อน stub — ถ้าคืนค่าเองก่อนแล้วค่อย unstub ค่าที่คืนจะถูกทับ
  if (originalGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalGate;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  vi.restoreAllMocks();
});

/** member ที่ผ่านด่าน role ของ case นั้น: L3 ต้อง admin, ที่เหลือ staff พอ (ไม่งั้นเคส "ต้องไม่พัง" ผ่านแบบว่างเปล่า) */
const memberFor = (c: Case) => ({ shop_id: "shop-1", role: c.ownerAdmin ? "admin" : "staff" });

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

describe("gate on + approved member (staff · admin สำหรับแถว ownerAdmin) — NOT denied (logged-in staff must keep working)", () => {
  it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
    process.env.AUTH_GATE = "on";
    sessionUser = { id: "user-staff" };
    memberRow = memberFor(c);
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

describe("local dev + gate off — never consults the session (DEV_ROLE flow)", () => {
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

// ---------------------------------------------------------------------------
// M2 (A-แคบ, มติ 3 พ.ย. 69): บน deployment จริงชั้น action บังคับเสมอ ไม่ว่า AUTH_GATE จะเป็นอะไร
// ---------------------------------------------------------------------------
const REAL_DEPLOYMENT_GATES: (string | undefined)[] = [undefined, "off"];

function setRealDeployment(gate: string | undefined) {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("AUTH_GATE", gate); // undefined = unset จริง (vitest ลบ key) ไม่ใช่สตริง "undefined"
}

describe.each(REAL_DEPLOYMENT_GATES)(
  "real deployment (VERCEL_ENV=production) + AUTH_GATE=%j + no session — denied ทุก CASES และ DB ไม่ถูกแตะ",
  (gate) => {
    it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
      setRealDeployment(gate);
      const fn = await load(c);
      // no args on purpose: the guard must run before any validation reads them
      if (c.style === "throw") {
        await expect(fn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
      } else {
        await expect(fn()).resolves.toEqual(DENIED);
      }
      expect(dataTouched).not.toHaveBeenCalled();
    });
  },
);

describe.each(REAL_DEPLOYMENT_GATES)(
  "real deployment + AUTH_GATE=%j + pending signup (session, no shop_member) — denied",
  (gate) => {
    it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
      setRealDeployment(gate);
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
  },
);

describe("real deployment + AUTH_GATE unset + approved member (staff · admin สำหรับแถว ownerAdmin) — NOT denied (ต้องไม่พัง: ปิด AUTH_GATE ไม่ทำให้ staff ที่ล็อกอินจริงใช้ไม่ได้)", () => {
  it.each(CASES.map((c) => [`${c.mod}.${c.fn}`, c] as const))("%s", async (_name, c) => {
    setRealDeployment(undefined);
    sessionUser = { id: "user-staff" };
    memberRow = memberFor(c);
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
    expect(text).not.toContain("บัญชียังไม่ได้รับอนุมัติ");
  });

  it("the guard actually lets the call through to the data layer (orders.listOrders touches the DB)", async () => {
    setRealDeployment(undefined);
    sessionUser = { id: "user-staff" };
    memberRow = { shop_id: "shop-1", role: "staff" };
    const { listOrders } = await import("./orders");
    const r = await listOrders({ channel: "all", status: "all", search: "", cursor: null });
    expect(r.ok).toBe(true);
    expect(dataTouched).toHaveBeenCalledWith("from:orders");
  });
});

// ---------------------------------------------------------------------------
// L3 (มติ 3 พ.ย. 69): ต้นทุน/มาร์จิ้น/ตั้งค่าราคา ห้ามถึง staff — 3 ตัว; getSkuOrderAlerts คง member-level
// ---------------------------------------------------------------------------
const CATALOG_ROLE_DENIED = {
  ok: false,
  error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและแก้ไขสินค้า ต้นทุน และการตั้งค่าราคาได้",
};
const MARKETING_ROLE_DENIED = { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนการตลาดได้" };
/** ข้อความ role ของแต่ละ module (แต่ละไฟล์มี requireOwnerAdmin ท้องถิ่นของตัวเอง) */
const roleDeniedFor = (c: Case) => (c.mod === "marketing" ? MARKETING_ROLE_DENIED : CATALOG_ROLE_DENIED);
const L3_CASES = CASES.filter((c) => c.ownerAdmin);

describe("L3 — sanity: ตาราง CASES ติดธง ownerAdmin ครบ 4 ตัวที่มติระบุ และ getSkuOrderAlerts / getAdSpendWeekly ไม่ติด", () => {
  it("exactly getProducts / getShopSetting / getBlendedMarginSuggestion / getChannelRoas", () => {
    expect(L3_CASES.map((c) => c.fn).sort()).toEqual([
      "getBlendedMarginSuggestion",
      "getChannelRoas",
      "getProducts",
      "getShopSetting",
    ]);
    expect(CASES.find((c) => c.fn === "getSkuOrderAlerts")?.ownerAdmin).toBeUndefined();
    // getAdSpendWeekly คืนแค่ spend/impressions/clicks — ไม่มี margin/ROAS ที่ derive จาก margin
    expect(CASES.find((c) => c.fn === "getAdSpendWeekly")?.ownerAdmin).toBeUndefined();
  });
});

describe.each([
  ["AUTH_GATE=on (local)", () => { process.env.AUTH_GATE = "on"; }],
  ["real deployment + AUTH_GATE unset", () => setRealDeployment(undefined)],
] as const)("L3 — %s", (_label, arrange) => {
  describe("ต้องถูกปฏิเสธ: staff member (session + shop_member role=staff)", () => {
    it.each(L3_CASES.map((c) => [c.fn, c] as const))("%s -> ข้อความ owner/admin และ data layer ไม่ถูกเรียก", async (_name, c) => {
      arrange();
      sessionUser = { id: "user-staff" };
      memberRow = { shop_id: "shop-1", role: "staff" };
      const fn = await load(c);
      await expect(fn()).resolves.toEqual(roleDeniedFor(c));
      expect(dataTouched).not.toHaveBeenCalled();
    });

    it("role แปลกที่ไม่รู้จัก (เช่น 'viewer') ก็ไม่ผ่าน — allowlist ไม่ใช่ denylist", async () => {
      arrange();
      sessionUser = { id: "user-x" };
      memberRow = { shop_id: "shop-1", role: "viewer" };
      const { getProducts } = await import("./catalog");
      await expect(getProducts()).resolves.toEqual(CATALOG_ROLE_DENIED);
      expect(dataTouched).not.toHaveBeenCalled();
    });
  });

  describe("ต้องถูกปฏิเสธ: คนนอกได้ข้อความ member ไม่ใช่ข้อความ role (denyIfNotMember มาก่อน)", () => {
    it.each(L3_CASES.map((c) => [c.fn, c] as const))("%s — ไม่มี session", async (_name, c) => {
      arrange();
      const fn = await load(c);
      await expect(fn()).resolves.toEqual(DENIED);
      expect(dataTouched).not.toHaveBeenCalled();
    });

    it.each(L3_CASES.map((c) => [c.fn, c] as const))("%s — pending (session ไม่มี shop_member)", async (_name, c) => {
      arrange();
      sessionUser = { id: "user-pending" };
      memberRow = null;
      const fn = await load(c);
      await expect(fn()).resolves.toEqual(DENIED);
      expect(dataTouched).not.toHaveBeenCalled();
    });
  });

  describe("ต้องไม่พัง: owner / admin ผ่านถึง data layer", () => {
    for (const role of ["owner", "admin"] as const) {
      it.each(L3_CASES.map((c) => [c.fn, c] as const))(`${role}: %s`, async (_name, c) => {
        arrange();
        sessionUser = { id: `user-${role}` };
        memberRow = { shop_id: "shop-1", role };
        const fn = await load(c);
        const outcome = await fn();
        expect(JSON.stringify(outcome)).not.toContain("เฉพาะเจ้าของร้าน/แอดมินเท่านั้น");
        expect(JSON.stringify(outcome)).not.toContain("ต้องเข้าสู่ระบบก่อน");
        expect(dataTouched).toHaveBeenCalledWith("schema:analytics");
        expect(outcome).not.toEqual(roleDeniedFor(c));
      });
    }
  });

  describe("ต้องไม่พัง: getSkuOrderAlerts ยังเป็น member-level (ไม่มีต้นทุน)", () => {
    it("staff member เรียกได้ ถึง data layer", async () => {
      arrange();
      sessionUser = { id: "user-staff" };
      memberRow = { shop_id: "shop-1", role: "staff" };
      const { getSkuOrderAlerts } = await import("./catalog");
      const r = await getSkuOrderAlerts();
      expect(r.ok).toBe(true);
      expect(dataTouched).toHaveBeenCalledWith("schema:analytics");
    });

    it("คนนอกยังโดนปฏิเสธ (ข้อความ member)", async () => {
      arrange();
      const { getSkuOrderAlerts } = await import("./catalog");
      await expect(getSkuOrderAlerts()).resolves.toEqual(DENIED);
      expect(dataTouched).not.toHaveBeenCalled();
    });
  });
});
