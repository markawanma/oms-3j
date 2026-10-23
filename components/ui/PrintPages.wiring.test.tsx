// @vitest-environment jsdom
// เดินสาย: หน้าพิมพ์แต่ละหน้า (server component) ต้องคืน <PrintFileTitle title=...> คู่กับ client เดิม — ชื่อไฟล์จากข้อมูลที่หน้าโหลดอยู่แล้ว (query เดิมเรียกครั้งเดียว)
// ไม่ render ลง DOM: เรียก page เป็นฟังก์ชัน async แล้วอ่านต้นไม้ element ที่คืนมา
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const LOT_ID = "22222222-2222-4222-8222-222222222222";

const getJobDetail = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({ getJobDetail: (...a: unknown[]) => getJobDetail(...a) }));
vi.mock("@/lib/jobs/page-gate", () => ({ canManageJobs: async () => true }));
vi.mock("@/lib/jobs/log", () => ({ logJobFailure: vi.fn() }));
vi.mock("@/lib/jobs/origin-server", () => ({ currentAppOrigin: async () => ({ ok: true, host: "app.example.test", warning: null }) }));
vi.mock("@/lib/jobs/photos-server", () => ({ primaryPhotoMdUrl: async () => null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/domain/jobs/JobPrintClient", () => ({ JobPrintClient: () => null }));
vi.mock("@/components/domain/jobs/SublotPrintClient", () => ({ SublotPrintClient: () => null }));

const getQuote = vi.fn();
const getQuoteItems = vi.fn();
const getSellerProfile = vi.fn();
const getInvoice = vi.fn();
const getReceipt = vi.fn();
vi.mock("@/lib/actions/oem", () => ({
  getQuote: (...a: unknown[]) => getQuote(...a),
  getQuoteItems: (...a: unknown[]) => getQuoteItems(...a),
  getSellerProfile: (...a: unknown[]) => getSellerProfile(...a),
  getInvoice: (...a: unknown[]) => getInvoice(...a),
  getReceipt: (...a: unknown[]) => getReceipt(...a),
}));
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: async () => "owner" }));
vi.mock("@/components/domain/oem/PrintQuoteClient", () => ({ PrintQuoteClient: () => null }));
vi.mock("@/components/domain/oem/PrintInvoiceClient", () => ({ PrintInvoiceClient: () => null }));
vi.mock("@/components/domain/oem/InvoicePrintBlocked", () => ({ InvoicePrintBlocked: () => null }));
vi.mock("@/components/domain/oem/PrintReceiptClient", () => ({ PrintReceiptClient: () => null }));
const toPrintableQuote = vi.fn();
vi.mock("@/lib/oem/printableQuote", () => ({ toPrintableQuote: (...a: unknown[]) => toPrintableQuote(...a) }));
const toPrintableInvoice = vi.fn();
const toInvoicePrintNotices = vi.fn();
vi.mock("@/lib/oem/printableInvoice", () => ({ toPrintableInvoice: (...a: unknown[]) => toPrintableInvoice(...a), toInvoicePrintNotices: (...a: unknown[]) => toInvoicePrintNotices(...a) }));
const toPrintableReceipt = vi.fn();
vi.mock("@/lib/oem/printableReceipt", () => ({ toPrintableReceipt: (...a: unknown[]) => toPrintableReceipt(...a) }));

import { PrintFileTitle } from "@/components/ui/PrintFileTitle";
import JobPrintPage from "@/app/(dashboard)/jobs/[id]/print/page";
import OemQuotePrintPage from "@/app/(dashboard)/oem/quotes/[id]/print/page";
import OemInvoicePrintPage from "@/app/(dashboard)/oem/invoices/[id]/print/page";
import OemReceiptPrintPage from "@/app/(dashboard)/oem/receipts/[id]/print/page";

/** หา <PrintFileTitle> ในต้นไม้ element ที่ page คืน */
function titleOf(node: ReactNode): string | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const t = titleOf(c);
      if (t !== null) return t;
    }
    return null;
  }
  const el = node as ReactElement<{ title?: string; children?: ReactNode }>;
  if (el.type === PrintFileTitle) return el.props.title ?? null;
  return titleOf(el.props?.children);
}

