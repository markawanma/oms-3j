// lib/auth/real-deployment-actions.qa.test.ts — QA 3 พ.ย. 69 (M2 A-แคบ + L3), เติมช่องที่ member-guard.test.ts ไม่ครอบ
// ใช้ role.ts / session.ts / deployment.ts / action-guard.ts ของจริงทั้งหมด — mock แค่ supabase client + dev/context
// เคสที่เติม:
//   1) guard() ของ lib/jobs/office-server.ts และ requireOwnerAdmin() ของ lib/marketing/piece-server.ts บน deployment จริง
//      (prod / preview / NODE_ENV=production) × AUTH_GATE unset/off × no session × DEV_ROLE=owner -> ปฏิเสธ (DEV_ROLE ไม่มีอำนาจ)
//   2) local + AUTH_GATE unset: no-op + DEV_ROLE ใช้ได้จริง (ไม่ใช่แค่ mock getDevRole ตายตัว) รวมถึง L3 3 ตัว
//   3) preview / NODE_ENV=production ผ่านชั้น action จริง (member-guard.test.ts ทดสอบแค่ VERCEL_ENV=production)
//   4) staff บน deployment จริงเรียก getSkuOrderAlerts ได้ (member-level) แต่ L3 ทั้ง 3 ได้ข้อความ owner/admin
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sessionUser: { id: string } | null = null;
let memberRow: { shop_id: string; role: string } | null = null;
let devRole: "owner" | "admin" | "staff" = "staff";
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
  getDevRole: () => devRole,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

const DENIED = { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };
const L3_ROLE_DENIED = {
  ok: false,
  error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและแก้ไขสินค้า ต้นทุน และการตั้งค่าราคาได้",
};

type Deployment = { label: string; arrange: (gate: string | undefined) => void };
const DEPLOYMENTS: Deployment[] = [
  { label: "VERCEL_ENV=production", arrange: () => vi.stubEnv("VERCEL_ENV", "production") },
  { label: "VERCEL_ENV=preview", arrange: () => vi.stubEnv("VERCEL_ENV", "preview") },
  { label: "NODE_ENV=production (ไม่มี VERCEL_ENV)", arrange: () => vi.stubEnv("NODE_ENV", "production") },
];
const GATES: (string | undefined)[] = [undefined, "off"];

function arrangeEnv(d: Deployment, gate: string | undefined) {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("AUTH_GATE", gate);
  d.arrange(gate);
}
function arrangeLocal(gate: string | undefined = undefined) {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("AUTH_GATE", gate);
  expect(process.env.NODE_ENV).toBe("test");
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  memberRow = null;
  devRole = "staff";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1) guard() — lib/jobs/office-server.ts (job-office*, job-photos, job-workers ใช้ตัวนี้เป็นบรรทัดแรก)
