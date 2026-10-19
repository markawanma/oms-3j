// getJobBoard/getJobDetail (0181): 1 การ์ดต่อใบแม่ · บรรทัดส่วนย่อยเฉพาะใบที่แยกแล้ว · ใบเดี่ยวไม่ยิง query เพิ่มของบอร์ด · view ล้ม = หน้าเดิม
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const ROOT = "11111111-1111-4111-8111-111111111111";
const SOLO = "33333333-3333-4333-8333-333333333333";

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown; count?: number }> = {};
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  const res = () => results[table] ?? { data: [], error: null, count: 0 };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: async () => "owner" }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: "99999999-9999-4999-8999-999999999999" }), requireSessionIfGateOn: async () => undefined }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: vi.fn(), from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

import { getJobBoard, getJobDetail } from "./job-office";

const boardRow = (o: Record<string, unknown>) => ({ id: ROOT, job_no: "JB-0020", seq: 20, source_kind: "production", design_label: "แหวน", metal: "silver", qty_planned: 100, status: "in_progress", current_stage_code: "cast", board_column: "cast", ...o });

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getJobBoard", () => {
  it("กรองส่วนย่อยออกจากบอร์ด (parent_job_id is null) — 1 การ์ดต่อใบแม่", async () => {
    results.v_job_board = { data: [], error: null };
    await getJobBoard();
    const b = calls.find((c) => c.table === "v_job_board")!;
    expect(b.ops.some((o) => o[0] === "is" && o[1] === "parent_job_id" && o[2] === null)).toBe(true);
  });

  it("ใบเดี่ยว: ไม่ query ต้นไม้ · แถวไม่มี key ของส่วนย่อย", async () => {
    results.v_job_board = { data: [boardRow({ parts_count: 1, parts_open: 1, qty_pending_explanation: 0, parent_job_id: null })], error: null };
    const r = await getJobBoard();
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.table === "v_job_tree_summary" || c.table === "v_job_tree")).toBe(false);
    if (r.ok) expect(r.data.rows[0].lotsLine).toBeUndefined();
  });

  it("ใบแยกส่วน: ดึง summary + ใส่บรรทัด 'เสร็จ x/N' ให้การ์ด · ใบเดี่ยวข้างเคียงไม่ถูกแตะ", async () => {
    results.v_job_board = { data: [boardRow({ parts_count: 3, parts_open: 3, dominant_stage_code: "setting" }), boardRow({ id: SOLO, job_no: "JB-0021", seq: 21, parts_count: 1 })], error: null };
    results.v_job_tree_summary = { data: [{ root_job_id: ROOT, qty_planned: 100, parts_count: 3, qty_qc_passed_total: 30, sum_check: true }], error: null };
    results.v_job_tree = { data: [{ job_id: ROOT, root_job_id: ROOT, lot_seq: 0, label: "JB-0020", status: "in_progress", qty_planned: 70, qty_live: 70, stage_code: "setting", stage_name: "ฝังพลอย" }], error: null };
    const r = await getJobBoard();
    if (!r.ok) throw new Error("board failed");
    const split = r.data.rows.find((x) => x.id === ROOT)!;
    const solo = r.data.rows.find((x) => x.id === SOLO)!;
    expect(split.lotsLine).toBe("เสร็จ 30/100 · ฝังพลอย 70");
    expect(split.lotsSumOk).toBe(true);
    expect(solo.lotsLine).toBeUndefined();
    const sumCall = calls.find((c) => c.table === "v_job_tree_summary")!;
    expect(sumCall.ops.find((o) => o[0] === "in")?.[2]).toEqual([ROOT]);
  });

  it("view ต้นไม้อ่านไม่ได้: บอร์ดยังโหลด (ไม่มีบรรทัดส่วนย่อย) ไม่ล้มทั้งหน้า", async () => {
    results.v_job_board = { data: [boardRow({ parts_count: 3, dominant_stage_code: "setting" })], error: null };
    results.v_job_tree_summary = { data: null, error: { code: "42P01" } };
    const r = await getJobBoard();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.rows).toHaveLength(1);
      expect(r.data.rows[0].lotsLine).toBeUndefined();
    }
  });
});

describe("getJobDetail", () => {
  it("ใส่ lots ให้ใบแม่ (ใบเดี่ยว = parts 1 แถว) · ต้นไม้อ่านไม่ได้ = lots null ไม่ล้ม", async () => {
    const job = { id: ROOT, job_no: "JB-0020", source_kind: "production", design_label: "แหวน", metal: "silver", qty_planned: 100, status: "in_progress", qty_order: 100 };
    results.job = { data: job, error: null };
    results.v_job_tree = { data: [{ job_id: ROOT, root_job_id: ROOT, lot_seq: 0, label: "JB-0020", status: "in_progress", qty_planned: 100, qty_live: 100 }], error: null };
    const ok = await getJobDetail(ROOT);
    expect(ok.ok && ok.data?.lots?.parts).toHaveLength(1);
    results.v_job_tree = { data: null, error: { code: "42P01" } };
    const bad = await getJobDetail(ROOT);
    expect(bad.ok).toBe(true);
    if (bad.ok) expect(bad.data?.lots).toBeNull();
  });
});
