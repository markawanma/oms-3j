// lib/actions/oem-invoice.test.ts — server actions ของใบแจ้งหนี้ OEM (0179)
//   setSellerPaymentLines · issueInvoice · voidInvoice · getInvoice · getSellerProfile (paymentLines: null vs [])
//   - ด่านสิทธิ์ (staff) · ด่านรูปร่างก่อนถึง RPC · payload ของ RPC key ต่อ key
//   - 🔴 ไม่มี field จำนวนเงินไปถึง RPC แม้ caller ยัดมา (client ส่งยอดเองไม่ได้)
//   - actor มาจาก session ฝั่ง server เท่านั้น (input ปลอม actor ไม่ได้ · ไม่มี session = ปฏิเสธ ไม่ยิง RPC)
//   - hint ของ DB -> ข้อความไทย · error อื่น/hint ที่ไม่รู้จักไม่รั่ว raw message · log ไม่มี PII
// pattern mock เดียวกับ lib/actions/oem-set-customer.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const getSessionUserMock = vi.fn();
const rpcMock = vi.fn();
const revalidateMock = vi.fn();
const maybeSingleMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUserMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({
      rpc: rpcMock,
      from: (table: string) => {
        const b = {
          select: (cols: string) => {
            selectMock(table, cols);
            return b;
          },
          eq: () => b,
          maybeSingle: () => maybeSingleMock(table, selectMock.mock.calls.at(-1)?.[1]),
        };
        return b;
      },
    }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidateMock(p) }));

const Q = "11111111-1111-4111-8111-111111111111";
const INV = "22222222-2222-4222-8222-222222222222";
const REPL = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const ZWSP = String.fromCharCode(8203);

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  getSessionUserMock.mockResolvedValue({ id: ACTOR });
  rpcMock.mockResolvedValue({ data: { id: INV, invoice_no: "IV-2610-001" }, error: null });
});

