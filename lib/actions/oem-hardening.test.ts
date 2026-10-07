// lib/actions/oem-hardening.test.ts — 0165 (security ตรวจย้อนหลัง 0163/0164)
//   M2  p_actor_id: มาจาก session ฝั่ง server เท่านั้น · ไม่มี session = ไม่ส่ง key · input ที่ยัด actor มาถูกเมิน
//   L1  saveQuote ผ่านด่านชื่อ/ช่องทางติดต่อเดียวกับ DB (ล่องหน/bidi/ยาว) · ชื่อไทย/อังกฤษ/อีโมจิ ZWJ ต้องผ่าน
//   L2  เหตุผลราคาพิเศษที่มีแต่อักขระล่องหน = ไม่มีเหตุผล · ฝังอักขระล่องหนในเหตุผลที่ปกติ = ถูกลบก่อนส่ง
//   L6  ค่าที่ไม่ใช่ string/number จาก caller ที่ข้าม type → ข้อความไทย ไม่ใช่ throw/500
// pattern mock เดียวกับ lib/actions/oem-bar-override.test.ts (+ getSessionUser ที่ปรับได้ต่อเทสต์)
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const getSessionUserMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUserMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SESSION_USER = "11111111-1111-4111-8111-111111111111";
const FORGED_USER = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  getSessionUserMock.mockResolvedValue({ id: SESSION_USER, email: "owner@example.test" });
  rpcMock.mockResolvedValue({ data: "quote-1", error: null });
});

const bar = (over: Record<string, unknown> = {}) => ({
  metal: "silver999" as const,
  barSize: "1_baht" as const,
  qty: 2,
  engraveImageThb: null,
  engraveTextThb: null,
  ...over,
});

const ZWJ = "\u200D";
const FAMILY = "👨" + ZWJ + "👩" + ZWJ + "👧";

