// lib/actions/job-worker.ts (0191 W3) — action ผู้จัดการกรอก/แก้พลอยจากมือถือ (QR ร้าน + PIN · ไม่ login)
// ครอบ: input ผิดรูปไม่ถึง RPC (คำตอบ/แถว/force/rev/job id) · แถวผ่าน allowlist เดียวกับออฟฟิศ (key แปลก เช่น price = ปฏิเสธ ไม่ทิ้งเงียบ) · force ต้องเป็นรายการชื่อ (boolean = ปฏิเสธ) ·
//       พารามิเตอร์ที่ส่ง DB (ไม่มี shop id · hash เท่านั้น) · ผลล้มพา gem.row/gem.field/similar กลับ · ไม่มีราคาในผลลัพธ์
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

import { intakeGemCatalog, intakeJobGems, intakeMyJobs, intakeOpen, intakeSetJobGems } from "./job-worker";
import type { IntakeOpenActionInput } from "./job-worker";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  hdrs = { "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
const params = (i = 0) => rpcMock.mock.calls[i][1] as Record<string, unknown>;
const fnOf = (i = 0) => rpcMock.mock.calls[i][0] as string;

const OPEN_OK = { ok: true, already: false, order_no: "PO-1", job_no: "JB-0031", token: "Qq7-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY", design_label: "แหวน", sku: null, sku_pending: true, metal: "silver", qty_order: 3, qty_planned: 3, is_new_design: false, due_date: null, status: "open", gem: { count: 1, total: 6, state: "specified", created_types: [], created_shapes: [], reused: [], merged_rows: [] } };
const open = (o: Partial<IntakeOpenActionInput> = {}): IntakeOpenActionInput => ({ idemKey: IDEM, label: "แหวน", metal: "silver", qty: 3, ...o });
const LINE = { typeId: T1, shapeId: S1, sizeA: "4", sizeB: "6", qtyPerPiece: 2, position: "ล้อมรอบ" };

describe("intakeOpen — พลอย (gems)", () => {
  it("ไม่ส่ง gems = ไม่มี p_gem_* (W1 เดิม) · ผลไม่มี gem ถ้า DB ไม่ส่ง", async () => {
    rpcMock.mockResolvedValue({ data: { ...OPEN_OK, gem: undefined }, error: null });
    const r = await intakeOpen(TOKEN, open());
    expect(r.ok).toBe(true);
    expect(Object.keys(params()).filter((k) => k.startsWith("p_gem"))).toEqual([]);
  });

  it("has: แถว camelCase → payload snake_case ผ่าน allowlist · ขนาด ',' → '.' · ส่ง p_gem_answer + p_gem_lines · ผลมี gem", async () => {
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
    const r = await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: [{ ...LINE, sizeA: "4,5" }] } }));
    expect(fnOf()).toBe("job_worker_open");
    expect(params()).toMatchObject({ p_token_hash: sha(TOKEN), p_gem_answer: "has", p_gem_lines: [{ type_id: T1, shape_id: S1, size_a: "4.5", size_b: "6", qty_per_piece: 2, position: "ล้อมรอบ" }] });
    expect(Object.keys(params()).some((k) => /shop/i.test(k))).toBe(false);
    expect(r).toMatchObject({ ok: true, result: { gem: { count: 1, total: 6, state: "specified" } } });
  });

  it("แถวพิมพ์ชนิด/รูปทรงใหม่ + force เฉพาะชื่อ → ส่ง new_type_name / new_shape / p_gem_force", async () => {
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
    await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: [{ newTypeName: "โกเมนต์", newShape: { name: "ทรงใบไม้", hasLength: true }, sizeA: 4, sizeB: 6, qtyPerPiece: "3" }], force: [{ kind: "type", name: "โกเมนต์" }] } }));
    expect(params().p_gem_lines).toEqual([{ new_type_name: "โกเมนต์", new_shape: { name: "ทรงใบไม้", has_length: true }, size_a: 4, size_b: 6, qty_per_piece: 3 }]);
    expect(params().p_gem_force).toEqual([{ kind: "type", name: "โกเมนต์" }]);
  });

  it("none / template: ส่งเฉพาะ answer · template ต้องมี SKU (ไม่มี = ปฏิเสธก่อนถึง DB)", async () => {
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
    await intakeOpen(TOKEN, open({ gems: { answer: "none" } }));
    expect(params(0).p_gem_answer).toBe("none");
    expect("p_gem_lines" in params(0)).toBe(false);
    await intakeOpen(TOKEN, open({ label: null, productId: PID, gems: { answer: "template" } }));
    expect(params(1)).toMatchObject({ p_gem_answer: "template", p_product_id: PID });
    rpcMock.mockClear();
    expect(await intakeOpen(TOKEN, open({ gems: { answer: "template" } }))).toMatchObject({ ok: false, field: "gems", error: expect.stringContaining("แม่แบบ") });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ผิดรูปไม่ถึง DB: answer แปลก · none+แถว · template+แถว · force boolean/รูปแปลก/กับ none · has 0 แถว · แถว key แปลก (price/cost) · 31 แถว · ไม่ใช่ object", async () => {
    const bads: [string, unknown][] = [
      ["answer maybe", { answer: "maybe" }], ["answer ว่าง", {}], ["gems เป็นสตริง", "has"], ["gems เป็น array", []],
      ["none+แถว", { answer: "none", lines: [LINE] }], ["template+แถว", { answer: "template", lines: [LINE] }],
      ["force true", { answer: "has", lines: [LINE], force: true }], ["force string", { answer: "has", lines: [LINE], force: "x" }], ["force เกิน key", { answer: "has", lines: [LINE], force: [{ kind: "type", name: "x", id: 1 }] }],
      ["none+force", { answer: "none", force: [{ kind: "type", name: "x" }] }],
      ["has 0 แถว", { answer: "has", lines: [] }], ["has ไม่มี lines", { answer: "has" }],
      ["key price", { answer: "has", lines: [{ ...LINE, price: 5 }] }], ["key cost", { answer: "has", lines: [{ ...LINE, cost: 5 }] }], ["key supplier", { answer: "has", lines: [{ ...LINE, supplier: "x" }] }],
      ["31 แถว", { answer: "has", lines: Array.from({ length: 31 }, () => LINE) }], ["แถวไม่ใช่ object", { answer: "has", lines: [5] }],
      ["qty ไม่ใช่เลข", { answer: "has", lines: [{ ...LINE, qtyPerPiece: "abc" }] }], ["size ไม่ใช่เลข", { answer: "has", lines: [{ ...LINE, sizeA: "NaN-ish-text-very-long-over-20" }] }],
    ];
    const fails: string[] = [];
    for (const [id, g] of bads) {
      const r = await intakeOpen(TOKEN, open({ gems: g as IntakeOpenActionInput["gems"], ...(id === "template+แถว" ? { label: null, productId: PID } : {}) }));
      if (r.ok || rpcMock.mock.calls.length > 0) fails.push(id);
      rpcMock.mockClear();
    }
    expect(fails).toEqual([]);
  });

  it("แถวผิดจาก allowlist: บอกแถว/ช่อง (gem.row/field) · key แปลกไม่สะท้อนชื่อที่เป็นอักขระแปลก", async () => {
    const r = await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: [LINE, { ...LINE, price: 5 } as never] } }));
    expect(r).toMatchObject({ ok: false, code: "gem_line_invalid", field: "gems", gem: { code: "line_invalid", row: 2, field: "price" } });
    const r2 = await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: [{ ...LINE, "x;DROP TABLE": 1 } as never] } }));
    expect(r2).toMatchObject({ ok: false, gem: { code: "line_invalid", row: 1 } });
    expect(JSON.stringify(r2)).not.toContain("DROP");
    const r3 = await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: Array.from({ length: 31 }, () => LINE) } }));
    expect(r3).toMatchObject({ ok: false, gem: { code: "too_many_lines", row: 31 } });
  });

  it("DB ปฏิเสธ: ชื่อคล้าย → code gem_similar + similar[] กลับพร้อม field gems? (ผ่าน failOf) · แถวผิดจาก DB → gem + ข้อความแถว", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_similar", message: "x", similar: [{ kind: "type", name: "Garnett", rows: [1], matches: [{ id: I1, name: "Garnet" }] }] }, error: null });
    const r = await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: [LINE] } }));
    expect(r).toMatchObject({ ok: false, code: "gem_similar", similar: [{ kind: "type", name: "Garnett", rows: [1], matches: [{ id: I1, name: "Garnet" }] }] });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "x", gem_code: "gem_inactive", gem_row: 1, gem_field: "type" }, error: null });
    expect(await intakeOpen(TOKEN, open({ gems: { answer: "has", lines: [LINE] } }))).toMatchObject({ ok: false, error: "พลอยแถว 1: รายการนี้ถูกปิดใช้งานแล้ว — เลือกอย่างอื่น หรือแจ้งออฟฟิศ", gem: { code: "gem_inactive", row: 1, field: "type" } });
  });
});

