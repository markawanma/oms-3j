"use client";

// ProductionCancelDialog — /production/[id]'s "ยกเลิกใบ" action
// (analytics.production_order_cancel, 0131 §13). Reason is OPTIONAL
// (p_reason default null in the RPC — unlike OEM's LostQuoteDialog, which
// hard-requires one) so this mirrors that instead of copying LostQuoteDialog
// verbatim.

import { useState, useTransition } from "react";
import { cancelProductionOrder } from "@/lib/actions/production";
import type { ProductionOrderRow } from "@/lib/production/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function ProductionCancelDialog({
  order,
  onClose,
  onCancelled,
}: {
  order: ProductionOrderRow;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelProductionOrder({ productionOrderId: order.id, reason: reason.trim() || null });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`ยกเลิกใบผลิต ${order.poNo} แล้ว`);
      onCancelled();
    });
  }

  return (
    <Modal open onClose={onClose} title={`ยกเลิกใบผลิต — ${order.poNo}`}>
      <p className="rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-800">
        ยกเลิกแล้วแก้ไขกลับไม่ได้ — ต้องเปิดใบผลิตใหม่ถ้าจะผลิตจริง (ใบที่ &quot;เข้าสต็อกแล้ว&quot; ยกเลิกไม่ได้อีก)
      </p>
      <label htmlFor="po-cancel-reason" className="mt-3 block text-sm font-medium text-zinc-700">
        เหตุผล (ไม่บังคับ)
      </label>
      <textarea
        id="po-cancel-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base"
        placeholder="เช่น กรอกจำนวน/SKU ผิด สร้างใบใหม่แทน"
      />
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={pending}>
          ปิด
        </Button>
        <Button type="button" variant="danger" className="flex-1" loading={pending} onClick={confirm}>
          ยืนยันยกเลิกใบ
        </Button>
      </div>
    </Modal>
  );
}
