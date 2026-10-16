"use client";

// InvoiceIssueDialog — "ออกใบแจ้งหนี้" (0179 oem_invoice_issue) · เปิดจาก InvoiceSection
//
// 🔴 ไม่มี amount ใน payload โดยเด็ดขาด: ยอดที่แสดงในกล่องสรุปมาจาก quote (depositAmountThb / outstandingThb —
// DB คำนวณสดทุกครั้งที่อ่าน) แสดงอย่างเดียว · server action ไม่มีช่องรับยอด · DB อ่านยอดจาก v_oem_quote เอง
// ส่งแค่: quoteId, kind, dueDate, note, replacesInvoiceId? (ชนิดมาจาก resolveInvoiceKind ที่ InvoiceSection — ไม่มี radio ให้เลือก)
//
// 4 state: ปกติ · loading (ปุ่ม loading ช่อง disabled ปิดไม่ได้) · error (role="alert" ค้าง + "รีเฟรชข้อมูล") ·
// success (เนื้อหาเปลี่ยนเป็น "ออกใบแจ้งหนี้ IV-… แล้ว" + [พิมพ์ใบแจ้งหนี้] โฟกัสที่ปุ่มพิมพ์)

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Printer } from "lucide-react";
import { issueInvoice } from "@/lib/actions/oem";
import type { IssuedInvoice, OemInvoiceKind, OemQuoteRow } from "@/lib/oem/types";
import { OEM_INVOICE_KIND_LABEL_TH } from "@/lib/oem/types";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { addDaysIso, todayBangkok } from "@/lib/oem/dates";
import { OEM_NOTE_MAX, approvalNoteIssue, fmtPct, oemNotePresent } from "@/lib/oem/display";
import { issueButtonLabelTh } from "@/lib/oem/invoiceDisplay";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** ค่าเริ่มต้นของกำหนดชำระใบคงเหลือ / วันที่ระบุเอง (มติ: +7 วัน) */
export const INVOICE_DEFAULT_DUE_DAYS = 7;
/** DB: กำหนดชำระต้องไม่ย้อนหลัง และไม่เกิน +365 วัน (นับจากวันนี้ไทย) */
export const INVOICE_MAX_DUE_DAYS = 365;

/** ตรวจวันกำหนดชำระ (pre-check — DB ตัดสินซ้ำ) · null = ใช้ได้ */
export function dueDateIssue(due: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return "เลือกวันกำหนดชำระ";
  if (due < today) return "วันกำหนดชำระต้องไม่ย้อนหลัง";
  if (due > addDaysIso(today, INVOICE_MAX_DUE_DAYS)) return `วันกำหนดชำระต้องไม่เกิน ${INVOICE_MAX_DUE_DAYS} วันนับจากวันนี้`;
  return null;
}

