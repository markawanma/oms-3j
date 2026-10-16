// lib/actions/oem-receipt-invoice.test.ts — ผูกใบเสร็จกับใบแจ้งหนี้ (0180 · phase I2) ฝั่ง server action
//   issueReceipt (invoiceId?) · getReceipt (invoiceId/invoiceNoSnapshot) · hint ของ DB -> ข้อความไทย (รวม 42501 actor_not_member)
//   - ไม่ส่ง invoiceId = payload 9 key เดิมเป๊ะ (ไม่มี p_invoice_id/p_actor_id) — ทำงานได้ทั้งก่อน/หลัง apply 0180
//   - ส่ง invoiceId = payload 11 key · actor มาจาก session เท่านั้น (caller ยัด actor ปลอมไม่ได้) · ไม่มี session = ไม่ยิง RPC
//   - 🔴 ไม่มีการคำนวณ/เดายอดฝั่ง client: ยอดที่ส่งไป = ยอดที่ caller ส่งมา (ผู้เรียกอ่านจาก invoice.amountThb) — DB เป็นด่านเทียบยอดเป๊ะ
// pattern mock เดียวกับ lib/actions/oem-invoice.test.ts
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
const RID = "55555555-5555-4555-8555-555555555555";
const ACTOR = "44444444-4444-4444-8444-444444444444";

const baseInput = { quoteId: Q, amountThb: 5000.51, receivedDate: "2026-10-16", kind: "deposit" as const };

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  getSessionUserMock.mockResolvedValue({ id: ACTOR });
  rpcMock.mockResolvedValue({ data: RID, error: null });
});

describe("issueReceipt — ไม่ผูกใบแจ้งหนี้ (ทางเดิม ต้องไม่เปลี่ยน)", () => {
  it("ไม่มี actor (session อ่านไม่ได้): payload เป็น 9 key เดิมเป๊ะ — ไม่มี p_invoice_id / p_actor_id", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { issueReceipt } = await import("./oem");
    const r = await issueReceipt({ ...baseInput, paymentMethod: "transfer", paymentRef: " ref-1 ", description: "  ทดสอบ ", reissuedFrom: null });
    expect(r).toEqual({ ok: true, data: { receiptId: RID } });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("oem_receipt_issue", {
      p_shop_id: "shop-1",
      p_quote_id: Q,
      p_amount_thb: 5000.51,
      p_received_date: "2026-10-16",
      p_kind: "deposit",
      p_payment_method: "transfer",
      p_payment_ref: "ref-1",
      p_description: "ทดสอบ",
      p_reissued_from: null,
    });
    expect(Object.keys(rpcMock.mock.calls[0][1]).sort()).toEqual(
      ["p_amount_thb", "p_description", "p_kind", "p_payment_method", "p_payment_ref", "p_quote_id", "p_received_date", "p_reissued_from", "p_shop_id"]
    );
    expect(revalidateMock).toHaveBeenCalled();
  });

  it("F3: มี actor จาก session แต่ไม่ผูกใบแจ้งหนี้: ส่ง p_actor_id (10 key · ไม่มี p_invoice_id) · actor ปลอมจาก input ไม่ถูกใช้", async () => {
    const { issueReceipt } = await import("./oem");
    // @ts-expect-error — IssueReceiptInput ไม่มี field actor โดยตั้งใจ · จำลอง caller ข้าม type
    const r = await issueReceipt({ ...baseInput, actorId: "attacker" });
    expect(r.ok).toBe(true);
    const payload = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.p_actor_id).toBe(ACTOR);
    expect(Object.keys(payload)).not.toContain("p_invoice_id");
    expect(Object.keys(payload)).toHaveLength(10);
    expect(JSON.stringify(payload)).not.toContain("attacker");
  });

  it("invoiceId = null / undefined = ทางเดิม · ไม่มี session ก็ออกได้ (ทางเดิมไม่บังคับ actor จนกว่า 0181)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { issueReceipt } = await import("./oem");
    expect((await issueReceipt({ ...baseInput, invoiceId: null })).ok).toBe(true);
    expect((await issueReceipt({ ...baseInput })).ok).toBe(true);
    for (const call of rpcMock.mock.calls) {
      expect(Object.keys(call[1])).not.toContain("p_invoice_id");
      expect(Object.keys(call[1])).not.toContain("p_actor_id");
    }
  });

  it("ด่านเดิมยังอยู่: ยอด NaN/ศูนย์/เกินเพดาน · วันที่ผิดรูป · kind/method นอกรายการ · staff -> ไม่ถึง RPC", async () => {
    const { issueReceipt } = await import("./oem");
    for (const amountThb of [Number.NaN, 0, -1, 100_000_001, Number.POSITIVE_INFINITY]) {
      expect((await issueReceipt({ ...baseInput, amountThb })).ok, String(amountThb)).toBe(false);
    }
    expect((await issueReceipt({ ...baseInput, receivedDate: "16/10/2026" })).ok).toBe(false);
    // @ts-expect-error — kind นอกรายการ (จำลอง caller ข้าม type)
    expect((await issueReceipt({ ...baseInput, kind: "full" })).ok).toBe(false);
    // @ts-expect-error — method นอกรายการ
    expect((await issueReceipt({ ...baseInput, paymentMethod: "card" })).ok).toBe(false);
    getEffectiveRoleMock.mockResolvedValueOnce("staff");
    expect((await issueReceipt(baseInput)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("22023 ที่ไม่มี hint (ด่านเดิมของ 0084-0088) -> ข้อความดิบของ DB ออกจอเหมือนเดิม", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "oem_receipt_issue: ยอดรับเงินรวม 1 บาท เกินยอดรวมใบเสนอราคาทั้งดีล", hint: null } });
    const { issueReceipt } = await import("./oem");
    const r = await issueReceipt(baseInput);
    expect(r).toEqual({ ok: false, error: "oem_receipt_issue: ยอดรับเงินรวม 1 บาท เกินยอดรวมใบเสนอราคาทั้งดีล" });
  });
});

