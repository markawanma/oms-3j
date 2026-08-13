"use client";

// HeroWatchForm — add/edit one hero-SKU watch entry. Reused for both flows:
// "add" (no initialProductId, free product picker) and "edit" (initialProductId
// set, picker locked to that product) since the RPC underneath is a single
// upsert (0037 hero_watch_add: ON CONFLICT DO UPDATE threshold/note).

import { useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";
import type { ProductRow } from "@/lib/catalog/types";
import type { HeroStockRow } from "@/lib/stock/types";
import { addHeroWatch } from "@/lib/actions/hero-stock";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function HeroWatchForm({
  products,
  existingRows,
  initialProductId,
  onDone,
  onCancel,
}: {
  products: ProductRow[];
  existingRows: HeroStockRow[];
  initialProductId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const existingMap = useMemo(() => new Map(existingRows.map((r) => [r.productId, r])), [existingRows]);

  const [productId, setProductId] = useState(initialProductId ?? "");
  const initialExisting = initialProductId ? existingMap.get(initialProductId) : undefined;
  const [threshold, setThreshold] = useState(String(initialExisting?.lowStockThreshold ?? 3));
  const [note, setNote] = useState(initialExisting?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEditing = Boolean(initialProductId);
  const selectedExisting = productId ? existingMap.get(productId) : undefined;

  function handleProductChange(id: string) {
    setProductId(id);
    const row = existingMap.get(id);
    setThreshold(String(row?.lowStockThreshold ?? 3));
    setNote(row?.note ?? "");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!productId) {
      setError("กรุณาเลือกสินค้า");
      return;
    }
    const th = Number(threshold);
    if (!Number.isFinite(th) || !Number.isInteger(th) || th < 0) {
      setError("เกณฑ์เตือนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }

    startTransition(async () => {
      const result = await addHeroWatch(productId, th, note.trim() || null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.push(isEditing || selectedExisting ? "บันทึกเกณฑ์เตือนแล้ว" : "เพิ่ม SKU เฝ้าดูแล้ว");
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label htmlFor="hero-product" className="mb-1 block text-sm font-medium text-zinc-700">
          สินค้า
        </label>
        <select
          id="hero-product"
          value={productId}
          onChange={(e) => handleProductChange(e.target.value)}
          disabled={isEditing}
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
        >
          <option value="">— เลือกสินค้า —</option>
          {products.map((p) => (
            <option key={p.productId} value={p.productId}>
              {p.sku} — {p.name}
              {existingMap.has(p.productId) ? " (กำลังเฝ้าดูอยู่)" : ""}
              {!p.isActive ? " (ปิดใช้งาน)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="hero-threshold" className="mb-1 block text-sm font-medium text-zinc-700">
          เกณฑ์เตือน (เหลือเท่าไหร่ถือว่าใกล้หมด)
        </label>
        <input
          id="hero-threshold"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm"
        />
      </div>

      <div>
        <label htmlFor="hero-note" className="mb-1 block text-sm font-medium text-zinc-700">
          โน้ต (ถ้ามี)
        </label>
        <input
          id="hero-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น ตัวชูไลฟ์วันนี้"
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isEditing || selectedExisting ? "บันทึก" : "เพิ่ม"}
        </Button>
      </div>
    </form>
  );
}
