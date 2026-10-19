// lib/actions/job-lots.test.ts — 0181 L1 (ออฟฟิศ): แยก/ยกเลิกส่วน · ชี้แจง/void ส่วนต่าง · รายการ QR · QR ใบย่อย · รับด้วยจำนวนจริง
// ตรวจ: สิทธิ์ก่อนถึง DB · input ผิดไม่ถึง RPC · actor/shop ใส่ฝั่ง server · params ที่ส่ง DB ตรงสัญญา · ไม่มี token/hash/ตัวเลขเงินในผลลัพธ์
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const JOB = "11111111-1111-4111-8111-111111111111";
const LOT = "22222222-2222-4222-8222-222222222222";
const DISC = "44444444-4444-4444-8444-444444444444";
const RAW_TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
let hdrs: Record<string, string> = {};

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }) }));

import { cancelJobLot, listJobQr, resolveDiscrepancyOffice, splitJobLot, voidDiscrepancy } from "./job-lots";
import { issueJobQr, officeReceiveStage, revokeJobQr } from "./job-office-write";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T05:00:00Z"));
  vi.clearAllMocks();
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  hdrs = { host: "app.example.test", "x-forwarded-proto": "https" };
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

const lastRpc = () => rpcMock.mock.calls.at(-1) as [string, Record<string, unknown>];

describe("สิทธิ์ — ไม่ใช่ owner/admin = ไม่ถึง DB ทุก action", () => {
  it("staff/ไม่มี session", async () => {
    roleMock.mockResolvedValue("staff");
    expect((await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 5, qtyHold: 10 })).ok).toBe(false);
    expect((await cancelJobLot({ lotJobId: LOT, reason: "x", disposition: "return_to_parent" })).ok).toBe(false);
    expect((await resolveDiscrepancyOffice({ discrepancyId: DISC, kind: "lost", reason: "missing" })).ok).toBe(false);
    expect((await voidDiscrepancy(DISC, "x")).ok).toBe(false);
    expect((await listJobQr(JOB)).ok).toBe(false);
    roleMock.mockResolvedValue("owner");
    requireSessionMock.mockRejectedValue(new Error("no session"));
    expect((await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 5, qtyHold: 10 })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("splitJobLot", () => {
  it("ส่ง params ตรงสัญญา · actor/shop มาจาก server (client ทับไม่ได้) · ผลลัพธ์ประกอบทีละ key", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, lot_job_id: LOT, lot_seq: 2, label: "JB-0020 · ส่วนที่ 2", qty: 40, parent_remaining: 60, leak_cost_thb: 5 }, error: null });
    const r = await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: "40", qtyHold: 100, p_actor: "x", p_shop_id: "y" } as never);
    expect(r).toEqual({ ok: true, data: { lotJobId: LOT, lotSeq: 2, label: "JB-0020 · ส่วนที่ 2", qty: 40, parentRemaining: 60 } });
    const [fn, p] = lastRpc();
    expect(fn).toBe("job_lot_split");
    expect(p).toEqual({ p_job_id: JOB, p_expected_seq: 4, p_qty: 40, p_qty_scrap: 0, p_scrap_reason: null, p_qty_hold: 100, p_shop_id: SHOP, p_actor: USER });
  });
  it("input ผิด (ไม่ใช่ uuid · จำนวน 0/ติดลบ/ทศนิยม/มีคอมมา/เกินเพดาน · เสียไม่มีเหตุผล) = ไม่ถึง DB", async () => {
    const bads: unknown[] = [
      { jobId: "x", expectedSeq: 4, qty: 5 }, { jobId: JOB, expectedSeq: 0, qty: 5 }, { jobId: JOB, expectedSeq: 4, qty: 0 },
      { jobId: JOB, expectedSeq: 4, qty: -3 }, { jobId: JOB, expectedSeq: 4, qty: "1,5" }, { jobId: JOB, expectedSeq: 4, qty: 2.5 },
      { jobId: JOB, expectedSeq: 4, qty: 100001 }, { jobId: JOB, expectedSeq: 4, qty: NaN }, { jobId: JOB, expectedSeq: 4, qty: 5, qtyScrap: 2 },
      { jobId: JOB, expectedSeq: 4, qty: 5, qtyScrap: 2, scrapReason: "ตกพื้น" }, { jobId: JOB, expectedSeq: 4, qty: 5, qtyHold: 0 }, null,
    ];
    for (const b of bads) expect((await splitJobLot({ qtyHold: 10, ...(b as object) } as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("DB ปฏิเสธ (22023 + hint) → ข้อความไทย + code = hint · ผลที่รูปไม่ครบ = ข้อความกลาง", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "จำนวนที่แยก (รวมของเสีย) ต้องมากกว่า 0 และต้องเหลือกับผู้ถืออย่างน้อย 1 ชิ้น", hint: "qty_invalid" } });
    const r = await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 10, qtyHold: 20 });
    expect(r).toEqual({ ok: false, error: "จำนวนที่แยก (รวมของเสีย) ต้องมากกว่า 0 และต้องเหลือกับผู้ถืออย่างน้อย 1 ชิ้น", code: "qty_invalid" });
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    expect((await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 10, qtyHold: 20 })).ok).toBe(false);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(JOB);
  });
});

