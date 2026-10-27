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
    expect(calls.some((c) => c.table === "v_job_tree_stage_loss")).toBe(false); // ใบเดี่ยวใช้ loss ของใบเอง
    expect(r?.treeLoss).toBeUndefined();
    for (const c of calls) {
      expect(c.ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP), c.table).toBe(true);
      expect(c.ops.some((o) => o[0] === "limit") || c.table === "v_job_tree_summary", c.table).toBe(true);
    }
  });

  it("0195 M2: holdsMetal = มีขั้นที่ received/sent ที่โลหะอยู่ในมือ (ขัดไม่ชั่งก็นับ) · ขั้น skipped/pending ไม่นับ · ไม่ส่ง metalStages = ไม่ตั้งค่า", async () => {
    results.v_job_tree = { data: [tree({}), tree({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", qty_planned: 4, qty_live: 4 })], error: null };
    results.v_job_tree_summary = { data: { root_job_id: ROOT, qty_planned: 10, parts_count: 2, lots_open: 1, qty_pending_explanation: 0, sum_check: true }, error: null };
    results.job_stage = {
      data: [
        { id: "a0", job_id: L1, seq: 1, stage_code: "wax", status: "skipped", weigh_required: false },
        { id: "a1", job_id: L1, seq: 2, stage_code: "buff", status: "sent", weigh_required: false },
        { id: "a2", job_id: L1, seq: 3, stage_code: "plating", status: "pending", weigh_required: true },
        { id: "b1", job_id: ROOT, seq: 1, stage_code: "wax", status: "received", weigh_required: false },
      ],
      error: null,
    };
    const names = { wax: "เทียน", buff: "ขัด", plating: "ชุบ" };
    const r = await loadJobLots(ROOT, names, new Set(["buff", "plating"]));
    expect(r?.parts[1].holdsMetal).toBe(true); // ส่วนที่ 1: ขัด (sent · ไม่ชั่ง · โลหะอยู่ในมือ)
    expect(r?.parts[1].hasWeighStage).toBe(false); // ไม่มีขั้นชั่งที่ชั่งแล้ว — เดิมจึงไม่บังคับชั่งของเสีย (ช่อง M2)
    expect(r?.parts[0].holdsMetal).toBeUndefined(); // ใบแม่: ขั้นเทียนไม่มีโลหะ
    const r2 = await loadJobLots(ROOT, names);
    expect(r2?.parts[1].holdsMetal).toBeUndefined();
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
    results.v_job_discrepancy = { data: [{ id: "d1", root_job_id: ROOT, job_id: L1, from_stage_id: "s1", to_stage_id: "s2", qty: 3, status: "open", created_at: "2026-10-19T03:00:00Z", weight_gap_g: -1.5, weight_sent_g: 10, qty_sent: 10, weight_gap_excess_g: -0.5 }], error: null };
    results.v_job_tree_stage_loss = { data: [{ root_job_id: ROOT, lot_seq: 1, job_id: L1, job_stage_id: "s2", stage_code: "setting", status: "pending", weighed: false, not_weighed: false, loss_g: null, loss_pct: null, warn: false, handoff_gap_g: null, handoff_gap_partial_g: -4, not_comparable: false, cancel_scrap_weight_g: 3.5 }, { job_id: null }], error: null };
    const r = await loadJobLots(ROOT, { cast: "หล่อ", polish: "ขัด", setting: "ฝังพลอย" });
    expect(r?.summary).toMatchObject({ qtyPlanned: 60, lotsOpen: 1, qtyPendingExplanation: 3, sumCheck: true });
    expect(r?.parts[1].passedStages).toEqual(["หล่อ", "ขัด"]);
    expect(r?.parts[0].holdSeq).toBe(3);
    expect(r?.discrepancies[0]).toMatchObject({ qty: 3, fromStageName: "ขัด", toStageName: "ฝังพลอย", lotLabel: "JB-0020 · ส่วนที่ 1" });
    // M-B: น้ำหนักเทียบ/snapshot/excess มาจาก view (DB คำนวณ) — ไม่คำนวณซ้ำฝั่ง TS
    expect(r?.discrepancies[0]).toMatchObject({ weightGapG: -1.5, weightSentG: 10, qtySent: 10, weightGapExcessG: -0.5 });
    // M-A: ต้นไม้ทั้งหมด (แถวเสีย/ไม่มี id ถูกกรอง) · query ผูก shop_id + root_job_id + limit
    expect(r?.treeLoss).toEqual([expect.objectContaining({ jobId: L1, lotSeq: 1, handoffGapPartialG: -4, handoffGapG: null, cancelScrapWeightG: 3.5 })]);
    const q = calls.find((c) => c.table === "v_job_tree_stage_loss")!;
    expect(q.ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP)).toBe(true);
    expect(q.ops.some((o) => o[0] === "eq" && o[1] === "root_job_id" && o[2] === ROOT)).toBe(true);
    expect(q.ops.some((o) => o[0] === "limit")).toBe(true);
    expect(calls.some((c) => c.table === "job_discrepancy")).toBe(false);
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

describe("0181 re-review: ขั้นรอรับ · ล็อก L-2 · loss ทั้งต้นไม้ · v_job_discrepancy", () => {
  const two = () => {
    results.v_job_tree = { data: [tree({}), tree({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", qty_planned: 10, qty_live: 10, stage_status: "pending" })], error: null };
    results.v_job_tree_summary = { data: { root_job_id: ROOT, qty_planned: 60, parts_count: 2, lots_open: 1, sum_check: true }, error: null };
  };
  const stages = [
    { id: "m1", job_id: ROOT, seq: 3, stage_code: "setting", status: "received", weigh_required: true },
    { id: "l0", job_id: L1, seq: 1, stage_code: "cast", status: "skipped", weigh_required: true, weight_in_g: 99, weight_out_g: 99 },
    { id: "l1", job_id: L1, seq: 2, stage_code: "polish", status: "sent", weigh_required: true, weight_in_g: 20, weight_out_g: 19.5, metal_added_g: 0 },
    { id: "l2", job_id: L1, seq: 3, stage_code: "setting", status: "pending", weigh_required: true },
    { id: "l3", job_id: L1, seq: 4, stage_code: "qc", status: "pending", weigh_required: false },
  ];
  const mm = (sid: string, partial: boolean) => ({ job_id: L1, job_stage_id: sid, payload: { kind: "handoff_mismatch", partial } });

  it("ส่วนที่มีขั้นรอรับ: pendingSeq = ต่ำสุด · ชื่อ/ชั่งตามขั้น · hasWeighStage ไม่นับขั้นที่ข้าม", async () => {
    two();
    results.job_stage = { data: stages, error: null };
    const r = await loadJobLots(ROOT, { setting: "ฝังพลอย", qc: "ตรวจ QC", cast: "หล่อ" });
    const lot = r!.parts[1];
    expect(lot).toMatchObject({ pendingSeq: 3, pendingStageName: "ฝังพลอย", pendingWeighRequired: true, hasWeighStage: true, receiveLocked: false });
    expect(r!.parts[0]).toMatchObject({ holdSeq: 3, holdWeighRequired: true, pendingSeq: null });
  });

  it("ล็อก: ชั่งไม่ตรง (partial) ครบ 3 ครั้งบนขั้นรอรับ = receiveLocked · 2 ครั้ง/ไม่ใช่ partial/ขั้นอื่น = ไม่ล็อก", async () => {
    two();
    results.job_stage = { data: stages, error: null };
    results.job_event = { data: [mm("l2", true), mm("l2", true), mm("l2", true), mm("l3", true)], error: null };
    expect((await loadJobLots(ROOT, {}))!.parts[1].receiveLocked).toBe(true);
    results.job_event = { data: [mm("l2", true), mm("l2", true), mm("l2", false), mm("l2", false)], error: null };
    expect((await loadJobLots(ROOT, {}))!.parts[1].receiveLocked).toBe(false);
  });

  it("event อ่านไม่ได้ → ไม่แสดงล็อก แต่โหลดต้นไม้ได้ตามปกติ", async () => {
    two();
    results.job_stage = { data: stages, error: null };
    results.job_event = { data: null, error: { code: "42P01" } };
    const r = await loadJobLots(ROOT, {});
    expect(r).not.toBeNull();
    expect(r!.parts[1].receiveLocked).toBe(false);
  });

  it("หลายส่วน: ดึง v_job_tree_stage_loss (ผูก shop_id + limit) · ใบเดี่ยว: ไม่ดึง · ส่วนต่างอ่านจาก v_job_discrepancy", async () => {
    two();
    results.job_stage = { data: stages, error: null };
    results.v_job_tree_stage_loss = { data: [{ root_job_id: ROOT, lot_seq: 0, job_id: ROOT, job_stage_id: "m1", stage_code: "setting", loss_g: 1, handoff_gap_partial_g: 0.2 }], error: null };
    const r = await loadJobLots(ROOT, {});
    expect(r!.treeLoss).toHaveLength(1);
    expect(r!.treeLoss![0]).toMatchObject({ lossG: 1, handoffGapPartialG: 0.2 });
    const lossCall = calls.find((c) => c.table === "v_job_tree_stage_loss")!;
    expect(lossCall.ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP)).toBe(true);
    expect(lossCall.ops.some((o) => o[0] === "limit")).toBe(true);
    expect(calls.some((c) => c.table === "v_job_discrepancy")).toBe(true);
    expect(calls.some((c) => c.table === "job_discrepancy")).toBe(false);
    calls.length = 0;
    results.v_job_tree = { data: [tree({})], error: null };
    results.job_stage = { data: [], error: null };
    const solo = await loadJobLots(ROOT, {});
    expect(solo!.treeLoss).toBeUndefined();
    expect(calls.some((c) => c.table === "v_job_tree_stage_loss")).toBe(false);
  });
});

describe("0181 security delta: ขั้นชั่งที่ชั่งแล้ว (M-D) · น้ำหนักล่าสุด (L-new-1)", () => {
  const one = (stages: Record<string, unknown>[]) => {
    results.v_job_tree = { data: [tree({}), tree({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1" })], error: null };
    results.v_job_tree_summary = { data: { root_job_id: ROOT, qty_planned: 60, parts_count: 2, sum_check: true }, error: null };
    results.job_stage = { data: stages, error: null };
  };
  it("ตั้งชั่งแต่ยังไม่มีน้ำหนักเลย (ยังไม่ถึงขั้นชั่ง) → hasWeighStage = false · latestWeightG = null", async () => {
    one([{ id: "a", job_id: L1, seq: 1, stage_code: "wax", status: "received", weigh_required: false }, { id: "b", job_id: L1, seq: 3, stage_code: "setting", status: "pending", weigh_required: true }]);
    const p = (await loadJobLots(ROOT, {}))!.parts[1];
    expect(p.hasWeighStage).toBe(false);
    expect(p.latestWeightG).toBeNull();
  });
  it("ขั้นชั่งที่ชั่งแล้ว (มีน้ำหนักเข้าหรือออก) → true · ขั้นที่ข้ามไม่นับ · ขั้นไม่ตั้งชั่งแม้มีน้ำหนักไม่นับเป็น 'ขั้นชั่ง'", async () => {
    one([{ id: "a", job_id: L1, seq: 1, stage_code: "cast", status: "skipped", weigh_required: true, weight_in_g: 5, weight_out_g: 5 }]);
    expect((await loadJobLots(ROOT, {}))!.parts[1].hasWeighStage).toBe(false);
    one([{ id: "a", job_id: L1, seq: 1, stage_code: "cast", status: "received", weigh_required: false, weight_in_g: 5 }]);
    expect((await loadJobLots(ROOT, {}))!.parts[1].hasWeighStage).toBe(false);
    one([{ id: "a", job_id: L1, seq: 1, stage_code: "cast", status: "received", weigh_required: true, weight_in_g: 5 }]);
    expect((await loadJobLots(ROOT, {}))!.parts[1].hasWeighStage).toBe(true);
    one([{ id: "a", job_id: L1, seq: 1, stage_code: "cast", status: "sent", weigh_required: true, weight_out_g: 4.5 }]);
    expect((await loadJobLots(ROOT, {}))!.parts[1].hasWeighStage).toBe(true);
  });
  it("น้ำหนักล่าสุด = ขั้นไม่ข้าม seq สูงสุดที่มีน้ำหนัก: ออก ถ้ายังไม่ส่งใช้ เข้า + เติม (ตรง job_latest_weight_g)", async () => {
    one([
      { id: "a", job_id: L1, seq: 1, stage_code: "cast", status: "sent", weigh_required: true, weight_in_g: 30, weight_out_g: 29 },
      { id: "b", job_id: L1, seq: 2, stage_code: "polish", status: "received", weigh_required: true, weight_in_g: 28, metal_added_g: 0.5 },
      { id: "c", job_id: L1, seq: 3, stage_code: "setting", status: "skipped", weigh_required: true, weight_in_g: 77, weight_out_g: 77 },
      { id: "d", job_id: L1, seq: 4, stage_code: "qc", status: "pending", weigh_required: false },
    ]);
    expect((await loadJobLots(ROOT, {}))!.parts[1].latestWeightG).toBe(28.5);
    one([{ id: "a", job_id: L1, seq: 1, stage_code: "cast", status: "sent", weigh_required: true, weight_in_g: 30, weight_out_g: 29 }]);
    expect((await loadJobLots(ROOT, {}))!.parts[1].latestWeightG).toBe(29);
  });
});
