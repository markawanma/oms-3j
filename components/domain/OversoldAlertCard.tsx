"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/**
 * Decision #2 (Tech Lead, locked): oversold_hold MVP is cancel-only.
 * "หาสินค้าทดแทน" is intentionally NOT built here — fast-follow, tracked as
 * technical debt in the handoff report.
 */
export function OversoldAlertCard({ busy, onCancel }: { busy: boolean; onCancel: (reason: string) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      <section role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <h2 className="font-semibold">ของไม่พอสำหรับออเดอร์นี้</h2>
        </div>
        <p className="mt-1 text-sm text-red-700">
          ระบบจองสต็อกให้ไม่สำเร็จ (สินค้าอาจถูกขายหมดในช่องทางอื่นก่อน) ต้องยกเลิกออเดอร์นี้เพื่อไม่ให้ลูกค้ารอนาน
        </p>
        <Button variant="danger" className="mt-3 w-full sm:w-auto" onClick={() => setModalOpen(true)}>
          ยกเลิกออเดอร์
        </Button>
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="ยกเลิกออเดอร์ (ของไม่พอ)">
        <label htmlFor="oversold-cancel-reason" className="text-sm font-medium text-slate-700">
          เหตุผลการยกเลิก
        </label>
        <textarea
          id="oversold-cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-base"
          placeholder="เช่น สินค้าหมดสต็อกจริง"
        />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setModalOpen(false)}>
            ปิด
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={busy}
            onClick={() => {
              onCancel(reason);
              setModalOpen(false);
            }}
          >
            ยืนยันยกเลิก
          </Button>
        </div>
      </Modal>
    </>
  );
}
