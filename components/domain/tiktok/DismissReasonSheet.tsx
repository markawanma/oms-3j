"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// Reuses the Modal/bottom-sheet pattern already established by
// components/domain/AdjustStockSheet.tsx (design §5: "โปรเจกต์มีอยู่แล้ว
// ใช้ต่อ ไม่คิดใหม่"). Reason is optional (design §5: "เก็บไว้ปรับ AI
// ภายหลัง ไม่ใช่บังคับกรอก") — closing/submitting with nothing selected
// still dismisses the card, just with `dismissReason: null`.
const REASONS: { value: string; label: string }[] = [
  { value: "not_relevant", label: "ไม่เกี่ยวข้อง" },
  { value: "tried_no_result", label: "ลองแล้วไม่ได้ผล" },
  { value: "not_enough_data", label: "ข้อมูลไม่พอ" },
];

export function DismissReasonSheet({
  open,
  title,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Recommendation title, shown in the sheet header for context. */
  title: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState<string>("");

  // Reset the choice each time the sheet re-opens for a (possibly different) card.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={`ปัดทิ้ง — ${title}`}>
      <p className="text-sm text-zinc-500">บอกเหตุผลสั้นๆ (ไม่บังคับ) — เก็บไว้ปรับคำแนะนำในอนาคต</p>
      <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="เหตุผลที่ปัดทิ้ง">
        {REASONS.map((r) => (
          <label
            key={r.value}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700 has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50"
          >
            <input
              type="radio"
              name="dismiss-reason"
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="h-4 w-4"
            />
            {r.label}
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="primary" className="flex-1" loading={busy} onClick={() => onSubmit(reason || null)}>
          ปัดทิ้ง
        </Button>
      </div>
    </Modal>
  );
}
