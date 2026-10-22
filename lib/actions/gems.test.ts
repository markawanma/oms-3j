// lib/actions/gems.ts (0190 G1a): guard owner/admin ทุก action · p_shop_id/p_actor จาก server · input ผ่าน allowlist ก่อนถึง DB · error พา gem {row,field,similar} · createJob ส่ง p_gem_lines/p_gem_force เฉพาะเมื่อมีค่า
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const JOB = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const T2 = "44444444-4444-4444-8444-444444444444";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
const copyMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: () => ({}) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs/photos-server", () => ({ copyCatalogPhotoToJob: (...a: unknown[]) => copyMock(...a), loadJobPhotos: vi.fn() }));
vi.mock("@/lib/jobs/gems-server", () => ({ loadJobGemsSummary: vi.fn() }));

import * as gems from "./gems";
import { createJob } from "./job-office";

beforeEach(() => {
  vi.clearAllMocks();
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: {}, error: null });
  copyMock.mockResolvedValue({ ok: false, reason: "no_product", error: "x" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const line = { typeId: T1, shapeId: T2, sizeA: 4, sizeB: 6, qtyPerPiece: 2, position: "บ่า" };

describe("สิทธิ์: ทุก action ต้อง owner/admin — role อื่น/ไม่ login ไม่แตะ DB", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["getGemOptions", () => gems.getGemOptions()],
    ["getGemCatalog", () => gems.getGemCatalog()],
    ["createGemName", () => gems.createGemName({ kind: "type", name: "โกเมน" })],
    ["createGemItem", () => gems.createGemItem(line)],
    ["renameGem", () => gems.renameGem({ kind: "type", id: T1, name: "x" })],
    ["setGemShapeHasLength", () => gems.setGemShapeHasLength({ id: T1, hasLength: true })],
    ["setGemActive", () => gems.setGemActive({ kind: "type", id: T1, active: false })],
    ["removeGem", () => gems.removeGem({ kind: "item", id: T1 })],
    ["previewGemMerge", () => gems.previewGemMerge({ kind: "type", fromId: T1, intoId: T2 })],
    ["mergeGem", () => gems.mergeGem({ kind: "type", fromId: T1, intoId: T2 })],
    ["setGemPrice", () => gems.setGemPrice({ itemId: ITEM, price: 10 })],
    ["getGemPriceHistory", () => gems.getGemPriceHistory(ITEM)],
    ["getJobGems", () => gems.getJobGems(JOB)],
    ["saveJobGems", () => gems.saveJobGems({ jobId: JOB, lines: [] })],
    ["getSkuGemTemplate", () => gems.getSkuGemTemplate(ITEM)],
    ["saveSkuGemTemplate", () => gems.saveSkuGemTemplate({ productId: ITEM, lines: [] })],
    ["makeSkuGemTemplateFromJob", () => gems.makeSkuGemTemplateFromJob(JOB)],
  ];
  it.each(calls)("%s: staff/ไม่ระบุ role → ok:false · ไม่เรียก RPC", async (_n, run) => {
    for (const role of ["staff", undefined, "viewer"]) {
      roleMock.mockResolvedValue(role);
      const r = (await run()) as { ok: boolean };
      expect(r.ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ไม่มี session user (actor) → RPC ที่ต้องมี actor ไม่ถูกเรียก", async () => {
    sessionUserMock.mockResolvedValue(null);
    const r = await gems.setGemPrice({ itemId: ITEM, price: 10 });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("พารามิเตอร์ที่ส่ง RPC: shop/actor จาก server · ชื่อ arg ตรง migration", () => {
  it("setGemPrice → gem_price_set ด้วย p_price เป็นตัวเลข · p_actor = session ไม่ใช่ค่าจาก client", async () => {
    rpcMock.mockResolvedValue({ data: { effective_from: "2026-10-22", replaced: false }, error: null });
    const r = await gems.setGemPrice({ itemId: ITEM, price: "7391,2468", effectiveFrom: "2026-10-22", supplier: "ร้านเอ", note: null, ...({ p_actor: "evil", p_shop_id: "evil" } as object) } as never);
    expect(r).toEqual({ ok: true, data: { effectiveFrom: "2026-10-22", replaced: false } });
    expect(rpcMock).toHaveBeenCalledWith("gem_price_set", { p_item_id: ITEM, p_price: 7391.2468, p_effective_from: "2026-10-22", p_supplier: "ร้านเอ", p_note: null, p_shop_id: SHOP, p_actor: USER });
  });
  it.each([0, -1, "NaN", "Infinity", 1_000_001, "1.23456", "", "abc", Number.NaN, null])("ราคา %j ปฏิเสธก่อนถึง DB (price_invalid)", async (p) => {
    const r = await gems.setGemPrice({ itemId: ITEM, price: p as never });
    expect(r.ok === false && r.code === "price_invalid").toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ขอบ: 1,000,000 และ 0.0001 ผ่าน · วันที่ผิดรูปแบบ → date_invalid", async () => {
    expect((await gems.setGemPrice({ itemId: ITEM, price: 1_000_000 })).ok).toBe(true);
    expect((await gems.setGemPrice({ itemId: ITEM, price: "0.0001" })).ok).toBe(true);
    const bad = await gems.setGemPrice({ itemId: ITEM, price: 10, effectiveFrom: "22/10/2026" });
    expect(bad.ok === false && bad.code === "date_invalid").toBe(true);
  });
  it("getGemOptions ไม่ส่ง p_actor · getGemCatalog ส่ง p_include_inactive + actor", async () => {
    rpcMock.mockResolvedValue({ data: { types: [], shapes: [], items: [] }, error: null });
    await gems.getGemOptions();
    expect(rpcMock).toHaveBeenLastCalledWith("gem_options_list", { p_shop_id: SHOP });
    await gems.getGemCatalog(true);
    expect(rpcMock).toHaveBeenLastCalledWith("gem_catalog_list", { p_include_inactive: true, p_shop_id: SHOP, p_actor: USER });
  });
  it("saveJobGems: แถวผ่าน allowlist เป็น snake_case · reason/force ส่งต่อ · ผลมี summary.reused", async () => {
    rpcMock.mockResolvedValue({ data: { changed: true, count: 1, window: "reason_required", lines: [{ gem_item_id: ITEM, label: "โกเมน · ไข่ · 4×6 มม.", qty_per_piece: 2, qty_total: 70, position: "บ่า", source: "manual" }], summary: { created_types: [], created_shapes: [], created_items: [], reused: [{ row: 1, kind: "type", typed: "โกเมน ", name: "โกเมน" }], merged_rows: [] } }, error: null });
    const r = await gems.saveJobGems({ jobId: JOB, lines: [line], reason: "พลอยแตก", force: true });
    expect(rpcMock).toHaveBeenCalledWith("job_gem_bom_set", { p_job_id: JOB, p_gem_lines: [{ type_id: T1, shape_id: T2, size_a: 4, size_b: 6, qty_per_piece: 2, position: "บ่า" }], p_reason: "พลอยแตก", p_force: true, p_shop_id: SHOP, p_actor: USER });
    expect(r.ok && r.data.summary.reused[0].name === "โกเมน" && r.data.window === "reason_required" && r.data.lines[0].qtyTotal === 70).toBe(true);
  });
  it("saveJobGems: แถวมี key ราคา → ปฏิเสธที่ชั้นแอป (gem.row/field) · ไม่เรียก DB", async () => {
    const r = await gems.saveJobGems({ jobId: JOB, lines: [line, { ...line, price: 5 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("line_invalid");
      expect(r.gem).toEqual({ code: "line_invalid", row: 2, field: "price" });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ผิดรูป: jobId ไม่ใช่ uuid · lines ไม่ใช่ array · kind แปลก · reason ยาวเกิน", async () => {
    expect((await gems.saveJobGems({ jobId: "x", lines: [] })).ok).toBe(false);
    expect((await gems.saveJobGems({ jobId: JOB, lines: "x" })).ok).toBe(false);
    expect((await gems.setGemActive({ kind: "price" as never, id: T1, active: true })).ok).toBe(false);
    expect((await gems.saveJobGems({ jobId: JOB, lines: [], reason: "ก".repeat(301) })).ok).toBe(false);
    expect((await gems.mergeGem({ kind: "item" as never, fromId: T1, intoId: T2 })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("error ของ DB → ข้อความไทย + gem (row/field/similar)", () => {
  it("gem_similar: คืน gem.similar ที่ตรวจรูปร่างแล้ว · code = gem_similar", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "พบชื่อพลอยที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่", hint: "gem_similar", details: JSON.stringify({ similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T1, name: "โกเมน" }] }] }) },
    });
    const r = await gems.saveJobGems({ jobId: JOB, lines: [{ newTypeName: "โกเมนต์", shapeId: T2, sizeA: 4, qtyPerPiece: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("gem_similar");
      expect(r.gem?.similar?.[0].matches[0].name).toBe("โกเมน");
      expect(r.error).toMatch(/คล้าย/);
    }
  });
  it("42501 (ไม่ใช่ owner/admin ที่ DB) → ข้อความสิทธิ์ · ไม่มีข้อความดิบ/ชื่อตารางหลุด", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for table gem_item_price", hint: "gem_actor_forbidden" } });
    const r = await gems.setGemPrice({ itemId: ITEM, price: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/gem_item_price|permission denied/);
  });
  it("RPC คืนรูปไม่ถูกต้อง → ข้อความกลาง (ไม่เดา)", async () => {
    rpcMock.mockResolvedValue({ data: { weird: true }, error: null });
    expect((await gems.getGemOptions()).ok).toBe(true); // options ว่างได้
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect((await gems.getJobGems(JOB)).ok).toBe(false);
  });
});

describe("createJob + พลอย", () => {
  const input = { kind: "production" as const, itemId: ITEM, stageCodes: ["cast", "qc", "pack"] };
  beforeEach(() => rpcMock.mockResolvedValue({ data: { job_id: JOB, job_no: "JB-0009" }, error: null }));
  it("ไม่ส่ง gemLines/gemForce → ไม่มี p_gem_lines/p_gem_force (DB คัดลอกแม่แบบถ้ามีขั้นฝัง) · ผลเหมือนเดิมเป๊ะ", async () => {
    const r = await createJob(input);
    expect(r).toEqual({ ok: true, data: { jobId: JOB, jobNo: "JB-0009", planMissing: [] } });
    const sent = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect("p_gem_lines" in sent).toBe(false);
    expect("p_gem_force" in sent).toBe(false);
  });
  it("gemLines = [] ส่งไปเป็น [] (ระบุว่าไม่มีพลอย) · แถว = snake_case · gemForce=true ส่ง p_gem_force", async () => {
    await createJob({ ...input, gemLines: [] });
    expect((rpcMock.mock.calls[0][1] as Record<string, unknown>).p_gem_lines).toEqual([]);
    await createJob({ ...input, gemLines: [line], gemForce: true });
    const sent = rpcMock.mock.calls[1][1] as Record<string, unknown>;
    expect(sent.p_gem_lines).toEqual([{ type_id: T1, shape_id: T2, size_a: 4, size_b: 6, qty_per_piece: 2, position: "บ่า" }]);
    expect(sent.p_gem_force).toBe(true);
  });
  it("แถวพลอยผิดรูป (key ราคา) → ไม่เรียก RPC ไม่เปิดใบ · gem.row/field บอกแถว", async () => {
    const r = await createJob({ ...input, gemLines: [{ ...line, price: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.gem).toEqual({ code: "line_invalid", row: 1, field: "price" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("DB ปฏิเสธแถว (qty_invalid แถว 2) → result.gem พากลับแถว/ช่อง · ไม่ copy รูป (ใบไม่เกิด)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "จำนวนต่อชิ้นต้องเป็นเลขเต็ม 1–1,000", hint: "qty_invalid", details: JSON.stringify({ row: 2, field: "qty_per_piece", code: "qty_invalid" }) } });
    const r = await createJob({ ...input, gemLines: [line, line] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.gem).toEqual({ code: "qty_invalid", row: 2, field: "qty_per_piece" });
    expect(copyMock).not.toHaveBeenCalled();
  });
});
