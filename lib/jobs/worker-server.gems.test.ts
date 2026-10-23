// lib/jobs/worker-server.ts (0191 W3) — ผู้จัดการกรอก/แก้พลอยจากมือถือ: ชั้นเรียก RPC + mapper ของผล (ประกอบทีละ field · กรอง key ต้องห้าม · ไม่มีราคา)
// ครอบ: พารามิเตอร์ที่ส่ง DB (hash · ไม่มี shop id · ส่งเฉพาะที่ระบุ) · ผลสำเร็จ → รูปร่าง allowlist · ผลล้ม (แถวผิด/ชื่อคล้าย/ล็อก/CAS) → ข้อความไทย + gem/similar ที่ตรวจรูปร่าง ·
//       ผลดิบมี key เงิน/ต้นทุน = ไม่ส่งต่อ · field แปลกที่ DB แนบมา = ทิ้ง · ข้อความดิบของ DB ไม่ถึงผู้ใช้
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const IDEM = "ik0123456789abcdef0123456789abcdef";
const JOB = "33333333-3333-4333-8333-333333333333";
const PID = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const I1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const I2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REV = "0123456789abcdef0123456789abcdef";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
let hdrs: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: vi.fn() }),
  headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("@/lib/images/signing", () => ({ signImagePaths: async () => new Map<string, string>(), signJobPhotoPaths: async () => new Map<string, string>() }));

import { gemFail, loadIntakeGemCatalog, loadIntakeJobGems, mapGemSimilar, mapGemSummary, openIntakeJob, parseGemFail, setIntakeJobGems } from "./worker-server";
import type { IntakeOpenInput } from "./worker-server";
import { listMyIntakeJobs } from "./shop-photo-server";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  hdrs = { "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 test" };
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
const params = (i = 0) => rpcMock.mock.calls[i][1] as Record<string, unknown>;
const fnOf = (i = 0) => rpcMock.mock.calls[i][0] as string;
const allLogged = () => JSON.stringify(errSpy.mock.calls);

const OPEN_OK = { ok: true, already: false, order_no: "PO-2610-001", job_no: "JB-0031", token: "Qq7-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY", design_label: "แหวน", sku: null, sku_pending: true, metal: "silver", qty_order: 3, qty_planned: 5, is_new_design: false, due_date: null, status: "open" };
const baseOpen = (o: Partial<IntakeOpenInput> = {}): IntakeOpenInput => ({ idemKey: IDEM, productId: null, pendingLabel: "แหวน", metal: "silver", purity: null, weightG: null, qtyOrder: 3, qtyPlanned: 5, dueDate: null, isNewDesign: false, note: null, gems: { answer: "none" }, ...o });
const LINES = [{ type_id: T1, shape_id: S1, size_a: 4, size_b: 6, qty_per_piece: 2, position: "ล้อมรอบ" }];

