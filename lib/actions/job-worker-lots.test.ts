// lib/actions/job-worker-lots.test.ts — 0181 L1 (ช่าง): ส่งต่อ n จาก N · รับด้วยจำนวนจริง · ชี้แจงส่วนต่าง · ยกเลิกส่วน · resolve หลายส่วน
// ตรวจ: input ผิดไม่ถึง RPC · params ที่ส่ง DB (ใบเดี่ยว = ชุดเดิมเป๊ะ) · payload ผ่าน allowlist ไม่มีข้อมูลต้องห้าม
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const LOT = "22222222-2222-4222-8222-222222222222";
const DISC = "44444444-4444-4444-8444-444444444444";
const WID = "11111111-1111-4111-8111-111111111111";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
let hdrs: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: vi.fn() }),
  headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));

import { workerCancelLotAction, workerReceiveStage, workerResolveDiscrepancyAction, workerSendStage } from "./job-worker";
import { loadWorkerView } from "@/lib/jobs/worker-server";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";

const paramsOf = (i = 0) => rpcMock.mock.calls[i][1] as Record<string, unknown>;
const SEND = { expectedSeq: 4, weightOut: null, qtyScrap: 0, scrapReason: null, metalAdded: null };

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  hdrs = { "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 test" };
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("workerSendStage — ส่งต่อ n จาก N", () => {
  it("ใบเดี่ยว/ส่งทั้งหมด: ไม่ส่ง p_lot_job_id/p_qty_send/p_qty_hold เลย (params ชุดเดิม)", async () => {
    await workerSendStage(TOKEN, SEND);
    expect(paramsOf()).not.toHaveProperty("p_lot_job_id");
    expect(paramsOf()).not.toHaveProperty("p_qty_send");
    expect(paramsOf()).not.toHaveProperty("p_qty_hold");
  });
  it("แยกส่วน: ส่ง qtySend + qtyHold + lotJobId → params ถูกชื่อ · ผลมี lot ที่กรองแล้ว", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, action: "split", lot_job_id: LOT, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", qty: 40, parent_remaining: 60, cost_thb: 9 }, error: null });
    const r = await workerSendStage(TOKEN, { ...SEND, qtySend: "40", qtyHold: 100, lotJobId: LOT });
    expect(r).toEqual({ ok: true, already: false, message: null, by: null, lot: { lotJobId: LOT, lotSeq: 1, label: "JB-0020 · ส่วนที่ 1", qty: 40, parentRemaining: 60 } });
    expect(paramsOf()).toMatchObject({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_expected_seq: 4, p_lot_job_id: LOT, p_qty_send: 40, p_qty_hold: 100 });
    expect(JSON.stringify(r)).not.toContain("cost");
  });
  it("แยกส่วนโดยไม่รู้จำนวนที่ถือ · จำนวนผิดรูป · มีน้ำหนักมากับการแยก · lot ไม่ใช่ uuid = ไม่ถึง DB", async () => {
    for (const i of [
      { ...SEND, qtySend: 40 }, { ...SEND, qtySend: 0, qtyHold: 100 }, { ...SEND, qtySend: "1,5", qtyHold: 100 }, { ...SEND, qtySend: 2.5, qtyHold: 100 },
      { ...SEND, qtySend: 100001, qtyHold: 100001 }, { ...SEND, qtySend: 40, qtyHold: 100, weightOut: "9.9" }, { ...SEND, qtySend: 40, qtyHold: 100, metalAdded: "0.5" },
      { ...SEND, qtySend: 40, qtyHold: 100, scrapWeight: "0.1" }, { ...SEND, lotJobId: "x" },
    ]) expect((await workerSendStage(TOKEN, i as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("H2 ทองชั่งตอนแบ่ง: weightMoveG ส่งเป็น p_weight_move_g (เฉพาะเมื่อระบุ) · 0/ติดลบ/4 ทศนิยม/ข้อความ/ไม่ใช่การแยก = ไม่ถึง DB", async () => {
    await workerSendStage(TOKEN, { ...SEND, qtySend: 10, qtyHold: 50, weightMoveG: "20.5", lotJobId: LOT });
    expect(paramsOf()).toMatchObject({ p_qty_send: 10, p_qty_hold: 50, p_weight_move_g: 20.5 });
    await workerSendStage(TOKEN, { ...SEND, qtySend: 10, qtyHold: 50 });
    expect(paramsOf(1)).not.toHaveProperty("p_weight_move_g");
    rpcMock.mockClear();
    for (const w of [0, "0", -1, "1.2345", "abc", NaN]) expect((await workerSendStage(TOKEN, { ...SEND, qtySend: 10, qtyHold: 50, weightMoveG: w } as never)).ok).toBe(false);
    expect((await workerSendStage(TOKEN, { ...SEND, weightMoveG: "5" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("DB ตอบ weight_move_required / office_required → ข้อความไทยตายตัว ไม่มีตัวเลข", async () => {
    for (const code of ["weight_move_required", "office_required"]) {
      rpcMock.mockResolvedValue({ data: { ok: false, code, message: "x" }, error: null });
      const r = code === "office_required"
        ? await workerResolveDiscrepancyAction(TOKEN, { discrepancyId: DISC, kind: "lost", reason: "missing" })
        : await workerSendStage(TOKEN, { ...SEND, qtySend: 10, qtyHold: 50, weightMoveG: "5" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.error).not.toMatch(/\d/);
      }
    }
  });
  it("ส่งทั้งหมดที่ถือ (qtySend = qtyHold) พร้อมน้ำหนัก = ผ่านด่านฝั่งแอป (น้ำหนักห้ามเฉพาะตอนแยกจริง)", async () => {
    const r = await workerSendStage(TOKEN, { ...SEND, weightOut: "9.9", qtySend: 100, qtyHold: 100 });
    expect(r.ok).toBe(true);
    expect(paramsOf()).toMatchObject({ p_qty_send: 100, p_qty_hold: 100, p_weight_out_g: 9.9 });
  });
  it("DB ตอบ stage_changed / qty_hold_required / weight_unexpected → ข้อความไทยตายตัว (ไม่มีตัวเลข)", async () => {
    for (const code of ["stage_changed", "qty_hold_required", "weight_unexpected", "invalid_part", "not_holder"]) {
      rpcMock.mockResolvedValue({ data: { ok: false, code, message: "x" }, error: null });
      const r = await workerSendStage(TOKEN, { ...SEND, qtySend: 10, qtyHold: 20 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(/[฀-๿]/.test(r.error)).toBe(true);
        expect(r.error).not.toMatch(/\d/);
      }
    }
  });
});

describe("workerReceiveStage — รับด้วยจำนวนจริง", () => {
  it("ไม่ระบุ = params เดิม · ระบุ lot/qty = ส่ง · ผลมี discrepancyQty เมื่อ DB รายงาน", async () => {
    await workerReceiveStage(TOKEN, 3, null);
    expect(paramsOf()).not.toHaveProperty("p_qty_received");
    expect(paramsOf()).not.toHaveProperty("p_lot_job_id");
    rpcMock.mockResolvedValue({ data: { ok: true, discrepancy_qty: 5, discrepancy_id: DISC }, error: null });
    const r = await workerReceiveStage(TOKEN, 5, null, { lotJobId: LOT, qtyReceived: "35" });
    expect(r).toEqual({ ok: true, already: false, message: null, by: null, discrepancyQty: 5 });
    expect(paramsOf(1)).toMatchObject({ p_expected_seq: 5, p_lot_job_id: LOT, p_qty_received: 35 });
  });
  it("จำนวน 0 / ทศนิยม / คอมมา / ติดลบ / lot ไม่ใช่ uuid = ไม่ถึง DB", async () => {
    for (const o of [{ qtyReceived: 0 }, { qtyReceived: "0" }, { qtyReceived: 2.5 }, { qtyReceived: "1,5" }, { qtyReceived: -1 }, { qtyReceived: 100001 }, { lotJobId: "x" }])
      expect((await workerReceiveStage(TOKEN, 5, null, o as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("ชี้แจงส่วนต่าง · ยกเลิกส่วน", () => {
  it("resolve: kind นอก scrap|lost · เหตุผลนอกชุด · id ไม่ใช่ uuid = ไม่ถึง DB · ผ่าน = params ถูกชื่อ", async () => {
    for (const i of [{ discrepancyId: "x", kind: "lost", reason: "missing" }, { discrepancyId: DISC, kind: "broken", reason: "missing" }, { discrepancyId: DISC, kind: "lost", reason: "" }, { discrepancyId: DISC, kind: "lost", reason: "อะไรก็ได้" }])
      expect((await workerResolveDiscrepancyAction(TOKEN, i as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await workerResolveDiscrepancyAction(TOKEN, { discrepancyId: DISC, kind: "lost", reason: "missing" })).ok).toBe(true);
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_discrepancy_resolve");
    expect(paramsOf()).toMatchObject({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_discrepancy_id: DISC, p_kind: "lost", p_reason: "missing" });
  });
  it("ไม่มี session = ไม่ถึง DB (session_required)", async () => {
    cookieStore.clear();
    const r = await workerResolveDiscrepancyAction(TOKEN, { discrepancyId: DISC, kind: "lost", reason: "missing" });
    const c = await workerCancelLotAction(TOKEN, LOT, null);
    expect(r.ok).toBe(false);
    expect(c.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("cancel lot: lot ไม่ใช่ uuid = ไม่ถึง DB (อักขระล่องหน = DB ปฏิเสธ — verify-0181) · ผ่าน = เรียก job_worker_lot_cancel", async () => {
    expect((await workerCancelLotAction(TOKEN, "x", null)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await workerCancelLotAction(TOKEN, LOT, "แยกผิด")).ok).toBe(true);
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_lot_cancel");
    expect(paramsOf()).toMatchObject({ p_lot_job_id: LOT, p_reason: "แยกผิด" });
  });
});

describe("loadWorkerView — หลายส่วน (next_action = multi)", () => {
  const MULTI = {
    ok: true,
    job: { job_no: "JB-0020", status: "in_progress", design_label: "แหวน", sku: null, metal: "silver", qty_planned: 100, due_date: null, stages: [{ seq: 4, code: "cast", name: "หล่อ", status: "received" }], has_profile: true },
    viewer: { worker_id: WID, display_name: "ช่างเอ" }, session_expired: false, next_action: "multi", action_stage: null, prev_weight_out_g: null, held_by: "ช่างเอ", workers: [],
    scrap_reasons: ["porosity", "broken"],
    parts: [
      { lot_job_id: LOT, label: "JB-0020 · ส่วนที่ 1", lot_seq: 1, status: "in_progress", qty_planned: 40, qty_live: 40, stage_code: "cut_sprue", stage_name: "ตัดต้น", holder_name: null, days: 0, is_mine: false, can_cancel_split: true, unit_cost: 9 },
      { lot_job_id: "bad", label: "x", lot_seq: 2, qty_planned: 1 },
    ],
    my_actions: [
      { lot_job_id: LOT, label: "JB-0020 · ส่วนที่ 1", action: "explain", stage_seq: 4, stage_code: "cast", stage_name: "หล่อ", weight_required: false, scrap_qty_ask: false, scrap_weight_ask: false, qty_hold: null, qty_expected: null, discrepancy_id: DISC, qty: 5, office_only: true },
      { lot_job_id: LOT, label: "x", action: "hack", stage_seq: 1, stage_code: "cast" },
    ],
  };
  it("ยอมรับ multi · ประกอบ parts/myActions ทีละ key (ทิ้งแถวรูปผิด/key แปลก) · ไม่มี key ต้องห้าม", async () => {
    rpcMock.mockResolvedValue({ data: MULTI, error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.nextAction).toBe("multi");
    expect(r.data.parts).toHaveLength(1);
    expect(r.data.parts?.[0]).toEqual({ lotJobId: LOT, label: "JB-0020 · ส่วนที่ 1", lotSeq: 1, status: "in_progress", qtyPlanned: 40, qtyLive: 40, stageCode: "cut_sprue", stageName: "ตัดต้น", holderName: null, days: 0, isMine: false, canCancelSplit: true });
    expect(r.data.myActions).toHaveLength(1);
    expect(r.data.myActions?.[0]).toMatchObject({ action: "explain", discrepancyId: DISC, qty: 5, officeOnly: true });
    expect(findForbiddenKeys(r.data)).toEqual([]);
    expect(JSON.stringify(r.data)).not.toContain("unit_cost");
  });
  it("ก่อนระบุตัว: parts/my_actions ไม่ถูกส่งออกแม้ DB ส่งมา · multi ของคนที่ยังไม่ระบุตัว = identify", async () => {
    rpcMock.mockResolvedValue({ data: { ...MULTI, viewer: null }, error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok && r.data.nextAction).toBe("identify");
    expect(r.ok && "parts" in r.data).toBe(false);
    expect(r.ok && "myActions" in r.data).toBe(false);
  });
  it("ใบเดี่ยว (ไม่มี parts/my_actions) = รูปเดิมไม่เปลี่ยน (ไม่มี key ใหม่)", async () => {
    const single = { ...MULTI, next_action: "send", parts: undefined, my_actions: undefined };
    rpcMock.mockResolvedValue({ data: single, error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok && "parts" in r.data).toBe(false);
    expect(r.ok && "myActions" in r.data).toBe(false);
  });
});
