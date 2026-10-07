// lib/actions/oem-set-customer.test.ts — 0164 setQuoteCustomer (server action ของ oem_quote_set_customer)
//   - ด่านสิทธิ์ (staff) · ด่านรูปร่างก่อนถึง RPC (ยาว/control/bidi) · payload ของ RPC key ต่อ key
//   - ส่งว่าง = null (ล้างค่า) · 22023 จาก DB แสดงข้อความไทยตรงๆ · error อื่นไม่รั่ว raw message
//   - ตัวช่วยฝั่ง UI: customerTextIssue / contactFromBilling (ใช้ร่วมกับ CustomerDialog "ดึงจากข้อมูลออกบิล")
// pattern mock เดียวกับ lib/actions/oem.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidateMock(p) }));

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: "quote-1", error: null });
});

describe("setQuoteCustomer", () => {
  it("เรียก oem_quote_set_customer ใน schema analytics ด้วย payload ครบ 4 key (key ต่อ key) + revalidate", async () => {
    const { setQuoteCustomer } = await import("./oem");
    const r = await setQuoteCustomer({ quoteId: "quote-1", customerName: "  บริษัท ทดสอบ จำกัด ", customerContact: " LINE: @test " });
    expect(r).toEqual({ ok: true, data: { quoteId: "quote-1" } });
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("oem_quote_set_customer", {
      p_shop_id: "shop-1",
      p_quote_id: "quote-1",
      p_customer_name: "บริษัท ทดสอบ จำกัด",
      p_customer_contact: "LINE: @test",
    });
    expect(revalidateMock).toHaveBeenCalledWith("/oem/quotes");
  });

  it("ส่งว่าง/เว้นวรรค/null = ส่ง null ไปล้างค่า (ไม่ใช่ข้ามหรือคงค่าเดิม)", async () => {
    const { setQuoteCustomer } = await import("./oem");
    await setQuoteCustomer({ quoteId: "quote-1", customerName: "   ", customerContact: "" });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_customer_name: null, p_customer_contact: null });
    rpcMock.mockClear();
    await setQuoteCustomer({ quoteId: "quote-1" });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_customer_name: null, p_customer_contact: null });
  });

  it("ไม่ส่ง key อื่นเกิน 4 ตัวไปที่ RPC (ไม่มีทางแตะเงิน/สถานะจาก action นี้ แม้ caller ยัดมาเกิน)", async () => {
    const { setQuoteCustomer } = await import("./oem");
    await setQuoteCustomer({
      quoteId: "quote-1",
      customerName: "x",
      // @ts-expect-error — SetQuoteCustomerInput ไม่มี field พวกนี้ · จำลอง caller ที่ข้าม type
      status: "won",
      grandTotal: 1,
      discountThb: 999,
    });
    expect(Object.keys(rpcMock.mock.calls[0][1]).sort()).toEqual(["p_customer_contact", "p_customer_name", "p_quote_id", "p_shop_id"]);
  });

  it("staff แก้ไม่ได้ — ก่อนถึง RPC", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { setQuoteCustomer } = await import("./oem");
    const r = await setQuoteCustomer({ quoteId: "quote-1", customerName: "x" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ไม่มี quoteId → ปฏิเสธก่อนถึง RPC", async () => {
    const { setQuoteCustomer } = await import("./oem");
    const r = await setQuoteCustomer({ quoteId: "", customerName: "x" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ชื่อยาว 201", { customerName: "ก".repeat(201) }],
    ["ช่องทางยาว 201", { customerContact: "x".repeat(201) }],
    ["ชื่อมี newline", { customerName: "a\nb" }],
    ["ช่องทางมี tab", { customerContact: "a\tb" }],
    ["ชื่อมี control 0x01", { customerName: "a\u0001b" }],
    ["ชื่อมี RLO", { customerName: "ชื่อ‮ปลอม" }],
    ["ชื่อมี zero-width", { customerName: "ชื่อ​ลับ" }],
    ["ช่องทางมี BOM กลางข้อความ", { customerContact: "li﻿ne" }],
  ])("ปฏิเสธก่อนถึง RPC: %s", async (_label, over) => {
    const { setQuoteCustomer } = await import("./oem");
    const r = await setQuoteCustomer({ quoteId: "quote-1", ...over });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toBe("บันทึกข้อมูลลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง"); // ต้องบอกสาเหตุ
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ขอบ: 200 ตัวอักษรพอดีผ่าน · ตัวอักษรไทย/จีน/อัญประกาศผ่าน (ต้องไม่พัง)", async () => {
    const { setQuoteCustomer } = await import("./oem");
    expect((await setQuoteCustomer({ quoteId: "q", customerName: "ก".repeat(200), customerContact: "x".repeat(200) })).ok).toBe(true);
    expect((await setQuoteCustomer({ quoteId: "q", customerName: "山田 José O'Brien \"ABC\" & Co.", customerContact: "081-234-5678 / line:@a_b" })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("22023 จาก DB (ใบปิดแล้ว) → ข้อความไทยของด่านแสดงตรงๆ", async () => {
    const msg = "oem_quote_set_customer: ใบที่ปิด/ยกเลิกแล้วแก้ข้อมูลลูกค้าไม่ได้ (ใบนี้สถานะ lost)";
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: msg } });
    const { setQuoteCustomer } = await import("./oem");
    expect(await setQuoteCustomer({ quoteId: "quote-1", customerName: "x" })).toEqual({ ok: false, error: msg });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("error อื่น (ใบไม่พบ/ระบบล่ม) → ข้อความทั่วไป ไม่รั่ว raw message ของ DB", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "oem_quote_set_customer: quote abc not found for this shop" } });
    const { setQuoteCustomer } = await import("./oem");
    expect(await setQuoteCustomer({ quoteId: "quote-1", customerName: "x" })).toEqual({
      ok: false,
      error: "บันทึกข้อมูลลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง",
    });
  });

  it("RPC throw (เครือข่ายล่ม) → ข้อความทั่วไป", async () => {
    rpcMock.mockRejectedValue(new Error("socket hang up"));
    const { setQuoteCustomer } = await import("./oem");
    expect(await setQuoteCustomer({ quoteId: "quote-1", customerName: "x" })).toEqual({
      ok: false,
      error: "บันทึกข้อมูลลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง",
    });
  });
});

