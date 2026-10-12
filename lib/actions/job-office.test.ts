// lib/actions/job-office*.ts + job-workers.ts — สิทธิ์ · actor/shop ฝั่ง server · ตรวจ input ก่อนถึง DB · QR ไม่รั่ว token · ไม่ log ความลับ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const JOB = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const WORKER = "33333333-3333-4333-8333-333333333333";
const RAW_TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
let hdrs: Record<string, string> = {};

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown; count?: number }> = {};
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) {
    b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  }
  const res = () => results[table] ?? { data: [], error: null, count: 0 };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }) }));

import { createJob, getJobBoard, getJobDetail, getJobsForSourceItems, suggestJob } from "./job-office";
import { cancelJob, doneJob, issueJobQr, officeReceiveStage, officeSendStage, reopenJobStage, revokeJobQr, setJobDesignLabel, setJobDue, setJobStartGateNote, skipJobStage } from "./job-office-write";
import { getWorkers, resetWorkerPin, saveWorker, setWorkerActive, unlockWorker } from "./job-workers";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T05:00:00Z")); // วันนี้ไทย = 2026-10-12
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  hdrs = { host: "app.example.test", "x-forwarded-proto": "https" };
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

const lastRpc = () => rpcMock.mock.calls.at(-1) as [string, Record<string, unknown>];

describe("สิทธิ์ — ทุก action ปฏิเสธก่อนแตะ DB", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["getJobBoard", () => getJobBoard()],
    ["getJobDetail", () => getJobDetail(JOB)],
    ["getJobsForSourceItems", () => getJobsForSourceItems("oem", [ITEM])],
    ["suggestJob", () => suggestJob("oem", ITEM)],
    ["createJob", () => createJob({ kind: "oem", itemId: ITEM, stageCodes: ["cast", "qc", "pack"] })],
    ["issueJobQr", () => issueJobQr(JOB, false)],
    ["revokeJobQr", () => revokeJobQr(JOB, "หาย")],
    ["officeReceiveStage", () => officeReceiveStage({ jobId: JOB, expectedSeq: 1, occurredOn: "2026-10-12", weightIn: null, workerId: WORKER, assigneeName: null })],
    ["officeSendStage", () => officeSendStage({ jobId: JOB, expectedSeq: 1, occurredOn: "2026-10-12", weightOut: null, qtyScrap: 0, scrapReason: null, metalAdded: null, weightNote: null })],
    ["skipJobStage", () => skipJobStage(JOB, "cast", "ไม่ต้องหล่อ")],
    ["reopenJobStage", () => reopenJobStage(JOB, "ย้อนแก้")],
    ["setJobDue", () => setJobDue(JOB, "2026-10-30")],
    ["setJobStartGateNote", () => setJobStartGateNote(JOB, "ลูกค้าประจำ")],
    ["doneJob", () => doneJob({ jobId: JOB, qtyGood: 1, qtyScrap: 0, weightFinal: null, note: null })],
    ["cancelJob", () => cancelJob(JOB, "ยกเลิก")],
    ["getWorkers", () => getWorkers()],
    ["saveWorker", () => saveWorker({ displayName: "ช่างเอ", stageCodes: [] })],
    ["resetWorkerPin", () => resetWorkerPin(WORKER)],
    ["setWorkerActive", () => setWorkerActive(WORKER, false)],
    ["unlockWorker", () => unlockWorker(WORKER)],
    ["setJobDesignLabel", () => setJobDesignLabel(JOB, "แหวนลายใบไม้")],
  ];
  it.each(all)("%s: role staff/viewer/ว่าง/ตัวพิมพ์ต่าง ถูกปฏิเสธ (allowlist owner|admin)", async (_n, fn) => {
    for (const role of ["staff", "viewer", "manager", "", undefined, null, "Owner", "ADMIN"]) {
      roleMock.mockResolvedValue(role);
      const r = (await fn()) as { ok: boolean };
      expect(r.ok, String(role)).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it.each(all)("%s: ไม่มี session (AUTH_GATE on) ถูกปฏิเสธ", async (_n, fn) => {
    requireSessionMock.mockRejectedValue(new Error("ไม่ได้เข้าสู่ระบบ"));
    expect(((await fn()) as { ok: boolean }).ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("admin ผ่านเหมือน owner", async () => {
    roleMock.mockResolvedValue("admin");
    expect((await getJobBoard()).ok).toBe(true);
  });
});

describe("actor/shop มาจากฝั่ง server เท่านั้น", () => {
  it("p_actor = session user · p_shop_id = ของ server — input ที่แอบใส่ p_actor/p_shop_id ทับไม่ได้", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, job_no: "JB-0001" }, error: null });
    const evil = { jobId: JOB, reason: "ยกเลิก", p_actor: "00000000-0000-4000-8000-000000000000", p_shop_id: "00000000-0000-4000-8000-000000000001" };
    await cancelJob(evil.jobId, evil.reason);
    expect(lastRpc()[0]).toBe("job_cancel");
    expect(lastRpc()[1]).toMatchObject({ p_job_id: JOB, p_reason: "ยกเลิก", p_shop_id: SHOP, p_actor: USER });
    // พารามิเตอร์ธุรกิจที่ดูเหมือน p_actor ใน object อื่น (createJob) ไม่ถูกส่งต่อ
    await createJob({ kind: "production", itemId: ITEM, stageCodes: ["cast", "qc", "pack"], ...({ p_actor: "x", p_shop_id: "y" } as object) });
    expect(lastRpc()[1].p_actor).toBe(USER);
    expect(lastRpc()[1].p_shop_id).toBe(SHOP);
  });

  it("อ่าน session ไม่ได้ → ไม่เรียก RPC ที่ต้องมี actor (ข้อความไทย) · suggest (ไม่มี actor) ยังทำได้", async () => {
    sessionUserMock.mockResolvedValue(null);
    expect((await cancelJob(JOB, "ยกเลิก")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: { metal: "silver", qty: 5, design_label: "x", deposit_missing: false, existing_job: null, stages: [] }, error: null });
    expect((await suggestJob("production", ITEM)).ok).toBe(true);
    expect(lastRpc()[1]).not.toHaveProperty("p_actor");
    expect(lastRpc()[1].p_shop_id).toBe(SHOP);
  });
});