describe("issueInvoice", () => {
  it("เรียก oem_invoice_issue ด้วย payload 7 key เป๊ะ (ไม่มี key ยอดเงิน) · actor จาก session · คืน {id, invoiceNo} · revalidate /oem/invoices", async () => {
    const { issueInvoice } = await import("./oem");
    const r = await issueInvoice({ quoteId: Q, kind: "deposit", dueDate: "2026-10-20", note: "  ขอบคุณลูกค้า ", replacesInvoiceId: REPL });
    expect(r).toEqual({ ok: true, data: { id: INV, invoiceNo: "IV-2610-001" } });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("oem_invoice_issue", {
      p_shop_id: "shop-1",
      p_quote_id: Q,
      p_kind: "deposit",
      p_due_date: "2026-10-20",
      p_note: "ขอบคุณลูกค้า",
      p_replaces_invoice_id: REPL,
      p_actor_id: ACTOR,
    });
    expect(Object.keys(rpcMock.mock.calls[0][1]).sort()).toEqual(
      ["p_actor_id", "p_due_date", "p_kind", "p_note", "p_quote_id", "p_replaces_invoice_id", "p_shop_id"]
    );
    expect(revalidateMock).toHaveBeenCalledWith("/oem/invoices");
  });

  it("🔴 caller ยัดยอดเงิน/actor/ผู้ออกมาเกิน type -> ไม่ไปถึง RPC (ยอดมาจาก DB เสมอ · actor มาจาก session)", async () => {
    const { issueInvoice } = await import("./oem");
    await issueInvoice({
      quoteId: Q,
      kind: "balance",
      // @ts-expect-error — IssueInvoiceInput ไม่มี field พวกนี้โดยตั้งใจ · จำลอง caller ที่ข้าม type
      amountThb: 1,
      amount: 1,
      p_amount_thb: 1,
      actorId: "attacker",
      p_actor_id: "attacker",
      createdBy: "attacker",
    });
    const payload = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).some((k) => /amount|thb|total|price/i.test(k))).toBe(false);
    expect(payload.p_actor_id).toBe(ACTOR);
    expect(JSON.stringify(payload)).not.toContain("attacker");
  });

  it("ไม่ส่ง due/note/replaces = ส่ง null (ให้ DB ใช้ค่าเริ่มตามมติ)", async () => {
    const { issueInvoice } = await import("./oem");
    await issueInvoice({ quoteId: Q, kind: "balance" });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_due_date: null, p_note: null, p_replaces_invoice_id: null });
  });

  it("staff ออกไม่ได้ — ก่อนถึง RPC", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { issueInvoice } = await import("./oem");
    expect((await issueInvoice({ quoteId: Q, kind: "deposit" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ไม่มี session (actor) = ปฏิเสธ ไม่ยิง RPC (เอกสารการเงินต้องรู้ผู้ออก)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { issueInvoice } = await import("./oem");
    const r = await issueInvoice({ quoteId: Q, kind: "deposit" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    getSessionUserMock.mockRejectedValue(new Error("session boom"));
    expect((await issueInvoice({ quoteId: Q, kind: "deposit" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ด่านรูปร่างก่อนถึง RPC: quoteId ผิด · kind นอก 2 ค่า · วันที่ไม่จริง/ผิดรูป · note ล่องหน/วรรคตอนล้วน/control · replaces ไม่ใช่ uuid", async () => {
    const { issueInvoice } = await import("./oem");
    const bad = [
      { quoteId: "", kind: "deposit" },
      { quoteId: "not-a-uuid", kind: "deposit" },
      { quoteId: Q, kind: "final" },
      { quoteId: Q, kind: "installment" },
      { quoteId: Q, kind: "deposit", dueDate: "2026-02-31" },
      { quoteId: Q, kind: "deposit", dueDate: "20/10/2026" },
      { quoteId: Q, kind: "deposit", note: ZWSP },
      { quoteId: Q, kind: "deposit", note: "...." },
      { quoteId: Q, kind: "deposit", note: "a" + String.fromCharCode(1) },
      { quoteId: Q, kind: "deposit", note: "ก".repeat(501) },
      { quoteId: Q, kind: "deposit", replacesInvoiceId: "x" },
    ];
    for (const b of bad) {
      const r = await issueInvoice(b as never);
      expect(r.ok, JSON.stringify(b)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("22023 + hint ที่รู้จัก -> ข้อความไทยของด่านนั้น (ไม่ใช่ข้อความดิบของ DB)", async () => {
    const { issueInvoice } = await import("./oem");
    const cases: Array<[string, string]> = [
      ["invoice_open", "ใบแจ้งหนี้ที่ยังเปิดค้าง"],
      ["payment_lines_empty", "ช่องทางชำระเงิน"],
      ["deposit_unpaid", "ยังไม่ได้รับมัดจำ"],
      ["quote_status_invalid", "ออกใบแจ้งหนี้ได้เฉพาะ"],
      ["buyer_incomplete", "ผู้ซื้อ"],
      ["due_invalid", "วันกำหนดชำระ"],
      ["actor_required", "ผู้ใช้"],
    ];
    for (const [hint, frag] of cases) {
      rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint, message: "RAW-DB-MESSAGE-" + hint } });
      const r = await issueInvoice({ quoteId: Q, kind: "deposit" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain(frag);
        expect(r.error).not.toContain("RAW-DB-MESSAGE");
      }
    }
  });

  it("22023 แต่ hint ไม่รู้จัก -> ข้อความกลาง ไม่รั่วข้อความดิบ", async () => {
    const { issueInvoice } = await import("./oem");
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "brand_new_gate", message: "RAW-DB-MESSAGE" } });
    const r = await issueInvoice({ quoteId: Q, kind: "deposit" });
    expect(r).toEqual({ ok: false, error: "ทำรายการใบแจ้งหนี้ไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });

  it("error อื่น (ไม่ใช่ 22023) -> ข้อความกลาง · log เฉพาะ code+message ไม่ log ทั้งก้อน/ไม่มี input", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "violates check constraint", details: "Failing row contains (PII-ชื่อลูกค้า)", hint: null } });
    const { issueInvoice } = await import("./oem");
    const r = await issueInvoice({ quoteId: Q, kind: "deposit", note: "NOTE-ลับ" });
    expect(r).toEqual({ ok: false, error: "ออกใบแจ้งหนี้ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    const logged = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("issueInvoice failed");
    expect(logged).toContain("23514");
    expect(logged).not.toContain("PII-ชื่อลูกค้า");
    expect(logged).not.toContain("NOTE-ลับ");
    spy.mockRestore();
  });

  it("ผลลัพธ์ RPC ผิดรูป (ไม่มี invoice_no) -> ล้มแบบปลอดภัย ไม่คืน id ครึ่งๆ", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({ data: { id: INV }, error: null });
    const { issueInvoice } = await import("./oem");
    expect((await issueInvoice({ quoteId: Q, kind: "deposit" })).ok).toBe(false);
    spy.mockRestore();
  });
});

describe("voidInvoice", () => {
  it("เรียก oem_invoice_void ด้วย payload 4 key · actor จาก session · เหตุผล trim แล้ว", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { voidInvoice } = await import("./oem");
    const r = await voidInvoice({ invoiceId: INV, reason: "  ลูกค้าโอนยอดต่าง  " });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(rpcMock).toHaveBeenCalledWith("oem_invoice_void", { p_shop_id: "shop-1", p_invoice_id: INV, p_reason: "ลูกค้าโอนยอดต่าง", p_actor_id: ACTOR });
    expect(revalidateMock).toHaveBeenCalledWith("/oem/invoices");
  });

  it("เหตุผล: ว่าง/เว้นวรรค/ล่องหน/วรรคตอนล้วน/control/>500 ถูกปฏิเสธก่อนถึง RPC · staff / ไม่มี actor / id ผิด ก็ไม่ถึง", async () => {
    const { voidInvoice } = await import("./oem");
    for (const reason of ["", "   ", ZWSP, "....", "a" + String.fromCharCode(1), "ก".repeat(501)]) {
      expect((await voidInvoice({ invoiceId: INV, reason })).ok, JSON.stringify(reason)).toBe(false);
    }
    expect((await voidInvoice({ invoiceId: "x", reason: "ทดสอบ" })).ok).toBe(false);
    getSessionUserMock.mockResolvedValueOnce(null);
    expect((await voidInvoice({ invoiceId: INV, reason: "ทดสอบ" })).ok).toBe(false);
    getEffectiveRoleMock.mockResolvedValueOnce("staff");
    expect((await voidInvoice({ invoiceId: INV, reason: "ทดสอบ" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("hint invoice_paid / invoice_not_issued -> ข้อความไทย", async () => {
    const { voidInvoice } = await import("./oem");
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "invoice_paid", message: "RAW" } });
    const r1 = await voidInvoice({ invoiceId: INV, reason: "ทดสอบ" });
    expect(r1.ok === false && r1.error).toContain("ถูกชำระแล้ว");
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "invoice_not_issued", message: "RAW" } });
    const r2 = await voidInvoice({ invoiceId: INV, reason: "ทดสอบ" });
    expect(r2.ok === false && r2.error).toContain("ยังไม่ถูกยกเลิก");
  });
});

describe("setSellerPaymentLines", () => {
  it("เรียก oem_setting_set_payment_lines ด้วย p_shop_id/p_lines/p_actor_id · trim + ตัดแถวว่าง · revalidate", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { setSellerPaymentLines } = await import("./oem");
    const r = await setSellerPaymentLines({ lines: ["  TEST-ONLY ช่องทาง 1 ", "", "   ", "TEST-ONLY ช่องทาง 2"] });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(rpcMock).toHaveBeenCalledWith("oem_setting_set_payment_lines", { p_shop_id: "shop-1", p_lines: ["TEST-ONLY ช่องทาง 1", "TEST-ONLY ช่องทาง 2"], p_actor_id: ACTOR });
    expect(revalidateMock).toHaveBeenCalledWith("/oem/rates");
  });

  it("ส่ง [] / แถวว่างล้วน = ล้างค่า (ส่ง array ว่างไป DB)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { setSellerPaymentLines } = await import("./oem");
    await setSellerPaymentLines({ lines: [] });
    await setSellerPaymentLines({ lines: ["", "  "] });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_lines: [] });
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_lines: [] });
  });

  it("ด่านรูปร่าง: ไม่ใช่ array · มีที่ไม่ใช่ string · 7 บรรทัด · 201 ตัวอักษร · ล่องหน/วรรคตอนล้วน/ขึ้นบรรทัดใหม่/control ถูกปฏิเสธก่อนถึง RPC", async () => {
    const { setSellerPaymentLines } = await import("./oem");
    const bad: unknown[] = [
      null,
      "TEST-ONLY",
      [1, "TEST-ONLY"],
      Array.from({ length: 7 }, (_, i) => "TEST-ONLY " + i),
      ["ก".repeat(201)],
      [ZWSP],
      ["...."],
      ["TEST-ONLY a\nb"],
      ["a" + String.fromCharCode(1)],
    ];
    for (const lines of bad) {
      const r = await setSellerPaymentLines({ lines } as never);
      expect(r.ok, JSON.stringify(lines)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("200 ตัวอักษรพอดีผ่าน · 6 บรรทัดพอดีผ่าน", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { setSellerPaymentLines } = await import("./oem");
    expect((await setSellerPaymentLines({ lines: ["ก".repeat(200)] })).ok).toBe(true);
    expect((await setSellerPaymentLines({ lines: Array.from({ length: 6 }, (_, i) => "TEST-ONLY " + i) })).ok).toBe(true);
  });

  it("staff / ไม่มี actor ไม่ถึง RPC", async () => {
    const { setSellerPaymentLines } = await import("./oem");
    getEffectiveRoleMock.mockResolvedValueOnce("staff");
    expect((await setSellerPaymentLines({ lines: ["TEST-ONLY"] })).ok).toBe(false);
    getSessionUserMock.mockResolvedValueOnce(null);
    expect((await setSellerPaymentLines({ lines: ["TEST-ONLY"] })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

function rawInvoice(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INV, shop_id: "shop-1", quote_id: Q, invoice_no: "IV-2610-001", kind: "deposit", status: "issued", amount_thb: "5000.51",
    vat_display: "breakdown", vat_rate: "0.0700", vat_base_thb: "4673.37", vat_amount_thb: "327.14", issue_date: "2026-10-16", due_date: "2026-10-16",
    pay_before_work: true, description: "เงินมัดจำ 50% ตามใบเสนอราคา OEM-2610-004", note: null,
    seller_snapshot: { legal_name: "ร้านทดสอบ", display_name: "POISON-DISPLAY", branch_label: null, address_lines: ["1 ถนนทดสอบ"], tax_id: null, phone: null, vat_registered: true },
    payment_lines: ["TEST-ONLY บัญชีทดสอบ"], buyer_legal_name: "ผู้ซื้อทดสอบ", buyer_tax_id: null, buyer_branch_label: null, buyer_address: null,
    quote_no_snapshot: "OEM-2610-004",
    lines_snapshot: [{ seq: 1, name: "สินค้าทดสอบ", sku: null, qty: 2, unit_price_thb: 5000.505, line_total_thb: 10001.01, cost: 777.77 }],
    pieces_subtotal_snapshot: "10001.01", nre_price_snapshot: "0.00", discount_thb_snapshot: "0.00", grand_total_snapshot: "10001.01",
    deposit_amount_snapshot: "5000.51", deposit_pct_snapshot: "0.5000", paid_before_thb: "0.00", balance_after_thb: "5000.50",
    void_reason: null, voided_at: null, replaces_invoice_id: null, created_at: "2026-10-16T01:00:00Z",
    quote_no: "OEM-2610-004", quote_status: "quoted", deal_root_id: Q, is_deal_active: true, active_quote_id: Q, deal_quote_no: "OEM-2610-004",
    deal_quote_status: "quoted", deal_grand_total: "10001.01", deal_paid_thb: "0", quote_valid_until: "2026-11-15", deal_quote_expired: false,
    payment_state: "unpaid", is_stale: false, is_overdue: false, receipt_id: null, receipt_no: null, received_date: null,
    ...over,
  };
}

describe("getInvoice", () => {
  it("map v_oem_invoice -> OemInvoiceRow ทีละ field · numeric (string) -> number · คีย์วางยาในบรรทัดรายการถูกทิ้ง", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: rawInvoice(), error: null });
    const { getInvoice } = await import("./oem");
    const r = await getInvoice(INV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ id: INV, invoiceNo: "IV-2610-001", kind: "deposit", amountThb: 5000.51, vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14, payBeforeWork: true, paymentState: "unpaid", activeQuoteId: Q, dealPaidThb: 0 });
    expect(r.data.lines).toEqual([{ seq: 1, name: "สินค้าทดสอบ", sku: null, qty: 2, unitPriceThb: 5000.505, lineTotalThb: 10001.01 }]);
    expect(JSON.stringify(r.data)).not.toContain("777.77");
    expect(selectMock.mock.calls[0][0]).toBe("v_oem_invoice");
    expect(String(selectMock.mock.calls[0][1])).not.toMatch(/created_by|voided_by|cost|margin|calc|approval/);
  });

  it("vat_display = none -> vatRate/base/amount เป็น null แม้ DB ส่งค่ามา", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: rawInvoice({ vat_display: "none", vat_rate: "0.07", vat_base_thb: "1", vat_amount_thb: "2" }), error: null });
    const { getInvoice } = await import("./oem");
    const r = await getInvoice(INV);
    expect(r.ok && r.data.vatRate).toBeNull();
    expect(r.ok && r.data.vatBaseThb).toBeNull();
    expect(r.ok && r.data.vatAmountThb).toBeNull();
  });

  it("ไม่พบ / id ผิดรูป / staff -> ข้อความไทย · แถวผิดรูป (enum แปลก/บรรทัดรายการเสีย) -> fail closed ไม่คืนใบครึ่งๆ", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getInvoice } = await import("./oem");
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await getInvoice(INV)).toEqual({ ok: false, error: "ไม่พบใบแจ้งหนี้นี้" });
    expect((await getInvoice("nope")).ok).toBe(false);
    getEffectiveRoleMock.mockResolvedValueOnce("staff");
    expect((await getInvoice(INV)).ok).toBe(false);
    maybeSingleMock.mockResolvedValueOnce({ data: rawInvoice({ kind: "installment" }), error: null });
    expect((await getInvoice(INV)).ok).toBe(false);
    maybeSingleMock.mockResolvedValueOnce({ data: rawInvoice({ lines_snapshot: [{ seq: 1, name: "x", qty: 1, unit_price_thb: "abc", line_total_thb: 1 }] }), error: null });
    expect((await getInvoice(INV)).ok).toBe(false);
    spy.mockRestore();
  });
});

