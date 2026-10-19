// lib/actions/job-worker-arrive.test.ts — 0183 (ช่าง): "ได้รับเพิ่มแล้ว" (ส่วนต่างทางที่ 3 · มติ 20 ต.ค.)
// ตรวจ: input ผิดไม่ถึง RPC · params ที่ส่ง DB (ส่งเฉพาะที่ระบุ) · ผลผ่าน allowlist (ไม่มีน้ำหนัก/ส่วนที่ขาด/ต้นทุน) · ข้อความของ code ที่ซ้ำบริบทอื่นเป็นของ arrive
// · ทุกข้อความล้มเหลวไม่มีตัวเลข (N1) แม้ข้อความดิบของ DB มีตัวเลข · my_actions ที่มี arrive ผ่าน sanitizeWorkerView
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const LOT = "22222222-2222-4222-8222-222222222222";
const DISC = "44444444-4444-4444-8444-444444444444";
const DISC2 = "55555555-5555-4555-8555-555555555555";
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

import { arriveDiscrepancyWorker } from "./job-worker";
import { loadWorkerView } from "@/lib/jobs/worker-server";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";

const paramsOf = (i = 0) => rpcMock.mock.calls[i][1] as Record<string, unknown>;
const OK_RESULT = { ok: true, action: "arrive", qty: 1, qty_remaining: 1, discrepancy_id: DISC2, arrived_id: "x", lot_job_id: LOT, lot_seq: 1, label: "JB-0038 · ส่วนที่ 1", stage_seq: 7, stage_code: "qc" };
const THAI = /[฀-๿]/;

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  hdrs = { "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 test" };
  rpcMock.mockResolvedValue({ data: OK_RESULT, error: null });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("arriveDiscrepancyWorker — params + ผลลัพธ์", () => {
  it("ส่งเฉพาะที่ระบุ: ไม่ส่ง p_weight_g/p_expected_open เมื่อไม่ระบุ · ส่ง hash ไม่ใช่ค่าดิบ · ผลมีเฉพาะ key ที่กรองแล้ว", async () => {
    const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1 });
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_discrepancy_arrive");
    expect(paramsOf()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_discrepancy_id: DISC, p_qty: 1, p_user_agent: "Mozilla/5.0 test", p_ip_hash: expect.any(String) });
    expect(JSON.stringify(paramsOf())).not.toContain(TOKEN);
    expect(JSON.stringify(paramsOf())).not.toContain(SESSION);
    expect(r).toEqual({ ok: true, arrived: { qty: 1, qtyRemaining: 1, remainingDiscrepancyId: DISC2, lot: { lotJobId: LOT, lotSeq: 1, label: "JB-0038 · ส่วนที่ 1", stageCode: "qc" } } });
  });
  it("ระบุน้ำหนัก (ทองขั้นชั่ง) + expectedOpen (CAS) = ส่งเป็น p_weight_g / p_expected_open · จำนวนเป็นข้อความตัวเลขล้วนได้", async () => {
    await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: "2", weightG: "1.234", expectedOpen: "3" });
    expect(paramsOf()).toMatchObject({ p_qty: 2, p_weight_g: 1.234, p_expected_open: 3 });
    await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 2, weightG: null, expectedOpen: null });
    expect(paramsOf(1)).not.toHaveProperty("p_weight_g");
    expect(paramsOf(1)).not.toHaveProperty("p_expected_open");
  });
  it("ครบทั้งก้อน (qty_remaining 0, ไม่มี discrepancy_id) → remainingDiscrepancyId = null", async () => {
    rpcMock.mockResolvedValue({ data: { ...OK_RESULT, qty_remaining: 0, discrepancy_id: null }, error: null });
    const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 2 });
    expect(r.ok && r.arrived?.qtyRemaining).toBe(0);
    expect(r.ok && r.arrived?.remainingDiscrepancyId).toBeNull();
  });
  it("ผลมี key เกิน (น้ำหนัก/ส่วนที่ขาด/ต้นทุน/gap) ต่อให้ DB ส่งมา = ไม่หลุดออกไปถึง client", async () => {
    rpcMock.mockResolvedValue({ data: { ...OK_RESULT, weight_g: 1.5, weight_gap_g: -2, missing_g: 2, cost_thb: 9, unit_price: 5 }, error: null });
    const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1 });
    const text = JSON.stringify(r);
    for (const bad of ["weight", "gap", "missing", "cost", "price", "1.5"]) expect(text).not.toContain(bad);
  });
  it("ผลที่รูปไม่ครบ (ไม่ใช่ action arrive · ไม่มี lot · qty ไม่ใช่จำนวนเต็ม) = ข้อความกลาง ไม่ใช่ ok", async () => {
    for (const data of [{ ...OK_RESULT, action: "split" }, { ...OK_RESULT, lot_job_id: "x" }, { ...OK_RESULT, qty: "1" }, { ...OK_RESULT, qty_remaining: null }, { ok: true }, [], null]) {
      rpcMock.mockResolvedValue({ data, error: null });
      const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1 });
      expect(r.ok).toBe(false);
    }
  });
});

