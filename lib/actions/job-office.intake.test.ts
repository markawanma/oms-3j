// getJobBoard + ป้ายใบจากหน้างาน (W1): ใบงาน production ที่ source_ref = PO ของใบผลิตที่เปิดจากหน้างาน ได้ intake · OEM/ใบเดิมไม่ได้ · อ่านป้ายล้ม = บอร์ดเดิม ไม่พัง
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown }> = {};
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  const res = () => results[table] ?? { data: [], error: null };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => Promise.resolve("owner") }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => Promise.resolve({ id: USER }), requireSessionIfGateOn: () => Promise.resolve() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: vi.fn(), from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

import { getJobBoard } from "./job-office";

const boardRow = (o: Record<string, unknown>) => ({ id: "j1", job_no: "JB-0001", seq: 1, source_kind: "production", source_ref: "PO-0040", design_label: "แหวน", metal: "silver", qty_planned: 30, status: "open", ...o });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T05:00:00Z"));
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("getJobBoard — intake ของใบจากหน้างาน", () => {
  it("ใบงาน production ที่ PO เปิดจากหน้างาน ได้ intake (รอรับทราบ + เวลาเปิด + โลหะต่าง) · ใบ OEM/ใบไม่มี source_ref ไม่ได้", async () => {
    results.v_job_board = {
      data: [boardRow({ id: "j1" }), boardRow({ id: "j2", job_no: "JB-0002", seq: 2, source_kind: "oem", source_ref: "QT-1" }), boardRow({ id: "j3", job_no: "JB-0003", seq: 3, source_ref: null })],
      error: null,
    };
    results.v_production_order = { data: [{ id: "o1", po_no: "PO-0040", status: "open", opened_via: "shopfloor", acknowledged_at: null, created_at: "2026-10-19T02:00:00Z" }], error: null };
    results.v_production_order_item = { data: [{ production_order_id: "o1", metal_mismatch: true }], error: null };
    const r = await getJobBoard();
    if (!r.ok) throw new Error("board failed");
    const [a, b, c] = r.data.rows;
    expect(a.intake).toEqual({ ackPending: true, openedAt: "2026-10-19T02:00:00Z", metalMismatch: true });
    expect(b.intake).toBeUndefined();
    expect(c.intake).toBeUndefined();
    // query ป้ายถามเฉพาะ po ของใบงาน production ที่มี source_ref (ไม่ถาม OEM)
    const q = calls.find((x) => x.table === "v_production_order");
    expect(q?.ops.find((o) => o[0] === "in")?.[2]).toEqual(["PO-0040"]);
  });

  it("ไม่มีใบงาน production เลย → ไม่ query ใบผลิต (บอร์ดเดิมทุกประการ)", async () => {
    results.v_job_board = { data: [boardRow({ source_kind: "oem", source_ref: "QT-1" })], error: null };
    const r = await getJobBoard();
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.table === "v_production_order")).toBe(false);
  });

  it("อ่านป้ายล้ม → บอร์ดยังโหลดได้ ไม่มี intake (ไม่พังทั้งหน้า)", async () => {
    results.v_job_board = { data: [boardRow({})], error: null };
    results.v_production_order = { data: null, error: { code: "42P01", message: "relation analytics.v_production_order missing" } };
    const r = await getJobBoard();
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.rows[0].intake).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("relation");
  });

  it("ผลที่ส่งให้หน้าจอไม่มีชื่อผู้เปิด/เงิน/ต้นทุน (intake มี 3 field เท่านั้น)", async () => {
    results.v_job_board = { data: [boardRow({})], error: null };
    results.v_production_order = { data: [{ id: "o1", po_no: "PO-0040", status: "open", opened_via: "shopfloor", opened_by_worker_name: "หัวหน้าช่าง", acknowledged_at: null, created_at: "2026-10-19T02:00:00Z" }], error: null };
    const r = await getJobBoard();
    const intake = r.ok ? r.data.rows[0].intake : undefined;
    expect(Object.keys(intake ?? {}).sort()).toEqual(["ackPending", "metalMismatch", "openedAt"]);
    expect(JSON.stringify(r)).not.toContain("หัวหน้าช่าง");
  });
});
