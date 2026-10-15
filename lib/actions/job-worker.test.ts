// lib/actions/job-worker.test.ts — ช่องทางสาธารณะของช่าง: hash ที่ส่ง DB · input ผิดไม่ถึง RPC · cookie · ไม่ log ความลับ · payload ไม่มีข้อมูลต้องห้าม
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WID = "11111111-1111-4111-8111-111111111111";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string, opts: unknown) => {
  cookieStore.set(name, value);
  return opts;
});
let hdrs: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: cookieSet }),
  headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));

import { workerLogin, workerLogout, workerReceiveStage, workerSendStage } from "./job-worker";
import { loadWorkerView } from "@/lib/jobs/worker-server";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";

const VIEW_OK = {
  ok: true,
  job: { job_no: "JB-0001", status: "open", stages: [{ seq: 1, code: "cast", name: "หล่อ", status: "pending" }] },
  viewer: null, session_expired: false, next_action: "identify", action_stage: null, prev_weight_out_g: null, held_by: null,
  workers: [{ id: WID, display_name: "ช่างเอ" }], scrap_reasons: [],
};

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  hdrs = { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Mozilla/5.0 test" };
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const paramsOf = (i = 0) => rpcMock.mock.calls[i][1] as Record<string, unknown>;
const allLogged = () => JSON.stringify(errSpy.mock.calls);

describe("loadWorkerView", () => {
  it("token รูปแบบผิด → ไม่ถึง DB เลย · ข้อความไทย", async () => {
    for (const t of ["", "abc", "../oem", "x".repeat(80), "JB-0001", null, undefined, 5]) {
      const r = await loadWorkerView(t);
      expect(r.ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง sha256 ของ token/session/ip — ไม่มีค่าดิบใน params", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: VIEW_OK, error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_resolve");
    expect(paramsOf()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_ip_hash: sha("203.0.113.9") });
    const json = JSON.stringify(paramsOf());
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(SESSION);
    expect(json).not.toContain("203.0.113.9");
  });

  it("ไม่มี cookie / cookie รูปแบบผิด → p_session_hash = null", async () => {
    rpcMock.mockResolvedValue({ data: VIEW_OK, error: null });
    await loadWorkerView(TOKEN);
    expect(paramsOf().p_session_hash).toBeNull();
    cookieStore.set("w_session", "bad value");
    await loadWorkerView(TOKEN);
    expect(paramsOf(1).p_session_hash).toBeNull();
  });

  it("DB คืน ok:false → ข้อความไทยสั้นตาม code · เกินอัตรา → ข้อความรอ", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "invalid_token", message: "x" }, error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r).toMatchObject({ ok: false, code: "invalid_token" });
    expect(!r.ok && r.error).toMatch(/QR/);
    rpcMock.mockResolvedValue({ data: { ok: false, code: "rate_limited", message: "x" }, error: null });
    expect((await loadWorkerView(TOKEN)) as { error: string }).toMatchObject({ error: expect.stringContaining("บ่อยเกินไป") });
  });

  it("error ระบบ → ข้อความกลาง · log เฉพาะ code (ไม่มี token/hash/ข้อความดิบ)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: `boom ${TOKEN} ${sha(TOKEN)}`, details: "pin=4831" } });
    const r = await loadWorkerView(TOKEN);
    expect(r).toMatchObject({ ok: false });
    const logged = allLogged();
    expect(logged).toContain("XX000");
    for (const secret of [TOKEN, sha(TOKEN), "4831", "boom"]) expect(logged).not.toContain(secret);
  });

  it("RPC คืนรูปที่ใช้ไม่ได้ → ข้อความกลาง ไม่ throw", async () => {
    for (const data of [null, "x", [], { ok: true }, { ok: true, job: {} }]) {
      rpcMock.mockResolvedValue({ data, error: null });
      expect((await loadWorkerView(TOKEN)).ok).toBe(false);
    }
  });

  it("🔴 payload ที่ส่งออกไป client ไม่มีข้อมูลต้องห้าม แม้ DB ส่งมาปนมา", async () => {
    rpcMock.mockResolvedValue({
      data: { ...VIEW_OK, job: { ...VIEW_OK.job, price_per_piece: 999, customer_name: "บริษัท ลับ", quote_no: "Q-1" }, grand_total: 5, costs: { unit_cost: 1 } },
      error: null,
    });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(findForbiddenKeys(r.data)).toEqual([]);
    const json = JSON.stringify(r.data);
    for (const s of ["บริษัท ลับ", "Q-1", "999"]) expect(json).not.toContain(s);
  });
});

