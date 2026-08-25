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

import { useState, useTransition } from "react";
import { issueReceipt } from "@/lib/actions/oem";
import type { OemQuoteRow, OemReceiptKind, OemReceiptPaymentMethod } from "@/lib/oem/types";
import { OEM_PAYMENT_METHOD_LABEL_TH, OEM_RECEIPT_KIND_LABEL_TH } from "@/lib/oem/types";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const PAYMENT_METHODS: OemReceiptPaymentMethod[] = ["transfer", "cash", "other"];

/** "วันนี้" ตามเวลาไทย, YYYY-MM-DD — ใช้ en-CA เพราะ Intl จัดรูปแบบวันที่
 * ให้เป็น YYYY-MM-DD ตรงตามที่ <input type="date"> ต้องการพอดี โดยไม่ต้องพึ่ง
 * timezone ของเครื่องผู้ใช้ (เจ้าของร้านอาจเปิดจากเครื่องที่ตั้ง tz อื่น). */
function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** เดา kind จากตำแหน่งของยอดนี้ในดีล — ไม่ใช่ตัวเลือกอิสระที่ผู้ใช้กรอกเอง
 * (ดูหัวไฟล์). ยอมให้คลาดเคลื่อนเล็กน้อยจาก floating point ด้วยเกณฑ์ 1 สตางค์. */
function deriveKind(paidSoFar: number | null, outstanding: number | null, amount: number): OemReceiptKind {
  if (!paidSoFar || paidSoFar <= 0) return "deposit";
  if (outstanding != null && amount >= outstanding - 0.01) return "final";
  return "partial";
}

export function ReceiptIssueDialog({ quote, onClose, onSaved }: { quote: OemQuoteRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const hasReceived = !!quote.paidThb && quote.paidThb > 0;
  const suggested = hasReceived ? quote.outstandingThb : (quote.depositAmountThb ?? quote.outstandingThb);
  const [amountInput, setAmountInput] = useState(suggested != null && suggested > 0 ? String(suggested) : "");
  const [receivedDate, setReceivedDate] = useState(todayBangkok());
  const [paymentMethod, setPaymentMethod] = useState<OemReceiptPaymentMethod>("transfer");
  const [paymentRef, setPaymentRef] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  const amount = Number(amountInput);
  const outstanding = quote.outstandingThb;
  const validAmount = Number.isFinite(amount) && amount > 0;
  // เพดานจริงคือ outstanding — ถ้า outstanding เป็น null (ยังไม่มียอดรวม) หรือ
  // <= 0 (จ่ายครบ/เกินแล้ว) ห้ามกดบันทึกเลย ก่อนแม้แต่จะยิง request ออกไป
  // (0084 §6 ฝั่ง DB ปฏิเสธเหมือนกัน แต่ที่นี่คือด่านแรกไม่ให้กดได้ตั้งแต่ต้น).
  const overOutstanding = outstanding != null && amount > outstanding + 0.01;
  const blockedByOutstanding = outstanding == null || outstanding <= 0;
  const canSubmit = validAmount && !overOutstanding && !blockedByOutstanding && !!receivedDate;
  const kind = validAmount ? deriveKind(quote.paidThb, outstanding, amount) : null;

  function submit() {
    if (!canSubmit || !kind) return;
    startTransition(async () => {
      const result = await issueReceipt({
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
      toast.push("บันทึกรับเงินและออกใบเสร็จ/ใบกำกับภาษีแล้ว");
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`บันทึกรับเงิน — ${quote.quoteNo}`}>
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
        value={amountInput}
        onChange={(e) => setAmountInput(e.target.value)}
        disabled={blockedByOutstanding}
        className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base tabular-nums disabled:bg-zinc-100"
        aria-invalid={!validAmount || overOutstanding}
        aria-describedby="oem-receipt-amount-error"
      />
      {(overOutstanding || (amountInput !== "" && !validAmount)) && (
        <p id="oem-receipt-amount-error" className="mt-1 text-xs text-red-600">
          {overOutstanding ? `รับเกินยอดคงค้าง (${formatTHB(outstanding!)}) ไม่ได้` : "กรอกจำนวนเงินให้มากกว่า 0"}
        </p>
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