describe("splitJobLot — L4 บังคับ qtyHold · H2 น้ำหนักส่วนที่แยก (ทองชั่งตอนแบ่ง)", () => {
  it("ไม่ส่ง qtyHold / qtyHold ผิดรูป = ไม่ถึง DB (L4)", async () => {
    for (const h of [undefined, null, "", 0, "0", 2.5, "1,5", -1, 100001]) expect((await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 5, qtyHold: h } as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("weightMoveG: ไม่ระบุ = ไม่ส่ง p_weight_move_g · ระบุ = ส่ง · 0/ติดลบ/4 ทศนิยม/NaN/Infinity/ข้อความ = ไม่ถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, lot_job_id: LOT, lot_seq: 1, label: "JB-1 · ส่วนที่ 1", qty: 10, parent_remaining: 40 }, error: null });
    await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 10, qtyHold: 50 });
    expect(lastRpc()[1]).not.toHaveProperty("p_weight_move_g");
    await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 10, qtyHold: 50, weightMoveG: "20.5" });
    expect(lastRpc()[1].p_weight_move_g).toBe(20.5);
    rpcMock.mockClear();
    for (const w of [0, "0", -1, "-3", 1.2345, "1.2345", NaN, Infinity, "abc", "1,2,3", 100001]) {
      expect((await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 10, qtyHold: 50, weightMoveG: w } as never)).ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("DB ตอบ weight_move_required → ข้อความไทยตายตัวไม่มีตัวเลข + code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน", hint: "weight_move_required" } });
    const r = await splitJobLot({ jobId: JOB, expectedSeq: 4, qty: 10, qtyHold: 50 });
    expect(r).toEqual({ ok: false, error: "ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน", code: "weight_move_required" });
  });
});

