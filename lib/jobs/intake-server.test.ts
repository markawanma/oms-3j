// lib/jobs/intake-server.ts — loader ป้ายใบจากหน้างานของบอร์ด: shop_id + limit ทุก query · เฉพาะ opened_via=shopfloor · ล้ม = map ว่าง (บอร์ดเดิมไม่พัง) · ไม่อ่านเงิน/ชื่อผู้เปิด
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown }> = {};
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(results[table] ?? { data: [], error: null }).then(ok, bad);
  return b;
}
vi.mock("@/lib/jobs/office-server", () => ({ db: () => ({ from: (t: string) => builder(t) }), shopId: () => SHOP }));

import { loadBoardIntake } from "./intake-server";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadBoardIntake", () => {
  it("ไม่มี po → ไม่ query เลย", async () => {
    expect(await loadBoardIntake([])).toEqual({ map: new Map(), failed: false });
    expect((await loadBoardIntake(["", ""])).failed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("รอรับทราบ = ใบผลิต open + acknowledged_at ว่าง · รับทราบแล้ว/ปิดแล้ว = ไม่รอ · metal_mismatch จากวิวของ DB", async () => {
    results.v_production_order = {
      data: [
        { id: "o1", po_no: "PO-1", status: "open", opened_via: "shopfloor", acknowledged_at: null, created_at: "2026-10-19T02:00:00Z" },
        { id: "o2", po_no: "PO-2", status: "open", opened_via: "shopfloor", acknowledged_at: "2026-10-20T00:00:00Z", created_at: "2026-10-19T02:00:00Z" },
        { id: "o3", po_no: "PO-3", status: "done", opened_via: "shopfloor", acknowledged_at: null, created_at: "2026-10-19T02:00:00Z" },
      ],
      error: null,
    };
    results.v_production_order_item = { data: [{ production_order_id: "o1", metal_mismatch: true }], error: null };
    const { map: m, failed } = await loadBoardIntake(["PO-1", "PO-2", "PO-3", "PO-1"]);
    expect(failed).toBe(false);
    expect(m.get("PO-1")).toEqual({ ackPending: true, openedAt: "2026-10-19T02:00:00Z", metalMismatch: true });
    expect(m.get("PO-2")).toEqual({ ackPending: false, openedAt: "2026-10-19T02:00:00Z", metalMismatch: false });
    expect(m.get("PO-3")).toMatchObject({ ackPending: false });
    for (const c of calls) {
      expect(c.ops.some((o) => o[0] === "eq" && o[1] === "shop_id" && o[2] === SHOP), c.table).toBe(true);
      expect(c.ops.some((o) => o[0] === "limit"), c.table).toBe(true);
    }
    const orderCall = calls.find((c) => c.table === "v_production_order");
    expect(orderCall?.ops.some((o) => o[0] === "eq" && o[1] === "opened_via" && o[2] === "shopfloor")).toBe(true);
    expect(orderCall?.ops.find((o) => o[0] === "in")?.[2]).toEqual(["PO-1", "PO-2", "PO-3"]); // ไม่ซ้ำ
  });

  it("ไม่มีใบจากหน้างานเลย → ไม่ query รายการ (ไม่เสียรอบ)", async () => {
    results.v_production_order = { data: [], error: null };
    const r = await loadBoardIntake(["PO-9"]);
    expect(r.map.size).toBe(0);
    expect(r.failed).toBe(false); // อ่านได้ ไม่มีใบจากหน้างานจริงๆ = ไม่ใช่ล้ม
    expect(calls.some((c) => c.table === "v_production_order_item")).toBe(false);
  });

  it("ผลไม่ตรงรูป (ไม่มี po_no/id) ถูกข้ามเงียบ", async () => {
    results.v_production_order = { data: [{ id: 5, po_no: "PO-1" }, { id: "o9" }, null], error: null };
    expect((await loadBoardIntake(["PO-1"])).map.size).toBe(0);
  });

  it("อ่านล้ม (error จาก DB) → map ว่าง ไม่ throw (บอร์ดแสดงแบบเดิม)", async () => {
    results.v_production_order = { data: null, error: { code: "42501", message: "denied" } };
    // failed = true (ไม่ใช่แค่ map ว่าง) — ให้ tile "รอรับทราบ" ขึ้น "—" ไม่ใช่ 0
    await expect(loadBoardIntake(["PO-1"])).resolves.toEqual({ map: new Map(), failed: true });
  });

  it("รายการล้มหลังใบผลิตสำเร็จ → ทั้งก้อนเป็น map ว่าง (ไม่โชว์ข้อมูลครึ่งเดียว)", async () => {
    results.v_production_order = { data: [{ id: "o1", po_no: "PO-1", status: "open", opened_via: "shopfloor", acknowledged_at: null, created_at: "x" }], error: null };
    results.v_production_order_item = { data: null, error: { code: "XX", message: "boom" } };
    expect(await loadBoardIntake(["PO-1"])).toEqual({ map: new Map(), failed: true });
  });

  it("po เกิน 100 → แบ่ง chunk (ไม่ทะลุเพดาน URL)", async () => {
    await loadBoardIntake(Array.from({ length: 230 }, (_, i) => `PO-${i}`).map((s) => s));
    expect(calls.filter((c) => c.table === "v_production_order")).toHaveLength(3);
  });
});
