// lib/jobs/gems-server.ts (0190 G1a · review S3): state ของพลอยอ่านจาก DB (analytics.job_gem_state) ไม่คิดซ้ำใน TS · แถวอ่านจากตาราง snapshot เท่านั้น (ไม่มีราคา)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const ROOT = "11111111-1111-4111-8111-111111111111";

vi.mock("server-only", () => ({}));
const rpcMock = vi.fn();
const fromMock = vi.fn();
const selectMock = vi.fn();
vi.mock("@/lib/jobs/office-server", () => ({
  db: () => ({ from: (t: string) => fromMock(t), rpc: (fn: string, args: unknown) => rpcMock(fn, args) }),
  shopId: () => SHOP,
}));

import { loadJobGemsSummary } from "./gems-server";

function tableRows(rows: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order"]) chain[k] = (...a: unknown[]) => (selectMock(k, ...a), chain);
  chain.limit = () => Promise.resolve({ data: rows, error });
  fromMock.mockReturnValue(chain);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadJobGemsSummary", () => {
  it("state มาจาก RPC job_gem_state (ส่ง shop + ใบแม่) · แถวมาจาก job_gem_bom (ฉลาก snapshot) · qtyTotal = ต่อชิ้น × จำนวนเริ่มผลิต", async () => {
    tableRows([{ gem_label: "โกเมน · ไข่ · 4×6 มม.", qty_per_piece: 2, position_note: "บ่า", line_seq: 1 }]);
    rpcMock.mockResolvedValue({ data: "specified", error: null });
    const r = await loadJobGemsSummary(ROOT, 3);
    expect(rpcMock).toHaveBeenCalledWith("job_gem_state", { p_shop_id: SHOP, p_root_job_id: ROOT });
    expect(fromMock).toHaveBeenCalledWith("job_gem_bom");
    expect(r).toEqual({ state: "specified", gems: [{ label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 6, position: "บ่า" }] });
  });

  it("ไม่มีแถว + DB ว่า unspecified / not_needed → ตาม DB ตรงๆ (TS ไม่ตัดสินเอง)", async () => {
    tableRows([]);
    rpcMock.mockResolvedValueOnce({ data: "unspecified", error: null });
    expect((await loadJobGemsSummary(ROOT, 3)).state).toBe("unspecified");
    rpcMock.mockResolvedValueOnce({ data: "not_needed", error: null });
    expect((await loadJobGemsSummary(ROOT, 3)).state).toBe("not_needed");
  });

  it("DB ว่า specified แต่ทุกแถวผิดรูป (ถูกทิ้ง) → ยัง specified (ไม่แปลงเป็น unspecified · N7)", async () => {
    tableRows([{ gem_label: 5, qty_per_piece: 2 }, { gem_label: "x", qty_per_piece: 1.5 }, null]);
    rpcMock.mockResolvedValue({ data: "specified", error: null });
    expect(await loadJobGemsSummary(ROOT, 3)).toEqual({ state: "specified", gems: [] });
  });

  it("อ่านไม่ได้ = throw (ผู้เรียกถือเป็น 'อ่านไม่ได้' ไม่ใช่ 'ไม่มีพลอย'): ตารางล้ม · RPC ล้ม · RPC คืนค่านอก enum", async () => {
    tableRows(null, new Error("boom"));
    rpcMock.mockResolvedValue({ data: "specified", error: null });
    await expect(loadJobGemsSummary(ROOT, 3)).rejects.toThrow();
    tableRows([]);
    rpcMock.mockResolvedValue({ data: null, error: new Error("rpc down") });
    await expect(loadJobGemsSummary(ROOT, 3)).rejects.toThrow();
    rpcMock.mockResolvedValue({ data: "weird", error: null });
    await expect(loadJobGemsSummary(ROOT, 3)).rejects.toThrow();
  });

  it("ผลลัพธ์ไม่มีฟิลด์ราคา/ผู้สร้าง/ที่มา (ไม่ select ตารางแคตตาล็อก/ราคา)", async () => {
    tableRows([{ gem_label: "โกเมน · ไข่ · 4×6 มม.", qty_per_piece: 2, position_note: null, line_seq: 1, price: 7391.2468 }]);
    rpcMock.mockResolvedValue({ data: "specified", error: null });
    const r = await loadJobGemsSummary(ROOT, 1);
    expect(Object.keys(r.gems[0]).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual(["job_gem_bom"]);
  });
});
