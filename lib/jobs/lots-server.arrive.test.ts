// lib/jobs/lots-server.ts — 0183: loader รู้จักส่วนที่เกิดจาก "ได้รับเพิ่มแล้ว" (arrive_discrepancy_id) + ขั้นผู้รับของส่วนต่าง (รหัส/ตั้งชั่ง)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const ROOT = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222221";
const ARR = "99999999-9999-4999-8999-999999999999";

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

import { loadJobLots } from "./lots-server";
import { LOT_STAGE_COLUMNS } from "./lots";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const tree = (o: Record<string, unknown>) => ({ job_id: ROOT, root_job_id: ROOT, lot_seq: 0, label: "JB-0018", status: "in_progress", qty_planned: 50, qty_live: 48, stage_code: "qc", stage_name: "ตรวจ QC", stage_status: "received", ...o });

describe("loadJobLots — ส่วนจาก arrive", () => {
  it("อ่านคอลัมน์ arrive_discrepancy_id จาก job_stage · ขั้นแรกของส่วนที่ผูก arrive = fromArrive true · ส่วนอื่น false", async () => {
    expect(LOT_STAGE_COLUMNS).toMatch(/arrive_discrepancy_id/);
    results.v_job_tree = { data: [tree({}), tree({ job_id: L1, lot_seq: 1, label: "JB-0018 · ส่วนที่ 1", qty_planned: 2, qty_live: 2 })], error: null };
    results.job_stage = {
      data: [
        { id: "m1", job_id: ROOT, seq: 2, stage_code: "qc", status: "received", arrive_discrepancy_id: null },
        { id: "a0", job_id: L1, seq: 1, stage_code: "polish", status: "skipped", arrive_discrepancy_id: null },
        { id: "a1", job_id: L1, seq: 2, stage_code: "qc", status: "received", arrive_discrepancy_id: ARR },
      ],
      error: null,
    };
    const r = await loadJobLots(ROOT, { polish: "ขัด", qc: "ตรวจ QC" });
    expect(r?.parts.find((p) => p.jobId === ROOT)?.fromArrive).toBe(false);
    expect(r?.parts.find((p) => p.jobId === L1)?.fromArrive).toBe(true);
    const st = calls.find((c) => c.table === "job_stage")!;
    expect(st.ops.some((o) => o[0] === "select" && String(o[1]).includes("arrive_discrepancy_id"))).toBe(true);
    expect(st.ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP)).toBe(true);
    expect(st.ops.some((o) => o[0] === "limit")).toBe(true);
  });

  it("ไม่มีคอลัมน์/ค่าว่าง/ไม่ใช่ข้อความ → false (ไม่เดา)", async () => {
    results.v_job_tree = { data: [tree({})], error: null };
    results.job_stage = { data: [{ id: "m1", job_id: ROOT, seq: 2, stage_code: "qc", status: "received", arrive_discrepancy_id: "" }, { id: "m2", job_id: ROOT, seq: 3, stage_code: "pack", status: "pending", arrive_discrepancy_id: 5 }], error: null };
    const r = await loadJobLots(ROOT, {});
    expect(r?.parts[0].fromArrive).toBe(false);
  });

  it("ส่วนต่าง: toStageCode / toWeighRequired มาจากขั้นผู้รับ (to_stage_id) — ขั้นที่ไม่ตั้งชั่ง = false", async () => {
    results.v_job_tree = { data: [tree({})], error: null };
    results.job_stage = {
      data: [
        { id: "s-from", job_id: ROOT, seq: 1, stage_code: "polish", status: "sent", weigh_required: false },
        { id: "s-to", job_id: ROOT, seq: 2, stage_code: "qc", status: "received", weigh_required: true },
      ],
      error: null,
    };
    results.v_job_discrepancy = { data: [{ id: "d1", root_job_id: ROOT, job_id: ROOT, from_stage_id: "s-from", to_stage_id: "s-to", qty: 2, status: "open" }], error: null };
    const r = await loadJobLots(ROOT, { polish: "ขัด", qc: "ตรวจ QC" });
    expect(r?.discrepancies[0]).toMatchObject({ toStageName: "ตรวจ QC", toStageCode: "qc", toWeighRequired: true });
    results.job_stage = { data: [{ id: "s-from", job_id: ROOT, seq: 1, stage_code: "polish", status: "sent", weigh_required: true }, { id: "s-to", job_id: ROOT, seq: 2, stage_code: "qc", status: "received", weigh_required: false }], error: null };
    const r2 = await loadJobLots(ROOT, { polish: "ขัด", qc: "ตรวจ QC" });
    expect(r2?.discrepancies[0]).toMatchObject({ toStageCode: "qc", toWeighRequired: false });
  });
});