describe("workerLogin", () => {
  it("ข้อมูลผิดรูป → ไม่ถึง DB: workerId ไม่ใช่ uuid · PIN ไม่ใช่ 4 หลัก", async () => {
    for (const [w, p] of [["x", "1234"], [WID, "123"], [WID, "12345"], [WID, "abcd"], [WID, ""]] as const) {
      expect((await workerLogin(TOKEN, w, p)).ok, `${w} ${p}`).toBe(false);
    }
    expect((await workerLogin("bad", WID, "4831")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("สำเร็จ → ตั้ง cookie httpOnly · sameSite lax · path /w · maxAge ≤ 12 ชม. (ค่า session ดิบอยู่ใน cookie เท่านั้น)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, session_token: SESSION, expires_at: new Date(Date.now() + 11 * 3600_000).toISOString(), worker: { id: WID, display_name: "ช่างเอ" } }, error: null });
    const r = await workerLogin(TOKEN, WID, "4831");
    expect(r).toEqual({ ok: true });
    expect(rpcMock.mock.calls[0][0]).toBe("worker_pin_verify");
    expect(paramsOf()).toMatchObject({ p_token_hash: sha(TOKEN), p_worker_id: WID, p_pin: "4831", p_ip_hash: sha("203.0.113.9"), p_user_agent: "Mozilla/5.0 test" });
    expect(JSON.stringify(paramsOf())).not.toContain(TOKEN);
    const [name, value, opts] = cookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("w_session");
    expect(value).toBe(SESSION);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/w" });
    expect(opts.maxAge as number).toBeLessThanOrEqual(12 * 3600);
    expect(opts.maxAge as number).toBeGreaterThan(10 * 3600);
  });

  it("PIN ผิด/ล็อก → ไม่ตั้ง cookie · ข้อความไทย · รอกี่วินาทีจาก DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "x", attempts_left: 3 }, error: null });
    const r = await workerLogin(TOKEN, WID, "0001");
    expect(r).toMatchObject({ ok: false, code: "bad_credentials", error: "ชื่อหรือ PIN ไม่ถูกต้อง" });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "locked", message: "x", retry_after_seconds: 900 }, error: null });
    expect(await workerLogin(TOKEN, WID, "0001")).toMatchObject({ ok: false, code: "locked", retryAfterSeconds: 900, error: "ใส่ PIN ผิดหลายครั้ง — ลองใหม่ใน 15 นาที" });
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("สัญญา 0173: PIN ผิดครั้งที่ 3-4 เตือนเหลือกี่ครั้ง · locked 1 ชม. · locked_office · งบ token หมด", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "x", attempts_left: 2, attempts_until_office: 12, token_budget_left: 17 }, error: null });
    expect(await workerLogin(TOKEN, WID, "0001")).toMatchObject({ ok: false, error: expect.stringContaining("เหลืออีก 2 ครั้ง") });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "x", attempts_left: 1, attempts_until_office: 11, token_budget_left: 16 }, error: null });
    expect(await workerLogin(TOKEN, WID, "0001")).toMatchObject({ ok: false, error: expect.stringContaining("เหลืออีก 1 ครั้ง") });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "locked", message: "x", retry_after_seconds: 3600 }, error: null });
    expect(await workerLogin(TOKEN, WID, "0001")).toMatchObject({ code: "locked", retryAfterSeconds: 3600, error: expect.stringContaining("60 นาที") });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "locked_office", message: "x" }, error: null });
    expect(await workerLogin(TOKEN, WID, "0001")).toMatchObject({ code: "locked_office", error: "ล็อกแล้ว ให้ออฟฟิศปลดล็อก" });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "token_budget_exhausted", message: "x" }, error: null });
    expect(await workerLogin(TOKEN, WID, "0001")).toMatchObject({ code: "token_budget_exhausted", error: "ใบนี้ใส่ PIN ผิดเกินกำหนด ขอพิมพ์ใบใหม่จากออฟฟิศ" });
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("ตัวเลขแนบมาผิดชนิด (string/NaN/ติดลบ) ไม่ทำให้ข้อความเพี้ยน หรือรั่วค่าดิบ", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "x", attempts_left: "2; drop", attempts_until_office: null, token_budget_left: -1 }, error: null });
    const r = await workerLogin(TOKEN, WID, "0001");
    expect(r).toMatchObject({ ok: false, error: "ชื่อหรือ PIN ไม่ถูกต้อง" });
    expect(JSON.stringify(r)).not.toContain("drop");
  });

  it("session_token ที่ DB คืนผิดรูป → ไม่ตั้ง cookie", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, session_token: "short", expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null });
    expect((await workerLogin(TOKEN, WID, "4831")).ok).toBe(false);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("PIN ไม่ถูก log แม้ DB ล้ม", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "pin 4831 failed" } });
    await workerLogin(TOKEN, WID, "4831");
    expect(allLogged()).not.toContain("4831");
    expect(allLogged()).not.toContain(TOKEN);
  });
});

