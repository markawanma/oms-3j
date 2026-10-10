// lib/actions/content-posts.test.ts — สิทธิ์ · shop_id · โพสต์ค้างผูกกรองถูก · link ใช้ RPC ถูกชื่อ/พารามิเตอร์ · id ผิดไม่ถึง RPC
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const POST = "11111111-1111-4111-8111-111111111111";
const STEP = "22222222-2222-4222-8222-222222222222";
const HOOK = "33333333-3333-4333-8333-333333333333";
const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

interface Op {
  table: string;
  ops: Array<[string, ...unknown[]]>;
}
const calls: Op[] = [];
const tableResults: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "lte", "lt", "gte", "gt", "or", "not", "order", "limit", "is", "range", "ilike"]) {
    b[m] = (...a: unknown[]) => {
      call.ops.push([m, ...a]);
      return b;
    };
  }
  const result = () => tableResults[table] ?? { data: [], error: null };
  b.maybeSingle = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [] }) }));

import { getPostsPageData, linkOrphanPost } from "./content-posts";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("สิทธิ์", () => {
  it("staff/role ไม่รู้จัก → ไม่ query ไม่เรียก RPC", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await getPostsPageData()).ok).toBe(false);
      expect((await linkOrphanPost(POST, STEP)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("getPostsPageData", () => {
  it("ทุก query กรอง shop_id · โพสต์ค้างผูก = active + step_id is null + เฉพาะช่องที่ผูกได้ + มีเพดาน", async () => {
    const r = await getPostsPageData();
    expect(r.ok).toBe(true);
    for (const c of calls) {
      if (["v_content_piece_calendar", "v_content_inbox_counts", "content_post", "v_content_piece"].includes(c.table)) {
        expect(c.ops, c.table).toContainEqual(["eq", "shop_id", SHOP]);
      }
    }
    const orphan = calls.find((c) => c.table === "content_post");
    expect(orphan?.ops).toContainEqual(["eq", "status", "active"]);
    expect(orphan?.ops).toContainEqual(["is", "step_id", null]);
    const inOp = orphan?.ops.find((o) => o[0] === "in");
    expect(inOp?.[2]).toEqual(["tiktok", "facebook", "instagram"]);
    expect(orphan?.ops.some((o) => o[0] === "limit")).toBe(true);
  });

  it("ไม่มีโพสต์ค้าง → ไม่ query v_content_piece (ช้า D15) · มีโพสต์ค้าง → โหลดผู้สมัครผูกด้วย limit", async () => {
    await getPostsPageData();
    expect(calls.some((c) => c.table === "v_content_piece")).toBe(false);
    calls.length = 0;
    tableResults.content_post = { data: [{ id: POST, platform: "tiktok", post_url: "https://x", posted_at: "2026-10-09T10:00:00Z", posted_date_th: "2026-10-09" }], error: null };
    const r = await getPostsPageData();
    expect(r.ok && r.data.orphans.ok && r.data.orphans.data.rows).toHaveLength(1);
    const cand = calls.find((c) => c.table === "v_content_piece");
    expect(cand?.ops.some((o) => o[0] === "limit")).toBe(true);
    expect(cand?.ops.some((o) => o[0] === "in" && o[1] === "piece_kind")).toBe(true);
  });

  it("ส่วนที่ล้มไม่ลากทั้งหน้า · ไม่รั่วข้อความดิบ", async () => {
    tableResults.content_post = { data: null, error: { code: "XX000", message: "relation analytics.content_post secret" } };
    const r = await getPostsPageData();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.orphans.ok).toBe(false);
    expect(JSON.stringify(r.data.orphans)).not.toContain("secret");
    expect(r.data.postRows.ok).toBe(true);
  });
});

describe("linkOrphanPost", () => {
  it("เรียก content_post_link_step ด้วย post/step/hook · shop + actor owner ถูกใส่ฝั่ง server", async () => {
    const r = await linkOrphanPost(POST, STEP, HOOK);
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("content_post_link_step", expect.objectContaining({ p_post_id: POST, p_step_id: STEP, p_hook_id: HOOK, p_shop_id: SHOP, p_actor_role: "owner" }));
    await linkOrphanPost(POST, STEP);
    expect(rpcMock).toHaveBeenLastCalledWith("content_post_link_step", expect.objectContaining({ p_hook_id: null }));
  });

  it("id ผิดรูป → ไม่ถึง RPC", async () => {
    expect((await linkOrphanPost("x", STEP)).ok).toBe(false);
    expect((await linkOrphanPost(POST, "x")).ok).toBe(false);
    expect((await linkOrphanPost(POST, STEP, "x")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("DB ปฏิเสธ (55000) → ข้อความไทยจาก DB ไม่ถูกกลืน", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: "content_post_link_step: ชิ้นนี้มีโพสต์ tiktok ที่ใช้งานอยู่แล้ว (1 platform ต่อชิ้น 1 โพสต์)" } });
    const r = await linkOrphanPost(POST, STEP);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("มีโพสต์");
  });
});

describe("review ข้อ 6: ผู้สมัครผูกที่โพสต์แล้ว นับ 60 วันจาก posted_on", () => {
  it("or() ใช้ posted_on ไม่ใช่ resolved_start", async () => {
    tableResults.content_post = { data: [{ id: POST, platform: "instagram", post_url: "https://x", posted_at: "2026-10-09T10:00:00Z", posted_date_th: "2026-10-09" }], error: null };
    await getPostsPageData();
    const cand = calls.find((c) => c.table === "v_content_piece")!;
    const orExpr = String(cand.ops.find((o) => o[0] === "or")?.[1]);
    expect(orExpr).toContain("posted_on.gte.");
    expect(orExpr).not.toContain("resolved_start");
  });
});

describe("review ข้อ 7: กองวันนี้ต้องโพสต์ใช้ loadPostTodayRows ตัวเดียวกับหน้างานที่รอฉัน", () => {
  it("เรียง resolved_start แล้ว step_id · approved/produced · ถึงวันนี้ · limit · ธง overdue จาก DB", async () => {
    tableResults.v_content_piece_calendar = { data: [{ step_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "a", piece_status: "produced", resolved_start: "2026-10-08", flag_no_link_overdue: true }, { step_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "b", piece_status: "approved", resolved_start: "2026-10-09", flag_no_link_overdue: false }], error: null };
    const r = await getPostsPageData();
    const ops = calls.find((c) => c.table === "v_content_piece_calendar")!.ops;
    expect(ops).toContainEqual(["in", "piece_status", ["approved", "produced"]]);
    expect(ops.filter((o) => o[0] === "order").map((o) => o[1])).toEqual(["resolved_start", "step_id"]);
    expect(ops.some((o) => o[0] === "limit")).toBe(true);
    expect(r.ok && r.data.overdueNoLinkIds).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  });
});
