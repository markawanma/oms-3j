// lib/oem/invoiceDisplay.ts — ตรรกะ "แสดงผล" ของใบแจ้งหนี้ OEM (0179) · pure · ไม่มีการคำนวณเงิน
//
// 🔴 ไฟล์นี้ "เปรียบเทียบ" ตัวเลขที่ DB คำนวณมาแล้วเท่านั้น (> 0, <= grand, < 0) — ไม่บวก/ลบ/คูณ/หาร/ปัดเศษเงินเลย
// ยอดที่ลูกค้าต้องชำระมาจาก DB ตอนออกใบ (oem_invoice_issue อ่านจาก v_oem_quote เอง) client ไม่เคยส่งยอด
// กฎทุกข้อที่นี่เป็น pre-check เพื่อ UX (ไม่ให้เปิด dialog ที่ทำได้แค่ล้มเหลว) — DB ตัดสินซ้ำทุกด่านเสมอ

import type { OemInvoiceKind, OemInvoiceRow, OemQuoteRow } from "./types";
import { OEM_INVOICE_PAY_BEFORE_WORK_TH } from "./types";
import type { SellerProfile } from "./sellerProfile";
import { missingSellerFields } from "./sellerProfile";
import { formatThaiDateOnly } from "@/lib/tiktok/format";

// ---------------------------------------------------------------------------
// 1) ชนิดใบที่ออกได้ — มี 0 หรือ 1 ชนิดเสมอ (ไม่มี radio ให้เลือก · มติ Tech Lead)
// ---------------------------------------------------------------------------

export type InvoiceKindBlock = "no_total" | "negative" | "fully_paid" | "deposit_invalid";

export type InvoiceKindResolution =
  | { kind: OemInvoiceKind; /** true = แจ้งยอดเต็ม (ไม่ตั้งมัดจำ + ยังไม่เคยรับเงิน) */ isFull: boolean; block: null }
  | { kind: null; isFull: false; block: InvoiceKindBlock };

type KindInput = Pick<OemQuoteRow, "depositMode" | "depositAmountThb" | "grandTotal" | "paidThb" | "outstandingThb">;

/** ตารางตัดสินชนิด (ตรงกับ oem_invoice_issue):
 *  ตั้งมัดจำ + ยังไม่เคยรับเงิน → deposit · ตั้งมัดจำ + รับแล้ว → balance · ไม่ตั้ง → balance (เต็มจำนวนถ้ายังไม่รับเงิน)
 *  เปรียบเทียบอย่างเดียว — ห้ามคำนวณเงิน */
export function resolveInvoiceKind(q: KindInput): InvoiceKindResolution {
  const grand = q.grandTotal;
  const outstanding = q.outstandingThb;
  if (grand == null || outstanding == null || !Number.isFinite(grand) || !Number.isFinite(outstanding)) {
    return { kind: null, isFull: false, block: "no_total" };
  }
  if (outstanding < 0) return { kind: null, isFull: false, block: "negative" };
  if (outstanding <= 0) return { kind: null, isFull: false, block: "fully_paid" };

  const hasPaid = q.paidThb != null && q.paidThb > 0;
  if (q.depositMode != null && !hasPaid) {
    const d = q.depositAmountThb;
    if (d == null || !Number.isFinite(d) || !(d > 0 && d <= grand)) {
      return { kind: null, isFull: false, block: "deposit_invalid" };
    }
    return { kind: "deposit", isFull: false, block: null };
  }
  return { kind: "balance", isFull: !hasPaid, block: null };
}

export function issueButtonLabelTh(res: Extract<InvoiceKindResolution, { block: null }>): string {
  if (res.kind === "deposit") return "ออกใบแจ้งหนี้มัดจำ";
  return res.isFull ? "ออกใบแจ้งหนี้ยอดเต็ม" : "ออกใบแจ้งหนี้ยอดคงเหลือ";
}

// ---------------------------------------------------------------------------
// 2) สถานะที่แสดงของใบ — ลำดับ: void → paid → stale → overdue → pending
// ---------------------------------------------------------------------------

export type InvoiceDisplayStatus = "void" | "paid" | "stale" | "overdue" | "pending";

export const INVOICE_DISPLAY_STATUS_LABEL_TH: Record<InvoiceDisplayStatus, string> = {
  void: "ยกเลิกแล้ว",
  paid: "ชำระแล้ว",
  stale: "ล้าสมัย",
  overdue: "เลยกำหนด",
  pending: "รอชำระ",
};

type StatusInput = Pick<OemInvoiceRow, "status" | "paymentState" | "isStale" | "isOverdue" | "kind" | "issueDate" | "dueDate" | "payBeforeWork">;

/** ใบมัดจำที่ due = issue = "ชำระก่อนเริ่มงาน" — ไม่มีกำหนดวันจริง ไม่นับเลยกำหนด (มติเจ้าของ · DB is_overdue ตัดไว้แล้ว — ที่นี่กันซ้ำอีกชั้น) */
function isPayBeforeWork(r: Pick<OemInvoiceRow, "kind" | "issueDate" | "dueDate" | "payBeforeWork">): boolean {
  return r.kind === "deposit" && (r.payBeforeWork || r.dueDate === r.issueDate);
}