describe("intakeGemCatalog", () => {
  it("เรียก RPC ด้วย hash (ไม่มี shop id) · productId ว่าง = ไม่ส่ง · ผิดรูป = ไม่ถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, types: [], shapes: [], sizes: [], has_template: false, template: [], max_lines: 30 }, error: null });
    expect(await intakeGemCatalog(TOKEN)).toMatchObject({ ok: true, types: [], hasTemplate: false, maxLines: 30 });
    expect(fnOf()).toBe("job_worker_gem_catalog");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_ip_hash: sha("203.0.113.9") });
    await intakeGemCatalog(TOKEN, PID);
    expect(params(1).p_product_id).toBe(PID);
    await intakeGemCatalog(TOKEN, "");
    expect("p_product_id" in params(2)).toBe(false);
    rpcMock.mockClear();
    expect(await intakeGemCatalog(TOKEN, "../x")).toMatchObject({ ok: false, field: "product" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ไม่มีสิทธิ์/หมดเวลา → ข้อความไทย code ตรงของ DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "session_required", message: "x" }, error: null });
    expect(await intakeGemCatalog(TOKEN)).toMatchObject({ ok: false, code: "session_required", error: "หมดเวลาแล้ว — ใส่ PIN ใหม่" });
  });
});

describe("intakeJobGems / intakeSetJobGems", () => {
  const GET = { ok: true, job: { job_id: JOB, job_no: "JB-0031", design_label: "แหวน", status: "open", qty_planned: 3 }, state: "specified", editable: true, lock_code: null, has_gem_stage: true, rev: REV, lines: [], max_lines: 30 };

  it("get: job id ผิดรูป = ไม่ถึง DB · ผ่าน = ส่ง hash + job id", async () => {
    expect(await intakeJobGems(TOKEN, "x")).toMatchObject({ ok: false });
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: GET, error: null });
    expect(await intakeJobGems(TOKEN, JOB)).toMatchObject({ ok: true, editable: true, rev: REV, lines: [] });
    expect(fnOf()).toBe("job_worker_gem_get");
    expect(params()).toMatchObject({ p_job_id: JOB, p_token_hash: sha(TOKEN) });
    expect(Object.keys(params()).some((k) => /shop/i.test(k))).toBe(false);
  });

  it("set: ผิดรูปไม่ถึง DB — job id · rev (ว่าง/ตัวใหญ่/ขาด) · lines (key price · 31 แถว · ไม่ใช่ array) · force (boolean/key เกิน)", async () => {
    const bads: [string, Parameters<typeof intakeSetJobGems>[1]][] = [
      ["job", { jobId: "x", lines: [], expectedRev: REV }], ["rev ว่าง", { jobId: JOB, lines: [], expectedRev: "" }], ["rev ใหญ่", { jobId: JOB, lines: [], expectedRev: REV.toUpperCase() }], ["rev ขาด", { jobId: JOB, lines: [], expectedRev: REV.slice(1) }],
      ["price", { jobId: JOB, lines: [{ ...LINE, price: 1 } as never], expectedRev: REV }], ["31", { jobId: JOB, lines: Array.from({ length: 31 }, () => LINE), expectedRev: REV }],
      ["ไม่ใช่ array", { jobId: JOB, lines: "x" as never, expectedRev: REV }], ["force true", { jobId: JOB, lines: [LINE], expectedRev: REV, force: true as never }], ["force key เกิน", { jobId: JOB, lines: [LINE], expectedRev: REV, force: [{ kind: "type", name: "x", z: 1 } as never] }],
    ];
    const fails: string[] = [];
    for (const [id, i] of bads) {
      const r = await intakeSetJobGems(TOKEN, i);
      if (r.ok || rpcMock.mock.calls.length > 0) fails.push(id);
      rpcMock.mockClear();
    }
    expect(fails).toEqual([]);
    expect(await intakeSetJobGems(TOKEN, null as never)).toMatchObject({ ok: false });
  });

  it("set ผ่าน: ส่ง hash + job + lines (snake_case) + rev + force · [] = ล้างพลอย (ส่ง [] จริง) · ผลล้มพา gem/similar/code กลับ", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, changed: true, count: 1, lines: [{ gem_item_id: I1, label: "CZ · กลม · 3 มม.", qty_per_piece: 2, qty_total: 6, position: null }], summary: { created_types: [], created_shapes: [], reused: [], merged_rows: [] }, state: "specified", rev: REV }, error: null });
    const r = await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [LINE], expectedRev: REV, force: [{ kind: "shape", name: "Brioletta" }] });
    expect(fnOf()).toBe("job_worker_gem_set");
    expect(params()).toMatchObject({ p_job_id: JOB, p_expected_rev: REV, p_lines: [{ type_id: T1, shape_id: S1, size_a: "4", size_b: "6", qty_per_piece: 2, position: "ล้อมรอบ" }], p_force: [{ kind: "shape", name: "Brioletta" }] });
    expect(r).toMatchObject({ ok: true, changed: true, count: 1, rev: REV, state: "specified" });
    await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: "empty" });
    expect(params(1).p_lines).toEqual([]);
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_conflict", message: "RAW" }, error: null });
    expect(await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [LINE], expectedRev: REV })).toMatchObject({ ok: false, code: "gem_conflict", error: expect.stringContaining("โหลดหน้าใหม่") });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "x", gem_code: "size_b_required", gem_row: 1, gem_field: "size_b" }, error: null });
    expect(await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [LINE], expectedRev: REV })).toMatchObject({ ok: false, error: "พลอยแถว 1: ใส่ทั้งกว้างและยาว (มม.)", gem: { code: "size_b_required", row: 1, field: "size_b" } });
  });

  it("ไม่มีราคา/key ต้องห้ามในผลที่ผ่านทุกช่องทางของ W3 (แม้ DB เผลอส่งมา = ปฏิเสธทั้งผล)", async () => {
    rpcMock.mockResolvedValue({ data: { ...GET, lines: [{ gem_item_id: I1, label: "x", qty_per_piece: 1, qty_total: 1, price: 7391.2468 }] }, error: null });
    const r = await intakeJobGems(TOKEN, JOB);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("7391");
  });
});

describe("intakeMyJobs — บรรทัดพลอย", () => {
  it("ผ่าน action → gem_* ครบในแต่ละใบ", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, open_allowed: true, jobs: [{ job_id: JOB, order_no: "PO-1", job_no: "JB-0031", design_label: "แหวน", metal: "silver", qty: 3, created_at: "2026-10-21T02:00:00Z", status: "open", photos_count: 0, my_photos_count: 0, editable: true, gem_state: "unspecified", gem_count: 0, gem_pieces: 0, gem_editable: true }], max_photos: 3 }, error: null });
    const r = await intakeMyJobs(TOKEN);
    expect(r.ok && r.jobs[0]).toMatchObject({ gemState: "unspecified", gemCount: 0, gemPieces: 0, gemEditable: true });
  });
});
