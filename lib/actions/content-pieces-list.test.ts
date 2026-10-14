// lib/actions/content-pieces-list.test.ts — สิทธิ์ · shop_id · กรองสถานะเสมอ (D15) · ดึง 51 แถว/หน้า · ค้นชื่อไม่ฉีด wildcard · ไม่รั่ว error ดิบ
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
const getEffectiveRoleMock = vi.fn();

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
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: vi.fn(), from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [] }) }));

import { getPiecesList } from "./content-pieces-list";

const pieceOps = () => calls.find((c) => c.table === "v_content_piece")?.ops ?? [];
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ step_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `t${i}`, piece_status: "planned" }));

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
});

describe("getPiecesList", () => {
  it("staff / role ไม่รู้จัก → ปฏิเสธโดยไม่ query", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await getPiecesList({})).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("ค่าเริ่มต้น: shop_id · กรองสถานะ 'ยังไม่ปิด' (ไม่มี posted/cancelled) · range 0..50 · เรียงวันแล้ว step_id", async () => {
    const r = await getPiecesList({});
    expect(r.ok).toBe(true);
    const ops = pieceOps();
    expect(ops).toContainEqual(["eq", "shop_id", SHOP]);
    const inOp = ops.find((o) => o[0] === "in");
    expect(inOp?.[1]).toBe("piece_status");
    expect(inOp?.[2]).not.toContain("posted");
    expect(inOp?.[2]).not.toContain("cancelled");
    expect(ops).toContainEqual(["range", 0, 50]);
    const orders = ops.filter((o) => o[0] === "order");
    expect(orders[0][1]).toBe("resolved_start");
    expect(orders[1][1]).toBe("step_id");
  });

  it("D15: ทุกสถานะที่เลือก ต้องมีตัวกรองสถานะเสมอ · posted จำกัด 60 วัน · cancelled กรองตรง", async () => {
    for (const status of ["idea", "planned", "drafting", "in_review", "approved", "produced", "posted", "cancelled", "ขยะ"]) {
      calls.length = 0;
      await getPiecesList({ status });
      const ops = pieceOps();
      const filtered = ops.some((o) => (o[0] === "in" || o[0] === "eq") && o[1] === "piece_status");
      expect(filtered, status).toBe(true);
    }
    calls.length = 0;
    await getPiecesList({ status: "posted" });
    expect(pieceOps().some((o) => o[0] === "gte" && o[1] === "posted_on")).toBe(true);
    calls.length = 0;
    await getPiecesList({ posted: "1" });
    const orOp = pieceOps().find((o) => o[0] === "or");
    expect(String(orOp?.[1])).toContain("piece_status.eq.posted");
    expect(String(orOp?.[1])).toContain("posted_on.gte."); // review: นับ 60 วันจากวันที่โพสต์จริง ไม่ใช่วันที่วางแผน
    expect(String(orOp?.[1])).not.toContain("resolved_start");
  });

  it("แบ่งหน้า: หน้า 3 → range 100..150 · ได้ 51 แถว = มีหน้าถัดไปและตัดเหลือ 50", async () => {
    tableResults.v_content_piece = { data: rows(51), error: null };
    const r = await getPiecesList({ page: "3" });
    expect(pieceOps()).toContainEqual(["range", 100, 150]);
    expect(r.ok && r.data.rows).toHaveLength(50);
    expect(r.ok && r.data.hasNext).toBe(true);
    tableResults.v_content_piece = { data: rows(50), error: null };
    const r2 = await getPiecesList({});
    expect(r2.ok && r2.data.hasNext).toBe(false);
  });

  it("ตัวกรองแคมเปญ/ช่องทาง/ค้นชื่อ ส่งเมื่อถูกต้องเท่านั้น · wildcard ของผู้ใช้ถูกกำจัด", async () => {
    await getPiecesList({ campaign: CAMPAIGN, channel: "tiktok", q: "100%_แหวน*" });
    const ops = pieceOps();
    expect(ops).toContainEqual(["eq", "campaign_id", CAMPAIGN]);
    expect(ops).toContainEqual(["eq", "channel", "tiktok"]);
    const like = ops.find((o) => o[0] === "ilike");
    expect(like).toEqual(["ilike", "title", "*100 แหวน*"]);

    calls.length = 0;
    await getPiecesList({ campaign: "x", channel: "evil", q: "" });
    const bad = pieceOps();
    expect(bad.some((o) => o[0] === "eq" && o[1] === "campaign_id")).toBe(false);
    expect(bad.some((o) => o[0] === "eq" && o[1] === "channel")).toBe(false);
    expect(bad.some((o) => o[0] === "ilike")).toBe(false);
  });

  it("แคมเปญ query กรอง shop_id + มี limit · ล้มแล้วหน้ายังอยู่ (แสดงข้อความไทย ไม่รั่วข้อความดิบ)", async () => {
    tableResults.campaign = { data: null, error: { code: "XX000", message: "relation analytics.campaign secret" } };
    const r = await getPiecesList({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.campaigns.ok).toBe(false);
    expect(JSON.stringify(r.data.campaigns)).not.toContain("secret");
    const c = calls.find((x) => x.table === "campaign");
    expect(c?.ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(c?.ops.some((o) => o[0] === "limit")).toBe(true);
  });

  it("query หลักล้ม → ข้อความไทย ไม่รั่ว error ดิบ", async () => {
    tableResults.v_content_piece = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout at analytics.x" } };
    const r = await getPiecesList({});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toContain("analytics");
    expect(!r.ok && r.error).toMatch(/ไม่สำเร็จ/);
  });
});