describe("openIntakeJob — พลอย (p_gem_*)", () => {
  it("S3 (security L1): กันซ้ำชั้น server — gems ไม่มี/null/answer แปลก = ล้มก่อนเรียก RPC (gem_answer_invalid) · ไม่มีทางไป null path", async () => {
    for (const gems of [undefined, null, {}, { answer: "maybe" }, { answer: null }, { answer: "NONE" }, "none", [] as unknown]) {
      const r = await openIntakeJob(TOKEN, baseOpen({ gems: gems as never }));
      expect(r, JSON.stringify(gems)).toMatchObject({ ok: false, code: "gem_answer_invalid", error: "เลือกก่อนว่าใบนี้ฝังพลอยไหม" });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("S3: ไม่มีทาง null — ทุกคำขอส่ง p_gem_answer เสมอ (none = ไม่มีพลอย) · ผลที่ DB ไม่ส่ง gem = ไม่มี key gem", async () => {
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
    const r = await openIntakeJob(TOKEN, baseOpen());
    expect(fnOf()).toBe("job_worker_open");
    expect(Object.keys(params()).filter((k) => k.startsWith("p_gem"))).toEqual(["p_gem_answer"]);
    expect(params().p_gem_answer).toBe("none");
    expect(r.ok && "gem" in r.data).toBe(false);
  });

  it("has: ส่ง answer + lines (+ force เฉพาะที่มี) · ไม่มี shop id · hash เท่านั้น", async () => {
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
    await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES, force: [{ kind: "type", name: "Garnett" }] } }));
    expect(params()).toMatchObject({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_gem_answer: "has", p_gem_lines: LINES, p_gem_force: [{ kind: "type", name: "Garnett" }] });
    expect(Object.keys(params()).some((k) => /shop/i.test(k))).toBe(false);
    expect(JSON.stringify(params())).not.toContain(TOKEN);
  });

  it("none/template: ส่ง answer อย่างเดียว (ไม่ส่ง lines/force) · has ที่ force ว่าง = ไม่ส่ง p_gem_force", async () => {
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
    await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "none" } }));
    await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "template" }, productId: PID, pendingLabel: null }));
    await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES, force: [] } }));
    expect(params(0)).toMatchObject({ p_gem_answer: "none" });
    expect("p_gem_lines" in params(0) || "p_gem_force" in params(0)).toBe(false);
    expect(params(1)).toMatchObject({ p_gem_answer: "template", p_product_id: PID });
    expect("p_gem_lines" in params(1) || "p_gem_force" in params(1)).toBe(false);
    expect("p_gem_force" in params(2)).toBe(false);
  });

  it("ผลสำเร็จ: gem ประกอบทีละ field (count/total/state/ชื่อใหม่/ใช้ตัวเดิมให้/แถวที่รวม) · key แปลกที่ DB แนบมาถูกทิ้ง", async () => {
    rpcMock.mockResolvedValue({
      data: { ...OPEN_OK, gem: { count: 2, total: 160, state: "specified", created_types: ["บุษราคัม"], created_shapes: [], reused: [{ row: 1, kind: "type", typed: "GARNET", name: "Garnet", id: I1 }, { row: 2, kind: "x", typed: "a", name: "b" }], merged_rows: [[1, 2]], supplier: "ร้าน X" } },
      error: null,
    });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    // supplier เป็น key ต้องห้ามของหน้าช่าง? — ไม่อยู่ใน pattern แต่ gem อ่านเฉพาะ field ที่กำหนด → ไม่ถึง client
    expect(r.ok && r.data.gem).toEqual({ count: 2, total: 160, state: "specified", createdTypes: ["บุษราคัม"], createdShapes: [], reused: [{ row: 1, kind: "type", typed: "GARNET", name: "Garnet" }], mergedRows: [[1, 2]] });
    expect(JSON.stringify(r)).not.toContain("supplier");
    expect(JSON.stringify(r)).not.toContain(I1);
  });

  it("replay (already): gem จาก DB (count/total/state) ใช้ได้ · ไม่มี token", async () => {
    rpcMock.mockResolvedValue({ data: { ...OPEN_OK, already: true, token: undefined, gem: { count: 2, total: 64, state: "specified" } }, error: null });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r.ok && r.data.already && r.data.token === null && r.data.gem?.count === 2 && r.data.gem?.createdTypes).toEqual([]);
  });

  it("gem รูปร่างผิด (state แปลก/count ติดลบ/ไม่ใช่ object) → ไม่ใส่ gem (ไม่ล้มทั้งใบ — เปิดสำเร็จแล้ว)", async () => {
    for (const bad of [{ count: 2, total: 1, state: "weird" }, { count: -1, total: 1, state: "specified" }, "x", null, { count: 31, total: 1, state: "specified" }]) {
      rpcMock.mockResolvedValue({ data: { ...OPEN_OK, gem: bad }, error: null });
      const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
      expect(r.ok && "gem" in r.data, JSON.stringify(bad)).toBe(false);
    }
  });

  it("ผลมี key ราคา/ต้นทุน (แม้ซ้อนใน gem) → ไม่ส่งต่อ · ไม่ log ผลดิบ", async () => {
    rpcMock.mockResolvedValue({ data: { ...OPEN_OK, gem: { count: 1, total: 1, state: "specified", price: 7391.2468 } }, error: null });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("7391");
    expect(allLogged()).not.toContain("7391");
    rpcMock.mockResolvedValue({ data: { ...OPEN_OK, gem: { count: 1, total: 1, state: "specified", unit_cost: 5 } }, error: null });
    expect((await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }))).ok).toBe(false);
  });

  it("แถวผิด: gem_line_invalid → ข้อความ 'พลอยแถว n: เหตุผล' (จาก GEM_ERROR_TH ตามรหัส) + gem.code/row/field · ไม่ใช้ข้อความดิบของ DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "SELECT * FROM analytics.gem_item", gem_code: "qty_invalid", gem_row: 2, gem_field: "qty_per_piece" }, error: null });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r).toMatchObject({ ok: false, code: "gem_line_invalid", error: "พลอยแถว 2: จำนวนต่อชิ้นต้องเป็นเลข 1–1,000", gem: { code: "qty_invalid", row: 2, field: "qty_per_piece" } });
    expect(JSON.stringify(r)).not.toContain("SELECT");
  });

  it("แถวผิดที่ไม่มีเลขแถว/แถว 0/31/field แปลก → ไม่ใส่ 'แถว n' ผิดๆ · field แปลก (ตัวใหญ่/ยาว/มีอักขระ) ถูกทิ้ง · รหัสแปลก = ข้อความกลาง", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "x", gem_code: "too_many_lines", gem_row: 31, gem_field: "lines" }, error: null });
    expect(await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }))).toMatchObject({ error: "พลอยต่อใบมีได้ไม่เกิน 30 รายการ", gem: { code: "too_many_lines", row: 31 } });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "x", gem_code: "qty_invalid", gem_row: 0, gem_field: "Price;DROP" }, error: null });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r).toMatchObject({ error: "จำนวนต่อชิ้นต้องเป็นเลข 1–1,000" });
    expect(r.ok === false && r.gem).toEqual({ code: "qty_invalid", row: 0 });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "x", gem_code: "Weird Code!", gem_row: 1 }, error: null });
    const r2 = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r2.ok === false && r2.gem).toBeUndefined();
    expect(r2).toMatchObject({ error: "ข้อมูลพลอยไม่ถูกต้อง — ตรวจแถวที่ระบุแล้วลองอีกครั้ง" });
  });

  it("ชื่อคล้าย: gem_similar → similar[] ที่ตรวจรูปร่าง (kind/ชื่อ/แถว/ชื่อที่มี) · ข้อมูลแปลกถูกทิ้ง · id ผิดรูป = null", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: false, code: "gem_similar", message: "x", similar: [
        { kind: "type", name: "Garnett", rows: [1, 99, "a", 2], matches: [{ id: I1, name: "Garnet" }, { id: "bad", name: "Garnet2" }, { id: I2, name: "" }], extra: "x" },
        { kind: "bad", name: "x", rows: [1], matches: [] }, { kind: "shape", name: "", rows: [], matches: [] }, "z"] },
      error: null,
    });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r).toMatchObject({ ok: false, code: "gem_similar", error: expect.stringContaining("คล้าย") });
    expect(r.ok === false && r.similar).toEqual([{ kind: "type", name: "Garnett", rows: [1, 2], matches: [{ id: I1, name: "Garnet" }, { id: null, name: "Garnet2" }] }]);
    expect(JSON.stringify(r)).not.toContain("extra");
  });

  it("code ใหม่ของพลอย (gem_*) → ข้อความไทยตายตัว · code ของ W1 เดิม (not_allowed ฯลฯ) ใช้ข้อความ W1 เดิม ไม่ถูกทับ", async () => {
    const expectations: [string, string][] = [
      ["gem_answer_required", "สินค้านี้ยังไม่มีแม่แบบพลอย — เลือกก่อนว่าฝังพลอยหรือไม่ฝังพลอย"],
      ["gem_lines_required", "เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก \"ไม่มีพลอย\""],
      ["gem_answer_invalid", "เลือกก่อนว่าใบนี้ฝังพลอยไหม"],
      ["gem_force_invalid", "ข้อมูลยืนยันชื่อพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง"],
      ["gem_name_cap", "เพิ่มพลอยใหม่ถี่เกินไปวันนี้ — เลือกจากรายการที่มี หรือแจ้งออฟฟิศ"],
      ["not_allowed", "บัญชีนี้ไม่มีสิทธิ์เปิดงานใหม่ — แจ้งออฟฟิศ"],
    ];
    for (const [code, msg] of expectations) {
      rpcMock.mockResolvedValue({ data: { ok: false, code, message: "RAW MESSAGE" }, error: null });
      expect(await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } })), code).toMatchObject({ ok: false, code, error: msg });
    }
  });

  it("job_exists ยังใช้ข้อความเดิม (มีเลขใบ) · error ระบบ → ข้อความกลาง ไม่ log พารามิเตอร์ (มี hash/พลอย)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "job_exists", message: "x", job_no: "JB-0007" }, error: null });
    expect(await openIntakeJob(TOKEN, baseOpen({ productId: PID, pendingLabel: null, gems: { answer: "template" } }))).toMatchObject({ code: "job_exists", error: expect.stringContaining("JB-0007") });
    rpcMock.mockResolvedValue({ data: null, error: { message: `boom ${TOKEN} ${SESSION}`, code: "XX000" } });
    const r = await openIntakeJob(TOKEN, baseOpen({ gems: { answer: "has", lines: LINES } }));
    expect(r.ok).toBe(false);
    expect(allLogged()).not.toContain(TOKEN);
    expect(allLogged()).not.toContain(SESSION);
  });
});

