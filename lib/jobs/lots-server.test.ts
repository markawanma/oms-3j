// lib/jobs/lots-server.ts — loader ต้นไม้ส่วนย่อย: อ่านด้วย shop_id + limit ทุก query · ล้ม = null/ว่าง (หน้าเดิมไม่พัง) · ไม่อ่านตัวเลขเงิน
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const ROOT = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222221";

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown }> = {};
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  const res = () => results[table] ?? { data: [], error: null };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@/lib/jobs/office-server", () => ({ db: () => ({ from: (t: string) => builder(t) }), shopId: () => SHOP }));

import { findLotRoot, loadBoardLots, loadJobLots } from "./lots-server";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const tree = (o: Record<string, unknown>) => ({ job_id: ROOT, root_job_id: ROOT, lot_seq: 0, label: "JB-0020", status: "in_progress", qty_planned: 50, qty_live: 50, stage_code: "setting", stage_name: "ฝังพลอย", stage_status: "received", ...o });

describe("loadJobLots", () => {
  it("ใบเดี่ยว: ต้นไม้ 1 แถว · ไม่ดึง summary (ไม่ต้องใช้) · ทุก query มี shop_id + limit", async () => {
    results.v_job_tree = { data: [tree({})], error: null };
    results.job_stage = { data: [{ id: "s1", job_id: ROOT, seq: 3, stage_code: "setting", status: "received" }], error: null };
    const r = await loadJobLots(ROOT, { setting: "ฝังพลอย" });
    expect(r?.parts).toHaveLength(1);
    expect(r?.parts[0].holdSeq).toBe(3);
    expect(r?.summary).toBeNull();
    expect(calls.some((c) => c.table === "v_job_tree_summary")).toBe(false);
    for (const c of calls) {
      expect(c.ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP), c.table).toBe(true);
      expect(c.ops.some((o) => o[0] === "limit") || c.table === "v_job_tree_summary", c.table).toBe(true);
    }
  });

  it("หลายส่วน: ดึง summary + ขั้นที่ผ่านมาแล้วของแต่ละส่วน (ใบย่อยพิมพ์บรรทัดเดียว) + ส่วนต่างพร้อมชื่อขั้น/ป้ายส่วน", async () => {
    results.v_job_tree = { data: [tree({}), tree({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", qty_planned: 10, qty_live: 10 })], error: null };
    results.v_job_tree_summary = { data: { root_job_id: ROOT, qty_planned: 60, parts_count: 2, lots_open: 1, qty_pending_explanation: 3, sum_check: true }, error: null };
    results.job_stage = {
      data: [
        { id: "s0", job_id: L1, seq: 1, stage_code: "cast", status: "skipped" },
        { id: "s1", job_id: L1, seq: 2, stage_code: "polish", status: "sent" },
        { id: "s2", job_id: L1, seq: 3, stage_code: "setting", status: "pending" },
        { id: "m1", job_id: ROOT, seq: 3, stage_code: "setting", status: "received" },
      ],
      error: null,
    };
    results.job_discrepancy = { data: [{ id: "d1", root_job_id: ROOT, job_id: L1, from_stage_id: "s1", to_stage_id: "s2", qty: 3, status: "open", created_at: "2026-10-19T03:00:00Z" }], error: null };
    const r = await loadJobLots(ROOT, { cast: "หล่อ", polish: "ขัด", setting: "ฝังพลอย" });
    expect(r?.summary).toMatchObject({ qtyPlanned: 60, lotsOpen: 1, qtyPendingExplanation: 3, sumCheck: true });
    expect(r?.parts[1].passedStages).toEqual(["หล่อ", "ขัด"]);
    expect(r?.parts[0].holdSeq).toBe(3);
    expect(r?.discrepancies[0]).toMatchObject({ qty: 3, fromStageName: "ขัด", toStageName: "ฝังพลอย", lotLabel: "JB-0020 · ส่วนที่ 1" });
  });

  it("อ่านไม่ได้ (error ของ view) → null · ไม่ throw (หน้าใบงานตกกลับไปแบบเดิม)", async () => {
    results.v_job_tree = { data: null, error: { code: "42P01", message: "relation does not exist" } };
    await expect(loadJobLots(ROOT, {})).resolves.toBeNull();
  });

  it("ไม่มีแถวต้นไม้เลย (ใบนี้เป็นส่วนย่อยเอง/ไม่พบ) → null", async () => {
    results.v_job_tree = { data: [], error: null };
    await expect(loadJobLots(L1, {})).resolves.toBeNull();
  });
});

describe("loadBoardLots", () => {
  it("ไม่มี id = ไม่ query · มี id → map ตาม root พร้อมบรรทัด 'เสร็จ x/N'", async () => {
    expect((await loadBoardLots([])).size).toBe(0);
    expect(calls).toHaveLength(0);
    results.v_job_tree_summary = { data: [{ root_job_id: ROOT, qty_planned: 100, parts_count: 2, qty_qc_passed_total: 34, qty_scrap_total: 1, sum_check: true }], error: null };
    results.v_job_tree = { data: [tree({ qty_live: 65, qty_planned: 65 })], error: null };
    const m = await loadBoardLots([ROOT]);
    expect(m.get(ROOT)).toMatchObject({ partsCount: 2, sumOk: true, line: "เสร็จ 34/100 · ฝังพลอย 65 · เสีย 1" });
  });
  it("ล้ม → map ว่าง (บอร์ดแสดงแบบเดิม)", async () => {
    results.v_job_tree_summary = { data: null, error: { code: "42P01" } };
    expect((await loadBoardLots([ROOT])).size).toBe(0);
  });
});

describe("findLotRoot — ใบนี้เป็นส่วนย่อยไหม", () => {
  it("ส่วนย่อย (มี parent) → id ใบแม่ · ใบแม่/ไม่พบ/อ่านไม่ได้ → null (ไม่เด้ง)", async () => {
    results.v_job_tree = { data: { job_id: L1, root_job_id: ROOT, parent_job_id: ROOT }, error: null };
    await expect(findLotRoot(L1)).resolves.toBe(ROOT);
    results.v_job_tree = { data: { job_id: ROOT, root_job_id: ROOT, parent_job_id: null }, error: null };
    await expect(findLotRoot(ROOT)).resolves.toBeNull();
    results.v_job_tree = { data: null, error: null };
    await expect(findLotRoot(L1)).resolves.toBeNull();
    results.v_job_tree = { data: null, error: { code: "42P01" } };
    await expect(findLotRoot(L1)).resolves.toBeNull();
  });
  it("query ผูก shop_id", async () => {
    results.v_job_tree = { data: null, error: null };
    await findLotRoot(L1);
    expect(calls[0].ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP)).toBe(true);
  });
});