describe("workerReceiveStage / workerSendStage", () => {
  it("ไม่มี session cookie → session_required โดยไม่ถึง DB", async () => {
    expect(await workerReceiveStage(TOKEN, 2, "1.5")).toMatchObject({ ok: false, code: "session_required" });
    expect(await workerSendStage(TOKEN, { expectedSeq: 2, weightOut: "1", qtyScrap: 0, scrapReason: null, metalAdded: null })).toMatchObject({ ok: false, code: "session_required" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("รับงาน: ส่ง hash + expected_seq + น้ำหนัก (number) · ไม่มี stage_code/worker_id จาก client", async () => {
    cookieStore.set("w_session", SESSION);
    const r = await workerReceiveStage(TOKEN, 3, "12.345");
    expect(r).toEqual({ ok: true, already: false, message: null, by: null });
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_receive");
    expect(paramsOf()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_expected_seq: 3, p_weight_in_g: 12.345, p_user_agent: "Mozilla/5.0 test", p_ip_hash: sha("203.0.113.9") });
  });

  it("รับงานไม่ชั่ง (ขั้นไม่บังคับ) → p_weight_in_g = null", async () => {
    cookieStore.set("w_session", SESSION);
    await workerReceiveStage(TOKEN, 1, "");
    expect(paramsOf().p_weight_in_g).toBeNull();
  });

  it("มีคนรับไปแล้ว (already) → ok + ข้อความไทย ไม่ใช่ error", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: { ok: true, already: true, message: "x", by: "ช่างบี" }, error: null });
    const r = await workerReceiveStage(TOKEN, 1, null);
    expect(r).toMatchObject({ ok: true, already: true, by: "ช่างบี", message: "ช่าง ช่างบี รับขั้นนี้ไปแล้ว" });
  });

  it("สัญญา 0174: handoff_mismatch -> ข้อความตายตัว ไม่มีตัวเลขส่วนต่าง/น้ำหนักขั้นก่อน แม้ DB เก่าจะแนบ gap_g มา · prev_not_sent ผ่านเป็น code (client ใส่ชื่อขั้นเอง)", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: { ok: false, code: "handoff_mismatch", message: "x", gap_g: -0.37, prev_weight_out_g: 10.5 }, error: null });
    const hm = await workerReceiveStage(TOKEN, 2, "10.13");
    expect(hm).toMatchObject({ ok: false, code: "handoff_mismatch", error: "น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ" });
    expect(JSON.stringify(hm)).not.toMatch(/0\.37|10\.5/);
    rpcMock.mockResolvedValue({ data: { ok: false, code: "prev_not_sent", message: "x" }, error: null });
    expect(await workerReceiveStage(TOKEN, 2, "10")).toMatchObject({ ok: false, code: "prev_not_sent" });
  });

  it("ส่งต่อ: ของเสีย + เหตุผล + เติมโลหะ → พารามิเตอร์ครบ · หมายเหตุเติมโลหะเป็นข้อความคงที่ (ไม่ให้ช่างพิมพ์)", async () => {
    cookieStore.set("w_session", SESSION);
    await workerSendStage(TOKEN, { expectedSeq: 2, weightOut: "10.5", qtyScrap: 2, scrapReason: "porosity", metalAdded: "0.4" });
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_send");
    expect(paramsOf()).toMatchObject({ p_expected_seq: 2, p_weight_out_g: 10.5, p_qty_scrap: 2, p_scrap_reason: "porosity", p_metal_added_g: 0.4, p_weight_note: "เติมโลหะ (ช่างแจ้งผ่าน QR)" });
    await workerSendStage(TOKEN, { expectedSeq: 2, weightOut: "10.5", qtyScrap: 0, scrapReason: "porosity", metalAdded: null });
    expect(paramsOf(1)).toMatchObject({ p_qty_scrap: 0, p_scrap_reason: null, p_metal_added_g: 0, p_weight_note: null });
  });

  it("0176 น้ำหนักเศษโลหะ: ส่ง p_scrap_weight_g เมื่อมีค่า (จุลภาคทศนิยมได้) · ไม่ส่ง/ว่าง = null · ผิดรูปแบบ/0/ติดลบ/กำกวม = ไม่ถึง DB", async () => {
    cookieStore.set("w_session", SESSION);
    const base = { expectedSeq: 2, weightOut: null, qtyScrap: 0, scrapReason: null, metalAdded: null };
    await workerSendStage(TOKEN, { ...base, scrapWeight: "0,35" });
    expect(paramsOf()).toMatchObject({ p_scrap_weight_g: 0.35 });
    await workerSendStage(TOKEN, base);
    expect(paramsOf(1)).toMatchObject({ p_scrap_weight_g: null });
    await workerSendStage(TOKEN, { ...base, scrapWeight: "  " });
    expect(paramsOf(2)).toMatchObject({ p_scrap_weight_g: null });
    rpcMock.mockClear();
    for (const bad of ["abc", "0", "-1", "1,234.5", "1.2345", "NaN", "100001"]) {
      expect((await workerSendStage(TOKEN, { ...base, scrapWeight: bad })).ok, bad).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ห้ามผ่าน (ไม่ถึง DB): น้ำหนักผิด · ของเสียติดลบ/ทศนิยม/มากเกิน · ของเสียแต่ไม่มีเหตุผล · เหตุผลนอก allowlist · seq ผิด · เติมโลหะติดลบ", async () => {
    cookieStore.set("w_session", SESSION);
    const ok = { expectedSeq: 2, weightOut: "10", qtyScrap: 0, scrapReason: null, metalAdded: null };
    const cases: Record<string, unknown>[] = [
      { weightOut: "-1" }, { weightOut: "0" }, { weightOut: "abc" }, { weightOut: "1.2345" }, { weightOut: "NaN" },
      { qtyScrap: -1 }, { qtyScrap: 1.5 }, { qtyScrap: 1001 }, { qtyScrap: NaN },
      { qtyScrap: 1, scrapReason: null }, { qtyScrap: 1, scrapReason: "<script>" },
      { expectedSeq: 0 }, { expectedSeq: 1.5 }, { expectedSeq: "2" },
      { metalAdded: "-0.1" }, { metalAdded: "x" },
    ];
    for (const c of cases) expect((await workerSendStage(TOKEN, { ...ok, ...c } as never)).ok, JSON.stringify(c)).toBe(false);
    expect((await workerSendStage(TOKEN, null as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("DB ปฏิเสธ (น้ำหนักเกิน/ขั้นเปลี่ยน) → ข้อความไทยตาม code", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: { ok: false, code: "weight_over", message: "x" }, error: null });
    expect(await workerSendStage(TOKEN, { expectedSeq: 2, weightOut: "99", qtyScrap: 0, scrapReason: null, metalAdded: null })).toMatchObject({ ok: false, code: "weight_over", error: expect.stringContaining("เติมโลหะ") });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "stage_changed", message: "x" }, error: null });
    expect(await workerReceiveStage(TOKEN, 2, null)).toMatchObject({ ok: false, code: "stage_changed" });
  });
});

describe("workerLogout", () => {
  it("เพิกถอน session ใน DB (ส่ง hash) + ลบ cookie (maxAge 0) · ไม่มี session ก็ไม่พัง", async () => {
    cookieStore.set("w_session", SESSION);
    expect(await workerLogout()).toEqual({ ok: true });
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_logout");
    expect(paramsOf()).toEqual({ p_session_hash: sha(SESSION) });
    expect(cookieSet.mock.calls.at(-1)).toEqual(["w_session", "", expect.objectContaining({ maxAge: 0, path: "/w", httpOnly: true })]);
    rpcMock.mockClear();
    cookieStore.clear();
    expect(await workerLogout()).toEqual({ ok: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
