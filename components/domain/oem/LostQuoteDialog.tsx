"use client";

// LostQuoteDialog — shared by QuotesPageClient (list) and QuoteDetailClient
// (single quote). "lost" requires a reason (DB-enforced in
// oem_quote_set_status, 0062) — this dialog collects it.

import { useState, useTransition } from "react";
import { setQuoteStatus } from "@/lib/actions/oem";
import type { OemQuoteRow } from "@/lib/oem/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function LostQuoteDialog({
  quote,
  onClose,
  onConfirmed,
}: {
  quote: OemQuoteRow;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [lostTo, setLostTo] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!reason.trim()) return;
    startTransition(async () => {
      const result = await setQuoteStatus({ quoteId: quote.id, status: "lost", lostReason: reason.trim(), lostTo: lostTo.trim() || null });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกแพ้งาน ${quote.quoteNo} แล้ว`);
      onConfirmed();
    });
  }

  return (
    <Modal open onClose={onClose} title={`แพ้งาน — ${quote.quoteNo}`}>
      <label htmlFor="oem-lost-reason" className="text-sm font-medium text-zinc-700">
        เหตุผล (บังคับ)
      </label>
      <textarea
        id="oem-lost-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base"
        placeholder="เช่น ลูกค้าบอกราคาสูงกว่าที่อื่น"
      />
      <label htmlFor="oem-lost-to" className="mt-3 block text-sm font-medium text-zinc-700">
        ใครได้งานไป (ถ้ารู้)
      </label>
      <input
        id="oem-lost-to"
        type="text"
        value={lostTo}
        onChange={(e) => setLostTo(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base"
        placeholder="เช่น ร้าน XYZ"
      />
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="danger" className="flex-1" loading={pending} disabled={reason.trim().length === 0} onClick={confirm}>
          ยืนยันแพ้งาน
        </Button>
      </div>
    </Modal>
  );
}
