// QA (R2-D2 · 24 ต.ค. 69) — W3 UI: payload ที่ "จอ" ประกอบ (shop-gem-flow + gem-draft + buildIntakeInput) ไปจนถึงพารามิเตอร์ RPC จริง (p_gem_*) ผ่าน action job-worker
// เหตุผล: เทสต์ของทีมตรวจทีละชั้น (pure / action) — ไฟล์นี้เดินครบสายจาก "state ของฟอร์ม" ถึง "params ที่ส่ง DB" แล้วล็อกรูปร่างไว้
//   ชุด params เดียวกันนี้ถูกยิงกับ RPC จริงใน tx ที่ rollback (scripts/verify/verify-0191-qa-ui-wire.sql — ค่าด้านล่างต้องตรงกับในไฟล์ SQL)
// ต้องถูก: template ที่ไม่แตะ = answer template ไม่มี lines · แก้แถวแม่แบบ = has + gem_item_id · none = answer เดียว · ชนิด/รูปทรงใหม่ (fancy 1 ค่า/2 ค่า) = new_type_name/new_shape · force = [{kind,name}] เฉพาะที่ยืนยัน
// ต้องไม่พัง: ไม่มี key ราคา/ shop id · ไม่มี p_gem_* ที่เป็น null · position ว่าง = ไม่ส่ง key · ขนาดสลับด้านเรียงเล็ก→ใหญ่ก่อนส่ง
import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const IDEM = "ik0123456789abcdef0123456789abcdef";
const JOB = "33333333-3333-4333-8333-333333333333";
const PID = "22222222-2222-4222-8222-222222222222";
const T_CZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S_ROUND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S_OVAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const I1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const I2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REV = "0123456789abcdef0123456789abcdef";

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: vi.fn() }),
  headers: async () => ({ get: (n: string) => ({ "x-forwarded-for": "203.0.113.9", "user-agent": "qa" })[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("@/lib/images/signing", () => ({ signImagePaths: async () => new Map<string, string>(), signJobPhotoPaths: async () => new Map<string, string>() }));

import { intakeOpen, intakeSetJobGems } from "@/lib/actions/job-worker";
import { draftRowsToInputs, emptyGemRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { addForce, emptyShopGems, pruneForce, rowFromIntakeLine, seedFromTemplate } from "@/lib/jobs/shop-gem-flow";
import type { ShopGemState } from "@/lib/jobs/shop-gem-flow";
import { buildIntakeInput, newForm, selectProduct, startNewProduct } from "@/lib/jobs/shop-open";
import type { ShopForm } from "@/lib/jobs/shop-open";
import type { IntakeGemLine, IntakeProduct } from "@/lib/jobs/worker-server";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpcMock.mockResolvedValue({ data: { ok: true, already: false, order_no: "PO-1", job_no: "JB-1", token: "Qq7-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY", design_label: "x", sku: null, sku_pending: true, metal: "silver", qty_order: 3, qty_planned: 3, is_new_design: false, due_date: null, status: "open", gem: { count: 0, total: 0, state: "not_needed", created_types: [], created_shapes: [], reused: [], merged_rows: [] } }, error: null });
});

const product: IntakeProduct = { id: PID, sku: "ZZ-1", name: "แหวน", imageUrl: null, prefill: { metal: "silver", purity: 0.925, weightG: 3.2, metalKnown: true } };
const tline = (o: Partial<IntakeGemLine> = {}): IntakeGemLine => ({ gemItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", typeId: T_CZ, typeName: "โกเมน", shapeId: S_OVAL, shapeName: "ไข่", hasLength: true, sizeA: 4, sizeB: 6, qtyPerPiece: 2, position: "ล้อมรอบ", ...o });
const skuForm = (gems: ShopGemState): ShopForm => ({ ...selectProduct(newForm(IDEM), product), qtyText: "3", gems });
const newDesignForm = (gems: ShopGemState): ShopForm => ({ ...startNewProduct(newForm(IDEM)), label: "แหวนใหม่", qtyText: "3", gems });
const complete = (o: Partial<GemDraftRow>): GemDraftRow => ({ ...emptyGemRow("manual"), qty: "2", ...o });
const TODAY = "2026-10-24";

async function openParams(form: ShopForm): Promise<Record<string, unknown>> {
  rpcMock.mockClear();
  const r = await intakeOpen(TOKEN, buildIntakeInput(form, TODAY));
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return rpcMock.mock.calls[0][1] as Record<string, unknown>;
}
const gemKeys = (p: Record<string, unknown>) => Object.keys(p).filter((k) => k.startsWith("p_gem")).sort();

// ชุด payload ที่ใช้ยิง DB จริง (verify-0191-qa-ui-wire.sql) — เก็บไว้ที่นี่เพื่อให้รูปร่างฝั่ง TS ถูกล็อกด้วยเทสต์ ไม่ใช่เขียนมือฝั่ง SQL อย่างเดียว
const DUMP: Record<string, { ga: string | null; gl: unknown; gf: unknown }> = {};
const rec = (name: string, p: Record<string, unknown>) => {
  DUMP[name] = { ga: (p.p_gem_answer as string) ?? null, gl: p.p_gem_lines ?? null, gf: p.p_gem_force ?? null };
};

describe("W-4 → intakeOpen params (S3: ทุกคำขอมี p_gem_answer)", () => {
  it("W1) แม่แบบ SKU ไม่แตะ → p_gem_answer=template · ไม่มี p_gem_lines/p_gem_force", async () => {
    const p = await openParams(skuForm(seedFromTemplate(PID, [tline(), tline({ gemItemId: I2, label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, position: null })])));
    expect(p.p_gem_answer).toBe("template");
    expect(gemKeys(p)).toEqual(["p_gem_answer"]);
    expect(p.p_product_id).toBe(PID);
    rec("tpl", p);
  });

  it("W2) ไม่มีพลอย → p_gem_answer=none อย่างเดียว", async () => {
    const p = await openParams(newDesignForm({ ...emptyShopGems(), answer: "none" }));
    expect(gemKeys(p)).toEqual(["p_gem_answer"]);
    expect(p.p_gem_answer).toBe("none");
    rec("none", p);
  });

  it("W3) แก้จำนวนของแถวแม่แบบ 1 แถว → has + gem_item_id (ไม่มี type_id/size) · position null = ไม่มี key", async () => {
    const s = seedFromTemplate(PID, [tline(), tline({ gemItemId: I2, label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, position: null })]);
    const rows = s.rows.map((r, i) => (i === 0 ? { ...r, qty: "3", edited: true } : r));
    const p = await openParams(skuForm({ ...s, rows }));
    expect(p.p_gem_answer).toBe("has");
    expect(p.p_gem_lines).toEqual([
      { gem_item_id: I1, qty_per_piece: 3, position: "ล้อมรอบ" },
      { gem_item_id: I2, qty_per_piece: 30 },
    ]);
    expect(gemKeys(p)).toEqual(["p_gem_answer", "p_gem_lines"]);
    rec("tpl_edit", p);
  });

  it("W4) ชนิดใหม่ + รูปทรงใหม่ fancy (2 ค่า กลับด้าน 6×3) + รูปทรงใหม่ 1 ค่า → new_type_name / new_shape{name,has_length} · ขนาดเรียง 3×6 · ชนิดเดิมส่ง type_id", async () => {
    const rows = [
      complete({ type: { kind: "new", name: "ทับทิมคิวเอ" }, shape: { kind: "new", name: "ใบมะกอกคิวเอ", hasLength: true }, sizeA: "6", sizeB: "3", qty: "2", position: "ล้อมรอบ" }),
      complete({ type: { kind: "existing", id: T_CZ, name: "CZ" }, shape: { kind: "new", name: "เพชรสี่แฉกคิวเอ", hasLength: false }, sizeA: "2,5", qty: "10" }),
      complete({ type: { kind: "existing", id: T_CZ, name: "CZ" }, shape: { kind: "existing", id: S_ROUND, name: "กลม", hasLength: false }, sizeA: "1.5", qty: "30" }),
    ];
    const p = await openParams(newDesignForm({ ...emptyShopGems(), answer: "has", rows }));
    expect(p.p_gem_answer).toBe("has");
    expect(p.p_gem_lines).toEqual([
      { new_type_name: "ทับทิมคิวเอ", new_shape: { name: "ใบมะกอกคิวเอ", has_length: true }, size_a: 3, size_b: 6, qty_per_piece: 2, position: "ล้อมรอบ" },
      { type_id: T_CZ, new_shape: { name: "เพชรสี่แฉกคิวเอ", has_length: false }, size_a: 2.5, qty_per_piece: 10 },
      { type_id: T_CZ, shape_id: S_ROUND, size_a: 1.5, qty_per_piece: 30 },
    ]);
    rec("new_names", p);
  });

  it("W5) force ล่วงหน้า: ชื่อที่ผู้ใช้ยืนยัน → p_gem_force=[{kind,name}] · ชื่อที่ถูกแก้/ลบแถวทิ้งแล้วไม่พกไป (pruneForce)", async () => {
    const row = complete({ type: { kind: "new", name: "โกเมนต์" }, shape: { kind: "existing", id: S_ROUND, name: "กลม", hasLength: false }, sizeA: "3" });
    const force = addForce([], { kind: "type", name: "โกเมนต์" });
    const p = await openParams(newDesignForm({ ...emptyShopGems(), answer: "has", rows: [row], force }));
    expect(p.p_gem_force).toEqual([{ kind: "type", name: "โกเมนต์" }]);
    rec("force", p);
    // แถวถูกแก้ชื่อใหม่ → force ถูกตัด → ไม่ส่ง p_gem_force
    const renamed = { ...row, type: { kind: "new" as const, name: "ชื่ออื่นเลย" } };
    const kept = pruneForce(force, [renamed]);
    expect(kept).toEqual([]);
    const p2 = await openParams(newDesignForm({ ...emptyShopGems(), answer: "has", rows: [renamed], force: kept }));
    expect(gemKeys(p2)).toEqual(["p_gem_answer", "p_gem_lines"]);
  });

  it("W6) ยังไม่ตอบ (unset) ที่หลุดถึง action = ปฏิเสธที่ action ไม่ถึง DB (ไม่เดาเป็นไม่มีพลอย)", async () => {
    rpcMock.mockClear();
    const r = await intakeOpen(TOKEN, buildIntakeInput(newDesignForm(emptyShopGems()), TODAY));
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("W7) ไม่มีราคา/shop id/ค่า null ใน params พลอยทุกชุด", async () => {
    for (const [k, v] of Object.entries(DUMP)) {
      const s = JSON.stringify(v);
      expect(/price|cost|thb|shop|margin/i.test(s), k).toBe(false);
      expect(s.includes("null,") && /"gl":\[\{[^}]*null/.test(s), k).toBe(false);
    }
  });
});

describe("W-10 → intakeSetJobGems params", () => {
  const SAVED = [tline(), tline({ gemItemId: I2, label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, position: null })];
  const send = async (rows: GemDraftRow[], force: { kind: "type" | "shape"; name: string }[] | null = null, rev = REV) => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValue({ data: { ok: true, changed: true, count: 0, lines: [], state: "unspecified", rev: "empty", summary: { created_types: [], created_shapes: [], reused: [], merged_rows: [] } }, error: null });
    const r = await intakeSetJobGems(TOKEN, { jobId: JOB, lines: draftRowsToInputs(rows), expectedRev: rev, force });
    return { r, p: rpcMock.mock.calls[0]?.[1] as Record<string, unknown> | undefined, fn: rpcMock.mock.calls[0]?.[0] as string | undefined };
  };

  it("S1) แก้จำนวนแถวที่บันทึกไว้ → gem_item_id + จำนวนใหม่ · p_expected_rev ตรงที่ได้จาก get · ไม่มี p_gem_force เมื่อไม่มี", async () => {
    const rows = SAVED.map((l) => rowFromIntakeLine(l, "saved"));
    rows[0] = { ...rows[0], qty: "5", edited: true };
    const { p, fn } = await send(rows);
    expect(fn).toBe("job_worker_gem_set");
    expect(p).toMatchObject({ p_job_id: JOB, p_expected_rev: REV, p_lines: [{ gem_item_id: I1, qty_per_piece: 5, position: "ล้อมรอบ" }, { gem_item_id: I2, qty_per_piece: 30 }] });
    expect(p).not.toHaveProperty("p_force");
    rec("set_edit", { p_gem_answer: "has", p_gem_lines: p?.p_lines } as Record<string, unknown>);
  });

  it("S2) ลบทุกแถว (0 แถว) → p_lines = [] (ไม่ใช่ null) · rev 'empty' ผ่าน regex", async () => {
    const { r, p } = await send([], null, "empty");
    expect(r.ok).toBe(true);
    expect(p?.p_lines).toEqual([]);
    expect(p?.p_expected_rev).toBe("empty");
    rec("set_zero", { p_gem_answer: "has", p_gem_lines: p?.p_lines } as Record<string, unknown>);
  });

  it("S3) เพิ่มชื่อใหม่ + force เฉพาะชื่อที่ยืนยัน → ส่ง p_force", async () => {
    const rows = [...SAVED.map((l) => rowFromIntakeLine(l, "saved")), complete({ type: { kind: "new", name: "ไพลินคิวเอ" }, shape: { kind: "existing", id: S_ROUND, name: "กลม", hasLength: false }, sizeA: "3", qty: "1" })];
    const { p } = await send(rows, [{ kind: "type", name: "ไพลินคิวเอ" }]);
    expect(p?.p_force).toEqual([{ kind: "type", name: "ไพลินคิวเอ" }]);
    expect((p?.p_lines as unknown[]).at(-1)).toEqual({ new_type_name: "ไพลินคิวเอ", shape_id: S_ROUND, size_a: 3, qty_per_piece: 1 });
    rec("set_new_force", { p_gem_answer: "has", p_gem_lines: p?.p_lines, p_gem_force: p?.p_force } as Record<string, unknown>);
  });

  it("S4) rev ผิดรูป ('', 'xyz', null) = ปฏิเสธที่ action ไม่ถึง DB", async () => {
    for (const rev of ["", "xyz", "ABCDEF0123456789ABCDEF0123456789", null as unknown as string]) {
      rpcMock.mockClear();
      const r = await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: rev });
      expect(r.ok, String(rev)).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    }
  });
});

describe("dump (เฉพาะเมื่อตั้ง QA_WIRE_DUMP) — ส่งออก params เป็น JSON ให้ไฟล์ SQL", () => {
  it("เขียนไฟล์เมื่อมี env · ไม่ตั้ง = ข้าม", () => {
    const out = process.env.QA_WIRE_DUMP;
    if (!out) return;
    writeFileSync(out, JSON.stringify(DUMP, null, 1));
  });
});
