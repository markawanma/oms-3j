"use client";

// ShopConfirmBox — กล่องยืนยัน 2 ปุ่มของหน้างาน (ล้างพลอยออกจากใบ · บันทึกโดยไม่มีพลอย · ทิ้งการแก้พลอย) — focus เริ่มที่ปุ่มปลอดภัยเสมอ
// ปุ่มปลอดภัย = ปุ่มหลัก (primary) · ปุ่มเสี่ยง = ปุ่มรอง · Esc/พื้นหลัง = ทางปลอดภัย (onSafe)

import { useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { useFocusAfterOpen } from "@/components/domain/gems/ui";

export function ShopConfirmBox({ title, body, safe, risky, onSafe, onRisky, testId }: { title: string; body: string; safe: string; risky: string; onSafe: () => void; onRisky: () => void; testId: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusAfterOpen(ref);
  return (
    <Modal open onClose={onSafe} title={title}>
      <div className="space-y-3" data-testid={testId}>
        <p className="text-lg text-zinc-900">{body}</p>
        <div className="flex flex-col gap-2">
          <button ref={ref} type="button" onClick={onSafe} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-primary-600 px-5 text-xl font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            {safe}
          </button>
          <BigButton type="button" tone="secondary" onClick={onRisky}>
            {risky}
          </BigButton>
        </div>
      </div>
    </Modal>
  );
}