export function resolveInvoiceDisplayStatus(r: StatusInput): InvoiceDisplayStatus {
  if (r.status === "void" || r.paymentState === "void") return "void";
  if (r.paymentState === "paid") return "paid";
  if (r.isStale) return "stale";
  if (r.isOverdue && !isPayBeforeWork(r)) return "overdue";
  return "pending";
}

/** ข้อความกำหนดชำระ (หน้าจอพนักงาน) — 3 เคส: มัดจำ due=issue / มัดจำตั้งวันเอง / คงเหลือ */
export function formatDueText(r: Pick<OemInvoiceRow, "kind" | "issueDate" | "dueDate" | "payBeforeWork">): string {
  if (isPayBeforeWork(r)) return OEM_INVOICE_PAY_BEFORE_WORK_TH;
  const date = formatThaiDateOnly(r.dueDate);
  return r.kind === "deposit" ? `ชำระภายใน ${date} (ก่อนเริ่มงาน)` : `ชำระภายใน ${date}`;
}

// ---------------------------------------------------------------------------
// 3) ด่านแสดง/ซ่อนปุ่มออกใบ (spec §2 — ข้อแรกที่ตรงชนะ)
// ---------------------------------------------------------------------------

export type InvoiceBlockReason =
  | InvoiceKindBlock
  | "load_error"
  | "draft"
  | "closed"
  | "superseded"
  | "stale_open"
  | "open_invoice"
  | "seller_incomplete"
  | "payment_lines_empty"
  | "payment_lines_unreadable"
  | "no_buyer";

export type InvoiceGateAction = "rates" | "payment_lines" | "billing" | "deposit";
export type InvoiceGateTone = "red" | "orange" | "amber" | "zinc";

export type InvoiceGate =
  | { state: "ready"; kind: OemInvoiceKind; isFull: boolean; labelTh: string }
  | {
      /** hidden = ไม่มีปุ่ม มีแถบเหตุผล · disabled = ปุ่มค้างไว้แต่กดไม่ได้ + แถบเหตุผล (aria-describedby) */
      state: "hidden" | "disabled";
      reason: InvoiceBlockReason;
      tone: InvoiceGateTone;
      message: string;
      action: InvoiceGateAction | null;
      /** เฉพาะ stale_open — ใบที่ต้องยกเลิกแล้วออกใหม่ */
      invoiceId: string | null;
      /** ปุ่มที่ค้างไว้ (disabled) ใช้ชื่อชนิดที่จะออกถ้ารู้ */
      labelTh: string | null;
    };

export function invoiceBlockReasonTh(reason: InvoiceBlockReason, ctx: { invoiceNo?: string; missing?: string[]; error?: string } = {}): string {
  switch (reason) {
    case "load_error":
      return `โหลดรายการใบแจ้งหนี้ไม่สำเร็จ${ctx.error ? ` (${ctx.error})` : ""} — ลองรีเฟรชหน้านี้ (ยังออกใบใหม่ไม่ได้ เพราะอาจมีใบค้างอยู่)`;
    case "draft":
      return "ออกใบแจ้งหนี้ได้เมื่อใบเสนอราคาอยู่สถานะเสนอราคาแล้ว";
    case "closed":
      return "ใบนี้ปิดแล้ว (แพ้งาน/ถูกปฏิเสธ) — ออกใบแจ้งหนี้ไม่ได้";
    case "superseded":
      return "ใบนี้ถูกแทนที่ด้วยใบต่อราคาใหม่ — ไปออกใบแจ้งหนี้ที่ใบใหม่";
    case "stale_open":
      return `ใบ ${ctx.invoiceNo ?? "—"} ยอดเปลี่ยนแล้ว ใช้ไม่ได้ — ยกเลิกแล้วออกใหม่`;
    case "open_invoice":
      return `มีใบแจ้งหนี้ค้างอยู่ (${ctx.invoiceNo ?? "—"}) — ออกใบใหม่ได้เมื่อใบนี้ชำระแล้วหรือถูกยกเลิก`;
    case "seller_incomplete":
      return `ข้อมูลร้านเรา (หัวกระดาษ) ยังไม่ครบ${ctx.missing && ctx.missing.length > 0 ? ` — ขาด: ${ctx.missing.join(", ")}` : ""} — ออกใบแจ้งหนี้ไม่ได้จนกว่าจะกรอก`;
    case "payment_lines_empty":
      return "ยังไม่ได้ตั้งช่องทางชำระเงิน — ออกใบแจ้งหนี้ไม่ได้จนกว่าจะตั้ง";
    case "payment_lines_unreadable":
      return "โหลดช่องทางชำระไม่สำเร็จ — ลองรีเฟรชหน้า";
    case "no_buyer":
      return "ยังไม่มีข้อมูลลูกค้าสำหรับออกเอกสาร";
    case "no_total":
      return "ใบนี้ยังไม่มียอดรวมที่คำนวณได้ — ออกใบแจ้งหนี้ไม่ได้";
    case "negative":
      return "ยอดบวกไม่ลง (ร้านค้างคืนเงิน) — แก้มัดจำ/ยอดก่อนออกใบแจ้งหนี้";
    case "fully_paid":
      return "รับเงินครบแล้ว — ไม่ต้องออกใบแจ้งหนี้";
    case "deposit_invalid":
      return "ยอดมัดจำที่ตั้งไว้ไม่ถูกต้อง — แก้มัดจำก่อน";
  }
}