describe("loadIntakeGemCatalog", () => {
  const CAT = {
    ok: true,
    types: [{ id: T1, name: "โกเมน" }, { id: "bad", name: "x" }, { id: S1, name: "" }],
    shapes: [{ id: S1, name: "ไข่", has_length: true }, { id: T1, name: "กลม", has_length: "yes" }],
    sizes: [{ type_id: T1, shape_id: S1, size_a: 4, size_b: 6 }, { type_id: T1, shape_id: S1, size_a: 0, size_b: null }, { type_id: "x", shape_id: S1, size_a: 3, size_b: null }, { type_id: T1, shape_id: S1, size_a: 1.5, size_b: null }],
    has_template: true,
    template: [{ gem_item_id: I1, label: "โกเมน · ไข่ · 4×6 มม.", type_id: T1, type_name: "โกเมน", shape_id: S1, shape_name: "ไข่", has_length: true, size_a: 4, size_b: 6, qty_per_piece: 2, position: "ล้อมรอบ" }, { gem_item_id: "bad", label: "x", qty_per_piece: 1 }],
    max_lines: 30,
  };

  it("ส่ง hash + p_product_id เฉพาะเมื่อระบุ · ไม่มี shop id · ผลประกอบทีละ field (กรองแถวผิดรูป)", async () => {
    rpcMock.mockResolvedValue({ data: CAT, error: null });
    const r = await loadIntakeGemCatalog(TOKEN, PID);
    expect(fnOf()).toBe("job_worker_gem_catalog");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_ip_hash: sha("203.0.113.9"), p_product_id: PID });
    expect(r.ok && r.data.types).toEqual([{ id: T1, name: "โกเมน" }]);
    expect(r.ok && r.data.shapes).toEqual([{ id: S1, name: "ไข่", hasLength: true }, { id: T1, name: "กลม", hasLength: false }]);
    expect(r.ok && r.data.sizes).toEqual([{ typeId: T1, shapeId: S1, sizeA: 4, sizeB: 6 }, { typeId: T1, shapeId: S1, sizeA: 1.5, sizeB: null }]);
    expect(r.ok && r.data.hasTemplate).toBe(true);
    expect(r.ok && r.data.template).toEqual([{ gemItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", typeId: T1, typeName: "โกเมน", shapeId: S1, shapeName: "ไข่", hasLength: true, sizeA: 4, sizeB: 6, qtyPerPiece: 2, position: "ล้อมรอบ" }]);
    expect(r.ok && r.data.maxLines).toBe(30);
    await loadIntakeGemCatalog(TOKEN, null);
    expect("p_product_id" in params(1)).toBe(false);
  });

  it("productId ผิดรูป → ไม่ถึง DB · ไม่มี session/token → ไม่ถึง DB · template ว่างแม้ DB บอก has_template = false", async () => {
    expect((await loadIntakeGemCatalog(TOKEN, "not-a-uuid")).ok).toBe(false);
    expect((await loadIntakeGemCatalog("bad", null))).toMatchObject({ ok: false, code: "invalid_token" });
    cookieStore.clear();
    expect((await loadIntakeGemCatalog(TOKEN, null))).toMatchObject({ ok: false, code: "session_required" });
    expect(rpcMock).not.toHaveBeenCalled();
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: { ...CAT, template: [] }, error: null });
    expect((await loadIntakeGemCatalog(TOKEN, PID)).ok && (await loadIntakeGemCatalog(TOKEN, PID)).ok).toBe(true);
    const r = await loadIntakeGemCatalog(TOKEN, PID);
    expect(r.ok && r.data.hasTemplate).toBe(false);
  });

  it("ผลมี key ราคา/ผู้ขาย (ที่ DB ไม่ควรส่ง) → ไม่ส่งต่อ", async () => {
    rpcMock.mockResolvedValue({ data: { ...CAT, types: [{ id: T1, name: "โกเมน", price: 12 }] }, error: null });
    expect((await loadIntakeGemCatalog(TOKEN, null)).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: { ...CAT, sizes: [{ type_id: T1, shape_id: S1, size_a: 4, size_b: null, unit_cost: 3 }] }, error: null });
    expect((await loadIntakeGemCatalog(TOKEN, null)).ok).toBe(false);
  });

  it("ไม่มีสิทธิ์ผู้จัดการ → ข้อความไทย (ไม่ข้อความดิบ)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "not_allowed", message: "RAW" }, error: null });
    expect(await loadIntakeGemCatalog(TOKEN, null)).toMatchObject({ ok: false, code: "not_allowed", error: "บัญชีนี้ไม่มีสิทธิ์จัดการใบงานจากหน้างาน — แจ้งออฟฟิศ" });
  });
});

