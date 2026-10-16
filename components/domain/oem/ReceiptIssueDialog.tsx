"use client";

// ReceiptIssueDialog — QuoteDetailClient/ReceiptSection's "บันทึกรับเงิน"
// action (0084). Calls issueReceipt -> analytics.oem_receipt_issue, which
// (a) computes vat_base/vat_amount server-side from amount_thb (never here —
// see pricing-disclosure-policy/oem-quote-invariants §2), (b) snapshots
// seller/buyer info onto the new row FOREVER, (c) flips the quote to 'won'
// automatically if it wasn't already (จ่ายมัดจำ = รับงาน).
//
// Prefill (design-oem-payment-invoice.md §8): first-ever payment on this
// deal (paidThb === 0/null) prefills the DEPOSIT amount; every payment after
// that prefills OUTSTANDING (the CLOSING installment) — both read straight
// off `quote` (v_oem_quote's live-computed depositAmountThb/outstandingThb),
// never recomputed here. The "kind" (deposit/partial/final) sent to the RPC
// is derived from the SAME two numbers, not asked as a separate form field —
// it is a fact about the payment's position in the deal, not a free choice.
//
// Overpay is blocked BEFORE the user can even press "บันทึก" (outstandingThb
// is the hard ceiling on the amount field) — the DB re-checks this too
// (0084 §6), but a request that can only ever fail should never leave the
// browser (same posture as every other write in this app).
//
// 0180 (I2): ถ้าดีลมีใบแจ้งหนี้ที่ออกแล้ว/ยังไม่ชำระ/ไม่ล้าสมัย -> ค่าเริ่ม "รับเงินตามใบแจ้งหนี้": ยอดล็อก (readOnly) เท่ายอดในใบที่ DB
// แช่แข็งไว้ตอนออกใบ · kind แมปตรงจากชนิดใบ (deposit -> deposit · balance -> final) — ห้าม deriveKind ในโหมดนี้ · ส่ง `invoiceId`
// เฉพาะโหมดนี้ ("ไม่อ้างใบ" = ไม่มี key นี้เลย = ทางเดิมเป๊ะ) · ไม่มีใบแจ้งหนี้ = dialog เดิมทุกประการ · ไม่คำนวณเงินที่นี่ เปรียบเทียบอย่างเดียว
//
// 0086: same posture for the buyer's tax-invoice completeness gate —
// oem_receipt_issue hard-rejects (22023) when the buyer has a tax_id but
// address/branch_label aren't filled in (missingTaxInvoiceFieldsTh above
// mirrors that check), so submit is blocked here too, with a link straight to
// BillingDialog instead of a dead-end toast after the fact.