export interface InvoiceGateInput {
  quote: Pick<
    OemQuoteRow,
    "status" | "billLegalName" | "depositMode" | "depositAmountThb" | "grandTotal" | "paidThb" | "outstandingThb"
  >;
  invoices: OemInvoiceRow[];
  /** ข้อความ error ถ้าโหลดรายการใบแจ้งหนี้ไม่สำเร็จ (null = โหลดได้) */
  invoicesError: string | null;
  sellerProfile: SellerProfile;
}

function blocked(
  state: "hidden" | "disabled",
  reason: InvoiceBlockReason,
  tone: InvoiceGateTone,
  ctx: { invoiceNo?: string; missing?: string[]; error?: string } = {},
  extra: { action?: InvoiceGateAction | null; invoiceId?: string | null; labelTh?: string | null } = {}
): InvoiceGate {
  return {
    state,
    reason,
    tone,
    message: invoiceBlockReasonTh(reason, ctx),
    action: extra.action ?? null,
    invoiceId: extra.invoiceId ?? null,
    labelTh: extra.labelTh ?? null,
  };
}

/** ด่าน 14 ข้อของ InvoiceSection — ข้อแรกที่ตรงชนะ (spec §2) · pure ทดสอบได้โดยไม่ต้อง render */
export function resolveInvoiceGate(input: InvoiceGateInput): InvoiceGate {
  const { quote, invoices, invoicesError, sellerProfile } = input;

  // 1 โหลดรายการใบไม่ได้ → ไม่รู้ว่ามีใบค้างอยู่ไหม ห้ามเดาว่าออกได้
  if (invoicesError) return blocked("hidden", "load_error", "red", { error: invoicesError });
  // 2-4 สถานะใบเสนอราคา
  if (quote.status === "draft") return blocked("hidden", "draft", "zinc");
  if (quote.status === "lost" || quote.status === "rejected") return blocked("hidden", "closed", "zinc");
  if (quote.status === "superseded") return blocked("hidden", "superseded", "zinc");

  // 5 ใบ stale ค้าง (ชนะใบเปิดค้างธรรมดา — stale ก็เป็นใบเปิดค้างเหมือนกัน แต่ต้องบอกทางออก)
  const stale = invoices.find((i) => i.status === "issued" && i.isStale);
  if (stale) return blocked("hidden", "stale_open", "orange", { invoiceNo: stale.invoiceNo }, { invoiceId: stale.id });
  // 6 ใบเปิดค้าง (ออกแล้ว ยังไม่ชำระ) — DB อนุญาตแค่ 1 ใบ/ดีล
  const open = invoices.find((i) => i.status === "issued" && i.paymentState === "unpaid");
  if (open) return blocked("hidden", "open_invoice", "zinc", { invoiceNo: open.invoiceNo });

  // ชนิดที่จะออก (ใช้ติดป้ายชื่อปุ่มที่ disabled ด้วย)
  const res = resolveInvoiceKind(quote);
  const labelTh = res.block === null ? issueButtonLabelTh(res) : null;

  // 7 ข้อมูลร้านไม่ครบ
  const missing = missingSellerFields(sellerProfile);
  if (missing.length > 0) return blocked("disabled", "seller_incomplete", "amber", { missing }, { action: "rates", labelTh });
  // 8-9 ช่องทางชำระ: [] = ยังไม่ตั้ง · null = อ่านไม่ได้ (คนละเรื่อง ห้ามปนกัน)
  if (sellerProfile.paymentLines === null) {
    return blocked("disabled", "payment_lines_unreadable", "red", {}, { labelTh });
  }
  if (sellerProfile.paymentLines.length === 0) {
    return blocked("disabled", "payment_lines_empty", "amber", {}, { action: "payment_lines", labelTh });
  }
  // 10 ไม่มีข้อมูลผู้ซื้อ
  if (!quote.billLegalName?.trim()) return blocked("disabled", "no_buyer", "amber", {}, { action: "billing", labelTh });

  // 11-13 ยอด/มัดจำ
  if (res.block !== null) {
    switch (res.block) {
      case "negative":
        return blocked("hidden", "negative", "red");
      case "fully_paid":
        return blocked("hidden", "fully_paid", "zinc");
      case "deposit_invalid":
        return blocked("hidden", "deposit_invalid", "amber", {}, { action: "deposit" });
      case "no_total":
        return blocked("hidden", "no_total", "zinc");
    }
  }

  // 14 ผ่าน
  return { state: "ready", kind: res.kind, isFull: res.isFull, labelTh: issueButtonLabelTh(res) };
}
