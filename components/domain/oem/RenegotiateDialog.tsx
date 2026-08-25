"use client";

// RenegotiateDialog — QuoteDetailClient's "ลูกค้าต่อราคา" action (T6v2).
// Calls oem_quote_renegotiate (0075): copies the quoted items verbatim into a
// NEW quote row with a different discount, marks the original 'superseded'.
// Only shown for a 'quoted', not-yet-expired quote (page-level gate; the RPC
// re-checks both server-side).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renegotiateQuote } from "@/lib/actions/oem";
import type { OemQuoteRow } from "@/lib/oem/types";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function RenegotiateDialog({ quote, onClose }: { quote: OemQuoteRow; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [discountThb, setDiscountThb] = useState(String(quote.discountThb || 0));
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const amount = Number(discountThb);
  const validAmount = Number.isFinite(amount) && amount >= 0;

  function confirm() {
    if (!validAmount) return;
    startTransition(async () => {
      const result = await renegotiateQuote({ quoteId: quote.id, newDiscountThb: amount, reason: reason.trim() || null });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ออกใบต่อราคาใหม่แล้ว");
      router.push(`/oem/quotes/${result.data.quoteId}`);
    });
  }

  return (
    <Modal open onClose={onClose} title={`ลูกค้าต่อราคา — ${quote.quoteNo}`}>
      <p className="text-sm text-zinc-600">
        ใบเดิม ({quote.quoteNo}) จะถูกทำเครื่องหมายว่า &quot;ถูกแทนที่&quot; และออกใบใหม่แทน — รายการ/ราคาต่อชิ้นยังคงเดิม เปลี่ยนได้เฉพาะส่วนลด
      </p>
      <p className="mt-1 text-xs text-zinc-400">ยอดก่อนส่วนลดเดิม {formatTHB(quote.quoteTotal ?? 0)}</p>

      <label htmlFor="oem-renegotiate-discount" className="mt-3 block text-sm font-medium text-zinc-700">
        ส่วนลดใหม่ (บาท)
      </label>
      <input
        id="oem-renegotiate-discount"
        type="number"
        inputMode="decimal"
        min={0}
        step="1"
        value={discountThb}
        onChange={(e) => setDiscountThb(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base"
      />

      <label htmlFor="oem-renegotiate-reason" className="mt-3 block text-sm font-medium text-zinc-700">
        เหตุผล (บังคับถ้า margin หลังหักส่วนลดต่ำกว่า floor)
      </label>
      <textarea
        id="oem-renegotiate-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base"
        placeholder="เช่น ลูกค้าขอลดเพิ่มเพื่อปิดออเดอร์"
      />

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={pending} disabled={!validAmount} onClick={confirm}>
          ยืนยันต่อราคา
        </Button>
      </div>
    </Modal>
  );
}