describe("loadIntakeJobGems", () => {
  const GET = {
    ok: true, job: { job_id: JOB, job_no: "JB-0031", design_label: "แหวน", status: "open", qty_planned: 5 }, state: "specified", editable: true, lock_code: null, has_gem_stage: true, rev: REV, max_lines: 30,
    lines: [{ gem_item_id: I1, label: "โกเมน · ไข่ · 4×6 มม.", type_id: T1, type_name: "โกเมน", shape_id: S1, shape_name: "ไข่", has_length: true, size_a: 4, size_b: 6, qty_per_piece: 2, qty_total: 10, position: "ล้อมรอบ" }],
  };

  it("ส่ง hash + job id (ไม่มี shop id) · ผลประกอบทีละ field", async () => {
    rpcMock.mockResolvedValue({ data: GET, error: null });
    const r = await loadIntakeJobGems(TOKEN, JOB);
    expect(fnOf()).toBe("job_worker_gem_get");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_job_id: JOB, p_ip_hash: sha("203.0.113.9") });
    expect(r).toEqual({ ok: true, data: {
      job: { jobId: JOB, jobNo: "JB-0031", designLabel: "แหวน", status: "open", qtyPlanned: 5 }, state: "specified", editable: true, lockCode: null, hasGemStage: true, rev: REV, maxLines: 30,
      lines: [{ gemItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", typeId: T1, typeName: "โกเมน", shapeId: S1, shapeName: "ไข่", hasLength: true, sizeA: 4, sizeB: 6, qtyPerPiece: 2, position: "ล้อมรอบ", qtyTotal: 10 }],
    } });
  });

  it("ล็อก: lock_code รู้จักเท่านั้น (อื่น = null) · lock_code มา = editable false เสมอ แม้ DB บอก true", async () => {
    rpcMock.mockResolvedValue({ data: { ...GET, editable: false, lock_code: "job_locked" }, error: null });
    expect(await loadIntakeJobGems(TOKEN, JOB)).toMatchObject({ ok: true, data: { editable: false, lockCode: "job_locked" } });
    rpcMock.mockResolvedValue({ data: { ...GET, editable: true, lock_code: "job_cancelled" }, error: null });
    expect(await loadIntakeJobGems(TOKEN, JOB)).toMatchObject({ data: { editable: false, lockCode: "job_cancelled" } });
    rpcMock.mockResolvedValue({ data: { ...GET, editable: true, lock_code: "SELECT 1" }, error: null });
    expect(await loadIntakeJobGems(TOKEN, JOB)).toMatchObject({ data: { editable: true, lockCode: null } });
  });

  it("job id ผิดรูป → ไม่ถึง DB (order_not_found) · ผลผิดสัญญา (rev ผิดรูป/state แปลก/job_no ผิด) → ข้อความกลาง", async () => {
    expect(await loadIntakeJobGems(TOKEN, "x")).toMatchObject({ ok: false, code: "order_not_found" });
    expect(rpcMock).not.toHaveBeenCalled();
    for (const bad of [{ rev: "ZZ" }, { rev: REV.toUpperCase() }, { state: "weird" }, { job: { ...GET.job, job_no: "X1" } }, { job: null }]) {
      rpcMock.mockResolvedValue({ data: { ...GET, ...bad }, error: null });
      expect((await loadIntakeJobGems(TOKEN, JOB)).ok, JSON.stringify(bad)).toBe(false);
    }
    rpcMock.mockResolvedValue({ data: { ...GET, rev: "empty", lines: [] }, error: null });
    expect(await loadIntakeJobGems(TOKEN, JOB)).toMatchObject({ ok: true, data: { rev: "empty", lines: [] } });
  });

  it("แถวผิดรูป (id/label/qty/qty_total) แม้แถวเดียว → ล้มปลอดภัยทั้งผล (ห้ามทิ้งเงียบ — หน้าแก้ส่งกลับเป็น replace-all จะลบแถวนั้นจริง) · lines ไม่ใช่ array/เกิน 30 = ล้ม · key ราคาในแถว → ไม่ส่งต่อทั้งผล", async () => {
    for (const bad of [{ gem_item_id: "bad", label: "x", qty_per_piece: 1, qty_total: 1 }, { ...GET.lines[0], qty_per_piece: 0 }, { ...GET.lines[0], qty_total: "x" }, { ...GET.lines[0], label: "" }, "x", null]) {
      rpcMock.mockResolvedValue({ data: { ...GET, lines: [...GET.lines, bad] }, error: null });
      expect((await loadIntakeJobGems(TOKEN, JOB)).ok, JSON.stringify(bad)).toBe(false);
    }
    rpcMock.mockResolvedValue({ data: { ...GET, lines: "x" }, error: null });
    expect((await loadIntakeJobGems(TOKEN, JOB)).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: { ...GET, lines: Array.from({ length: 31 }, () => GET.lines[0]) }, error: null });
    expect((await loadIntakeJobGems(TOKEN, JOB)).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: { ...GET, lines: GET.lines }, error: null });
    expect((await loadIntakeJobGems(TOKEN, JOB)).ok).toBe(true);
    rpcMock.mockResolvedValue({ data: { ...GET, lines: [{ ...GET.lines[0], price_per_unit: 5 }] }, error: null });
    expect((await loadIntakeJobGems(TOKEN, JOB)).ok).toBe(false);
  });

  it("ใบคนอื่น/ออฟฟิศ/ส่วนย่อย (order_not_found) → ข้อความเดียวกัน", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "order_not_found", message: "RAW" }, error: null });
    expect(await loadIntakeJobGems(TOKEN, JOB)).toMatchObject({ ok: false, code: "order_not_found", error: "ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง" });
  });
});

