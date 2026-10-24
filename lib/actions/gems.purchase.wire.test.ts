// QA เสริม G1b (0192): ทดสอบ "wire" — payload ที่ server action ส่งต้องมีชื่อพารามิเตอร์ตรง signature จริงใน migration 0192 (ผิดชื่อ = PostgREST 404 PGRST202 ตอนใช้จริง)
// + mapper ต้องรับ JSON จริงจาก DB ได้ (fixture = ผลจริงจาก dry-run verify-0192-qa.sql บนร้านสังเคราะห์) + ธงข้อห้ามราคา
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const L1 = "11111111-1111-4111-8111-111111111111";

const rpcMock = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: async () => "owner" }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: USER, email: "o@example.test" }), requireSessionIfGateOn: async () => undefined }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: () => ({}) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import * as gems from "./gems";
import { mapGemPurchaseCost, mapGemPurchaseMark, mapGemPurchaseSummary } from "@/lib/jobs/gem-purchase";

const root = resolve(__dirname, "../..");
const sql = readFileSync(resolve(root, "supabase/migrations/0192_gems_to_buy_g1b.sql"), "utf8");
const fixture = JSON.parse(readFileSync(resolve(root, "lib/jobs/gem-purchase.dbshape.fixture.json"), "utf8")) as { summary: Record<string, unknown>; mark: Record<string, unknown>; cost: Record<string, unknown> };

