// lib/actions/crm.reads.test.ts — H1 Phase 2: READ-member gate on the 7 member-level
// reads of crm.ts (design §1.2 / §5): getCrmOverview · getCrmCustomerDimensions ·
// getCrmCustomers · getCrmOrders · getCrmCustomerNotes · getCrmEditOptions ·
// getCrmImportErrors.
//   ห้ามผ่าน  : gate on + anonymous / pending / auth-env broken -> {ok:false}, DB never touched
//   ต้องไม่พัง : gate off DEV flow, owner, and a staff MEMBER all still read (these pages are
//              not role-gated and the design explicitly does NOT tighten them);
//              owner-level crm actions (getCrmMergeCandidates, writes) are untouched
// action-guard.ts / role.ts are the REAL modules (see test-support/h1-harness.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, MSG, setAuth, setTables, touchedDb, type AuthState } from "./test-support/h1-harness";

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

import {
  crmEditCustomerName,
  getCrmCustomerDetail,
  getCrmCustomerDimensions,
  getCrmCustomerNotes,
  getCrmCustomers,
  getCrmEditOptions,
  getCrmImportErrors,
  getCrmMergeCandidates,
  getCrmOrders,
  getCrmOverview,
} from "./crm";

const READS: [string, () => Promise<unknown>][] = [
  ["getCrmOverview", () => getCrmOverview()],
  ["getCrmCustomerDimensions", () => getCrmCustomerDimensions()],
  ["getCrmCustomers", () => getCrmCustomers()],
  ["getCrmOrders", () => getCrmOrders()],
  ["getCrmCustomerNotes", () => getCrmCustomerNotes("cust-1")],
  ["getCrmEditOptions", () => getCrmEditOptions()],
  ["getCrmImportErrors", () => getCrmImportErrors()],
];

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

describe.each(READS)("%s — READ-member gate", (_name, call) => {
  const denied: [string, AuthState, string][] = [
    ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
    ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
    ["gate on + pending (มี session ไม่มี shop_member)", AUTH.pending, MSG.notApproved],
  ];

  it.each(denied)("ห้ามผ่าน: %s -> {ok:false} และ DB ไม่ถูกแตะ", async (_label, auth, error) => {
    setAuth(h, auth);

    await expect(call()).resolves.toEqual({ ok: false, error });
    expect(touchedDb(h)).toBe(false);
  });

  it.each([
    ["gate off + DEV_ROLE=staff (DEV flow เดิม)", AUTH.gateOffStaff],
    ["gate off + DEV_ROLE=owner", AUTH.gateOffOwner],
    ["gate on + owner", AUTH.ownerMember],
    ["gate on + admin", AUTH.adminMember],
    ["gate on + staff member (หน้า /crm/* ไม่ gate role — ต้องอ่านได้ตามเดิม)", AUTH.staffMember],
  ])("ต้องไม่พัง: %s -> ok:true และเข้าถึง DB", async (_label, auth) => {
    setAuth(h, auth);

    const result = (await call()) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(touchedDb(h)).toBe(true);
  });
});

describe("guard อยู่บรรทัดแรก ก่อน parse/validate input", () => {
  it("getCrmOverview: วันที่เพี้ยน + ไม่มี session -> ข้อความ guard", async () => {
    setAuth(h, AUTH.noSession);

    await expect(getCrmOverview({ from: "2026-99-99", to: "x", channelCode: "line" })).resolves.toEqual({
      ok: false,
      error: MSG.needLogin,
    });
    expect(touchedDb(h)).toBe(false);
  });

  it("getCrmOverview: วันที่เพี้ยน + สมาชิก -> ยังเงียบๆ drop เป็น 'ไม่มีขอบเขต' แล้วโหลดได้ (สัญญาเดิมไม่เปลี่ยน)", async () => {
    setAuth(h, AUTH.staffMember);

    const result = await getCrmOverview({ from: "bad", to: "bad" });
    expect(result).toMatchObject({ ok: true, data: { scope: { requestedFrom: null, requestedTo: null } } });
  });

  it("getCrmCustomerNotes: customerId ว่าง + ไม่มี session -> ข้อความ guard ไม่ใช่ 'ไม่พบรหัสลูกค้า'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(getCrmCustomerNotes("")).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("getCrmCustomerNotes: customerId ว่าง + สมาชิก -> ยัง validate ตามเดิม", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(getCrmCustomerNotes("")).resolves.toEqual({ ok: false, error: "ไม่พบรหัสลูกค้า" });
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'โหลด...ไม่สำเร็จ' (pending ยิง getCrmCustomers)", async () => {
    setAuth(h, AUTH.pending);

    const result = (await getCrmCustomers()) as { ok: false; error: string };
    expect(result.error).toBe(MSG.notApproved);
    expect(result.error).not.toMatch(/ไม่สำเร็จ/);
  });
});