const JOB = {
  id: JOB_ID, jobNo: "JB-0034", sourceKind: "production", designLabel: "ต่างหู", sku: "ER-001", metal: "silver",
  qtyPlanned: 10, qtyOrder: 10, createdAt: "2026-10-21T03:00:00+00:00", status: "open", dueDate: null,
  targetPieceG: null, metalPlanG: null, weightStartG: null, profileName: null,
};
function detail(extra: Record<string, unknown> = {}) {
  return { ok: true, data: { job: JOB, stages: [], gems: null, todayTh: "2026-10-23", lots: null, partOf: null, ...extra } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ใบงาน A5 / ใบย่อย", () => {
  it("ใบแม่: 261021_JB-0034_ต่างหู · query getJobDetail ครั้งเดียว", async () => {
    getJobDetail.mockResolvedValue(detail());
    const out = await JobPrintPage({ params: Promise.resolve({ id: JOB_ID }) });
    expect(titleOf(out)).toBe("261021_JB-0034_ต่างหู");
    expect(getJobDetail).toHaveBeenCalledTimes(1);
  });
  it("ใบย่อย (?lot=): 261021_JB-0034-ส่วน2_ต่างหู", async () => {
    getJobDetail.mockResolvedValue(
      detail({ lots: { parts: [{ jobId: LOT_ID, lotSeq: 2, label: "JB-0034 · ส่วนที่ 2", status: "open", qtyPlanned: 5, qtyLive: 5, passedStages: ["หล่อ"], stageName: "ขัด" }] } }),
    );
    const out = await JobPrintPage({ params: Promise.resolve({ id: JOB_ID }), searchParams: Promise.resolve({ lot: LOT_ID }) });
    expect(titleOf(out)).toBe("261021_JB-0034-ส่วน2_ต่างหู");
    expect(getJobDetail).toHaveBeenCalledTimes(1);
  });
  it("ใบที่ปิดแล้ว/ไม่พบ = หน้าแจ้งเตือน ไม่ตั้งชื่อไฟล์ (title คง 3J Insight)", async () => {
    getJobDetail.mockResolvedValue(detail({ job: { ...JOB, status: "done" } }));
    expect(titleOf(await JobPrintPage({ params: Promise.resolve({ id: JOB_ID }) }))).toBeNull();
    getJobDetail.mockResolvedValue({ ok: true, data: null });
    expect(titleOf(await JobPrintPage({ params: Promise.resolve({ id: JOB_ID }) }))).toBeNull();
    getJobDetail.mockResolvedValue({ ok: false, error: "x" });
    expect(titleOf(await JobPrintPage({ params: Promise.resolve({ id: JOB_ID }) }))).toBeNull();
  });
});

describe("OEM", () => {
  it("ใบเสนอราคา", async () => {
    getQuote.mockResolvedValue({ ok: true, data: { raw: "row" } });
    getQuoteItems.mockResolvedValue({ ok: true, data: [{ raw: "item" }] });
    getSellerProfile.mockResolvedValue({ ok: false, error: "x" });
    toPrintableQuote.mockReturnValue({ quoteNo: "QT-2610-007", createdAt: "2026-10-21T02:00:00+00:00", billLegalName: "บริษัท เอบีซี จำกัด", customerName: "x" });
    const out = await OemQuotePrintPage({ params: Promise.resolve({ id: "q1" }) });
    expect(titleOf(out)).toBe("261021_QT-2610-007_บริษัท-เอบีซี-จำกัด");
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(toPrintableQuote).toHaveBeenCalledTimes(1); // ด่าน boundary เดิมเรียกครั้งเดียว ชื่อไฟล์อ่านจากผลของมัน
  });
  it("ใบแจ้งหนี้ (ปกติ)", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: { invoiceNo: "INV-2610-003", amountThb: 1 } });
    toInvoicePrintNotices.mockReturnValue({ blockPrint: false });
    toPrintableInvoice.mockReturnValue({ invoiceNo: "INV-2610-003", issueDate: "2026-10-21", buyerLegalName: "ห้างหุ้นส่วน 3J" });
    const out = await OemInvoicePrintPage({ params: Promise.resolve({ id: "i1" }) });
    expect(titleOf(out)).toBe("261021_INV-2610-003_ห้างหุ้นส่วน-3J");
  });
  it("ใบแจ้งหนี้ stale (บล็อกพิมพ์) = หน้าบล็อก ไม่ตั้งชื่อไฟล์ และไม่เรียก toPrintableInvoice", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: { invoiceNo: "INV-1", amountThb: 1, issueDate: "2026-10-21", quoteId: "q" } });
    toInvoicePrintNotices.mockReturnValue({ blockPrint: true, activeQuoteId: null });
    const out = await OemInvoicePrintPage({ params: Promise.resolve({ id: "i1" }) });
    expect(titleOf(out)).toBeNull();
    expect(toPrintableInvoice).not.toHaveBeenCalled();
  });
  it("ใบเสร็จ", async () => {
    getReceipt.mockResolvedValue({ ok: true, data: { raw: "row" } });
    toPrintableReceipt.mockReturnValue({ receiptNo: "RT-2608-016", issueDate: "2026-10-21", buyerLegalName: "Acme Co., Ltd." });
    const out = await OemReceiptPrintPage({ params: Promise.resolve({ id: "r1" }) });
    expect(titleOf(out)).toBe("261021_RT-2608-016_Acme-Co.,-Ltd");
  });
});