describe("setIntakeJobGems", () => {
  const SET_OK = { ok: true, changed: true, count: 1, lines: [{ gem_item_id: I1, label: "โกเมน · ไข่ · 4×6 มม.", qty_per_piece: 3, qty_total: 15, position: null }], summary: { created_types: ["Garnett"], created_shapes: [], reused: [], merged_rows: [] }, state: "specified", rev: REV };

  it("ส่ง hash + job + lines + rev (+ force เฉพาะที่มี) · ไม่มี shop id/ip ดิบ · ผลประกอบทีละ field", async () => {
    rpcMock.mockResolvedValue({ data: SET_OK, error: null });
    const r = await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: REV });
    expect(fnOf()).toBe("job_worker_gem_set");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_job_id: JOB, p_lines: LINES, p_expected_rev: REV, p_ip_hash: sha("203.0.113.9") });
    expect(r).toEqual({ ok: true, data: { changed: true, count: 1, lines: [{ gemItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 3, qtyTotal: 15, position: null }], state: "specified", rev: REV, summary: { createdTypes: ["Garnett"], createdShapes: [], reused: [], mergedRows: [] } } });
    await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: "empty", force: [{ kind: "type", name: "Garnett" }] });
    expect(params(1)).toMatchObject({ p_expected_rev: "empty", p_force: [{ kind: "type", name: "Garnett" }] });
    await setIntakeJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: REV, force: [] });
    expect("p_force" in params(2)).toBe(false);
    expect(params(2).p_lines).toEqual([]);
  });

  it("job id/rev ผิดรูป → ไม่ถึง DB (rev ผิด = gem_rev_invalid)", async () => {
    expect(await setIntakeJobGems(TOKEN, { jobId: "x", lines: [], expectedRev: REV })).toMatchObject({ ok: false, code: "order_not_found" });
    for (const rev of ["", "zzz", REV.toUpperCase(), REV.slice(1), "empty ", null as unknown as string]) {
      expect(await setIntakeJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: rev }), String(rev)).toMatchObject({ ok: false, code: "gem_rev_invalid" });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ผลสำเร็จผิดรูป (changed ไม่ใช่ boolean/rev ผิด/state แปลก/count เกิน) → ข้อความกลาง · key ราคาในผล → ไม่ส่งต่อ", async () => {
    for (const bad of [{ changed: "yes" }, { rev: "x" }, { state: "weird" }, { count: 99 }]) {
      rpcMock.mockResolvedValue({ data: { ...SET_OK, ...bad }, error: null });
      expect((await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: REV })).ok, JSON.stringify(bad)).toBe(false);
    }
    rpcMock.mockResolvedValue({ data: { ...SET_OK, summary: { ...SET_OK.summary, price: 1 } }, error: null });
    expect((await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: REV })).ok).toBe(false);
  });

  it("ล้ม: ชน (gem_conflict) · ล็อก · ไม่มีขั้นฝัง · ชื่อคล้าย · แถวผิด → ข้อความไทยตายตัว/โครงสร้างครบ", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ code: "gem_conflict" }, { error: "มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดหน้าใหม่แล้วแก้อีกครั้ง" }],
      [{ code: "job_locked" }, { error: "ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ" }],
      [{ code: "job_closed" }, { error: "ใบนี้ปิดแล้ว — แก้พลอยไม่ได้" }],
      [{ code: "job_not_open" }, { error: "ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้ — แจ้งออฟฟิศ" }],
      [{ code: "no_gem_stage" }, { error: "ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศให้เพิ่มขั้นก่อน" }],
      [{ code: "gem_line_invalid", gem_code: "size_invalid", gem_row: 1, gem_field: "size_a" }, { error: "พลอยแถว 1: ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)", gem: { code: "size_invalid", row: 1, field: "size_a" } }],
      [{ code: "gem_similar", similar: [{ kind: "shape", name: "Brioletta", rows: [1], matches: [{ id: S1, name: "Briolette" }] }] }, { similar: [{ kind: "shape", name: "Brioletta", rows: [1], matches: [{ id: S1, name: "Briolette" }] }] }],
    ];
    for (const [db, want] of cases) {
      rpcMock.mockResolvedValue({ data: { ok: false, message: "RAW", ...db }, error: null });
      expect(await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: REV }), String(db.code)).toMatchObject({ ok: false, code: db.code, ...want });
    }
  });

  it("rate limit/ไม่มีสิทธิ์/QR ถูกเพิกถอน → ใช้ข้อความของช่องทาง QR ร้าน (retryAfterSeconds ผ่านเมื่อมี)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "rate_limited", message: "x", retry_after_seconds: 120 }, error: null });
    expect(await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: REV })).toMatchObject({ ok: false, code: "rate_limited", error: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง", retryAfterSeconds: 120 });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "invalid_token", message: "x" }, error: null });
    expect(await setIntakeJobGems(TOKEN, { jobId: JOB, lines: LINES, expectedRev: REV })).toMatchObject({ code: "invalid_token", error: "QR ร้านนี้ใช้ไม่ได้แล้ว — ขอ QR ใหม่จากออฟฟิศ" });
  });
});

