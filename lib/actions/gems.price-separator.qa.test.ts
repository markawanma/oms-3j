// QA R2-D2 (22 ต.ค. 69) re-QA: ตัวคั่นอื่นนอกจาก "," ASCII ในช่องราคาพลอย — ต้องไม่ถูกตีเป็นราคาอื่นเงียบๆ ทั้งจอ (priceIssue) และ action (setGemPrice)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const ITEM = "22222222-2222-4222-8222-222222222222";
const rpcMock = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => Promise.resolve("owner") }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => Promise.resolve({ id: USER, email: "o@example.test" }), requireSessionIfGateOn: () => Promise.resolve() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: () => ({}) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs/gems-server", () => ({ loadJobGemsSummary: vi.fn() }));

import { setGemPrice } from "./gems";

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: { effective_from: "2026-10-22", replaced: false }, error: null });
});

// ตัวคั่น/ตัวเลขนอก ASCII ที่ผู้ใช้อาจพิมพ์/วางมา: จุลภาคเต็มความกว้าง · จุลภาคอาหรับ · จุดทศนิยมอาหรับ · เลขเต็มความกว้าง · เลขไทย · ช่องว่างคั่นหลักพัน · เลขยกกำลัง · ยกเว้น + นำหน้า
const WEIRD = ["1，250", "1،250", "1٫5", "１２５０", "๑๒๕๐", "1 250", "1\u00A0250", "1e3", "+5", "1_000", "0x10", "١٢٣"];

describe("ช่องราคาพลอย: ตัวคั่น/ตัวเลขแปลก", () => {
  it.each(WEIRD)("action: %j ถูกปฏิเสธก่อนถึง DB", async (p) => {
    const r = await setGemPrice({ itemId: ITEM, price: p });
    expect(r.ok, p).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ราคาที่ถูกต้องผ่านทั้งจอและ action: 1000 · 12.50 · 0.0001 · ' 7391.2468 '", async () => {
    for (const p of ["1000", "12.50", "0.0001", " 7391.2468 "]) {
      const r = await setGemPrice({ itemId: ITEM, price: p });
      expect(r.ok, p).toBe(true);
    }
    expect(rpcMock.mock.calls.map((c) => c[1].p_price)).toEqual([1000, 12.5, 0.0001, 7391.2468]);
  });
  it("price เป็น number: ผ่านเฉพาะค่าจำกัด · NaN/Infinity/ติดลบ/0 ถูกปฏิเสธ", async () => {
    for (const n of [Number.NaN, Infinity, -5, 0, 1_000_000.01]) expect((await setGemPrice({ itemId: ITEM, price: n })).ok, String(n)).toBe(false);
    expect((await setGemPrice({ itemId: ITEM, price: 1250 })).ok).toBe(true);
  });
});
