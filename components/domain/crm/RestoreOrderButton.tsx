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
import { RotateCcw } from "lucide-react";
import { restoreDeletedOrders } from "@/lib/actions/import-missing-orders";
import type { DeletedOrderRow } from "@/lib/import/missing-orders-types";
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

  async function handleRestore() {
    setRestoring(true);
    setError(null);
    const res = await restoreDeletedOrders([row.id]);
    setRestoring(false);
    if (!res.ok) {
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
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
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
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={restoring}>
              ยกเลิก
            </Button>
            <Button type="button" variant="primary" onClick={() => void handleRestore()} loading={restoring}>
              ยืนยันกู้คืน
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
