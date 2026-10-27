// lib/actions/live.test.ts — H1 Phase 3: in-action authz guard on live.ts (design §1.5 / §5) + the helper move.
//   startLiveSession / closeLiveSession                                -> WRITE (owner/admin)
//   getOpenSession / listLiveSessions / getLiveSessionStats / getTopSkus -> READ-member (any shop member incl. staff;
//                                                                         /live/* is not role-gated at the page)
//   ห้ามผ่าน  : anonymous / auth-env broken / pending -> {ok:false}; WRITE also refuses staff member + DEV_ROLE=staff; DB never touched
//   ต้องไม่พัง: gate off DEV flow unchanged · owner passes · staff member keeps every read (gmv NOT masked — existing behaviour, §1.5)
//   ย้าย helper: live.ts no longer exports getManualTiktokChannelAccountId (it was a public action taking a client shopId);
//              startLiveSession still resolves the channel_account through lib/live/channel-account.ts
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

import * as liveModule from "./live";
import { closeLiveSession, getLiveSessionStats, getOpenSession, getTopSkus, listLiveSessions, startLiveSession } from "./live";
import { getManualTiktokChannelAccountId } from "@/lib/live/channel-account";

const DENIED_WRITE = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่เริ่ม/ปิดไลฟ์ได้";

const SESSION_ROW = {
  id: "ls-1",
  title: "ไลฟ์ทดสอบ",
  status: "open",
  started_at: "2026-10-27T13:00:00Z",
  ended_at: null,
  notes: null,
};
const STATS_ROW = {
  live_session_id: "ls-1",
  title: "ไลฟ์ทดสอบ",
  status: "open",
  started_at: "2026-10-27T13:00:00Z",
  ended_at: null,
  order_count: "4",
  oversold_count: "1",
  gmv: "5400.50",
  units_sold: "9",
  duration_hours: "1.5",
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

// ---------------------------------------------------------------------------
// READ-member
// ---------------------------------------------------------------------------
describe("getOpenSession — READ-member gate", () => {
  gateMatrix(h, "member", { call: () => getOpenSession(), tables: { live_session: { data: SESSION_ROW, error: null } } }, "");
});
describe("listLiveSessions — READ-member gate", () => {
  gateMatrix(h, "member", { call: () => listLiveSessions(), tables: { live_session: { data: [SESSION_ROW], error: null } } }, "");
});
describe("getLiveSessionStats — READ-member gate", () => {
  gateMatrix(h, "member", { call: () => getLiveSessionStats("ls-1"), tables: { v_live_session_stats: { data: STATS_ROW, error: null } } }, "");
});
describe("getTopSkus — READ-member gate", () => {
  gateMatrix(
    h,
    "member",
    {
      call: () => getTopSkus("ls-1"),
      tables: {
        live_session: { data: { id: "ls-1" }, error: null },
        order_item: { data: [{ product_id: "p-1", qty: 3, product: { sku: "R-001", name: "แหวน" } }], error: null },
      },
    },
    "",
  );
});

// ---------------------------------------------------------------------------
// WRITE
// ---------------------------------------------------------------------------
describe("startLiveSession — WRITE gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(
    h,
    "owner",
    {
      call: () => startLiveSession({ title: "ไลฟ์ทดสอบ" }),
      tables: { channel_account: { data: { id: "ca-1" }, error: null }, live_session: { data: SESSION_ROW, error: null } },
      allowed: (r) => r.ok === true && r.data.id === "ls-1",
    },
    DENIED_WRITE,
  );
});
describe("closeLiveSession — WRITE gate (requireWriteAccess + requireOwnerAdmin)", () => {
  gateMatrix(h, "owner", { call: () => closeLiveSession("ls-1"), tables: { live_session: { data: { id: "ls-1" }, error: null } } }, DENIED_WRITE);
});

// ---------------------------------------------------------------------------
// ข้อมูล / ลำดับ guard
// ---------------------------------------------------------------------------
describe("READ-member — ข้อมูลที่ staff member เห็นต้องเท่า owner เป๊ะ (ไม่ mask เพิ่ม)", () => {
  it("getLiveSessionStats: staff member ได้ gmv/orderCount เหมือน owner", async () => {
    setTables(h, { v_live_session_stats: { data: STATS_ROW, error: null } });

    setAuth(h, AUTH.ownerMember);
    const asOwner = await getLiveSessionStats("ls-1");
    setAuth(h, AUTH.staffMember);
    const asStaff = await getLiveSessionStats("ls-1");

    expect(asStaff).toEqual(asOwner);
    expect(asStaff).toMatchObject({ ok: true, data: { gmv: 5400.5, orderCount: 4, oversoldCount: 1, unitsSold: 9, durationHours: 1.5 } });
  });

  it("getTopSkus: staff member ได้อันดับ SKU เท่า owner", async () => {
    setTables(h, {
      live_session: { data: { id: "ls-1" }, error: null },
      order_item: { data: [{ product_id: "p-1", qty: 3, product: { sku: "R-001", name: "แหวน" } }], error: null },
    });
    setAuth(h, AUTH.staffMember);

    await expect(getTopSkus("ls-1")).resolves.toEqual({
      ok: true,
      data: [{ productId: "p-1", sku: "R-001", name: "แหวน", qtySold: 3 }],
    });
  });

  it("getOpenSession: ไม่มีไลฟ์เปิด + staff member -> ok:true data:null (หน้า /live เริ่มต้นได้)", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, { live_session: { data: null, error: null } });

    await expect(getOpenSession()).resolves.toEqual({ ok: true, data: null });
  });
});

