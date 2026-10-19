// getJobHistory — เฉพาะใบแม่ที่ปิดแล้ว/ยกเลิก · whitelist คอลัมน์ · shop_id + limit · ยอดทั้งต้นไม้ · guard · ล้ม = ข้อความกลาง
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const ROOT = "11111111-1111-4111-8111-111111111111";
const SOLO = "33333333-3333-4333-8333-333333333333";
const CXL = "44444444-4444-4444-8444-444444444444";

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown }> = {};
let role = "owner";
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  const res = () => results[table] ?? { data: [], error: null };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: async () => role }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: "99999999-9999-4999-8999-999999999999" }), requireSessionIfGateOn: async () => undefined }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: vi.fn(), from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

import { getJobHistory } from "./job-office";
import { HISTORY_COLUMNS } from "@/lib/jobs/history";

const jobRow = (o: Record<string, unknown>) => ({
  id: ROOT, job_no: "JB-0018", seq: 18, source_kind: "oem", design_label: "แหวน", sku_snapshot: null, metal: "silver", qty_order: 50, qty_planned: 50, qty_good: 45, qty_scrap: 3,
  status: "done", done_at: "2026-10-19T10:00:00Z", cancelled_at: null, cancel_reason: null, surplus_disposition: "stock", updated_at: "2026-10-19T10:00:00Z", ...o,
});