import { useId, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { issueReceipt } from "@/lib/actions/oem";
import type { OemInvoiceKind, OemInvoiceRow, OemQuoteRow, OemReceiptKind, OemReceiptPaymentMethod } from "@/lib/oem/types";
import { OEM_PAYMENT_METHOD_LABEL_TH, OEM_RECEIPT_KIND_LABEL_TH } from "@/lib/oem/types";
import { formatTHB } from "@/lib/format";
import { todayBangkok } from "@/lib/oem/dates";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/** 0086: oem_receipt_issue hard-rejects (22023) when the buyer has a tax_id
 * (= นิติบุคคล) but address/branch_label aren't complete — a full tax invoice
 * under ป.รัษฎากร ม.86/4 needs both. This mirrors that gate client-side so the
 * dialog warns (and blocks submit — the request can only ever fail server-side
 * otherwise) BEFORE the owner wastes a receipt-number slot on a rejected call.
 * A private individual (no tax_id) is exempt entirely, same as the RPC. */
function missingTaxInvoiceFieldsTh(quote: OemQuoteRow): string[] {
  if (!quote.billTaxId?.trim()) return [];
  const missing: string[] = [];
  const addr = quote.billAddress;
  const addressComplete = !!(addr?.line1?.trim() && addr?.subdistrict?.trim() && addr?.district?.trim() && addr?.province?.trim() && addr?.postalCode?.trim());
  if (!addressComplete) missing.push("ที่อยู่");
  if (!quote.billBranchLabel?.trim()) missing.push("สาขา");
  return missing;
}

const PAYMENT_METHODS: OemReceiptPaymentMethod[] = ["transfer", "cash", "other"];

/** ตารางแมปตายตัว (ตรงกับ 0180 hint invoice_kind_mismatch) — ใบมัดจำ = รับมัดจำ · ใบคงเหลือ = ชำระงวดสุดท้าย */
export const INVOICE_TO_RECEIPT_KIND: Record<OemInvoiceKind, OemReceiptKind> = { deposit: "deposit", balance: "final" };

const INVOICE_KIND_SHORT_TH: Record<OemInvoiceKind, string> = { deposit: "มัดจำ", balance: "คงเหลือ" };

/** ใบแจ้งหนี้ที่เสนอให้ผูกได้: ออกแล้ว + ยังไม่ชำระ + ไม่ล้าสมัย (ใบ stale DB ปฏิเสธ จึงไม่เสนอ) · หนึ่งดีลมีใบเปิดได้ใบเดียว */
export function pickLinkableInvoice(invoices: OemInvoiceRow[]): OemInvoiceRow | null {
  return invoices.find((i) => i.status === "issued" && i.paymentState === "unpaid" && !i.isStale) ?? null;
}

/** ใบที่ล้าสมัยค้างอยู่ (ออกแล้ว ยังไม่ชำระ ยอดดีลเปลี่ยนหลังออกใบ) — เตือนว่าต้องยกเลิกก่อนถ้าอยากอ้างใบใหม่ */
export function pickStaleInvoice(invoices: OemInvoiceRow[]): OemInvoiceRow | null {
  return invoices.find((i) => i.status === "issued" && i.paymentState === "unpaid" && i.isStale) ?? null;
}

/** เดา kind จากตำแหน่งของยอดนี้ในดีล — ไม่ใช่ตัวเลือกอิสระที่ผู้ใช้กรอกเอง
 * (ดูหัวไฟล์). ยอมให้คลาดเคลื่อนเล็กน้อยจาก floating point ด้วยเกณฑ์ 1 สตางค์. */
function deriveKind(paidSoFar: number | null, outstanding: number | null, amount: number): OemReceiptKind {
  if (!paidSoFar || paidSoFar <= 0) return "deposit";
  if (outstanding != null && amount >= outstanding - 0.01) return "final";
  return "partial";
}

export function ReceiptIssueDialog({
  quote,
  onClose,
  onSaved,
  onGoToBilling,
  invoices = [],
}: {
  quote: OemQuoteRow;
  /** 0180: ใบแจ้งหนี้ของดีล (getInvoices) — ไม่ส่ง/ว่าง = dialog เดิมทุกประการ (ไม่มีกลุ่ม "รับเงินตาม") */
  invoices?: OemInvoiceRow[];
  onClose: () => void;
  onSaved: () => void;
  /** 0086: closes this dialog + opens QuoteDetailClient's BillingDialog —
   * used by the incomplete-tax-info warning below. */
  onGoToBilling: () => void;
}) {
  const toast = useToast();
  const linkable = pickLinkableInvoice(invoices);
  const staleInvoice = pickStaleInvoice(invoices);
  const [payMode, setPayMode] = useState<"invoice" | "none">("invoice");
  const warnId = useId();
  const hasReceived = !!quote.paidThb && quote.paidThb > 0;
  const suggested = hasReceived ? quote.outstandingThb : (quote.depositAmountThb ?? quote.outstandingThb);
  const [amountInput, setAmountInput] = useState(suggested != null && suggested > 0 ? String(suggested) : "");
  const [receivedDate, setReceivedDate] = useState(todayBangkok());
  const [paymentMethod, setPaymentMethod] = useState<OemReceiptPaymentMethod>("transfer");
  const [paymentRef, setPaymentRef] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  // ตามใบ: ยอดมาจากใบตรงๆ (ตัวเลขที่ DB แช่แข็งไว้ ไม่ผ่านการคำนวณ) · ไม่อ้างใบ/ไม่มีใบ: ยอดที่พนักงานกรอก (เดิม)
  const linked = linkable !== null && payMode === "invoice" ? linkable : null;
  const effectiveAmountInput = linked ? String(linked.amountThb) : amountInput;
  const amount = Number(effectiveAmountInput);
  const outstanding = quote.outstandingThb;
  const validAmount = Number.isFinite(amount) && amount > 0;
  // เพดานจริงคือ outstanding — ถ้า outstanding เป็น null (ยังไม่มียอดรวม) หรือ
  // <= 0 (จ่ายครบ/เกินแล้ว) ห้ามกดบันทึกเลย ก่อนแม้แต่จะยิง request ออกไป
  // (0084 §6 ฝั่ง DB ปฏิเสธเหมือนกัน แต่ที่นี่คือด่านแรกไม่ให้กดได้ตั้งแต่ต้น).
  const overOutstanding = outstanding != null && amount > outstanding + 0.01;
  const blockedByOutstanding = outstanding == null || outstanding <= 0;
  const missingTaxInvoiceFields = missingTaxInvoiceFieldsTh(quote);
  const canSubmit = validAmount && !overOutstanding && !blockedByOutstanding && !!receivedDate && missingTaxInvoiceFields.length === 0;
  const kind: OemReceiptKind | null = linked
    ? INVOICE_TO_RECEIPT_KIND[linked.kind]
    : validAmount
      ? deriveKind(quote.paidThb, outstanding, amount)
      : null;

  function submit() {
    if (!canSubmit || !kind) return;
    startTransition(async () => {
      const result = await issueReceipt({
        // ส่ง invoiceId เฉพาะโหมดตามใบ — โหมดไม่อ้างใบต้องไม่มี key นี้เลย (ทางเดิมเป๊ะ)
        ...(linked ? { invoiceId: linked.id } : {}),
        quoteId: quote.id,
        amountThb: amount,
        receivedDate,
        kind,
        paymentMethod,
        paymentRef: paymentRef.trim() || null,
        description: description.trim() || null,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกรับเงินและออกใบเสร็จ/ใบกำกับภาษีแล้ว${linked ? ` · ปิดใบแจ้งหนี้ ${linked.invoiceNo} แล้ว` : ""}`);
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`บันทึกรับเงิน — ${quote.quoteNo}`}>
      {missingTaxInvoiceFields.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-amber-800">ผู้ซื้อมีเลขผู้เสียภาษี แต่ข้อมูลยังไม่ครบสำหรับใบกำกับภาษีเต็มรูป</p>
            <p className="mt-0.5 text-xs text-amber-700">
              ยังไม่มี{missingTaxInvoiceFields.join(" และ ")} — ระบบจะออกใบเสร็จ/ใบกำกับภาษีให้ไม่ได้เลยจนกว่าจะกรอกให้ครบ (ปฏิเสธที่ระบบหลังบ้าน)
            </p>
            <button
              type="button"
              onClick={onGoToBilling}
              className="mt-1.5 text-xs font-semibold text-amber-800 underline hover:text-amber-900"
            >
              ไปกรอกข้อมูลผู้ซื้อให้ครบ
            </button>
          </div>
        </div>
      )}

      {staleInvoice && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span>มีใบแจ้งหนี้ {staleInvoice.invoiceNo} ที่ล้าสมัย — ยกเลิกก่อนถ้าต้องการอ้างใบใหม่</span>
        </p>
      )}

      {linkable && (
        <fieldset className="mb-3 rounded-md border border-zinc-200 px-3 py-1">
          <legend className="px-1 text-sm font-medium text-zinc-700">รับเงินตาม</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-zinc-800">
            <input
              type="radio"
              name="oem-receipt-paymode"
              value="invoice"
              checked={payMode === "invoice"}
              onChange={() => setPayMode("invoice")}
              disabled={pending}
              className="h-4 w-4 shrink-0"
            />
            <span>
              ตามใบแจ้งหนี้ {linkable.invoiceNo} — <span className="whitespace-nowrap tabular-nums">{formatTHB(linkable.amountThb)}</span> (
              {INVOICE_KIND_SHORT_TH[linkable.kind]})
            </span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-zinc-800">
            <input
              type="radio"
              name="oem-receipt-paymode"
              value="none"
              checked={payMode === "none"}
              onChange={() => setPayMode("none")}
              disabled={pending}
              aria-describedby={payMode === "none" ? warnId : undefined}
              className="h-4 w-4 shrink-0"
            />
            <span>รับเงินโดยไม่อ้างใบแจ้งหนี้</span>
          </label>
          {payMode === "none" && (
            <p id={warnId} className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              ใบแจ้งหนี้ {linkable.invoiceNo} จะกลายเป็น “ล้าสมัย” (พิมพ์ไม่ได้) และต้องยกเลิกเอง
            </p>
          )}
        </fieldset>
      )}

      {blockedByOutstanding ? (
        <p className="rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-800">
          {outstanding == null
            ? "ใบนี้ยังไม่มียอดรวมที่คำนวณได้ — บันทึกรับเงินไม่ได้"
            : outstanding <= 0
              ? "ใบนี้รับเงินครบยอดแล้ว (หรือเกินยอดแล้ว) — ไม่ควรบันทึกรับเงินเพิ่มจนกว่าจะตรวจสอบ/ต่อราคาก่อน"
              : ""}
        </p>
      ) : (
        <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-sm text-zinc-700">
          ยอดคงค้างปัจจุบัน <span className="font-semibold tabular-nums">{formatTHB(outstanding!)}</span> — ระบบจะออกเลขที่เอกสารทันทีที่กดบันทึก
          และ<span className="font-semibold">แก้ไขไม่ได้อีก</span> (ผิดแล้วต้องยกเลิกแล้วออกใหม่)
        </p>
      )}

      <label htmlFor="oem-receipt-amount" className="mt-3 block text-sm font-medium text-zinc-700">
        จำนวนเงินที่รับ (บาท)
      </label>
      <input
        id="oem-receipt-amount"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={effectiveAmountInput}
        onChange={(e) => setAmountInput(e.target.value)}
        disabled={blockedByOutstanding}
        readOnly={!!linked}
        aria-readonly={linked ? true : undefined}
        className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base tabular-nums disabled:bg-zinc-100 read-only:bg-zinc-100 read-only:text-zinc-700"
        aria-invalid={!validAmount || overOutstanding}
        aria-describedby="oem-receipt-amount-error"
      />
      {(overOutstanding || (amountInput !== "" && !validAmount)) && (
        <p id="oem-receipt-amount-error" className="mt-1 text-xs text-red-600">
          {overOutstanding ? `รับเกินยอดคงค้าง (${formatTHB(outstanding!)}) ไม่ได้` : "กรอกจำนวนเงินให้มากกว่า 0"}
        </p>
      )}
      {linked && (
        <p className="mt-1 text-xs text-zinc-500">ยอดล็อกตามใบแจ้งหนี้ — ถ้าลูกค้าโอนไม่ตรงยอด ให้เลือก “รับเงินโดยไม่อ้างใบแจ้งหนี้”</p>
      )}
      {kind && !overOutstanding && (
        <p className="mt-1 text-xs text-zinc-500">
          ระบบจะบันทึกเป็น: <span className="font-medium text-zinc-700">{OEM_RECEIPT_KIND_LABEL_TH[kind]}</span>
        </p>
      )}

      <label htmlFor="oem-receipt-date" className="mt-3 block text-sm font-medium text-zinc-700">
        วันที่รับเงิน
      </label>
      <input
        id="oem-receipt-date"
        type="date"
        value={receivedDate}
        max={todayBangkok()}
        onChange={(e) => setReceivedDate(e.target.value)}
        disabled={blockedByOutstanding}
        className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base disabled:bg-zinc-100"
      />

      <p className="mt-3 text-sm font-medium text-zinc-700">ช่องทางรับเงิน</p>
      <div className="mt-1 flex gap-2" role="radiogroup" aria-label="ช่องทางรับเงิน">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={paymentMethod === m}
            disabled={blockedByOutstanding}
            onClick={() => setPaymentMethod(m)}
            className={`min-h-11 flex-1 rounded-md border px-2 text-sm font-medium disabled:opacity-50 ${
              paymentMethod === m ? "border-primary-600 bg-primary-50 text-primary-800" : "border-zinc-300 text-zinc-600"
            }`}
          >
            {OEM_PAYMENT_METHOD_LABEL_TH[m]}
          </button>
        ))}
      </div>

      <label htmlFor="oem-receipt-ref" className="mt-3 block text-sm font-medium text-zinc-700">
        เลขอ้างอิง (ถ้ามี)
      </label>
      <input
        id="oem-receipt-ref"
        type="text"
        value={paymentRef}
        onChange={(e) => setPaymentRef(e.target.value)}
        disabled={blockedByOutstanding}
        placeholder="เช่น เลขที่รายการโอน"
        className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base disabled:bg-zinc-100"
      />

      <label htmlFor="oem-receipt-desc" className="mt-3 block text-sm font-medium text-zinc-700">
        รายการบนเอกสาร (ไม่กรอก = ระบบสร้างข้อความให้อัตโนมัติ)
      </label>
      <textarea
        id="oem-receipt-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={blockedByOutstanding}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base disabled:bg-zinc-100"
        placeholder={`เช่น เงินมัดจำงาน OEM ตามใบเสนอราคา ${quote.quoteNo}`}
      />

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={pending} disabled={!canSubmit} onClick={submit}>
          บันทึกรับเงิน
        </Button>
      </div>
    </Modal>
  );
}