describe("issueReceipt — ผูกใบแจ้งหนี้ (0180)", () => {
  it("ส่ง p_invoice_id + p_actor_id (จาก session) · payload 11 key เป๊ะ · ยอด/kind ตามที่ caller ส่ง ไม่ถูกแก้", async () => {
    const { issueReceipt } = await import("./oem");
    const r = await issueReceipt({ ...baseInput, invoiceId: INV });
    expect(r).toEqual({ ok: true, data: { receiptId: RID } });
    expect(rpcMock).toHaveBeenCalledWith("oem_receipt_issue", {
      p_shop_id: "shop-1",
      p_quote_id: Q,
      p_amount_thb: 5000.51,
      p_received_date: "2026-10-16",
      p_kind: "deposit",
      p_payment_method: null,
      p_payment_ref: null,
      p_description: null,
      p_reissued_from: null,
      p_invoice_id: INV,
      p_actor_id: ACTOR,
    });
    expect(Object.keys(rpcMock.mock.calls[0][1])).toHaveLength(11);
  });

  it("🔴 caller ยัด actor ปลอม/ผู้ออกเกิน type -> actor ที่ไปถึง RPC มาจาก session เท่านั้น", async () => {
    const { issueReceipt } = await import("./oem");
    await issueReceipt({
      ...baseInput,
      invoiceId: INV,
      // @ts-expect-error — IssueReceiptInput ไม่มี field พวกนี้โดยตั้งใจ · จำลอง caller ที่ข้าม type
      actorId: "attacker",
      p_actor_id: "attacker",
      createdBy: "attacker",
    });
    const payload = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.p_actor_id).toBe(ACTOR);
    expect(JSON.stringify(payload)).not.toContain("attacker");
  });

  it("invoiceId ไม่ใช่ uuid -> ไม่ถึง RPC · ไม่มี session (actor) -> ไม่ถึง RPC (เอกสารการเงินต้องรู้ผู้ทำรายการ)", async () => {
    const { issueReceipt } = await import("./oem");
    for (const bad of ["x", "", "22222222-2222-2222", "' or 1=1 --"]) {
      // string ว่างต้องถูกปฏิเสธด้วย (ไม่ถูกตีเป็น "ไม่ส่ง")
      const r = await issueReceipt({ ...baseInput, invoiceId: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    getSessionUserMock.mockResolvedValueOnce(null);
    const r2 = await issueReceipt({ ...baseInput, invoiceId: INV });
    expect(r2.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reissue + invoice: ส่งทั้งสองค่า (DB ตรวจว่าต้องอ้างใบแจ้งหนี้เดียวกับใบเดิม)", async () => {
    const { issueReceipt } = await import("./oem");
    await issueReceipt({ ...baseInput, invoiceId: INV, reissuedFrom: RID });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_invoice_id: INV, p_reissued_from: RID, p_actor_id: ACTOR });
  });

  it("hint ของ DB -> ข้อความไทยคงที่ (ไม่ปล่อยข้อความดิบที่มีเลขใบ/ยอด)", async () => {
    const { issueReceipt } = await import("./oem");
    const { invoiceErrorMessage } = await import("@/lib/oem/invoiceMessages");
    for (const hint of [
      "invoice_stale", "invoice_deal_mismatch", "invoice_amount_mismatch", "invoice_kind_mismatch", "reissue_invoice_mismatch",
      "invoice_not_found", "invoice_not_issued", "invoice_paid", "actor_required", "invoice_snapshot_mismatch", "invoice_date_before",
    ]) {
      rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "RAW-DB-MESSAGE IV-2610-001 5000.51", hint } });
      const r = await issueReceipt({ ...baseInput, invoiceId: INV });
      expect(r.ok, hint).toBe(false);
      if (r.ok) continue;
      expect(r.error, hint).toBe(invoiceErrorMessage(hint));
      expect(r.error, hint).not.toContain("RAW-DB-MESSAGE");
      expect(r.error, hint).toMatch(/[ก-๙]/);
    }
  });

  it("42501 + actor_not_member (L1) -> ข้อความไทยคงที่ · 42501 อื่น/โค้ดอื่น -> ข้อความกลาง + log เฉพาะ code+message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { issueReceipt } = await import("./oem");
    const { invoiceErrorMessage } = await import("@/lib/oem/invoiceMessages");
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "RAW-FORBIDDEN", hint: "actor_not_member" } });
    expect(await issueReceipt({ ...baseInput, invoiceId: INV })).toEqual({ ok: false, error: invoiceErrorMessage("actor_not_member") });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied for function oem_receipt_issue", hint: null } });
    const r2 = await issueReceipt({ ...baseInput, invoiceId: INV });
    expect(r2).toEqual({ ok: false, error: "บันทึกรับเงินไม่สำเร็จ ลองใหม่อีกครั้ง" });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function", hint: null } });
    expect(await issueReceipt({ ...baseInput, invoiceId: INV })).toEqual({ ok: false, error: "บันทึกรับเงินไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(String(spy.mock.calls.at(-1)?.[0] ?? "")).not.toContain(INV);
    spy.mockRestore();
  });

  it("revalidate หลังผูกสำเร็จ (ให้รายการใบแจ้งหนี้/ใบเสร็จรีเฟรช)", async () => {
    const { issueReceipt } = await import("./oem");
    await issueReceipt({ ...baseInput, invoiceId: INV });
    expect(revalidateMock).toHaveBeenCalled();
  });
});