describe("arriveDiscrepancyWorker — เคสห้ามผ่าน (ไม่ถึง DB)", () => {
  it("id ไม่ใช่ uuid · input ไม่ใช่ object · จำนวน 0/ติดลบ/ทศนิยม/คอมมา/เกินเพดาน/NaN/ข้อความ", async () => {
    const bads: unknown[] = [
      { discrepancyId: "x", qty: 1 }, { discrepancyId: "", qty: 1 }, { qty: 1 }, null, "abc", 42,
      { discrepancyId: DISC, qty: 0 }, { discrepancyId: DISC, qty: -1 }, { discrepancyId: DISC, qty: 2.5 }, { discrepancyId: DISC, qty: "1,5" },
      { discrepancyId: DISC, qty: 100001 }, { discrepancyId: DISC, qty: NaN }, { discrepancyId: DISC, qty: "abc" }, { discrepancyId: DISC, qty: "" }, { discrepancyId: DISC },
    ];
    for (const b of bads) expect((await arriveDiscrepancyWorker(TOKEN, b as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("น้ำหนัก 0 / ติดลบ / 4 ทศนิยม / ข้อความ / NaN / เกินเพดาน · expectedOpen 0/ติดลบ/ข้อความ = ไม่ถึง DB", async () => {
    for (const w of [0, "0", -1, "1.2345", "abc", NaN, 100001, "1e3"]) expect((await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1, weightG: w } as never)).ok).toBe(false);
    for (const e of [0, "0", -1, "x", 2.5, 100001]) expect((await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1, expectedOpen: e } as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ไม่มี session (cookie) = ไม่ถึง DB (session_required) · token รูปผิด = ไม่ถึง DB (invalid_token)", async () => {
    cookieStore.clear();
    const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1 });
    expect(!r.ok && r.code).toBe("session_required");
    cookieStore.set("w_session", SESSION);
    const r2 = await arriveDiscrepancyWorker("not-a-token", { discrepancyId: DISC, qty: 1 });
    expect(!r2.ok && r2.code).toBe("invalid_token");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("arriveDiscrepancyWorker — DB ปฏิเสธ → ข้อความไทยตายตัว ไม่มีตัวเลข (N1)", () => {
  const CODES = ["arrive_weight_required", "arrive_heavy", "not_receiver", "weight_unexpected", "office_required", "qty_invalid", "stage_changed", "already_resolved", "invalid_part", "job_closed", "job_on_hold", "weight_invalid", "date_invalid", "session_required"];
  it.each(CODES)("%s → ไทย · code ตามเดิม · ไม่มีตัวเลขแม้ข้อความดิบของ DB มีตัวเลขน้ำหนัก", async (code) => {
    rpcMock.mockResolvedValue({ data: { ok: false, code, message: "ขาด 2.000 g เพดาน 2.05 g" }, error: null });
    const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1, weightG: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code);
      expect(THAI.test(r.error)).toBe(true);
      // ตัวเลขที่ DB ส่งมา (ส่วนที่ขาด/เพดาน) ต้องไม่หลุดเข้าข้อความ · ตัวเลขตายตัวในกติกา (เช่น "มากกว่า 0") ไม่นับ
      for (const leaked of ["2.000", "2.05", " g"]) expect(r.error, leaked).not.toContain(leaked);
      expect(r.error).not.toMatch(/[a-z]+_[a-z_]+/);
    }
  });
  it("weight_unexpected / office_required ตอน arrive ใช้ข้อความของ arrive (ไม่ใช่ข้อความของการแยกส่วน/ชี้แจงส่วนต่าง)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "weight_unexpected", message: "x" }, error: null });
    const a = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1, weightG: 1 });
    expect(!a.ok && a.error).toContain("ได้รับเพิ่ม");
    expect(!a.ok && a.error).not.toContain("แยกส่วน");
    rpcMock.mockResolvedValue({ data: { ok: false, code: "office_required", message: "x" }, error: null });
    const b = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1, weightG: 1 });
    expect(!b.ok && b.error).toContain("ชิ้นที่มาถึง");
    expect(!b.ok && b.error).not.toContain("ชี้แจง");
  });
  it("error ระบบ (supabase error) = ข้อความกลาง · log ไม่มี token/session/ข้อความดิบ", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: `boom ${TOKEN} ${SESSION}`, hint: null } });
    const r = await arriveDiscrepancyWorker(TOKEN, { discrepancyId: DISC, qty: 1 });
    expect(!r.ok && r.error).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    const logs = JSON.stringify(errSpy.mock.calls);
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain(SESSION);
    expect(logs).not.toContain("boom");
  });
});

describe("loadWorkerView — my_actions มี arrive", () => {
  const VIEW = {
    ok: true,
    job: { job_no: "JB-0038", status: "in_progress", design_label: "แหวน", sku: null, metal: "gold", qty_planned: 10, due_date: null, stages: [{ seq: 7, code: "qc", name: "ตรวจ QC", status: "received" }], has_profile: true },
    viewer: { worker_id: WID, display_name: "ช่างรับ" }, session_expired: false, next_action: "multi", action_stage: null, prev_weight_out_g: null, held_by: "ช่างรับ", workers: [], scrap_reasons: [],
    parts: [],
    my_actions: [
      { lot_job_id: LOT, label: "JB-0038", action: "arrive", stage_seq: 7, stage_code: "qc", stage_name: "ตรวจ QC", weight_required: true, scrap_qty_ask: false, scrap_weight_ask: false, qty_hold: null, qty_expected: null, discrepancy_id: DISC, qty: 2, office_only: false,
        weight_gap_g: -2, missing_g: 2 },
    ],
  };
  it("action arrive ผ่าน allowlist: discrepancyId/qty/weightRequired มา · key น้ำหนัก/ส่วนที่ขาดที่แอบมาถูกทิ้ง · ไม่มี key ต้องห้าม", async () => {
    rpcMock.mockResolvedValue({ data: VIEW, error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.myActions).toHaveLength(1);
    expect(r.data.myActions?.[0]).toMatchObject({ action: "arrive", discrepancyId: DISC, qty: 2, weightRequired: true, officeOnly: false });
    const text = JSON.stringify(r.data);
    expect(text).not.toContain("gap");
    expect(text).not.toContain("missing");
    expect(findForbiddenKeys(r.data)).toEqual([]);
  });
});