describe("listMyIntakeJobs — บรรทัดพลอย (W-9)", () => {
  const ROW = { job_id: JOB, order_no: "PO-1", job_no: "JB-0031", design_label: "แหวน", metal: "gold", qty: 30, created_at: "2026-10-21T02:00:00Z", status: "open", photos_count: 1, my_photos_count: 1, editable: true, gem_state: "specified", gem_count: 3, gem_pieces: 94, gem_editable: true };
  it("gem_* ประกอบทีละ field (state รู้จักเท่านั้น · จำนวนไม่ติดลบ/ไม่เกินเพดาน) · DB รุ่นเก่า (ไม่มี gem_*) = null/0/false", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, open_allowed: true, jobs: [ROW, { ...ROW, job_id: I1, gem_state: "weird", gem_count: 99, gem_pieces: -5, gem_editable: "yes" }, (({ gem_state, gem_count, gem_pieces, gem_editable, ...rest }) => rest)(ROW)] }, error: null });
    const r = await listMyIntakeJobs(TOKEN);
    expect(r.ok && r.data.jobs.map((j) => [j.gemState, j.gemCount, j.gemPieces, j.gemEditable])).toEqual([["specified", 3, 94, true], [null, 30, 0, false], [null, 0, 0, false]]);
  });
  it("key ราคาใน gem_* → ไม่ส่งต่อทั้งผล", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, open_allowed: true, jobs: [{ ...ROW, gem_cost: 5 }] }, error: null });
    expect((await listMyIntakeJobs(TOKEN)).ok).toBe(false);
  });
});

