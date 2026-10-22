"use client";

// GemConfirm — กล่องยืนยันการกระทำที่ย้อนไม่ได้/ล้างข้อมูล: โฟกัสเริ่มที่ปุ่มปลอดภัย (ยกเลิก/ไม่ล้าง) — UX §11 (กล่องยืนยันทุกใบ focus เริ่มที่ปุ่มปลอดภัย)

import { useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { GemErrorLine, useFocusAfterOpen } from "@/components/domain/gems/ui";

export function GemConfirm({
  title,
  message,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  danger = true,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useFocusAfterOpen(cancel);
  return (
    <Modal open onClose={onCancel} title={title}>
      <div className="space-y-3" data-testid="gem-confirm">
        <p className="text-base text-zinc-900 break-words">{message}</p>
        <GemErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancel} type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