describe("getReceipt — map invoice_id / invoice_no_snapshot (0180)", () => {
  function rawReceipt(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: RID, shop_id: "shop-1", quote_id: Q, receipt_no: "RT-2610-001", kind: "deposit", status: "issued", amount_thb: "5000.51",
      vat_rate: "0.0700", vat_base_thb: "4673.37", vat_amount_thb: "327.14", received_date: "2026-10-16", issue_date: "2026-10-16",
      payment_method: null, payment_ref: null, description: "เงินมัดจำงาน OEM", seller_snapshot: { legal_name: "ร้านทดสอบ", address_lines: ["1 ถนนทดสอบ"] },
      buyer_legal_name: "ผู้ซื้อทดสอบ", buyer_tax_id: null, buyer_branch_label: null, buyer_address: null, quote_no_snapshot: "OEM-2610-004",
      grand_total_snapshot: "10001.01", paid_before_thb: "0.00", balance_after_thb: "5000.50", void_reason: null, voided_at: null, voided_by: null,
      reissued_from_receipt_id: null, invoice_id: INV, invoice_no_snapshot: "IV-2610-001", created_by: null, created_at: "2026-10-16T01:00:00Z",
      quote_no: "OEM-2610-004", is_deal_active: true,
      ...over,
    };
  }

  it("ใบที่ผูก -> invoiceId + invoiceNoSnapshot · ใบเดิมก่อน 0180 (null) -> null ทั้งคู่ · select ขอคอลัมน์ใหม่ทั้งสอง", async () => {
    const { getReceipt } = await import("./oem");
    maybeSingleMock.mockResolvedValueOnce({ data: rawReceipt(), error: null });
    const a = await getReceipt(RID);
    expect(a.ok && a.data.invoiceId).toBe(INV);
    expect(a.ok && a.data.invoiceNoSnapshot).toBe("IV-2610-001");
    expect(String(selectMock.mock.calls[0][1])).toMatch(/\binvoice_id\b.*\binvoice_no_snapshot\b/);
    expect(selectMock.mock.calls[0][0]).toBe("v_oem_receipt");
    maybeSingleMock.mockResolvedValueOnce({ data: rawReceipt({ invoice_id: null, invoice_no_snapshot: null }), error: null });
    const b = await getReceipt(RID);
    expect(b.ok && b.data.invoiceId).toBeNull();
    expect(b.ok && b.data.invoiceNoSnapshot).toBeNull();
    maybeSingleMock.mockResolvedValueOnce({ data: (() => { const r = rawReceipt(); delete r.invoice_id; delete r.invoice_no_snapshot; return r; })(), error: null });
    const c = await getReceipt(RID);
    expect(c.ok && c.data.invoiceId).toBeNull();
  });
});