describe("ตัวแปลงย่อย", () => {
  it("mapGemSummary: ค่าเริ่มของ replay (ไม่มีรายการชื่อ) = ว่าง · state/count/total ผิด = null", () => {
    expect(mapGemSummary({ count: 0, total: 0, state: "not_needed" })).toEqual({ count: 0, total: 0, state: "not_needed", createdTypes: [], createdShapes: [], reused: [], mergedRows: [] });
    expect(mapGemSummary({ count: 1.5, total: 0, state: "specified" })).toBeNull();
    expect(mapGemSummary(null)).toBeNull();
    expect(mapGemSummary([])).toBeNull();
  });
  it("parseGemFail / mapGemSimilar: รูปร่างผิดทิ้ง", () => {
    expect(parseGemFail({ gem_code: "qty_invalid", gem_row: 3, gem_field: "qty_per_piece" })).toEqual({ code: "qty_invalid", row: 3, field: "qty_per_piece" });
    expect(parseGemFail({ gem_code: "QTY", gem_row: 3 })).toBeNull();
    expect(parseGemFail({ gem_code: "qty_invalid", gem_row: 32, gem_field: "A b" })).toEqual({ code: "qty_invalid" });
    expect(mapGemSimilar("x")).toEqual([]);
    expect(mapGemSimilar(Array.from({ length: 50 }, () => ({ kind: "type", name: "a", rows: [1], matches: [] }))).length).toBe(20);
  });
  it("gemFail: ไม่ใช่รหัสของพลอย → ตกไปข้อความ QR ร้านเดิม", () => {
    expect(gemFail({ ok: false, code: "invalid_token", error: "x" }).error).toBe("QR ร้านนี้ใช้ไม่ได้แล้ว — ขอ QR ใหม่จากออฟฟิศ");
    expect(gemFail({ ok: false, code: "unknown_code", error: "ข้อความเดิม" }).error).toBe("ข้อความเดิม");
  });
});