// ---------------------------------------------------------------------------
describe("office-server guard() — deployment จริง ไม่ฟัง AUTH_GATE และไม่ฟัง DEV_ROLE", () => {
  for (const d of DEPLOYMENTS) {
    for (const gate of GATES) {
      it(`${d.label} AUTH_GATE=${JSON.stringify(gate)} + no session + DEV_ROLE=owner -> "ต้องเข้าสู่ระบบก่อน"`, async () => {
        arrangeEnv(d, gate);
        devRole = "owner"; // ถ้า env มีอำนาจ ด่าน role จะผ่าน — ต้องไม่ผ่านเพราะชั้น session ตัดก่อน
        const { guard } = await import("@/lib/jobs/office-server");
        await expect(guard()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
      });
    }
  }

  it("prod gate off + pending (session, no shop_member) + DEV_ROLE=owner -> ปฏิเสธด้วย NOT_ALLOWED", async () => {
    arrangeEnv(DEPLOYMENTS[0], "off");
    devRole = "owner";
    sessionUser = { id: "u-pending" };
    memberRow = null;
    const { guard, NOT_ALLOWED } = await import("@/lib/jobs/office-server");
    await expect(guard()).resolves.toEqual({ ok: false, error: NOT_ALLOWED });
  });

  it("prod gate off + staff member -> NOT_ALLOWED", async () => {
    arrangeEnv(DEPLOYMENTS[0], undefined);
    sessionUser = { id: "u-staff" };
    memberRow = { shop_id: "shop-1", role: "staff" };
    const { guard, NOT_ALLOWED } = await import("@/lib/jobs/office-server");
    await expect(guard()).resolves.toEqual({ ok: false, error: NOT_ALLOWED });
  });

  it.each(["owner", "admin"])("ต้องไม่พัง: prod gate unset + %s member -> ผ่าน (null)", async (role) => {
    arrangeEnv(DEPLOYMENTS[0], undefined);
    sessionUser = { id: "u-" + role };
    memberRow = { shop_id: "shop-1", role };
    const { guard } = await import("@/lib/jobs/office-server");
    await expect(guard()).resolves.toBeNull();
  });

  it("end-to-end: getJobBoard บน prod gate off no session -> ปฏิเสธ DB ไม่ถูกแตะ", async () => {
    arrangeEnv(DEPLOYMENTS[0], "off");
    devRole = "owner";
    const { getJobBoard } = await import("@/lib/actions/job-office");
    const r = (await getJobBoard()) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(dataTouched).not.toHaveBeenCalled();
  });

  it("ต้องไม่พัง (local): AUTH_GATE unset + DEV_ROLE=owner -> guard ผ่าน (no-op + DEV_ROLE ใช้ได้)", async () => {
    arrangeLocal();
    devRole = "owner";
    const { guard } = await import("@/lib/jobs/office-server");
    await expect(guard()).resolves.toBeNull();
  });

  it("ต้องไม่พัง (local): AUTH_GATE unset + DEV_ROLE=staff -> NOT_ALLOWED (DEV_ROLE ยังเป็นผู้ตัดสิน ไม่ใช่เปิดโล่ง)", async () => {
    arrangeLocal();
    devRole = "staff";
    const { guard, NOT_ALLOWED } = await import("@/lib/jobs/office-server");
    await expect(guard()).resolves.toEqual({ ok: false, error: NOT_ALLOWED });
  });

  it("local + AUTH_GATE=on + no session + DEV_ROLE=owner -> ปฏิเสธ (พฤติกรรมเดิมของ gate on)", async () => {
    arrangeLocal("on");
    devRole = "owner";
    const { guard } = await import("@/lib/jobs/office-server");
    await expect(guard()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
  });
});

// ---------------------------------------------------------------------------
// 2) requireOwnerAdmin() — lib/marketing/piece-server.ts (ทุก action ชิ้นงาน content ใช้เป็นบรรทัดแรก — ผ่าน role ไม่ผ่าน session.ts)
// ---------------------------------------------------------------------------
describe("piece-server requireOwnerAdmin() — deployment จริง no session -> role = staff ปฏิเสธ แม้ DEV_ROLE=owner", () => {
  const PIECE_DENIED = { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนนี้ได้" };

  for (const d of DEPLOYMENTS) {
    for (const gate of GATES) {
      it(`${d.label} AUTH_GATE=${JSON.stringify(gate)} + no session + DEV_ROLE=owner -> ปฏิเสธ`, async () => {
        arrangeEnv(d, gate);
        devRole = "owner";
        const { requireOwnerAdmin } = await import("@/lib/marketing/piece-server");
        await expect(requireOwnerAdmin()).resolves.toEqual(PIECE_DENIED);
      });
    }
  }

  it("ต้องไม่พัง: prod gate off + admin member -> ผ่าน", async () => {
    arrangeEnv(DEPLOYMENTS[0], "off");
    sessionUser = { id: "u-admin" };
    memberRow = { shop_id: "shop-1", role: "admin" };
    const { requireOwnerAdmin } = await import("@/lib/marketing/piece-server");
    await expect(requireOwnerAdmin()).resolves.toBeNull();
  });

  it("ต้องไม่พัง (local): AUTH_GATE unset + DEV_ROLE=owner -> ผ่าน", async () => {
    arrangeLocal();
    devRole = "owner";
    const { requireOwnerAdmin } = await import("@/lib/marketing/piece-server");
    await expect(requireOwnerAdmin()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3) ชั้น action จริงบน preview / NODE_ENV=production (member-guard.test.ts ทดสอบแค่ VERCEL_ENV=production)
// ---------------------------------------------------------------------------
describe("ชั้น action บน preview / NODE_ENV=production + gate unset/off + no session -> ปฏิเสธ ไม่แตะ DB", () => {
  type Probe = { name: string; run: () => Promise<unknown> };
  const probes: Probe[] = [
    { name: "stock.adjustStock (write)", run: async () => (await import("@/lib/actions/stock")).adjustStock("00000000-0000-4000-8000-000000000000", 3) },
    { name: "orders.listOrders (read)", run: async () => (await import("@/lib/actions/orders")).listOrders({ channel: "all", status: "all", search: "", cursor: null }) },
    { name: "catalog.getProducts (L3)", run: async () => (await import("@/lib/actions/catalog")).getProducts() },
    { name: "catalog.getShopSetting (L3)", run: async () => (await import("@/lib/actions/catalog")).getShopSetting() },
    { name: "catalog.getBlendedMarginSuggestion (L3)", run: async () => (await import("@/lib/actions/catalog")).getBlendedMarginSuggestion() },
    { name: "catalog.getSkuOrderAlerts (member)", run: async () => (await import("@/lib/actions/catalog")).getSkuOrderAlerts() },
  ];
  for (const d of DEPLOYMENTS.slice(1)) {
    for (const gate of GATES) {
      it.each(probes.map((p) => [p.name, p] as const))(`${d.label} AUTH_GATE=${JSON.stringify(gate)}: %s`, async (_n, p) => {
        arrangeEnv(d, gate);
        devRole = "owner";
        await expect(p.run()).resolves.toEqual(DENIED);
        expect(dataTouched).not.toHaveBeenCalled();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 4) L3 กับ local dev (DEV_ROLE ผ่าน role.ts จริง) + staff บน deployment จริง
// ---------------------------------------------------------------------------
describe("L3 บน local dev — DEV_ROLE เป็นผู้ตัดสิน (ผ่าน role.ts จริง)", () => {
  const fns = ["getProducts", "getShopSetting", "getBlendedMarginSuggestion"] as const;

  it.each(fns)("local AUTH_GATE unset + DEV_ROLE=owner: %s ถึง data layer", async (fn) => {
    arrangeLocal();
    devRole = "owner";
    const mod = await import("@/lib/actions/catalog");
    const r = JSON.stringify(await mod[fn]());
    expect(r).not.toContain("เฉพาะเจ้าของร้าน/แอดมินเท่านั้น");
    expect(r).not.toContain("ต้องเข้าสู่ระบบก่อน");
    expect(dataTouched).toHaveBeenCalledWith("schema:analytics");
  });

  it.each(fns)("local AUTH_GATE unset + DEV_ROLE=staff: %s -> ข้อความ owner/admin ไม่แตะ DB", async (fn) => {
    arrangeLocal();
    devRole = "staff";
    const mod = await import("@/lib/actions/catalog");
    await expect(mod[fn]()).resolves.toEqual(L3_ROLE_DENIED);
    expect(dataTouched).not.toHaveBeenCalled();
  });

  it("local AUTH_GATE unset + DEV_ROLE=staff: getSkuOrderAlerts ยังผ่าน (member-level)", async () => {
    arrangeLocal();
    devRole = "staff";
    const { getSkuOrderAlerts } = await import("@/lib/actions/catalog");
    const r = await getSkuOrderAlerts();
    expect(r.ok).toBe(true);
    expect(dataTouched).toHaveBeenCalledWith("schema:analytics");
  });
});

describe("staff member บน deployment จริง (gate unset)", () => {
  for (const d of DEPLOYMENTS) {
    it(`${d.label}: getSkuOrderAlerts ผ่าน · L3 ทั้ง 3 ได้ข้อความ owner/admin`, async () => {
      arrangeEnv(d, undefined);
      devRole = "owner"; // DEV_ROLE ต้องไม่ช่วยยกสิทธิ์ staff ที่ล็อกอินจริง
      sessionUser = { id: "u-staff" };
      memberRow = { shop_id: "shop-1", role: "staff" };
      const cat = await import("@/lib/actions/catalog");

      expect((await cat.getSkuOrderAlerts()).ok).toBe(true);
      dataTouched.mockClear();

      await expect(cat.getProducts()).resolves.toEqual(L3_ROLE_DENIED);
      await expect(cat.getShopSetting()).resolves.toEqual(L3_ROLE_DENIED);
      await expect(cat.getBlendedMarginSuggestion()).resolves.toEqual(L3_ROLE_DENIED);
      expect(dataTouched).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// 5) requireWriteAccess() — ด่านเขียนที่ 46 call site พึ่ง (ผ่าน requireSessionIfGateOn) ต้องตัดที่ชั้น session เองบน deployment จริง
//    ใช้ callback owner/admin ที่ "ยอมผ่านเสมอ" เพื่อพิสูจน์ว่าที่ปฏิเสธมาจากชั้น session ไม่ใช่ role
// ---------------------------------------------------------------------------
describe("requireWriteAccess — ชั้น session ตัดเองบน deployment จริงแม้ callback role ยอมผ่านทุกอย่าง", () => {
  for (const d of DEPLOYMENTS) {
    for (const gate of GATES) {
      it(`${d.label} AUTH_GATE=${JSON.stringify(gate)} + no session -> "ต้องเข้าสู่ระบบก่อน" และ callback ไม่ถูกเรียก`, async () => {
        arrangeEnv(d, gate);
        const { requireWriteAccess } = await import("@/lib/auth/action-guard");
        const roleCb = vi.fn(() => null);
        await expect(requireWriteAccess(roleCb)).resolves.toEqual(DENIED);
        expect(roleCb).not.toHaveBeenCalled();
      });
    }
  }

  it("ต้องไม่พัง: prod gate unset + มี session -> ส่งต่อให้ callback role ตัดสิน", async () => {
    arrangeEnv(DEPLOYMENTS[0], undefined);
    sessionUser = { id: "u-owner" };
    memberRow = { shop_id: "shop-1", role: "owner" };
    const { requireWriteAccess } = await import("@/lib/auth/action-guard");
    const roleCb = vi.fn(() => null);
    await expect(requireWriteAccess(roleCb)).resolves.toBeNull();
    expect(roleCb).toHaveBeenCalledTimes(1);
  });

  it("ต้องไม่พัง (local): AUTH_GATE unset + ไม่มี session -> no-op ส่งต่อ callback (DEV_ROLE flow เดิม)", async () => {
    arrangeLocal();
    const { requireWriteAccess } = await import("@/lib/auth/action-guard");
    const roleCb = vi.fn(() => null);
    await expect(requireWriteAccess(roleCb)).resolves.toBeNull();
    expect(roleCb).toHaveBeenCalledTimes(1);
  });
});