/** ชื่อ + ชื่อพารามิเตอร์ (ตามลำดับ) ของ `create or replace function analytics.<name>(...)` ใน 0192 */
function signature(name: string): string[] {
  const m = new RegExp(`create or replace function analytics\\.${name}\\(([^)]*)\\)`).exec(sql);
  if (!m) throw new Error(`ไม่พบ ${name} ใน 0192`);
  return m[1].split(",").map((a) => a.trim().split(/\s+/)[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpcMock.mockResolvedValue({ data: {}, error: null });
});

describe("wire: ชื่อพารามิเตอร์ที่ action ส่ง = signature จริงของ RPC ใน 0192 (ชุดเดียวกันเป๊ะ — ขาด/เกิน = PostgREST หา function ไม่เจอ)", () => {
  it("signature ใน 0192 อ่านได้ครบ 3 ตัว (กัน regex เสียแล้วเทสต์ผ่านเปล่า)", () => {
    expect(signature("gem_purchase_summary")).toEqual(["p_shop_id", "p_actor"]);
    expect(signature("gem_purchase_summary_cost")).toEqual(["p_shop_id", "p_actor"]);
    expect(signature("gem_purchase_mark")).toEqual(["p_shop_id", "p_line_ids", "p_ordered", "p_actor"]);
  });
  it.each([
    ["gem_purchase_summary", () => gems.getGemPurchaseSummary()],
    ["gem_purchase_summary_cost", () => gems.getGemPurchaseCost()],
    ["gem_purchase_mark", () => gems.markGemPurchase({ lineIds: [L1], ordered: true })],
  ] as [string, () => Promise<unknown>][])("%s: key ที่ส่งตรง signature", async (fn, run) => {
    await run();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe(fn);
    expect(Object.keys(args).sort()).toEqual([...signature(fn)].sort());
  });
  it("p_line_ids เป็น array ของ string uuid · p_ordered เป็น boolean จริง (ไม่ใช่ string) — PostgREST cast uuid[]/boolean ได้", async () => {
    await gems.markGemPurchase({ lineIds: [L1], ordered: false });
    const args = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(Array.isArray(args.p_line_ids) && (args.p_line_ids as unknown[]).every((x) => typeof x === "string")).toBe(true);
    expect(args.p_ordered).toBe(false);
  });
  it("RPC ทั้ง 3 ตัวไม่มี overload/พารามิเตอร์ default ใน 0192 (ส่งครบทุกตัวเสมอ) และ service_role เท่านั้นที่ได้ execute", () => {
    for (const fn of ["gem_purchase_summary", "gem_purchase_mark", "gem_purchase_summary_cost"]) {
      expect(sql.match(new RegExp(`create or replace function analytics\\.${fn}\\(`, "g"))).toHaveLength(1);
      expect(new RegExp(`create or replace function analytics\\.${fn}\\([^)]*\\bdefault\\b`).test(sql)).toBe(false);
    }
    expect(sql).toMatch(/grant execute on function %s to service_role/);
    expect(sql).not.toMatch(/grant execute on function[^;]*to (anon|authenticated|public)/i);
  });
});

describe("mapper รับ JSON จริงจาก DB (fixture จาก dry-run) — shape ตรง type", () => {
  it("summary: แปลงได้ · มีกลุ่ม/ใบ/unspecified/removed_after_order/changed_after_order · ตัวเลขตรงต้นฉบับ", () => {
    const m = mapGemPurchaseSummary(fixture.summary);
    expect(m).not.toBeNull();
    expect(m!.groups.length).toBe((fixture.summary.groups as unknown[]).length);
    expect(m!.groups.reduce((n, g) => n + g.jobs.length, 0)).toBeGreaterThanOrEqual(3);
    expect(m!.groups.some((g) => g.jobs.some((j) => j.changedAfterOrder && j.isOrdered && j.orderedBy !== null && j.orderedAt !== null))).toBe(true);
    expect(m!.unspecifiedJobs.length).toBeGreaterThanOrEqual(2);
    expect(m!.removedAfterOrder.length).toBeGreaterThanOrEqual(1);
    expect(m!.removedAfterOrder[0].label).toMatch(/มม\.$/);
    // ยอดรวมของกลุ่มต้องเท่า totals (DB ส่งมาสอดคล้องกัน — mapper ไม่คำนวณเอง)
    expect(m!.groups.reduce((n, g) => n + g.qtyNeededNow, 0)).toBe(m!.totals.qtyNeededNow);
    expect(m!.groups.reduce((n, g) => n + g.qtyRemaining, 0)).toBe(m!.totals.qtyRemaining);
    expect(m!.groups.reduce((n, g) => n + g.qtyOrdered, 0)).toBe(m!.totals.qtyOrdered);
    expect(m!.serverNow).toMatch(/\+07:00$/);
  });
  it("summary จริง: ไม่มีคีย์ราคา/ต้นทุน/ผู้ขายทั้งใน JSON ดิบและใน output ของ mapper", () => {
    const bad = /price|cost|thb|supplier|margin/i;
    expect(JSON.stringify(fixture.summary)).not.toMatch(bad);
    expect(JSON.stringify(mapGemPurchaseSummary(fixture.summary))).not.toMatch(bad);
    expect(JSON.stringify(fixture.mark)).not.toMatch(bad);
    expect(JSON.stringify(mapGemPurchaseMark(fixture.mark))).not.toMatch(bad);
  });
  it("mark: แปลงได้ · lines ครบทุกแถวที่ส่ง · is_ordered true", () => {
    const m = mapGemPurchaseMark(fixture.mark);
    expect(m).not.toBeNull();
    expect(m!.lines.length).toBe((fixture.mark.lines as unknown[]).length);
    expect(m!.requested).toBe(m!.changed + m!.unchanged);
    expect(m!.lines.every((l) => l.isOrdered)).toBe(true);
  });
  it("cost: แปลงได้ · กลุ่มไม่มีราคา = null + ธง · กลุ่มมีราคา = ตัวเลข · totals = ผลรวมแถวที่ไม่ null เป๊ะ (ไม่คำนวณใน client)", () => {
    const m = mapGemPurchaseCost(fixture.cost);
    expect(m).not.toBeNull();
    expect(m!.groups.some((g) => g.costRemainingThb === null && g.missingPriceRemaining)).toBe(true);
    expect(m!.groups.some((g) => typeof g.costRemainingThb === "number" && !g.missingPrice)).toBe(true);
    expect(m!.totals.complete).toBe(false);
    expect(m!.totals.groupsMissingPrice).toBe(m!.groups.filter((g) => g.missingPrice).length);
    const sumRem = Math.round(m!.groups.reduce((n, g) => n + (g.costRemainingThb ?? 0), 0) * 100) / 100;
    expect(m!.totals.costRemainingThb).toBe(sumRem);
  });
  it("action ครบทางจริง: ป้อน fixture ผ่าน rpc mock → ok:true ทั้ง 3 ตัว (callOffice → mapper)", async () => {
    rpcMock.mockResolvedValueOnce({ data: fixture.summary, error: null });
    rpcMock.mockResolvedValueOnce({ data: fixture.cost, error: null });
    rpcMock.mockResolvedValueOnce({ data: fixture.mark, error: null });
    expect((await gems.getGemPurchaseSummary()).ok).toBe(true);
    expect((await gems.getGemPurchaseCost()).ok).toBe(true);
    expect((await gems.markGemPurchase({ lineIds: [L1], ordered: true })).ok).toBe(true);
  });
  it("ผลจริงที่ถูกบิดเล็กน้อยต้องถูกปฏิเสธ (null) ไม่ใช่แสดงยอดที่ตรวจไม่ได้: ลบคีย์ totals · id ใบเสีย · จำนวนทศนิยม", () => {
    const s = structuredClone(fixture.summary) as { totals: Record<string, unknown>; groups: { jobs: Record<string, unknown>[]; qty_needed_now: unknown }[] };
    delete s.totals.qty_remaining;
    expect(mapGemPurchaseSummary(s)).toBeNull();
    const s2 = structuredClone(fixture.summary) as typeof s;
    s2.groups[0].jobs[0].job_id = "not-a-uuid";
    expect(mapGemPurchaseSummary(s2)).toBeNull();
    const s3 = structuredClone(fixture.summary) as typeof s;
    s3.groups[0].qty_needed_now = 1.5;
    expect(mapGemPurchaseSummary(s3)).toBeNull();
  });
});

describe("ขอบเขตที่ชั้น TS (ข้อสังเกตจากการอ่านโค้ด)", () => {
  it("กลุ่มที่มี line_ids เกิน 200: 'ติ๊กทั้งรายการ' (ส่ง groups[].lineIds) ถูกปฏิเสธที่ชั้น TS ก่อนถึง DB — ยืนยันพฤติกรรมปัจจุบัน", async () => {
    const ids = Array.from({ length: 201 }, (_v, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    const r = await gems.markGemPurchase({ lineIds: ids, ordered: true });
    expect(r.ok === false && r.code === "purchase_lines_invalid").toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("N6: mapper ไม่ตัดเงียบ — groups[].line_ids เกิน 500 = null ทั้งผล (ตัดแล้วติ๊ก \"ทั้งรายการ\" จะไม่ครบโดยไม่มีสัญญาณ) · 500 พอดีผ่าน", () => {
    const g = (fixture.summary.groups as Record<string, unknown>[])[0];
    const ids = (n: number) => Array.from({ length: n }, (_v, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    expect(mapGemPurchaseSummary({ ...fixture.summary, groups: [{ ...g, line_ids: ids(600) }] })).toBeNull();
    expect(mapGemPurchaseSummary({ ...fixture.summary, groups: [{ ...g, line_ids: ids(500) }] })?.groups[0].lineIds.length).toBe(500);
  });
});
