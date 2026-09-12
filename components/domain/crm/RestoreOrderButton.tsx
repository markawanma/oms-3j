"use client";

// RestoreOrderButton — the one interactive leaf inside DeletedOrdersHistory
// (a plain Server Component, design §6 "(server)"). Split into its own
// "use client" file because Next.js applies "use client" per FILE, and an
// async Server Component (DeletedOrdersHistory itself calls getDeletedOrders
// directly) cannot share a file with hooks/onClick handlers — isolating the
// interactivity to this one small leaf keeps the table itself server-
// rendered instead of lifting all 50 rows into client state. Not an
// explicitly-named file in the task brief's file list, but required by this
// Next.js constraint — see delivery notes.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, RotateCcw } from "lucide-react";
import { restoreDeletedOrders } from "@/lib/actions/import-missing-orders";
import { isMissingOrdersWriteDisabledError, type DeletedOrderRow } from "@/lib/import/missing-orders-types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { formatTHB } from "@/lib/format";

export function RestoreOrderButton({ row }: { row: DeletedOrderRow }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same C-2 write-switch caveat as MissingOrdersPanel.tsx (see that file's
  // comment): no status action exists to know ahead of time, so this is
  // learned reactively per-button on first failed attempt and then kept
  // disabled for the rest of this button's lifetime. Each row's button
  // discovers this independently (no shared state lifted across rows) —
  // an accepted trade-off given time constraints, not a correctness issue.
  const [writeDisabled, setWriteDisabled] = useState(false);

  async function handleRestore() {
    setRestoring(true);
    setError(null);
    const res = await restoreDeletedOrders([row.id]);
    setRestoring(false);
    if (!res.ok) {
      if (isMissingOrdersWriteDisabledError(res.error)) {
        setWriteDisabled(true);
        return;
      }
      setError(res.error);
      toast.push(res.error, "error");
      return;
    }
    setOpen(false);
    toast.push(`กู้คืนออเดอร์ ${row.sourceOrderNo} แล้ว`);
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={writeDisabled}
        title={writeDisabled ? "ปุ่มกู้คืนปิดอยู่บนเซิร์ฟเวอร์นี้ (รอ Auth A2)" : undefined}
        onClick={() => setOpen(true)}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        กู้คืน
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        confirmBeforeClose={() => !restoring}
        title="ยืนยันการกู้คืนออเดอร์"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            กู้คืนออเดอร์ <span className="font-semibold">{row.sourceOrderNo}</span> ({formatTHB(row.revenueThb)}) กลับเข้าระบบ?
          </p>
          {writeDisabled && (
            <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
              <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
              ปุ่มกู้คืนปิดอยู่บนเซิร์ฟเวอร์นี้ (รอ Auth A2)
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={restoring}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleRestore()}
              loading={restoring}
              disabled={writeDisabled}
            >
              ยืนยันกู้คืน
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
