"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { OrderStatus } from "@/lib/types";

interface ActionConfig {
  label: string;
  variant: "primary" | "danger";
  kind: "advance" | "ship" | "cancel";
}

// Action set per status — mirrors the DB trigger's allowed transitions
// exactly (supabase/migrations/0001_core_schema.sql
// validate_order_status_transition). oversold_hold is handled separately by
// OversoldAlertCard (decision #2: cancel-only), and completed/cancelled are
// terminal (no actions rendered).
const ACTIONS_BY_STATUS: Partial<Record<OrderStatus, ActionConfig[]>> = {
  new: [
    { label: "ยืนยันออเดอร์", variant: "primary", kind: "advance" },
    { label: "ยกเลิกออเดอร์", variant: "danger", kind: "cancel" },
  ],
  confirmed: [
    { label: "เตรียมจัดส่ง", variant: "primary", kind: "advance" },
    { label: "ยกเลิกออเดอร์", variant: "danger", kind: "cancel" },
  ],
  to_ship: [
    { label: "ยืนยันจัดส่งแล้ว", variant: "primary", kind: "ship" },
    { label: "ยกเลิกออเดอร์", variant: "danger", kind: "cancel" },
  ],
  shipped: [{ label: "ปิดออเดอร์ (สำเร็จ)", variant: "primary", kind: "advance" }],
};

export function StickyActionBar({
  status,
  busy,
  onAdvance,
  onShip,
  onCancel,
}: {
  status: OrderStatus;
  busy: boolean;
  onAdvance: () => void;
  onShip: () => void;
  onCancel: (reason: string) => void;
}) {
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [reason, setReason] = useState("");

  const actions = ACTIONS_BY_STATUS[status];
  if (!actions) return null;

  return (
    <>
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant}
            loading={busy}
            className="flex-1"
            onClick={() => {
              if (action.kind === "advance") onAdvance();
              else if (action.kind === "ship") onShip();
              else setCancelModalOpen(true);
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <Modal open={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title="ยกเลิกออเดอร์">
        <label htmlFor="cancel-reason" className="text-sm font-medium text-slate-700">
          เหตุผลการยกเลิก
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-base"
          placeholder="เช่น ลูกค้าขอยกเลิก, สินค้าหมด"
        />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setCancelModalOpen(false)}>
            ปิด
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={busy}
            onClick={() => {
              onCancel(reason);
              setCancelModalOpen(false);
            }}
          >
            ยืนยันยกเลิก
          </Button>
        </div>
      </Modal>
    </>
  );
}