describe("guard อยู่บรรทัดแรก ก่อน validate input และนอก try/catch", () => {
  it("getLiveSessionStats('') + ไม่มี session -> ข้อความ guard ไม่ใช่ 'ไม่พบไลฟ์นี้'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(getLiveSessionStats("")).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  it("getTopSkus('') + สมาชิก -> ยัง validate ได้ 'ไม่พบไลฟ์นี้' ไม่แตะ DB", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(getTopSkus("")).resolves.toEqual({ ok: false, error: "ไม่พบไลฟ์นี้" });
    expect(touchedDb(h)).toBe(false);
  });

  it("closeLiveSession('') + staff member -> ข้อความ denied ของโดเมน (ไม่ใช่ validation)", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(closeLiveSession("")).resolves.toEqual({ ok: false, error: DENIED_WRITE });
  });

  it("closeLiveSession('') + owner -> ยัง validate ตามเดิม", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(closeLiveSession("")).resolves.toEqual({ ok: false, error: "ไม่พบไลฟ์นี้" });
    expect(touchedDb(h)).toBe(false);
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'เริ่มไลฟ์ไม่สำเร็จ' / 'โหลดรายการไลฟ์ไม่สำเร็จ'", async () => {
    setAuth(h, AUTH.pending);

    const start = (await startLiveSession({})) as { ok: false; error: string };
    const list = (await listLiveSessions()) as { ok: false; error: string };
    expect(start.error).not.toMatch(/ไม่สำเร็จ/);
    expect(list.error).toBe(MSG.notApproved);
  });
});

describe("startLiveSession / closeLiveSession — owner path เท่าเดิม", () => {
  it("owner: เริ่มไลฟ์ -> insert live_session ด้วย channel_account ที่หาเจอ · คืน LiveSession ที่ map แล้ว", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { channel_account: { data: { id: "ca-1" }, error: null }, live_session: { data: SESSION_ROW, error: null } });

    await expect(startLiveSession({ title: " ไลฟ์ทดสอบ " })).resolves.toEqual({
      ok: true,
      data: { id: "ls-1", title: "ไลฟ์ทดสอบ", status: "open", startedAt: "2026-10-27T13:00:00Z", endedAt: null, notes: null },
    });
    expect(h.fromMock.mock.calls.map((c) => c[0])).toEqual(["channel_account", "live_session"]);
  });

  it("owner: มีไลฟ์เปิดอยู่แล้ว (23505) -> ข้อความเดิม", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { channel_account: { data: { id: "ca-1" }, error: null }, live_session: { data: null, error: { code: "23505", message: "dup" } } });

    await expect(startLiveSession({})).resolves.toEqual({ ok: false, error: "มีไลฟ์ที่เปิดอยู่แล้ว ปิดไลฟ์เดิมก่อนเริ่มไลฟ์ใหม่" });
  });

  it("owner: ไม่มี channel_account manual-live -> ไม่ insert live_session · ข้อความทั่วไป", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { channel_account: { data: null, error: null } });

    await expect(startLiveSession({})).resolves.toEqual({ ok: false, error: "เริ่มไลฟ์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(h.fromMock.mock.calls.map((c) => c[0])).toEqual(["channel_account"]);
  });

  it("owner: ปิดไลฟ์ที่ไม่เปิดอยู่ -> ข้อความเดิม", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, { live_session: { data: null, error: null } });

    await expect(closeLiveSession("ls-1")).resolves.toEqual({ ok: false, error: "ไม่พบไลฟ์ที่เปิดอยู่ หรือปิดไปแล้ว" });
  });
});

// ---------------------------------------------------------------------------
// ย้าย getManualTiktokChannelAccountId ออกจาก "use server"
// ---------------------------------------------------------------------------
describe("getManualTiktokChannelAccountId — ไม่ใช่ server action สาธารณะอีกต่อไป", () => {
  it("live.ts ไม่ export มันแล้ว (export ทุกตัวของไฟล์ use-server = endpoint ที่ client ยิงได้)", () => {
    expect("getManualTiktokChannelAccountId" in liveModule).toBe(false);
  });

  it("helper ใหม่ทำงานเท่าเดิม: เจอ -> id · ไม่เจอ -> throw ข้อความ seed · DB error -> throw ต่อ", async () => {
    setTables(h, { channel_account: { data: { id: "ca-9" }, error: null } });
    await expect(getManualTiktokChannelAccountId("shop-1")).resolves.toBe("ca-9");

    setTables(h, { channel_account: { data: null, error: null } });
    await expect(getManualTiktokChannelAccountId("shop-1")).rejects.toThrow(/ต้อง seed ก่อน/);

    const boom = new Error("db down");
    setTables(h, { channel_account: { data: null, error: boom } });
    await expect(getManualTiktokChannelAccountId("shop-1")).rejects.toBe(boom);
  });
});