describe("getSellerProfile — paymentLines: null (อ่านไม่ได้) ต่างจาก [] (อ่านได้แต่ว่าง)", () => {
  const mainRow = {
    seller_legal_name: "ร้านทดสอบ", seller_branch_label: null, seller_address_lines: ["1 ถนนทดสอบ"], seller_tax_id: null,
    seller_vat_registered: true, seller_phone: null, seller_line: null, seller_email: null, seller_website: null, seller_terms: [],
  };
  const isPaymentQuery = (_t: string, cols: unknown) => String(cols) === "seller_payment_lines";

  function mockQueries(payment: () => unknown) {
    maybeSingleMock.mockImplementation(async (t: string, cols: unknown) => (isPaymentQuery(t, cols) ? payment() : { data: mainRow, error: null }));
  }

  it("อ่านได้และมีค่า -> array เดิม (ตัดบรรทัดว่าง)", async () => {
    mockQueries(() => ({ data: { seller_payment_lines: ["TEST-ONLY a", "  ", "TEST-ONLY b"] }, error: null }));
    const { getSellerProfile } = await import("./oem");
    const r = await getSellerProfile();
    expect(r.ok && r.data.paymentLines).toEqual(["TEST-ONLY a", "TEST-ONLY b"]);
  });

  it("อ่านได้แต่ว่าง ({}) -> []  (ไม่ใช่ null)", async () => {
    mockQueries(() => ({ data: { seller_payment_lines: [] }, error: null }));
    const { getSellerProfile } = await import("./oem");
    const r = await getSellerProfile();
    expect(r.ok && r.data.paymentLines).toEqual([]);
  });

  it("query ช่องทางชำระล้ม (คอลัมน์ยังไม่มี/schema cache) -> null แต่ข้อมูลร้านส่วนอื่นยังโหลดได้ (ไม่ล่มทั้งหน้า)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQueries(() => ({ data: null, error: { code: "42703", message: 'column "seller_payment_lines" does not exist' } }));
    const { getSellerProfile } = await import("./oem");
    const r = await getSellerProfile();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.paymentLines).toBeNull();
      expect(r.data.legalName).toBe("ร้านทดสอบ");
    }
    spy.mockRestore();
  });

  it("แถวมาแต่ไม่มีคอลัมน์ (ไม่ใช่ array) -> null · ไม่มีแถวร้านเลย -> []", async () => {
    const { getSellerProfile } = await import("./oem");
    mockQueries(() => ({ data: {}, error: null }));
    expect((await getSellerProfile()).ok && ((await getSellerProfile()) as { data: { paymentLines: unknown } }).data.paymentLines).toBeNull();
    mockQueries(() => ({ data: null, error: null }));
    const r = await getSellerProfile();
    expect(r.ok && r.data.paymentLines).toEqual([]);
  });
});