describe("M2 — p_actor_id มาจาก session ฝั่ง server เท่านั้น", () => {
  it("saveQuote: มี session → ส่ง p_actor_id = id ของ session user", async () => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: bar() }], status: "draft" });
    expect(r.ok).toBe(true);
    expect(rpcMock.mock.calls[0][0]).toBe("oem_quote_save");
    expect(rpcMock.mock.calls[0][1].p_actor_id).toBe(SESSION_USER);
  });

  it("setQuoteCustomer: มี session → ส่ง p_actor_id = id ของ session user (key ครบ 5)", async () => {
    const { setQuoteCustomer } = await import("./oem");
    const r = await setQuoteCustomer({ quoteId: "quote-1", customerName: "ร้าน ABC", customerContact: "LINE @a" });
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("oem_quote_set_customer", {
      p_shop_id: "shop-1",
      p_quote_id: "quote-1",
      p_customer_name: "ร้าน ABC",
      p_customer_contact: "LINE @a",
      p_actor_id: SESSION_USER,
    });
  });

  it("🔴 client ยัด actor ปลอมมาใน input (หลายชื่อ/หลายระดับ) → ถูกเมิน ใช้ id ของ session เท่านั้น", async () => {
    const { saveQuote, setQuoteCustomer } = await import("./oem");
    await saveQuote({
      items: [{ input: bar() }],
      status: "draft",
      // @ts-expect-error — SaveQuoteInput ไม่มี field พวกนี้ · จำลอง caller ที่ข้าม type
      actorId: FORGED_USER,
      p_actor_id: FORGED_USER,
      actor: FORGED_USER,
      updatedBy: FORGED_USER,
    });
    expect(rpcMock.mock.calls[0][1].p_actor_id).toBe(SESSION_USER);
    expect(JSON.stringify(rpcMock.mock.calls[0][1])).not.toContain(FORGED_USER);

    rpcMock.mockClear();
    await setQuoteCustomer({
      quoteId: "quote-1",
      customerName: "x",
      // @ts-expect-error — SetQuoteCustomerInput ไม่มี field พวกนี้
      actorId: FORGED_USER,
      p_actor_id: FORGED_USER,
    });
    expect(rpcMock.mock.calls[0][1].p_actor_id).toBe(SESSION_USER);
    expect(JSON.stringify(rpcMock.mock.calls[0][1])).not.toContain(FORGED_USER);
  });

  it("ไม่มี session (AUTH_GATE=off / ยังไม่ล็อกอิน) → ไม่มี key p_actor_id เลย (payload เดิมเป๊ะ — RPC default null)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { saveQuote, setQuoteCustomer } = await import("./oem");
    await saveQuote({ items: [{ input: bar() }], status: "draft" });
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_actor_id");
    rpcMock.mockClear();
    await setQuoteCustomer({ quoteId: "quote-1", customerName: "x" });
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_actor_id");
  });

  it("อ่าน session ล้ม (env ผิด) → บันทึกต่อได้โดยไม่มี p_actor_id (การออกใบต้องไม่พังเพราะเรื่อง audit)", async () => {
    getSessionUserMock.mockRejectedValue(new Error("auth env missing"));
    const { saveQuote, setQuoteCustomer } = await import("./oem");
    expect((await saveQuote({ items: [{ input: bar() }], status: "draft" })).ok).toBe(true);
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_actor_id");
    rpcMock.mockClear();
    expect((await setQuoteCustomer({ quoteId: "quote-1", customerName: "x" })).ok).toBe(true);
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_actor_id");
  });

  it("staff: ไม่ถึง session/RPC เลย (ด่านสิทธิ์เดิม)", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { saveQuote, setQuoteCustomer } = await import("./oem");
    expect((await saveQuote({ items: [{ input: bar() }], status: "draft" })).ok).toBe(false);
    expect((await setQuoteCustomer({ quoteId: "q", customerName: "x" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("L1 — saveQuote ชื่อ/ช่องทางติดต่อผ่านด่านเดียวกับ DB", () => {
  it.each([
    ["ชื่อมี RLO", { customerName: "ชื่อ\u202Eปลอม" }],
    ["ชื่อมี U+061C", { customerName: "a\u061Cb" }],
    ["ชื่อมี U+2028", { customerName: "a\u2028b" }],
    ["ชื่อมี U+E0100 (variation selector supplement)", { customerName: "a" + String.fromCodePoint(0xe0100) + "b" }],
    ["ชื่อมี C1 (U+0085)", { customerName: "a\u0085b" }],
    ["ชื่อมี newline", { customerName: "a\nb" }],
    ["ช่องทางมี zero-width", { customerContact: "li\u200Bne" }],
    ["ช่องทางยาว 201", { customerContact: "x".repeat(201) }],
    ["ชื่อมี ZWJ ติดอักษรไทย (ซ่อนข้อความ)", { customerName: "ก" + ZWJ + "ข" }],
  ])("ปฏิเสธก่อนถึง RPC: %s", async (_l, over) => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: bar() }], status: "draft", ...over });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ต้องไม่พัง: ชื่อไทย / อังกฤษ / อีโมจิ ZWJ ครอบครัว / VS16 / อัญประกาศ ผ่านทุกช่อง", async () => {
    const { saveQuote, setQuoteCustomer } = await import("./oem");
    for (const name of ["บริษัท ทดสอบ จำกัด", "ABC Trading Co., Ltd.", "ครอบครัว " + FAMILY, "รัก ❤️ ร้าน", "José O'Brien \"ABC\""]) {
      expect((await saveQuote({ items: [{ input: bar() }], status: "draft", customerName: name })).ok).toBe(true);
      expect((await setQuoteCustomer({ quoteId: "quote-1", customerName: name })).ok).toBe(true);
    }
    expect(rpcMock).toHaveBeenCalledTimes(10);
  });
});

