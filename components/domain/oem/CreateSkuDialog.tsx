"use client";

// CreateSkuDialog — "+ สินค้าใหม่" trigger next to QuoteJobItemCard's SKU
// picker (Phase 1a, docs/3j-jewelry/oem/design-email-sku-phase1.md). Picks an
// existing prefix config + a product name, calls createCatalogSku, and hands
// the resulting {productId, sku, name} straight to onCreated — the SAME
// callback the SKU picker itself uses (onSelectSku in QuoteJobItemCard), so
// the item form fills in exactly the way selecting an existing SKU does
// (productId/skuSnapshot/productNameSnapshot — no new fields introduced).
//
// No config yet (prefixes.length === 0, not loading, no fetch error) → the
// form is replaced by a message + link to /catalog/sku-prefix, never a
// broken/empty dropdown (design: "ไม่มี config → raise ชี้ไปหน้า config").

import { useState, useTransition } from "react";
import Link from "next/link";
import { createCatalogSku } from "@/lib/actions/catalog-sku";
import type { SkuPrefixRow } from "@/lib/catalog/sku-prefix";
import { SKU_WORK_TYPE_LABEL_TH } from "@/lib/catalog/sku-prefix";
import type { OemProductOption } from "@/lib/oem/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900";
const labelCls = "mt-3 block text-sm font-medium text-zinc-700";

function prefixOptionLabel(p: SkuPrefixRow): string {
  return `${p.kindLabel} · ${SKU_WORK_TYPE_LABEL_TH[p.workType]} (${p.prefix})`;
}

export function CreateSkuDialog({
  open,
  onClose,
  prefixes,
  prefixesLoading,
  prefixesError,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  prefixes: SkuPrefixRow[];
  prefixesLoading: boolean;
  prefixesError: string | null;
  onCreated: (product: OemProductOption) => void;
}) {
  const toast = useToast();
  const [prefixId, setPrefixId] = useState("");
  const [name, setName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();

  function handleClose() {
    setPrefixId("");
    setName("");
    setSubmitError(null);
    onClose();
  }

  const hasConfig = prefixes.length > 0;
  const canSubmit = !prefixesLoading && hasConfig && prefixId !== "" && name.trim() !== "";

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    startSubmit(async () => {
      const result = await createCatalogSku({ prefixId, name: name.trim() });
      if (!result.ok) {
        setSubmitError(result.error);
        toast.push(result.error, "error");
        return;
      }
      const prefixRow = prefixes.find((p) => p.id === prefixId);
      toast.push(`สร้าง SKU ${result.data.sku} แล้ว`);
      onCreated({
        productId: result.data.productId,
        sku: result.data.sku,
        name: name.trim(),
        category: prefixRow?.kindLabel ?? null,
      });
      handleClose();
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title="สร้างสินค้าใหม่">
      {prefixesLoading ? (
        <p className="text-sm text-zinc-500">กำลังโหลดรายการ prefix...</p>
      ) : prefixesError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {prefixesError}
        </p>
      ) : !hasConfig ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            ยังไม่มีการตั้งค่า prefix — ต้องตั้งค่าก่อนถึงจะสร้าง SKU ใหม่ได้
          </p>
          <Link
            href="/catalog/sku-prefix"
            className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700"
          >
            ไปตั้งค่า prefix
          </Link>
        </div>
      ) : (
        <>
          <label className={labelCls} htmlFor="create-sku-prefix">
            เลือก prefix
          </label>
          <select
            id="create-sku-prefix"
            value={prefixId}
            onChange={(e) => setPrefixId(e.target.value)}
            className={inputCls}
          >
            <option value="">— เลือก —</option>
            {prefixes.map((p) => (
              <option key={p.id} value={p.id}>
                {prefixOptionLabel(p)}
              </option>
            ))}
          </select>

          <label className={labelCls} htmlFor="create-sku-name">
            ชื่อสินค้า
          </label>
          <input
            id="create-sku-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="เช่น แหวนหัวใจฝังพลอย"
          />
          <p className="mt-1 text-xs text-zinc-400">
            กด &quot;สร้าง&quot; แล้วสินค้าจะถูกบันทึกเข้าคลังสินค้าทันที (แม้ยังไม่บันทึกใบเสนอราคา)
          </p>

          {submitError && (
            <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {submitError}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={pending}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={submit} loading={pending} disabled={!canSubmit}>
              สร้าง
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