// getCrmCustomerDetail returns the customer-360 financials (revenue_sum/
// profit_sum, per-order revenue/profit/bank) — its getEffectiveRole() only
// masks raw PII, so before H1 a pending/anonymous direct POST (collapsed to
// "staff") got those financials. requireMemberAccess() must now block that,
// while a real member still reaches the DB (where the per-role PII mask and
// tenant shop_id check take over, both unchanged).
describe("getCrmCustomerDetail — membership gate (QA finding, H1)", () => {
  const denied: [string, AuthState, string][] = [
    ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
    ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
    ["gate on + pending (มี session ไม่มี shop_member)", AUTH.pending, MSG.notApproved],
  ];

  it.each(denied)("ห้ามผ่าน: %s -> {ok:false} และ DB ไม่ถูกแตะ", async (_label, auth, error) => {
    setAuth(h, auth);

    await expect(getCrmCustomerDetail("cust-1")).resolves.toEqual({ ok: false, error });
    expect(touchedDb(h)).toBe(false);
  });

  it("ต้องไม่พัง: staff member ผ่านด่าน membership แล้วถึง DB (ไม่โดนข้อความ guard)", async () => {
    setAuth(h, AUTH.staffMember);

    // A real member clears requireMemberAccess() and the action runs against the
    // DB (the per-role PII mask + tenant shop_id check then take over — both
    // unchanged, and exercised by the owner-level crm tests). touchedDb proves
    // the gate let a member through; ok:true proves it wasn't short-circuited by
    // a guard message.
    const result = (await getCrmCustomerDetail("cust-1")) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(touchedDb(h)).toBe(true);
  });
});

describe("ข้อมูลที่ staff member เห็นต้องเท่า owner (ไม่ mask เพิ่ม — design ไม่เปลี่ยน policy)", () => {
  it("getCrmOverview: totals เงิน/กำไรเหมือนกันทั้ง owner และ staff member", async () => {
    setTables(
      h,
      {},
      {
        data: {
          totals: { orders: 10, revenue: 5000, profit: 1200, customers: 8, profit_actual_orders: 4, profit_estimated_orders: 6 },
        },
        error: null,
      },
    );

    setAuth(h, AUTH.ownerMember);
    const asOwner = await getCrmOverview();
    setAuth(h, AUTH.staffMember);
    const asStaff = await getCrmOverview();

    expect(asStaff).toEqual(asOwner);
    expect(asStaff).toMatchObject({ ok: true, data: { totals: { orders: 10, revenue: 5000, aov: 500, profitSum: 1200 } } });
  });

  it("getCrmCustomerNotes: staff member อ่านโน้ตได้ (policy 0021 = tenant member)", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, {
      crm_customer_note: {
        data: [{ id: "n1", body: "ชอบแหวน", created_by: "u1", created_at: "2026-10-01", updated_at: "2026-10-01" }],
        error: null,
      },
    });

    await expect(getCrmCustomerNotes("cust-1")).resolves.toEqual({
      ok: true,
      data: [{ id: "n1", body: "ชอบแหวน", createdBy: "u1", createdAt: "2026-10-01", updatedAt: "2026-10-01" }],
    });
  });
});

describe("ไม่แตะ owner-level actions ของ crm.ts (ยังใช้ getEffectiveRole เดิม)", () => {
  it("getCrmMergeCandidates: staff member ยังได้ {ok:true,data:[]} ตามเดิม", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(getCrmMergeCandidates()).resolves.toEqual({ ok: true, data: [] });
    expect(touchedDb(h)).toBe(false);
  });

  it("crmEditCustomerName: staff member ยังถูกปฏิเสธด้วยข้อความเดิมของ action นั้น และ DB ไม่ถูกแตะ", async () => {
    setAuth(h, AUTH.staffMember);

    const result = (await crmEditCustomerName("cust-1", "ชื่อใหม่")) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).not.toBe(MSG.notApproved);
    expect(touchedDb(h)).toBe(false);
  });
});