describe("cancelJobLot · resolveDiscrepancyOffice · voidDiscrepancy", () => {
  it("cancel: คืนชิ้น (ไม่ส่ง scrap reason) · scrap ต้องมีเหตุผลของเสียจากชุด · disposition นอกชุด = ไม่ถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, disposition: "return_to_parent", live_qty: 40 }, error: null });
    expect(await cancelJobLot({ lotJobId: LOT, reason: "แยกผิด", disposition: "return_to_parent" })).toEqual({ ok: true, data: { disposition: "return_to_parent", liveQty: 40 } });
    expect(lastRpc()[1]).toEqual({ p_lot_job_id: LOT, p_reason: "แยกผิด", p_disposition: "return_to_parent", p_scrap_reason: null, p_shop_id: SHOP, p_actor: USER });
    rpcMock.mockClear();
    for (const b of [
      { lotJobId: LOT, reason: "x", disposition: "scrap" }, { lotJobId: LOT, reason: "x", disposition: "scrap", scrapReason: "อะไรก็ได้" },
      { lotJobId: LOT, reason: "x", disposition: "lost" }, { lotJobId: LOT, reason: "", disposition: "return_to_parent" },
      { lotJobId: "x", reason: "x", disposition: "scrap", scrapReason: "broken" },
    ]) expect((await cancelJobLot(b as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await cancelJobLot({ lotJobId: LOT, reason: "ของเสียทั้งก้อน", disposition: "scrap", scrapReason: "broken" })).ok).toBe(true);
    expect(lastRpc()[1].p_scrap_reason).toBe("broken");
  });
  it("M-C scrapWeightG: ไม่ระบุ = ไม่ส่ง p_scrap_weight_g · ระบุกับ scrap = ส่ง · 0/ติดลบ/4 ทศนิยม/NaN/ข้อความ/ไปกับ return_to_parent = ไม่ถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, disposition: "scrap", live_qty: 10 }, error: null });
    await cancelJobLot({ lotJobId: LOT, reason: "ใช้ไม่ได้", disposition: "scrap", scrapReason: "broken" });
    expect(lastRpc()[1]).not.toHaveProperty("p_scrap_weight_g");
    await cancelJobLot({ lotJobId: LOT, reason: "ใช้ไม่ได้", disposition: "scrap", scrapReason: "broken", scrapWeightG: "3.5" });
    expect(lastRpc()[1].p_scrap_weight_g).toBe(3.5);
    rpcMock.mockClear();
    for (const w of [0, "0", -1, "1.2345", NaN, Infinity, "abc", 100001]) {
      expect((await cancelJobLot({ lotJobId: LOT, reason: "x", disposition: "scrap", scrapReason: "broken", scrapWeightG: w } as never)).ok, String(w)).toBe(false);
    }
    expect((await cancelJobLot({ lotJobId: LOT, reason: "x", disposition: "return_to_parent", scrapWeightG: 5 })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("DB ตอบ scrap_weight_required → ข้อความไทยตายตัว + code (ทองต้องชั่งของเสียที่เลิกใช้)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "ทอง: ยกเลิกเป็นของเสียต้องชั่งน้ำหนักของเสียที่เลิกใช้", hint: "scrap_weight_required" } });
    const r = await cancelJobLot({ lotJobId: LOT, reason: "x", disposition: "scrap", scrapReason: "broken" });
    expect(r).toEqual({ ok: false, error: "ทอง: ยกเลิกเป็นของเสียต้องชั่งน้ำหนักของเสียที่เลิกใช้", code: "scrap_weight_required" });
  });
  it("M-B resolve: note (คำอธิบายข้อความ) ส่งเป็น p_reason แทนรหัส · note ล่องหน/< > /ยาวเกิน = ไม่ถึง DB · ไม่มี note = ส่งรหัสเดิม", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, qty: 1 }, error: null });
    await resolveDiscrepancyOffice({ discrepancyId: DISC, kind: "lost", reason: "missing", note: "ชั่งซ้ำแล้ว ผงทองหายตอนตะไบ" });
    expect(lastRpc()[1].p_reason).toBe("ชั่งซ้ำแล้ว ผงทองหายตอนตะไบ");
    await resolveDiscrepancyOffice({ discrepancyId: DISC, kind: "lost", reason: "missing", note: "" });
    expect(lastRpc()[1].p_reason).toBe("missing");
    rpcMock.mockClear();
    for (const n of ["a​b", "<b>x</b>", "x".repeat(201)]) {
      expect((await resolveDiscrepancyOffice({ discrepancyId: DISC, kind: "lost", reason: "missing", note: n })).ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("DB ตอบ note_required (ทองหายเกินสัดส่วน) → ข้อความไทย + code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "ทอง: น้ำหนักหายมากกว่าสัดส่วนชิ้นที่ขาด — ต้องเขียนคำอธิบายเป็นข้อความ (ไม่ใช่แค่เลือกรหัสเหตุผล)", hint: "note_required" } });
    const r = await resolveDiscrepancyOffice({ discrepancyId: DISC, kind: "lost", reason: "missing" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("note_required");
  });
  it("resolve/void: kind นอก scrap|lost · เหตุผลนอกชุด · id ไม่ใช่ uuid = ไม่ถึง DB · ผ่านแล้วส่ง params ตรงสัญญา", async () => {
    for (const b of [{ discrepancyId: "x", kind: "lost", reason: "missing" }, { discrepancyId: DISC, kind: "broken", reason: "missing" }, { discrepancyId: DISC, kind: "lost", reason: "" }, { discrepancyId: DISC, kind: "lost", reason: "x" }])
      expect((await resolveDiscrepancyOffice(b as never)).ok).toBe(false);
    expect((await voidDiscrepancy("x", "ของเจอแล้ว")).ok).toBe(false);
    expect((await voidDiscrepancy(DISC, "")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: { ok: true, qty: 5 }, error: null });
    expect(await resolveDiscrepancyOffice({ discrepancyId: DISC, kind: "lost", reason: "missing" })).toEqual({ ok: true, data: { qty: 5 } });
    expect(lastRpc()).toEqual(["job_discrepancy_resolve", { p_discrepancy_id: DISC, p_kind: "lost", p_reason: "missing", p_shop_id: SHOP, p_actor: USER }]);
    expect(await voidDiscrepancy(DISC, "ของเจอแล้ว")).toEqual({ ok: true, data: { qty: 5 } });
    expect(lastRpc()[0]).toBe("job_discrepancy_void");
  });
});

describe("listJobQr · issueJobQr (ใบย่อย) · revokeJobQr (รายใบ) · officeReceiveStage (จำนวนจริง)", () => {
  it("listJobQr: กรองทีละ key — ไม่มี token/hash แม้ DB ส่งมา · แถวรูปผิดถูกทิ้ง", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { print_no: 1, purpose: "traveler", lot_job_id: null, label: null, issued_at: "2026-10-12T01:00:00Z", active: false, revoked_at: "2026-10-12T02:00:00Z", revoke_reason: "reprint", token: RAW_TOKEN, token_hash: "a".repeat(64) },
        { print_no: 2, purpose: "sublot", lot_job_id: LOT, label: "JB-0020 · ส่วนที่ 1", issued_at: "2026-10-12T03:00:00Z", active: true, revoked_at: null, revoke_reason: null },
        { print_no: "x", purpose: "sublot" }, { print_no: 3, purpose: "evil" }, null,
      ],
      error: null,
    });
    const r = await listJobQr(JOB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((x) => x.printNo)).toEqual([1, 2]);
    expect(JSON.stringify(r)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(r)).not.toContain("token");
    expect(r.data[1]).toMatchObject({ purpose: "sublot", lotJobId: LOT, label: "JB-0020 · ส่วนที่ 1", active: true });
    expect(lastRpc()).toEqual(["job_token_list", { p_job_id: JOB, p_shop_id: SHOP, p_actor: USER }]);
  });
  it("issueJobQr ไม่ส่ง opts = พารามิเตอร์เดิมเป๊ะ · มี opts = purpose/lot ไม่เพิกถอนของเก่า · token ดิบไม่หลุดไปกับผลลัพธ์", async () => {
    rpcMock.mockResolvedValue({ data: { token: RAW_TOKEN, print_no: 3, job_no: "JB-0020", revoked_previous: 0 }, error: null });
    const r0 = await issueJobQr(JOB, false);
    expect(lastRpc()[1]).toEqual({ p_job_id: JOB, p_revoke_previous: true, p_shop_id: SHOP, p_actor: USER });
    expect(r0.ok && JSON.stringify(r0).includes(RAW_TOKEN)).toBe(false);
    const r1 = await issueJobQr(JOB, true, { purpose: "sublot", lotJobId: LOT });
    expect(lastRpc()[1]).toEqual({ p_job_id: JOB, p_purpose: "sublot", p_lot_job_id: LOT, p_shop_id: SHOP, p_actor: USER });
    expect(r1.ok && JSON.stringify(r1).includes(RAW_TOKEN)).toBe(false);
    // L6: keepPrevious=false (ที่ UI เดิมใช้แปลว่า "เพิกถอนของเก่า") ไม่ทำให้ใบย่อยเพิกถอนทุกใบ — เพิกถอนต้องเลือกชัด (revokePrevious: true)
    await issueJobQr(JOB, false, { purpose: "sublot", lotJobId: LOT });
    expect(lastRpc()[1]).not.toHaveProperty("p_revoke_previous");
    await issueJobQr(JOB, true, { purpose: "sublot", lotJobId: LOT, revokePrevious: true });
    expect(lastRpc()[1].p_revoke_previous).toBe(true);
    rpcMock.mockClear();
    expect((await issueJobQr(JOB, true, { purpose: "evil", lotJobId: LOT } as never)).ok).toBe(false);
    expect((await issueJobQr(JOB, true, { purpose: "sublot", lotJobId: "x" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("revokeJobQr: ไม่ระบุ printNo = พารามิเตอร์เดิม · ระบุ = p_print_no · ค่านอกช่วง = ไม่ถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { revoked: 1 }, error: null });
    await revokeJobQr(JOB, "ใบหาย");
    expect(lastRpc()[1]).toEqual({ p_job_id: JOB, p_reason: "ใบหาย", p_shop_id: SHOP, p_actor: USER });
    await revokeJobQr(JOB, "ใบหาย", 4);
    expect(lastRpc()[1]).toEqual({ p_job_id: JOB, p_reason: "ใบหาย", p_print_no: 4, p_shop_id: SHOP, p_actor: USER });
    rpcMock.mockClear();
    for (const n of [0, -1, 1.5, 100001, NaN]) expect((await revokeJobQr(JOB, "ใบหาย", n)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("officeReceiveStage: ไม่ระบุจำนวน = ไม่ส่ง p_qty_received (เดิม) · ระบุ = ส่ง · 0/ทศนิยม/คอมมา = ไม่ถึง DB", async () => {
    const base = { jobId: LOT, expectedSeq: 5, occurredOn: "2026-10-12", weightIn: null, workerId: null, assigneeName: "ช่างเอ" };
    await officeReceiveStage(base);
    expect(lastRpc()[1]).not.toHaveProperty("p_qty_received");
    await officeReceiveStage({ ...base, qtyReceived: "35" });
    expect(lastRpc()[1].p_qty_received).toBe(35);
    rpcMock.mockClear();
    for (const q of [0, "0", 2.5, "1,5", -1, "abc", 100001]) expect((await officeReceiveStage({ ...base, qtyReceived: q })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
