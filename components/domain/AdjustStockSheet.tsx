"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { StockRow } from "@/lib/types";

export function AdjustStockSheet({
  stock,
  busy,
  onClose,
  onSubmit,
}: {
  stock: StockRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (productId: string, newOnHand: number) => void;
}) {
  const [value, setValue] = useState<string>("");

  if (!stock) return null;

  // Reset the input whenever a different product is opened.
  const displayValue = value === "" ? String(stock.qtyOnHand) : value;

  return (
    <Modal open={!!stock} onClose={onClose} title={`ปรับสต็อก — ${stock.name}`}>
      <p className="text-sm text-zinc-500">
        จำนวนที่จองแล้ว ({stock.qtyReserved}) แก้ไขไม่ได้จากหน้านี้ — ปรับได้เฉพาะจำนวนในสต็อกจริง (on hand) เช่น หลังนับสต็อกจริง หรือสินค้าเสียหาย
      </p>
      <label htmlFor="new-on-hand" className="mt-3 block text-sm font-medium text-zinc-700">
        จำนวนในสต็อกจริง (on hand) ใหม่
      </label>
      <input
        id="new-on-hand"
        type="number"
        min={0}
        step={1}
        value={displayValue}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-base"
      />
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          loading={busy}
          onClick={() => {
            const parsed = Number(displayValue);
            if (Number.isInteger(parsed) && parsed >= 0) {
              onSubmit(stock.productId, parsed);
            }
          }}
        >
          บันทึก
        </Button>
      </div>
    </Modal>
  );
}
