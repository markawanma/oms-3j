"use client";

// VoidInvoiceDialog — "ยกเลิกใบแจ้งหนี้" (0179 oem_invoice_void). ลอก VoidReceiptDialog:
// issued -> void ทางเดียว ไม่มี "ยกเลิกการยกเลิก" · เหตุผลบังคับ (ภายในร้านเท่านั้น ไม่พิมพ์บนใบ — DB เก็บ แต่ PrintableInvoice ไม่มี field)
// เลขที่ใบที่ยกเลิกใช้ซ้ำไม่ได้ตลอดไป · ใบยังอยู่ในรายการเสมอ
//
// โหมด "stale" (กด "ยกเลิกและออกใหม่"): ใบนี้ยอดไม่ตรงกับดีลแล้ว (ต่อราคา/รับเงินไม่อ้างใบ) — เหตุผลมีค่าเริ่ม ·
// สำเร็จแล้วแจ้ง onVoided({ reissueReplacing: id }) ให้ InvoiceSection เปิด InvoiceIssueDialog ต่อ (ส่ง replacesInvoiceId)
// ใบที่ชำระแล้วไม่มีปุ่มเปิด dialog นี้ (DB ปฏิเสธ invoice_paid — ต้องยกเลิกใบเสร็จก่อน)

import { useState } from "react";
import { voidInvoice } from "@/lib/actions/oem";
import type { OemInvoiceRow } from "@/lib/oem/types";
import { OEM_NOTE_MAX, approvalNoteIssue, oemNotePresent } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export const STALE_VOID_DEFAULT_REASON = "ยอดเปลี่ยนหลังออกใบ";

export interface InvoiceVoidedInfo {
  /** มีค่า = เปิด issue dialog ต่อ โดยออกแทนใบนี้ */
  reissueReplacing: string | null;
}

export function VoidInvoiceDialog({
  invoice,
  mode,
  onClose,
  onVoided,
}: {
  invoice: Pick<OemInvoiceRow, "id" | "invoiceNo" | "amountThb">;
  mode: "normal" | "stale";
  onClose: () => void;
  onVoided: (info: InvoiceVoidedInfo) => void;
}) {
  const toast = useToast();
  const isStale = mode === "stale";
  const [reason, setReason] = useState(isStale ? STALE_VOID_DEFAULT_REASON : "");
  const [error, setError] = useState<string | null>(null);
  // pending เป็น state ตรงๆ — React 18 ไม่ติดตาม async transition
  const [pending, setPending] = useState(false);

  const reasonShapeIssue = approvalNoteIssue(reason, "เหตุผล");
  const canConfirm = oemNotePresent(reason) && reasonShapeIssue === null;
  const reasonLen = [...reason].length;

  async function confirm() {
    if (!canConfirm || pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await voidInvoice({ invoiceId: invoice.id, reason: reason.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.push(`ยกเลิกใบแจ้งหนี้ ${invoice.invoiceNo} แล้ว`);
      onVoided({ reissueReplacing: isStale ? invoice.id : null });
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ — ไม่แน่ใจว่ายกเลิกไปแล้วหรือยัง รีเฟรชหน้าเพื่อตรวจสถานะใบก่อนลองใหม่");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`ยกเลิกใบแจ้งหนี้ — ${invoice.invoiceNo}`} confirmBeforeClose={() => !pending}>
      {isStale && (
        <p className="mb-2 rounded-md bg-orange-50 px-2.5 py-2 text-sm text-orange-800">
          ยอดใบเสนอราคาหรือเงินที่รับเปลี่ยนไปหลังออกใบนี้
        </p>
      )}
      <div className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800">
        <p className="font-semibold">ยกเลิกแล้วย้อนกลับไม่ได้</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            เลขที่ <span className="font-medium">{invoice.invoiceNo}</span> (ยอด <span className="whitespace-nowrap tabular-nums">{formatTHB(invoice.amountThb)}</span>)
            ใช้ซ้ำไม่ได้ตลอดไป
          </li>
          <li>ใบยังอยู่ในรายการ (ขึ้น &ldquo;ยกเลิกแล้ว&rdquo;)</li>
          <li>ถ้าลูกค้าได้รับใบนี้ไปแล้ว ต้องแจ้งลูกค้าว่าใช้ไม่ได้</li>
          <li>ต้องแจ้งยอดใหม่ → ออกใบใหม่ได้หลังยกเลิก</li>
        </ul>
      </div>

      <label htmlFor="oem-void-invoice-reason" className="mt-3 block text-sm font-medium text-zinc-700">
        เหตุผลที่ยกเลิก (บังคับ · ใช้ภายในร้าน ไม่พิมพ์บนใบ)
      </label>
      <textarea
        id="oem-void-invoice-reason"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
        rows={3}
        disabled={pending}
        aria-invalid={reasonShapeIssue !== null}
        aria-describedby="oem-void-invoice-reason-count"
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base disabled:bg-zinc-100"
        placeholder="เช่น ต่อราคา ยอดเปลี่ยน / ลูกค้าโอนยอดต่าง / กรอกกำหนดชำระผิด"
      />
      <p id="oem-void-invoice-reason-count" className={`mt-0.5 text-right text-xs tabular-nums ${reasonLen > OEM_NOTE_MAX ? "text-red-600" : "text-zinc-400"}`}>
        {reasonLen}/{OEM_NOTE_MAX}
      </p>
      {reasonShapeIssue && <p className="mt-1 text-xs text-red-600">{reasonShapeIssue}</p>}

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" disabled={pending} onClick={onClose}>
          ปิด
        </Button>
        <Button type="button" variant="danger" className="flex-1" loading={pending} disabled={!canConfirm} onClick={confirm}>
          {isStale ? "ยกเลิกและออกใบใหม่" : "ยืนยันยกเลิกใบแจ้งหนี้"}
        </Button>
      </div>
    </Modal>
  );
}