describe("อ่าน: ทุก query กรอง shop_id + มี limit", () => {
  it("บอร์ด: ใบงานที่ยังไม่ปิดเท่านั้น", async () => {
    await getJobBoard();
    for (const c of calls) {
      expect(c.ops, c.table).toContainEqual(["eq", "shop_id", SHOP]);
      expect(c.ops.some((o) => o[0] === "limit"), c.table).toBe(true);
    }
    expect(calls[0].table).toBe("v_job_board");
    expect(calls[0].ops).toContainEqual(["in", "status", ["open", "in_progress", "on_hold"]]);
  });
  it("รายละเอียดใบงาน: ทุกตาราง/view กรอง shop_id · ไม่พบ/id ผิดรูป = null (ไม่ query)", async () => {
    expect(await getJobDetail("not-a-uuid")).toEqual({ ok: true, data: null });
    expect(calls).toHaveLength(0);
    results.job = { data: { id: JOB, job_no: "JB-0001", metal: "silver", qty_planned: 3, status: "open", design_label: "แหวน", source_kind: "production", production_order_item_id: ITEM }, error: null };
    results.production_order_item = { data: { production_order_id: "44444444-4444-4444-8444-444444444444" }, error: null };
    const r = await getJobDetail(JOB);
    expect(r.ok && r.data?.job.jobNo).toBe("JB-0001");
    expect(r.ok && r.data?.source).toEqual({ kind: "production", id: "44444444-4444-4444-8444-444444444444" });
    for (const c of calls) expect(c.ops, c.table).toContainEqual(["eq", "shop_id", SHOP]);
  });
  it("ใบงานของร้านอื่น/ไม่มี → null", async () => {
    results.job = { data: null, error: null };
    expect(await getJobDetail(JOB)).toEqual({ ok: true, data: null });
  });
  it("ใบงานตามรายการต้นทาง: id ผิดรูป/ชนิดผิด/เกิน 100 ไม่ query", async () => {
    for (const [k, ids] of [["x", [ITEM]], ["oem", ["bad"]], ["oem", Array.from({ length: 101 }, () => ITEM)]] as const) {
      expect((await getJobsForSourceItems(k, [...ids])).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    await getJobsForSourceItems("oem", [ITEM]);
    expect(calls[0].ops).toContainEqual(["in", "oem_quote_item_id", [ITEM]]);
    expect(calls[0].ops).toContainEqual(["neq", "status", "cancelled"]);
  });
  it("query ล้ม → ข้อความไทย ไม่รั่วข้อความดิบ · log เฉพาะ code", async () => {
    results.v_job_board = { data: null, error: { code: "XX000", message: "relation analytics.secret exploded" } };
    const r = await getJobBoard();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("secret");
  });
});

describe("createJob — ตรวจ input ก่อนถึง DB", () => {
  const ok = { kind: "oem" as const, itemId: ITEM, stageCodes: ["cast", "qc", "pack"], dueDate: "2026-10-30" };
  it("ห้ามผ่าน: ชนิด/id/ขั้นว่าง/ขั้นซ้ำ/รหัสผิดรูป/วันผิด/ข้อความยาวเกิน", async () => {
    const bad: Record<string, unknown>[] = [
      { kind: "evil" }, { itemId: "x" }, { stageCodes: [] }, { stageCodes: ["cast", "cast"] }, { stageCodes: ["CAST"] }, { stageCodes: "cast" },
      { dueDate: "2026-02-30" }, { dueDate: "tomorrow" }, { designLabel: "ก".repeat(201) }, { note: "ก".repeat(501) }, { startGateNote: "a\u0000b" },
    ];
    for (const b of bad) expect((await createJob({ ...ok, ...b } as never)).ok, JSON.stringify(b)).toBe(false);
    expect((await createJob(null as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("OEM → job_create_from_quote_item (รวมเหตุผลก่อนมัดจำ) · ผลิตเอง → job_create_from_production_item (ไม่มี gate note)", async () => {
    rpcMock.mockResolvedValue({ data: { job_id: JOB, job_no: "JB-0009" }, error: null });
    const r = await createJob({ ...ok, startGateNote: "  ลูกค้าประจำ  ", designLabel: " แหวน " });
    expect(r).toEqual({ ok: true, data: { jobId: JOB, jobNo: "JB-0009" } });
    expect(lastRpc()[0]).toBe("job_create_from_quote_item");
    expect(lastRpc()[1]).toMatchObject({ p_quote_item_id: ITEM, p_stage_codes: ["cast", "qc", "pack"], p_due_date: "2026-10-30", p_start_gate_note: "ลูกค้าประจำ", p_design_label: "แหวน" });
    await createJob({ ...ok, kind: "production" });
    expect(lastRpc()[0]).toBe("job_create_from_production_item");
    expect(lastRpc()[1]).not.toHaveProperty("p_start_gate_note");
    expect(lastRpc()[1]).toMatchObject({ p_production_order_item_id: ITEM });
  });
  it("DB ปฏิเสธ (ยังไม่มีมัดจำ) → ข้อความไทยจาก DB/ตาราง hint", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "start_gate_required", message: "job_create_from_quote_item: ดีลนี้ยังไม่มีเงินมัดจำเข้า — ต้องระบุเหตุผลที่ยอมเริ่มผลิตก่อน (start_gate_note)" } });
    const r = await createJob(ok);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/มัดจำ/);
    expect(!r.ok && r.error).not.toMatch(/start_gate_note|job_create/);
  });
  it("RPC คืนรูปแปลก → ข้อความกลาง ไม่ throw", async () => {
    rpcMock.mockResolvedValue({ data: { job_id: "bad" }, error: null });
    expect((await createJob(ok)).ok).toBe(false);
  });
});

describe("พิมพ์ QR — token ดิบไม่ออกจากฝั่ง server", () => {
  it("คืนเฉพาะ SVG + เลขใบ · ค่า token ไม่อยู่ในผลลัพธ์ · ค่าเริ่ม = เพิกถอนใบเก่า", async () => {
    rpcMock.mockResolvedValue({ data: { token: RAW_TOKEN, print_no: 2, job_id: JOB, job_no: "JB-0001", revoked_previous: 1 }, error: null });
    const r = await issueJobQr(JOB, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.svg.startsWith("<svg")).toBe(true);
    expect(r.data).toMatchObject({ printNo: 2, jobNo: "JB-0001", revokedPrevious: 1 });
    expect(JSON.stringify(r)).not.toContain(RAW_TOKEN);
    expect(lastRpc()[0]).toBe("job_token_issue");
    expect(lastRpc()[1]).toMatchObject({ p_job_id: JOB, p_revoke_previous: true });
    await issueJobQr(JOB, true); // พิมพ์สำเนาเพิ่ม ไม่เพิกถอน
    expect(lastRpc()[1].p_revoke_previous).toBe(false);
  });
  it("host แปลก/ว่างใน header → ไม่ออก token (ไม่เรียก RPC)", async () => {
    for (const host of ["", "evil.test/../x", "a b", "evil.test@x", "-bad.test", "x".repeat(130)]) {
      hdrs = { host };
      expect((await issueJobQr(JOB, false)).ok, host).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("RPC คืน token ผิดรูป → ไม่ทำ QR · error ไม่มี token · ไม่ log token", async () => {
    rpcMock.mockResolvedValue({ data: { token: "short", print_no: 1, job_no: "JB-1" }, error: null });
    expect((await issueJobQr(JOB, false)).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "start_gate_required", message: `x ${RAW_TOKEN}` } });
    const r = await issueJobQr(JOB, false);
    expect(JSON.stringify(r)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(RAW_TOKEN);
  });
  it("เพิกถอน QR ต้องมีเหตุผล", async () => {
    expect((await revokeJobQr(JOB, "  ")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: { revoked: 2 }, error: null });
    expect(await revokeJobQr(JOB, "ใบหาย")).toEqual({ ok: true, data: { revoked: 2 } });
  });
});

describe("กรอกแทน รับ/ส่ง", () => {
  const recv = { jobId: JOB, expectedSeq: 2, occurredOn: "2026-10-12", weightIn: "10.5", workerId: WORKER, assigneeName: null };
  it("รับ: วันที่ย้อนได้ ≤14 วัน ไม่อนาคต · ต้องระบุผู้รับ · น้ำหนักถูกต้อง", async () => {
    for (const b of [{ occurredOn: "2026-10-13" }, { occurredOn: "2026-09-27" }, { occurredOn: "x" }, { weightIn: "-1" }, { weightIn: "0" }, { workerId: null, assigneeName: null }, { workerId: "bad" }, { expectedSeq: 0 }, { assigneeName: "ก".repeat(61), workerId: null }]) {
      expect((await officeReceiveStage({ ...recv, ...b } as never)).ok, JSON.stringify(b)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await officeReceiveStage({ ...recv, occurredOn: "2026-09-28" })).ok).toBe(true); // ย้อน 14 วันพอดี
    expect(lastRpc()[0]).toBe("job_office_receive");
    expect(lastRpc()[1]).toMatchObject({ p_expected_seq: 2, p_occurred_on: "2026-09-28", p_weight_in_g: 10.5, p_worker_id: WORKER, p_assignee_name: null, p_channel: "job_page" });
  });
  it("รับด้วยชื่อที่พิมพ์ (ไม่ใช่ช่างในทะเบียน) ผ่าน", async () => {
    expect((await officeReceiveStage({ ...recv, workerId: null, assigneeName: " ช่างข้างนอก " })).ok).toBe(true);
    expect(lastRpc()[1]).toMatchObject({ p_worker_id: null, p_assignee_name: "ช่างข้างนอก" });
  });
  const send = { jobId: JOB, expectedSeq: 2, occurredOn: "2026-10-12", weightOut: "10", qtyScrap: 0, scrapReason: null, metalAdded: null, weightNote: null };
  it("ส่ง: ของเสียต้องมีเหตุผล · เติมโลหะต้องมีหมายเหตุ · ค่าผิดไม่ถึง DB", async () => {
    for (const b of [{ qtyScrap: 2 }, { qtyScrap: 2, scrapReason: "x" }, { qtyScrap: -1 }, { metalAdded: "0.5" }, { metalAdded: "-1" }, { weightOut: "abc" }, { occurredOn: "2030-01-01" }]) {
      expect((await officeSendStage({ ...send, ...b } as never)).ok, JSON.stringify(b)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    await officeSendStage({ ...send, qtyScrap: 2, scrapReason: "broken", metalAdded: "0.5", weightNote: "เติมเนื้อ" });
    expect(lastRpc()[0]).toBe("job_office_send");
    expect(lastRpc()[1]).toMatchObject({ p_qty_scrap: 2, p_scrap_reason: "broken", p_metal_added_g: 0.5, p_weight_note: "เติมเนื้อ", p_weight_out_g: 10 });
  });
});

describe("ข้าม/ย้อน/กำหนดส่ง/เหตุผล/ปิด/ยกเลิก", () => {
  it("ต้องมีเหตุผลที่มีตัวอักษร: ข้าม · ย้อน · ยกเลิก · เหตุผลก่อนมัดจำ", async () => {
    expect((await skipJobStage(JOB, "cast", " ")).ok).toBe(false);
    expect((await reopenJobStage(JOB, "")).ok).toBe(false);
    expect((await cancelJob(JOB, "  ")).ok).toBe(false);
    expect((await setJobStartGateNote(JOB, "")).ok).toBe(false);
    expect((await skipJobStage(JOB, "Cast;drop", "เหตุผล")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("กำหนดส่ง: null = ล้าง · วันผิด/ปีนอกช่วงไม่ถึง DB", async () => {
    expect((await setJobDue(JOB, null)).ok).toBe(true);
    expect(lastRpc()[1].p_due_date).toBeNull();
    expect((await setJobDue(JOB, "2026-13-01")).ok).toBe(false);
    expect((await setJobDue(JOB, "2099-01-01")).ok).toBe(false);
  });
  it("ปิดงาน: จำนวนเต็ม ≥0 · น้ำหนักสุทธิถูกต้อง · DB ตัดสินดี+เสีย=แผน", async () => {
    for (const b of [{ qtyGood: -1 }, { qtyGood: 1.5 }, { qtyScrap: -2 }, { weightFinal: "-3" }, { weightFinal: "NaN" }]) {
      expect((await doneJob({ jobId: JOB, qtyGood: 3, qtyScrap: 0, weightFinal: null, note: null, ...b } as never)).ok, JSON.stringify(b)).toBe(false);
    }
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "qty_mismatch", message: "job_done: จำนวนดี + จำนวนเสีย ต้องเท่ากับจำนวนที่วางแผน (5 ชิ้น)" } });
    const r = await doneJob({ jobId: JOB, qtyGood: 3, qtyScrap: 0, weightFinal: "12.3", note: null });
    expect(!r.ok && r.error).toContain("5 ชิ้น");
    expect(lastRpc()[1]).toMatchObject({ p_qty_good: 3, p_qty_scrap: 0, p_weight_final_g: 12.3 });
  });
});

describe("ทะเบียนช่าง — PIN", () => {
  it("เพิ่มช่าง: ไม่ส่ง PIN = DB สุ่มให้ → คืนครั้งเดียวในผลลัพธ์ · ส่ง PIN = ไม่คืน PIN กลับ", async () => {
    rpcMock.mockResolvedValue({ data: { id: WORKER, display_name: "ช่างเอ", pin: "4831", pin_generated: true }, error: null });
    expect(await saveWorker({ displayName: "ช่างเอ", stageCodes: ["cast"] })).toEqual({ ok: true, data: { id: WORKER, pin: "4831" } });
    expect(lastRpc()[1]).toMatchObject({ p_id: null, p_display_name: "ช่างเอ", p_stage_codes: ["cast"], p_pin: null });
    rpcMock.mockResolvedValue({ data: { id: WORKER, pin: null, pin_generated: false }, error: null });
    expect(await saveWorker({ displayName: "ช่างบี", stageCodes: [], pin: "7391" })).toEqual({ ok: true, data: { id: WORKER, pin: null } });
    expect(lastRpc()[1].p_pin).toBe("7391");
  });
  it("ห้ามผ่าน: ชื่อว่าง/ยาว · PIN ไม่ใช่ 4 หลัก · แก้ช่างเดิมพร้อม PIN · id ผิด · รหัสขั้นผิด", async () => {
    for (const b of [{ displayName: " " }, { displayName: "ก".repeat(61) }, { pin: "123" }, { pin: "12345" }, { pin: "abcd" }, { stageCodes: ["Bad Code"] }, { id: "x" }]) {
      expect((await saveWorker({ displayName: "ช่าง", stageCodes: [], ...b } as never)).ok, JSON.stringify(b)).toBe(false);
    }
    expect((await saveWorker({ id: WORKER, displayName: "ช่าง", stageCodes: [], pin: "4831" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("PIN เดาง่าย (DB ปฏิเสธ) → ข้อความไทย · PIN ไม่ถูก log", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "pin_invalid", message: "PIN ต้องเป็นตัวเลข 4 หลัก และห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย" } });
    const r = await saveWorker({ displayName: "ช่างเอ", stageCodes: [], pin: "1111" });
    expect(!r.ok && r.error).toMatch(/PIN/);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("1111");
  });
  it("รีเซ็ต PIN: สุ่ม (ไม่ส่ง) คืนครั้งเดียว · กำหนดเอง = ไม่คืน · ปิด/เปิดช่างส่ง boolean", async () => {
    rpcMock.mockResolvedValue({ data: { worker_id: WORKER, pin: "2604", pin_generated: true }, error: null });
    expect(await resetWorkerPin(WORKER)).toEqual({ ok: true, data: { pin: "2604" } });
    expect(lastRpc()[1].p_pin).toBeNull();
    expect((await resetWorkerPin(WORKER, "12")).ok).toBe(false);
    expect((await resetWorkerPin("x")).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: { worker_id: WORKER, is_active: false }, error: null });
    expect((await setWorkerActive(WORKER, false)).ok).toBe(true);
    expect(lastRpc()[1]).toMatchObject({ p_worker_id: WORKER, p_active: false });
    expect((await setWorkerActive(WORKER, "no" as never)).ok).toBe(false);
  });
  it("อ่านทะเบียนช่าง: ไม่เลือก pin_hash (select เฉพาะคอลัมน์ปลอดภัย) · กรอง shop_id", async () => {
    await getWorkers();
    const w = calls.find((c) => c.table === "worker")!;
    expect(w.ops).toContainEqual(["eq", "shop_id", SHOP]);
    const sel = String(w.ops.find((o) => o[0] === "select")?.[1]);
    expect(sel).not.toMatch(/pin|hash/);
  });
});

describe("0173: ปลดล็อกช่าง · แก้ชื่อเรียกใบงาน · สถานะล็อกในทะเบียน", () => {
  it("unlockWorker: เรียก worker_unlock ด้วย actor/shop จาก server · uuid ผิดไม่ถึง DB", async () => {
    expect((await unlockWorker(WORKER)).ok).toBe(true);
    expect(lastRpc()[0]).toBe("worker_unlock");
    expect(lastRpc()[1]).toMatchObject({ p_worker_id: WORKER, p_shop_id: SHOP, p_actor: USER });
    rpcMock.mockClear();
    expect((await unlockWorker("x")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("unlockWorker: client ทับ p_actor/p_shop_id ไม่ได้ (ใส่หลัง spread)", async () => {
    await unlockWorker(WORKER);
    const sent = lastRpc()[1];
    expect(sent.p_actor).toBe(USER);
    expect(sent.p_shop_id).toBe(SHOP);
  });
  it("setJobDesignLabel: ส่งชื่อที่ตัดช่องว่างแล้ว · ว่าง/ยาวเกิน/ตัวควบคุม/uuid ผิด ไม่ถึง DB", async () => {
    expect((await setJobDesignLabel(JOB, "  แหวนลายใบไม้ ไซส์ 7  ")).ok).toBe(true);
    expect(lastRpc()[0]).toBe("job_design_label_set");
    expect(lastRpc()[1]).toMatchObject({ p_job_id: JOB, p_design_label: "แหวนลายใบไม้ ไซส์ 7", p_actor: USER, p_shop_id: SHOP });
    rpcMock.mockClear();
    for (const bad of ["", "   ", "x".repeat(201), "a\u0000b", 5 as never, null as never]) expect((await setJobDesignLabel(JOB, bad)).ok, String(bad)).toBe(false);
    expect((await setJobDesignLabel("nope", "ชื่อ")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("setJobDesignLabel: DB ปฏิเสธ (ใบปิดแล้ว) = ข้อความไทย", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "job_closed", message: "job_design_label_set: ใบงานปิดแล้ว" } });
    const r = await setJobDesignLabel(JOB, "ชื่อ");
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("job_design_label_set");
  });
  it("getWorkers: อ่านสถานะล็อกจาก v_worker_lock (ไม่มี pin_hash) แล้วจับคู่กับช่าง · ผิดชนิดถือว่าไม่ล็อก", async () => {
    results.worker = { data: [{ id: WORKER, display_name: "ช่างเอ", stage_codes: ["cast"], is_active: true, locked_until: "infinity", created_at: "2026-10-01T00:00:00Z" }], error: null };
    results.v_worker_lock = { data: [{ worker_id: WORKER, lock_state: "office", failed_attempts: 15, in_window: true }, { worker_id: "zz", lock_state: "weird" }], error: null };
    const r = await getWorkers();
    expect(r.ok && r.data.workers[0]).toMatchObject({ id: WORKER, lockState: "office", failedAttempts: 15 });
    const lk = calls.find((c) => c.table === "v_worker_lock")!;
    expect(lk.ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(String(lk.ops.find((o) => o[0] === "select")?.[1])).not.toMatch(/pin|hash/);
    results.v_worker_lock = { data: [{ worker_id: WORKER, lock_state: "weird", failed_attempts: "9", in_window: false }], error: null };
    const r2 = await getWorkers();
    expect(r2.ok && r2.data.workers[0]).toMatchObject({ lockState: "none", failedAttempts: 0 });
  });
});

describe("issueJobQr — origin จาก env APP_ORIGIN (security L2)", () => {
  const OLD = process.env.APP_ORIGIN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = OLD;
  });
  const tokenOk = () => rpcMock.mockResolvedValue({ data: { token: RAW_TOKEN, print_no: 1, job_no: "JB-0001", revoked_previous: 0 }, error: null });

  it("APP_ORIGIN ผิดรูปแบบ (เช่น ค่าตัวอย่าง TODO_OWNER_APP_ORIGIN) = ไม่ออก token ไม่เรียก RPC · ข้อความไทย", async () => {
    process.env.APP_ORIGIN = "TODO_OWNER_APP_ORIGIN";
    tokenOk();
    const r = await issueJobQr(JOB, false);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("APP_ORIGIN") });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("APP_ORIGIN ถูกต้อง = ออก QR ได้ แม้ Host header จะเป็นโดเมนอื่น/ปลอม (ไม่ใช้ Host)", async () => {
    process.env.APP_ORIGIN = "https://oms.example.test";
    hdrs = { host: "evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "http" };
    tokenOk();
    const r = await issueJobQr(JOB, false);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(r)).not.toContain("evil.test");
  });

  it("ไม่ตั้ง APP_ORIGIN = ถอยไปใช้ Host (พฤติกรรมเดิม) · host ผิดรูปแบบยังถูกปฏิเสธ", async () => {
    delete process.env.APP_ORIGIN;
    tokenOk();
    expect((await issueJobQr(JOB, false)).ok).toBe(true);
    rpcMock.mockClear();
    hdrs = { host: "evil.test/../x" };
    expect((await issueJobQr(JOB, false)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
