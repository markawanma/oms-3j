// QA (R2-D2 · 23 ต.ค. 69) — W3 (0191): edge ของชั้น TS ที่เทสต์เดิมยังไม่แตะ
// ครอบ: gemFail กับ code/gem.code ที่เป็นชื่อ property ของ Object (constructor/__proto__/toString) · toWireGemLines/Force ขอบเขต (60/61 · 200/201 · เลขไทย · __proto__ ใน JSON · แถวโหว่ใน array) ·
//       action: gems เป็น null/array/สตริง · key แปลกระดับบน · my-list ตัวเลข gem_* สุดขั้ว · ผลดิบที่มี gem_row นอกช่วง
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const IDEM = "ik0123456789abcdef0123456789abcdef";

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: vi.fn() }),
  headers: async () => ({ get: (n: string) => ({ "x-forwarded-for": "203.0.113.9", "user-agent": "qa" })[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("@/lib/images/signing", () => ({ signImagePaths: async () => new Map<string, string>(), signJobPhotoPaths: async () => new Map<string, string>() }));

import { intakeOpen, intakeSetJobGems } from "@/lib/actions/job-worker";
import { GEM_FORCE_MAX, toWireGemForce, toWireGemLines } from "@/lib/jobs/gem-wire";
import { fail, gemFail, openIntakeJob } from "@/lib/jobs/worker-server";
import { listMyIntakeJobs } from "@/lib/jobs/shop-photo-server";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
const TID = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";
const okLine = { typeId: TID, shapeId: SID, sizeA: 3, qtyPerPiece: 1 };
const open = (gems: unknown) => intakeOpen(TOKEN, { idemKey: IDEM, label: "แหวน", metal: "silver", qty: 2, gems } as never);
const PROTO_NAMES = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"];

describe("gemFail — ชื่อ property ของ Object ไม่ใช่รหัสที่รู้จัก", () => {
  it.each(PROTO_NAMES)("gem.code = %s → ข้อความสำรองไทย ไม่หลุดซอร์ส/[object] ไม่ throw", (name) => {
    const f = gemFail({ ok: false, code: "gem_line_invalid", error: "x", gem: { code: name, row: 2, field: "type" } });
    expect(typeof f.error).toBe("string");
    expect(f.error).not.toMatch(/function|\[object|native code/);
    expect(/[฀-๿]/.test(f.error)).toBe(true);
  });
  it.each(PROTO_NAMES)("f.code = %s (ไม่ใช่ gem_*) ทั้งช่อง open/gem → ไม่ throw · ไม่หลุดซอร์ส", (name) => {
    for (const ctx of ["open", "gem"] as const) {
      const f = gemFail(fail(name), ctx);
      expect(f.error).not.toMatch(/function|\[object|native code/);
      expect(typeof f.error).toBe("string");
      expect(f.error.length).toBeGreaterThan(0);
    }
  });
  it("gem_row นอกช่วงจาก DB (0, 31, -1, 1.5, NaN, สตริง) ผ่านทางจริง (callWorkerRpc → parseGemFail) → ไม่ใส่ 'แถว n' ผิดๆ", async () => {
    for (const row of [0, 31, -1, 1.5, null, "2"]) {
      rpcMock.mockResolvedValue({ data: { ok: false, code: "gem_line_invalid", message: "x", gem_code: "qty_invalid", gem_row: row, gem_field: "qty_per_piece" }, error: null });
      const r = await openIntakeJob(TOKEN, { idemKey: IDEM, productId: null, pendingLabel: "แหวน", metal: "silver", purity: null, weightG: null, qtyOrder: 2, qtyPlanned: 2, dueDate: null, isNewDesign: false, note: null, gems: { answer: "has", lines: [{ type_id: TID }] } });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error, String(row)).not.toMatch(/แถว (0|31|-1|1.5|null|2):/);
        expect(r.error, String(row)).toBe("จำนวนต่อชิ้นต้องเป็นเลข 1–1,000");
      }
    }
  });
});

describe("toWireGemLines — ขอบเขต", () => {
  it("30 แถว ผ่าน · 31 แถว ปฏิเสธ too_many_lines แถว 31", () => {
    expect(toWireGemLines(Array.from({ length: 30 }, () => okLine)).ok).toBe(true);
    const r = toWireGemLines(Array.from({ length: 31 }, () => okLine));
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.code, r.row]).toEqual(["too_many_lines", 31]);
  });
  it("key __proto__ เป็น own property (JSON.parse) → ปฏิเสธ ไม่สะท้อนชื่อ key กลับ · ไม่มี prototype pollution", () => {
    const row = JSON.parse('{"typeId":"' + TID + '","__proto__":{"price":9}}');
    const r = toWireGemLines([row]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("line_invalid");
      expect(r.field).toBeNull();
    }
    expect(({} as Record<string, unknown>).price).toBeUndefined();
  });
  it("key ราคาจริง (price/cost/priceThb) → ปฏิเสธ ระบุแถว+ชื่อ key ปลอดภัย · ไม่ส่งต่อ", () => {
    for (const k of ["price", "cost", "priceThb", "unit_price"]) {
      const r = toWireGemLines([okLine, { ...okLine, [k]: 5 }]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.row).toBe(2);
    }
  });
  it("แถวโหว่ใน array (sparse) / null / ตัวเลข / array ซ้อน → line_invalid ตรงแถว", () => {
    for (const bad of [[okLine, , okLine], [okLine, null], [okLine, 5], [okLine, [okLine]], [okLine, "x"]] as unknown[][]) {
      const r = toWireGemLines(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect([r.code, r.row]).toEqual(["line_invalid", 2]);
    }
  });
  it("จำนวนต่อชิ้น: ' 5 ' → 5 · '0001' → 1 · เลขไทย/อารบิก-อินดิก/'1.5'/'1e2'/'+5'/'' → qty_invalid · number 1e21 ส่งต่อให้ DB ตัดสิน (DB ปฏิเสธ — ยืนยันใน dry-run)", () => {
    const ok = (q: unknown) => toWireGemLines([{ ...okLine, qtyPerPiece: q }]);
    const a = ok(" 5 ");
    expect(a.ok && a.value[0].qty_per_piece === 5).toBe(true);
    const b = ok("0001");
    expect(b.ok && b.value[0].qty_per_piece === 1).toBe(true);
    for (const q of ["๕", "٣", "1.5", "1e2", "+5", "", "  ", "-1", "1_0", true, {}, []]) {
      const r = ok(q);
      expect(r.ok, String(q)).toBe(false);
    }
    const huge = ok(1e21);
    expect(huge.ok && huge.value[0].qty_per_piece === 1e21).toBe(true);
    expect(ok(Number.NaN).ok).toBe(false);
    expect(ok(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
  it("ขนาด: '4,5' → '4.5' (ตัวแรกตัวเดียว) · '1,2,3' ไม่ crash (ส่งต่อให้ DB ปฏิเสธ) · ยาว 21 ตัว → size_invalid · NaN/Infinity/boolean/object → size_invalid", () => {
    const sz = (v: unknown) => toWireGemLines([{ ...okLine, sizeA: v }]);
    const a = sz("4,5");
    expect(a.ok && a.value[0].size_a === "4.5").toBe(true);
    expect(sz("1,2,3").ok).toBe(true);
    expect(sz("1".repeat(21)).ok).toBe(false);
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, true, {}, []]) expect(sz(v).ok, String(v)).toBe(false);
  });
  it("ชื่อใหม่: emoji/ZWJ/RTL ไม่ถูกแก้ระหว่างทาง (DB ตัดสิน) · 200 ผ่าน · 201 ปฏิเสธ name_invalid ช่อง type", () => {
    const nm = (s: unknown) => toWireGemLines([{ newTypeName: s, shapeId: SID, sizeA: 3, qtyPerPiece: 1 }]);
    const e = nm("💎‍✨‮");
    expect(e.ok && e.value[0].new_type_name === "💎‍✨‮").toBe(true);
    expect(nm("ก".repeat(200)).ok).toBe(true);
    const r = nm("ก".repeat(201));
    expect(!r.ok && r.code === "name_invalid" && r.field === "type").toBe(true);
    expect(nm(5).ok).toBe(false);
    expect(nm({}).ok).toBe(false);
  });
});

describe("toWireGemForce — ขอบเขต", () => {
  const f = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "type", name: `n${i}` }));
  it(`${GEM_FORCE_MAX} รายการผ่าน · ${GEM_FORCE_MAX + 1} ปฏิเสธ gem_force_invalid`, () => {
    expect(toWireGemForce(f(GEM_FORCE_MAX)).ok).toBe(true);
    const r = toWireGemForce(f(GEM_FORCE_MAX + 1));
    expect(!r.ok && r.code === "gem_force_invalid").toBe(true);
  });
  it("ชื่อ 200 ผ่าน · 201 / ว่าง ปฏิเสธ · kind ผิด / key เกิน / ไม่ใช่ object / boolean / สตริง ปฏิเสธ · [] และ null = ไม่ยืนยัน", () => {
    expect(toWireGemForce([{ kind: "shape", name: "ก".repeat(200) }]).ok).toBe(true);
    for (const bad of [[{ kind: "type", name: "ก".repeat(201) }], [{ kind: "type", name: "" }], [{ kind: "item", name: "x" }], [{ kind: "type", name: "x", extra: 1 }], [5], [null], true, "type", {}, [[]]]) {
      expect(toWireGemForce(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(toWireGemForce([])).toEqual({ ok: true, value: null });
    expect(toWireGemForce(null)).toEqual({ ok: true, value: null });
    expect(toWireGemForce(undefined)).toEqual({ ok: true, value: null });
  });
  it("ชื่อซ้ำ/ชื่อ __proto__ เป็นแค่ข้อความ (ไม่กระทบ prototype)", () => {
    const r = toWireGemForce([{ kind: "type", name: "__proto__" }, { kind: "type", name: "__proto__" }]);
    expect(r.ok && r.value?.length === 2).toBe(true);
    expect(({} as Record<string, unknown>).name).toBeUndefined();
  });
});

describe("intakeOpen — รูปแบบ gems แปลก ไม่ถึง DB", () => {
  it.each([[null], [[]], ["has"], [5], [true], [{}], [{ answer: null }], [{ answer: "HAS" }], [{ answer: "has " }]])("gems = %j → ปฏิเสธที่ field gems ไม่เรียก RPC", async (g) => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const r = await open(g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("gems");
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("key แปลกระดับบนของ gems (price/lines ของ none) → ตัวที่ไม่รู้จักไม่ถูกส่งต่อ · none + key ราคา ไม่มีผลต่อ payload", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, already: false, order_no: "PO-1", job_no: "JB-0001", token: "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU", design_label: "แหวน", sku: null, sku_pending: true, metal: "silver", qty_order: 2, qty_planned: 2, status: "open", is_new_design: false, due_date: null }, error: null });
    await open({ answer: "none", price: 100, cost: 5 });
    const p = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(p.p_gem_answer).toBe("none");
    expect(JSON.stringify(p)).not.toMatch(/price|cost|100/);
    expect(Object.keys(p).filter((k) => k.startsWith("p_gem")).sort()).toEqual(["p_gem_answer"]);
  });
  it("has + 30 แถว ผ่าน allowlist ครบ 30 · has + 31 แถว → too_many_lines แถว 31 ไม่ถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const r31 = await open({ answer: "has", lines: Array.from({ length: 31 }, () => okLine) });
    expect(!r31.ok && r31.gem?.code === "too_many_lines" && r31.gem.row === 31).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("intakeSetJobGems — ขอบเขต", () => {
  const JOB = "33333333-3333-4333-8333-333333333333";
  it("rev 'empty' ผ่าน · 'EMPTY'/'empty ' ปฏิเสธ · lines [] ส่งจริง", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, changed: false, count: 0, lines: [], summary: {}, state: "unspecified", rev: "empty" }, error: null });
    const ok = await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: "empty" });
    expect(ok.ok).toBe(true);
    expect((rpcMock.mock.calls[0][1] as Record<string, unknown>).p_lines).toEqual([]);
    for (const rev of ["EMPTY", "empty ", " empty", ""]) {
      const r = await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: rev });
      expect(r.ok, rev).toBe(false);
    }
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("hub — gem_* สุดขั้วไม่ทำให้พัง", () => {
  const J = { job_id: "44444444-4444-4444-8444-444444444444", order_no: "PO-1", job_no: "JB-0001", design_label: "แหวน", metal: "silver", qty: 3, created_at: "2026-10-23T08:00:00+00:00", status: "open", photos_count: 0, my_photos_count: 0, editable: true };
  it.each([
    [Number.NaN, 0], [-1, 0], [1.5, 0], ["5", 0], [1e13, 0], [null, 0], [12, 12],
  ])("gem_pieces = %j → %j", async (raw, want) => {
    rpcMock.mockResolvedValue({ data: { ok: true, open_allowed: true, jobs: [{ ...J, gem_state: "specified", gem_count: 2, gem_pieces: raw, gem_editable: true }], max_photos: 3 }, error: null });
    const r = await listMyIntakeJobs(TOKEN);
    expect(r.ok && r.data.jobs[0].gemPieces === want).toBe(true);
  });
  it("gem_count 99 → 30 · gem_state แปลก → null · gem_editable เป็นสตริง 'true' → false (ไม่เชื่อชนิดผิด)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, open_allowed: true, jobs: [{ ...J, gem_state: "weird", gem_count: 99, gem_pieces: 0, gem_editable: "true" }], max_photos: 3 }, error: null });
    const r = await listMyIntakeJobs(TOKEN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.jobs[0]).toMatchObject({ gemState: null, gemCount: 30, gemEditable: false });
  });
});