describe("customerTextIssue / contactFromBilling (CustomerDialog)", () => {
  it("customerTextIssue: ว่าง/null/เว้นวรรค = ใช้ได้ (ล้างค่า)", async () => {
    const { customerTextIssue } = await import("@/lib/oem/display");
    expect(customerTextIssue(null, "ชื่อลูกค้า")).toBeNull();
    expect(customerTextIssue("   ", "ชื่อลูกค้า")).toBeNull();
    expect(customerTextIssue("ร้าน ABC", "ชื่อลูกค้า")).toBeNull();
  });

  it("customerTextIssue: ข้อความบอกว่าช่องไหนผิด", async () => {
    const { customerTextIssue } = await import("@/lib/oem/display");
    expect(customerTextIssue("a\nb", "ชื่อลูกค้า")).toMatch(/^ชื่อลูกค้า/);
    expect(customerTextIssue("x".repeat(201), "ช่องทางติดต่อ")).toMatch(/^ช่องทางติดต่อ.*200/);
  });

  it("contactFromBilling: เบอร์ + ช่องทางต่อกันด้วย ' / ' ข้ามช่องว่าง", async () => {
    const { contactFromBilling } = await import("@/lib/oem/display");
    expect(contactFromBilling("0812345678", "LINE @a")).toBe("0812345678 / LINE @a");
    expect(contactFromBilling("0812345678", null)).toBe("0812345678");
    expect(contactFromBilling("  ", "LINE @a")).toBe("LINE @a");
    expect(contactFromBilling(null, undefined)).toBe("");
  });
});