beforeEach(() => {
  calls.length = 0;
  role = "owner";
  for (const k of Object.keys(results)) delete results[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getJobHistory — query", () => {
  it("อ่านตาราง job: shop_id · status in [done,cancelled] · parent_job_id is null (ใบแม่เท่านั้น) · updated_at ใหม่ก่อน · limit 500 · select = whitelist", async () => {
    results.job = { data: [], error: null };
    const r = await getJobHistory();
    expect(r.ok).toBe(true);
    const q = calls.find((c) => c.table === "job")!;
    expect(q.ops).toContainEqual(["select", HISTORY_COLUMNS]);
    expect(q.ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(q.ops).toContainEqual(["in", "status", ["done", "cancelled"]]);
    expect(q.ops).toContainEqual(["is", "parent_job_id", null]);
    expect(q.ops).toContainEqual(["order", "updated_at", { ascending: false }]);
    expect(q.ops).toContainEqual(["limit", 500]);
    // ไม่ดึงสถานะที่ยังวิ่งอยู่
    expect(JSON.stringify(q.ops)).not.toMatch(/in_progress|"open"|on_hold/);
  });

  it("whitelist: ไม่ select source_ref/ราคา/ลูกค้า/ต้นทุน", async () => {
    await getJobHistory();
    const sel = String(calls.find((c) => c.table === "job")!.ops.find((o) => o[0] === "select")![1]);
    expect(sel).not.toMatch(/source_ref|price|cost|customer|buyer|amount|thb|quote_item|note\b|weight/i);
  });

  it("แถวคืนมาไม่มี field นอกสเปกแม้ DB ส่งเกินมา", async () => {
    results.job = { data: [jobRow({ source_ref: "QT-2608-001", unit_price: 999, customer_name: "คุณเอ" })], error: null };
    results.v_job_tree_summary = { data: [], error: null };
    const r = await getJobHistory();
    if (!r.ok) throw new Error("fail");
    expect(JSON.stringify(r.data)).not.toMatch(/QT-2608|999|คุณเอ|source_ref|unit_price/);
  });

  it("ใบที่ status แปลกหลุดมา (เช่น in_progress) ถูกทิ้ง", async () => {
    results.job = { data: [jobRow({}), jobRow({ id: SOLO, job_no: "JB-0019", status: "in_progress" })], error: null };
    const r = await getJobHistory();
    if (!r.ok) throw new Error("fail");
    expect(r.data.rows.map((x) => x.jobNo)).toEqual(["JB-0018"]);
  });
});

describe("getJobHistory — ยอดทั้งต้นไม้", () => {
  it("ใบ done: ดี/เสียมาจาก v_job_tree_summary (ใบแม่ 45 + ส่วน arrived 2 = 47) · query ผูก shop_id + root_job_id in + limit", async () => {
    results.job = { data: [jobRow({ qty_good: 45 }), jobRow({ id: SOLO, job_no: "JB-0019", seq: 19, qty_good: 10, qty_scrap: 0 })], error: null };
    results.v_job_tree_summary = { data: [{ root_job_id: ROOT, qty_done_good: 47, qty_scrap_total: 3 }], error: null };
    const r = await getJobHistory();
    if (!r.ok) throw new Error("fail");
    expect(r.data.rows.find((x) => x.id === ROOT)).toMatchObject({ qtyGood: 47, qtyScrap: 3 });
    expect(r.data.rows.find((x) => x.id === SOLO)).toMatchObject({ qtyGood: 10, qtyScrap: 0 }); // ไม่มีสรุป = ยอดของใบเอง
    const q = calls.find((c) => c.table === "v_job_tree_summary")!;
    expect(q.ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(q.ops.find((o) => o[0] === "in" && o[1] === "root_job_id")?.[2]).toEqual([ROOT, SOLO]);
    expect(q.ops.some((o) => o[0] === "limit")).toBe(true);
    expect(String(q.ops.find((o) => o[0] === "select")![1])).toBe("root_job_id, qty_done_good, qty_scrap_total");
  });

  it("ใบยกเลิกไม่ถูกส่งไปขอสรุป · ไม่มีใบ done = ไม่ยิง view เลย", async () => {
    results.job = { data: [jobRow({ id: CXL, job_no: "JB-0020", status: "cancelled", done_at: null, cancelled_at: "2026-10-05T01:00:00Z", cancel_reason: "ยกเลิก" })], error: null };
    const r = await getJobHistory();
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.table === "v_job_tree_summary")).toBe(false);
  });

  it("ใบ done เกิน 100 ใบ แบ่งคำขอเป็นก้อน ≤ 100 id (กัน URL ยาวเกิน)", async () => {
    const many = Array.from({ length: 230 }, (_, i) => jobRow({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, job_no: `JB-${i}`, seq: i + 1 }));
    results.job = { data: many, error: null };
    await getJobHistory();
    const sums = calls.filter((c) => c.table === "v_job_tree_summary");
    expect(sums).toHaveLength(3);
    for (const s of sums) expect((s.ops.find((o) => o[0] === "in")![2] as string[]).length).toBeLessThanOrEqual(100);
  });

  it("อ่านสรุปต้นไม้ไม่ได้ = ล้มทั้งคำขอ (ไม่โชว์ยอดใบแม่ครึ่งเดียวเงียบๆ) · ข้อความกลาง ไม่รั่ว error ดิบ", async () => {
    results.job = { data: [jobRow({})], error: null };
    results.v_job_tree_summary = { data: null, error: { message: "relation boom secret", code: "42P01" } };
    const r = await getJobHistory();
    expect(r).toEqual({ ok: false, error: "โหลดประวัติงานไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(JSON.stringify(r)).not.toMatch(/secret|42P01|boom/);
  });
});

describe("getJobHistory — truncated / error / guard", () => {
  it("ครบ 500 แถว = truncated true · น้อยกว่า = false", async () => {
    results.job = { data: Array.from({ length: 500 }, (_, i) => jobRow({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, job_no: `JB-${i}`, status: "cancelled", done_at: null, cancelled_at: "2026-10-01T00:00:00Z" })), error: null };
    const a = await getJobHistory();
    expect(a.ok && a.data.truncated).toBe(true);
    results.job = { data: [jobRow({})], error: null };
    const b = await getJobHistory();
    expect(b.ok && b.data.truncated).toBe(false);
  });

  it("ล้มที่ query job = ข้อความกลาง", async () => {
    results.job = { data: null, error: { message: "db down password=x", code: "XX000" } };
    const r = await getJobHistory();
    expect(r).toEqual({ ok: false, error: "โหลดประวัติงานไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });

  it("ไม่ใช่ owner/admin (staff/role แปลก) = ไม่ query อะไรเลย", async () => {
    for (const rl of ["staff", "viewer", "", "superuser"]) {
      role = rl;
      calls.length = 0;
      const r = await getJobHistory();
      expect(r.ok, rl).toBe(false);
      expect(calls, rl).toHaveLength(0);
    }
  });

  it("admin ผ่าน · คืน todayTh รูป YYYY-MM-DD", async () => {
    role = "admin";
    const r = await getJobHistory();
    expect(r.ok && /^\d{4}-\d{2}-\d{2}$/.test(r.data.todayTh)).toBe(true);
  });
});