describe("L2 — เหตุผลราคาพิเศษ", () => {
  it.each([
    ["U+2060 ล้วน", "\u2060\u2060"],
    ["U+FEFF ล้วน", "\uFEFF\uFEFF"],
    ["RLO ล้วน", "\u202E"],
    ["zero-width + เว้นวรรค", " \u200B \u200C "],
  ])("เหตุผลเป็น %s → ปฏิเสธก่อนถึง RPC (ทั้ง calcPrice และ saveQuote)", async (_l, reason) => {
    const { calcPrice, saveQuote } = await import("./oem");
    const input = bar({ barPriceOverrideThb: 1100, barPriceOverrideReason: reason });
    expect((await calcPrice(input)).ok).toBe(false);
    expect((await saveQuote({ items: [{ input }], status: "draft" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("เหตุผลปกติที่ฝังอักขระล่องหน → ส่งไปแบบถูกลบแล้ว (admin ไม่เห็นข้อความเพี้ยน)", async () => {
    const { calcPrice } = await import("./oem");
    rpcMock.mockResolvedValue({ data: { is_complete: false, missing: [], breakdown: {}, floors: {}, warnings: [] }, error: null });
    await calcPrice(bar({ barPriceOverrideThb: 1100, barPriceOverrideReason: "bid\u202E ลูกค้า\u2060 A" }));
    // action ส่งตามที่ผู้ใช้กรอก (DB เป็นผู้ลบ/ตัดสิน) — ที่ขอบ action ตรวจแค่ "ไม่ว่างหลังลบ"
    expect(rpcMock.mock.calls[0][1].p_input.bar_price_override_reason).toContain("bid");
  });

  it("เหตุผลมีอีโมจิ ZWJ → ผ่านด่านที่ขอบ action", async () => {
    const { calcPrice } = await import("./oem");
    rpcMock.mockResolvedValue({ data: { is_complete: false, missing: [], breakdown: {}, floors: {}, warnings: [] }, error: null });
    const r = await calcPrice(bar({ barPriceOverrideThb: 1100, barPriceOverrideReason: "งานครอบครัว " + FAMILY }));
    expect(r.ok).toBe(true);
  });
});

describe("L6 — ค่าที่ไม่ใช่ชนิดที่คาด → ข้อความไทย ไม่ throw", () => {
  const smuggle = (v: unknown) => v as never;

  it.each([
    ["เหตุผลเป็น number", { barPriceOverrideThb: 1100, barPriceOverrideReason: smuggle(123) }],
    ["เหตุผลเป็น object", { barPriceOverrideThb: 1100, barPriceOverrideReason: smuggle({ a: 1 }) }],
    ["ราคาเป็น string", { barPriceOverrideThb: smuggle("1100"), barPriceOverrideReason: "x" }],
    ["เหตุผลเป็น array (ไม่มีราคา)", { barPriceOverrideThb: null, barPriceOverrideReason: smuggle(["x"]) }],
  ])("calcPrice/saveQuote %s → ok:false + ข้อความที่บอกสาเหตุ (ไม่ใช่ throw)", async (_l, over) => {
    const { calcPrice, saveQuote } = await import("./oem");
    const input = bar(over);
    const a = await calcPrice(input);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).not.toMatch(/ไม่สำเร็จ ลองใหม่/);
    const b = await saveQuote({ items: [{ input }], status: "draft" });
    expect(b.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([20261017, { y: 1 }, ["2026-10-17"], true])("barValidUntil ที่ไม่ใช่ string (%j) → ok:false", async (bad) => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: bar() }], status: "draft", barValidUntil: smuggle(bad) });
    expect(r).toEqual({ ok: false, error: "วันยืนราคาไม่ถูกต้อง" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([123, { a: 1 }, true, ["x"]])("setQuoteCustomer: quoteId ที่ไม่ใช่ string (%j) → ok:false ไม่ throw", async (bad) => {
    const { setQuoteCustomer } = await import("./oem");
    const r = await setQuoteCustomer({ quoteId: smuggle(bad), customerName: "x" });
    expect(r).toEqual({ ok: false, error: "ไม่พบใบเสนอราคา" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([123, { a: 1 }, true, ["x"]])("setQuoteCustomer: ชื่อ/ช่องทางที่ไม่ใช่ string (%j) → ok:false ไม่ throw", async (bad) => {
    const { setQuoteCustomer } = await import("./oem");
    expect((await setQuoteCustomer({ quoteId: "q", customerName: smuggle(bad) })).ok).toBe(false);
    expect((await setQuoteCustomer({ quoteId: "q", customerContact: smuggle(bad) })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("input เป็น null/undefined ทั้งก้อน → ok:false", async () => {
    const { setQuoteCustomer, saveQuote } = await import("./oem");
    expect((await setQuoteCustomer(smuggle(null))).ok).toBe(false);
    expect((await setQuoteCustomer(smuggle(undefined))).ok).toBe(false);
    expect((await saveQuote(smuggle(null))).ok).toBe(false);
  });
});
