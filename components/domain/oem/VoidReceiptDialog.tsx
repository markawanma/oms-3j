"use client";

// VoidReceiptDialog — "ยกเลิกใบเสร็จ" action (0084). Calls
// analytics.oem_receipt_void: issued -> void, ONE WAY, reason mandatory
// (DB-enforced) — there is no "un-void". The document's own number is
// permanently retired (never reused, never deleted from the list — see
// design-oem-payment-invoice.md §14.9), same pattern as LostQuoteDialog.

import { useState, useTransition } from "react";
import { voidReceipt } from "@/lib/actions/oem";
import type { OemReceiptRow } from "@/lib/oem/types";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function VoidReceiptDialog({
  receipt,
  onClose,
  onVoided,
}: {
  receipt: OemReceiptRow;
  onClose: () => void;
  onVoided: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!reason.trim()) return;
    startTransition(async () => {
      const result = await voidReceipt({ receiptId: receipt.id, reason: reason.trim() });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`ยกเลิกใบเสร็จ ${receipt.receiptNo} แล้ว`);
      onVoided();
    });
  }

  return (
    <Modal open onClose={onClose} title={`ยกเลิกใบเสร็จ — ${receipt.receiptNo}`}>
      <div className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800">
        <p className="font-semibold">ยกเลิกแล้วย้อนกลับไม่ได้</p>
        <p className="mt-1">
          เลขที่ <span className="font-medium">{receipt.receiptNo}</span> (ยอด {formatTHB(receipt.amountThb)}) จะถูกใช้ซ้ำอีกไม่ได้ตลอดไป — เอกสารยัง
          ปรากฏในรายการเสมอ (พร้อมลายน้ำ &quot;ยกเลิกแล้ว&quot;) เพื่อให้ตรวจสอบความต่อเนื่องของเลขที่ได้ ถ้าต้องรับเงินก้อนนี้จริง ให้ออกใบเสร็จใหม่หลังยกเลิก
        </p>
      </div>

      <label htmlFor="oem-void-receipt-reason" className="mt-3 block text-sm font-medium text-zinc-700">
        เหตุผลที่ยกเลิก (บังคับ)
      </label>
      <textarea
        id="oem-void-receipt-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base"
        placeholder="เช่น กรอกยอดผิด / ลูกค้าโอนซ้ำ"
      />

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          ปิด
        </Button>
        <Button type="button" variant="danger" className="flex-1" loading={pending} disabled={reason.trim().length === 0} onClick={confirm}>
          ยืนยันยกเลิกใบเสร็จ
        </Button>
      </div>
    </Modal>
  );
}