export function InvoiceIssueDialog({
  quote,
  sellerProfile,
  kind,
  isFull,
  replacesInvoiceId = null,
  onClose,
  onChanged,
}: {
  quote: OemQuoteRow;
  sellerProfile: SellerProfile;
  /** ชนิดที่ resolveInvoiceKind ตัดสินแล้ว — dialog ไม่เลือกเอง */
  kind: OemInvoiceKind;
  isFull: boolean;
  /** ออกแทนใบที่เพิ่ง void (โหมด "ยกเลิกและออกใหม่") */
  replacesInvoiceId?: string | null;
  onClose: () => void;
  /** ข้อมูลในหน้าเปลี่ยนแล้ว (ออกใบสำเร็จ / กด "รีเฟรชข้อมูล") → router.refresh */
  onChanged: () => void;
}) {
  const today = todayBangkok();
  const isDeposit = kind === "deposit";
  const [dueMode, setDueMode] = useState<"before_work" | "custom">("before_work");
  const [customDue, setCustomDue] = useState(addDaysIso(today, INVOICE_DEFAULT_DUE_DAYS));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedInvoice | null>(null);
  // pending เป็น state ตรงๆ (ไม่ใช้ useTransition) — React 18 ไม่ติดตาม async transition · ใช้ได้เหมือนกันทั้ง React 18/19
  const [pending, setPending] = useState(false);
  const printRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (issued) printRef.current?.focus();
  }, [issued]);

  // ยอดที่แสดง — อ่านจาก quote อย่างเดียว (ไม่ใช่ค่าที่ส่ง)
  const shownAmount = isDeposit ? quote.depositAmountThb : quote.outstandingThb;
  const needsDate = !isDeposit || dueMode === "custom";
  const dateIssue = needsDate ? dueDateIssue(customDue, today) : null;
  const noteShapeIssue = approvalNoteIssue(note, "หมายเหตุ");
  const noteIssue = noteShapeIssue ?? (note.trim() !== "" && !oemNotePresent(note) ? "หมายเหตุต้องมีตัวอักษรหรือตัวเลขจริง" : null);
  const canSubmit = !pending && dateIssue === null && noteIssue === null;
  const noteLen = [...note].length;

  const title = `${issueButtonLabelTh({ kind, isFull, block: null })} — ${quote.quoteNo}`;
  const expired = quote.isExpiredTh || quote.status === "expired";

  const kindDetail = isDeposit
    ? quote.depositMode === "pct" && quote.depositInput != null
      ? `มัดจำ ${fmtPct(quote.depositInput)}`
      : "มัดจำตามที่ตกลง"
    : isFull
      ? "ยอดเต็ม"
      : "ยอดคงเหลือ";
  // บรรทัดภาษี: ตัดสินจาก seller.vatRegistered ตัวเดียว (ไม่จด = ไม่มีคำว่าภาษีมูลค่าเพิ่มที่ไหนเลย) · ไม่มีตัวเลข — DB แยกยอดตอนออกใบ
  const taxLine = !sellerProfile.vatRegistered
    ? null
    : quote.vatMode === "breakdown"
      ? "แสดงแยกภาษีมูลค่าเพิ่มบนใบ (คำนวณตอนออกใบ)"
      : "ราคารวมภาษีมูลค่าเพิ่มแล้ว";

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    // "ชำระก่อนเริ่มงาน" → ส่ง null ให้ DB ใช้วันที่ไทยของตัวเอง (ไม่พึ่งนาฬิกาเครื่องผู้ใช้ · security L1)
    const dueDate = needsDate ? customDue : null;
    try {
      // 🔴 payload ไม่มี amount — IssueInvoiceInput ไม่มี field ยอดโดยตั้งใจ
      const result = await issueInvoice({
        quoteId: quote.id,
        kind,
        dueDate,
        note: note.trim() === "" ? null : note.trim(),
        ...(replacesInvoiceId ? { replacesInvoiceId } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIssued(result.data);
      onChanged();
    } catch {
      // เครือข่ายหลุด/action throw — ไม่รู้ว่าออกใบไปแล้วหรือยัง: บอกให้รีเฟรชดูรายการก่อนกดซ้ำ (กันออกซ้ำ → DB กันด้วยด่าน invoice_open อยู่แล้ว)
      setError("เชื่อมต่อไม่สำเร็จ — ไม่แน่ใจว่าออกใบไปแล้วหรือยัง กด \"รีเฟรชข้อมูล\" เพื่อตรวจรายการก่อนลองใหม่");
    } finally {
      setPending(false);
    }
  }

  function openPrint(id: string) {
    // window.open จากคลิกตรง (ไม่ใช่ใน async) — กัน popup blocker
    window.open(`/oem/invoices/${id}/print`, "_blank", "noopener,noreferrer");
  }

  if (issued) {
    return (
      <Modal open onClose={onClose} title={title}>
        <div role="status" className="flex items-start gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-3 text-green-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-base font-bold">ออกใบแจ้งหนี้ {issued.invoiceNo} แล้ว</p>
            <p className="mt-0.5 text-xs">ใบนี้แก้ไขไม่ได้ ถ้าผิดต้องยกเลิกแล้วออกใหม่ (เลขเดิมใช้ซ้ำไม่ได้)</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            ปิด
          </Button>
          <Button ref={printRef} type="button" variant="primary" className="flex-1" onClick={() => openPrint(issued.id)}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            พิมพ์ใบแจ้งหนี้
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={title} confirmBeforeClose={() => !pending}>
      {expired && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            ใบเสนอราคานี้หมดอายุแล้ว{quote.quoteValidUntil ? ` (ยืนราคาถึง ${formatThaiDateOnly(quote.quoteValidUntil)})` : ""} ยังออกใบแจ้งหนี้ได้ แต่ควรยืนยันราคากับลูกค้าก่อนส่ง
          </p>
        </div>
      )}

      <dl className="rounded-md bg-zinc-50 px-3 py-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">ชนิด</dt>
          <dd className="text-right font-medium text-zinc-800">
            {OEM_INVOICE_KIND_LABEL_TH[kind]} · {kindDetail}
          </dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <dt className="text-zinc-500">ยอดที่จะแจ้ง</dt>
          <dd className="whitespace-nowrap text-xl font-bold tabular-nums text-zinc-900">{shownAmount != null ? formatTHB(shownAmount) : "—"}</dd>
        </div>
        <div className="mt-1 flex justify-between gap-3 text-zinc-600">
          <dt>ยอดรวมใบเสนอราคา</dt>
          <dd className="whitespace-nowrap tabular-nums">{quote.grandTotal != null ? formatTHB(quote.grandTotal) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 text-zinc-600">
          <dt>รับแล้ว</dt>
          <dd className="whitespace-nowrap tabular-nums">{formatTHB(quote.paidThb ?? 0)}</dd>
        </div>
        {taxLine && <p className="mt-1.5 border-t border-zinc-200 pt-1.5 text-xs text-zinc-600">{taxLine}</p>}
      </dl>

      {isDeposit ? (
        <fieldset className="mt-3" disabled={pending}>
          <legend className="text-sm font-medium text-zinc-700">กำหนดชำระ</legend>
          <label className="mt-1 flex min-h-11 items-center gap-2 text-sm text-zinc-800">
            <input type="radio" name="oem-invoice-due-mode" checked={dueMode === "before_work"} onChange={() => setDueMode("before_work")} className="h-4 w-4" />
            ชำระก่อนเริ่มงาน
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-800">
            <input type="radio" name="oem-invoice-due-mode" checked={dueMode === "custom"} onChange={() => setDueMode("custom")} className="h-4 w-4" />
            ระบุวันที่เอง
          </label>
        </fieldset>
      ) : null}

      {needsDate && (
        <div className={isDeposit ? "mt-1 pl-6" : "mt-3"}>
          <label htmlFor="oem-invoice-due" className="block text-sm font-medium text-zinc-700">
            {isDeposit ? "วันกำหนดชำระ" : "กำหนดชำระ"}
          </label>
          <input
            id="oem-invoice-due"
            type="date"
            value={customDue}
            min={today}
            max={addDaysIso(today, INVOICE_MAX_DUE_DAYS)}
            onChange={(e) => setCustomDue(e.target.value)}
            disabled={pending}
            aria-invalid={dateIssue !== null}
            aria-describedby="oem-invoice-due-help"
            className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base disabled:bg-zinc-100"
          />
          <p id="oem-invoice-due-help" className={`mt-1 text-xs ${dateIssue ? "text-red-600" : "text-zinc-500"}`}>
            {dateIssue ?? (isDeposit ? "เลือกวันที่ลูกค้าต้องชำระมัดจำภายใน" : "ออกใบตอนส่งมอบงาน — ค่าเริ่มต้น 7 วันหลังออกใบ")}
          </p>
        </div>
      )}

      <label htmlFor="oem-invoice-note" className="mt-3 block text-sm font-medium text-zinc-700">
        หมายเหตุถึงลูกค้า (ไม่บังคับ) — พิมพ์บนใบแจ้งหนี้
      </label>
      <textarea
        id="oem-invoice-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        disabled={pending}
        aria-invalid={noteIssue !== null}
        aria-describedby="oem-invoice-note-help"
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base disabled:bg-zinc-100"
      />
      <p id="oem-invoice-note-help" className={`mt-0.5 flex justify-between gap-2 text-xs ${noteIssue ? "text-red-600" : "text-zinc-400"}`}>
        <span>{noteIssue ?? ""}</span>
        <span className="tabular-nums">
          {noteLen}/{OEM_NOTE_MAX}
        </span>
      </p>

      <p className="mt-3 rounded-md bg-zinc-50 px-2.5 py-2 text-xs text-zinc-600">
        กดออกแล้วจะได้เลขที่ IV-ปีเดือน-ลำดับ ทันที แก้ไขไม่ได้ ถ้าผิดต้องยกเลิกแล้วออกใหม่ (เลขเดิมใช้ซ้ำไม่ได้)
      </p>

      {error && (
        <div role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-sm text-red-800">
          <p>{error}</p>
          <button
            type="button"
            className="mt-1 min-h-11 text-sm font-semibold text-red-800 underline hover:text-red-900"
            onClick={() => {
              onChanged();
              onClose();
            }}
          >
            รีเฟรชข้อมูล
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" disabled={pending} onClick={onClose}>
          ปิด
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={pending} disabled={!canSubmit} onClick={submit}>
          ออกใบแจ้งหนี้{shownAmount != null ? ` ${formatTHB(shownAmount)}` : ""}
        </Button>
      </div>
    </Modal>
  );
}
