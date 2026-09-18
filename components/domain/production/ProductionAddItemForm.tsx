"use client";

// ProductionAddItemForm — /production/[id]'s "เพิ่มรายการ SKU" section, only
// rendered while the order is open. Each add is a LIVE persisted RPC call
// (analytics.production_order_item_set, 0131 §9 — an upsert on
// (production_order_id, product_id)), not client-side accumulation before a
// batch save like OEM's quote composer — 0131 has no "draft" concept for
// items.
//
// "+ สินค้าใหม่" reuses OEM's CreateSkuDialog as-is (explicitly allowed by
// the P1b brief) — it already does everything a brand-new-SKU flow needs
// (prefix picker, catalog_sku_create RPC, owner/admin gate inside
// createCatalogSku itself) and hands back exactly {productId, sku, name,
// category}, which is enough to select it as this form's next add. No seed
// weight/purity/category is passed (unlike OEM's usage, which seeds from
// the current quote line) — there is no equivalent "current line" to seed
// from here, so every field stays null and the dialog shows its own
// "ยังไม่มีอะไรให้ดึง" copy, never guessed.

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { setProductionOrderItem } from "@/lib/actions/production";
import type { ProductionSkuOption } from "@/lib/production/types";
import type { SkuPrefixRow } from "@/lib/catalog/sku-prefix";
import { listSkuPrefixes } from "@/lib/actions/catalog-sku";
import { CreateSkuDialog } from "@/components/domain/oem/CreateSkuDialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";

function optionLabel(o: ProductionSkuOption): string {
  return `${o.sku} · ${o.name}`;
}

export function ProductionAddItemForm({
  productionOrderId,
  skuOptions,
  skuOptionsError,
  onAdded,
}: {
  productionOrderId: string;
  skuOptions: ProductionSkuOption[];
  skuOptionsError: string | null;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<{ productId: string; sku: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);

  // Loaded on demand (only when the "+ สินค้าใหม่" dialog is actually
  // opened), same posture as QuoteJobItemCard's SkuPicker.
  const [prefixes, setPrefixes] = useState<SkuPrefixRow[]>([]);
  const [prefixesLoading, setPrefixesLoading] = useState(false);
  const [prefixesError, setPrefixesError] = useState<string | null>(null);
  const [prefixesLoaded, setPrefixesLoaded] = useState(false);

  function openCreateDialog() {
    setCreateOpen(true);
    if (prefixesLoaded) return;
    setPrefixesLoading(true);
    listSkuPrefixes().then((result) => {
      setPrefixesLoading(false);
      setPrefixesLoaded(true);
      if (!result.ok) {
        setPrefixesError(result.error);
        return;
      }
      setPrefixes(result.data);
    });
  }

  function handleTextChange(value: string) {
    setText(value);
    const match = skuOptions.find((o) => optionLabel(o) === value);
    setSelected(match ? { productId: match.productId, sku: match.sku, name: match.name } : null);
  }

  const qtyNum = Number(qty);
  const validQty = Number.isFinite(qtyNum) && Number.isInteger(qtyNum) && qtyNum > 0 && qtyNum <= 100000;
  const canSubmit = !!selected && validQty && !pending;

  function submit() {
    if (!selected || !validQty) return;
    setError(null);
    startTransition(async () => {
      const result = await setProductionOrderItem({
        productionOrderId,
        productId: selected.productId,
        qtyPlanned: qtyNum,
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`เพิ่ม ${result.data.sku} จำนวน ${result.data.qtyPlanned} ชิ้นแล้ว`);
      setSelected(null);
      setText("");
      setQty("1");
      onAdded();
    });
  }

  const disablePicker = !!skuOptionsError || skuOptions.length === 0;

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-700">เพิ่มรายการ SKU</span>
        <button
          type="button"
          onClick={openCreateDialog}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-100"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          สินค้าใหม่
        </button>
      </div>

      <CreateSkuDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        prefixes={prefixes}
        prefixesLoading={prefixesLoading}
        prefixesError={prefixesError}
        seed={{ weightG: null, purity: null, category: null }}
        onCreated={(product) => {
          setSelected({ productId: product.productId, sku: product.sku, name: product.name });
          setText(`${product.sku} · ${product.name}`);
        }}
      />

      {skuOptionsError && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {skuOptionsError}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <input
            type="text"
            list="production-sku-options"
            value={text}
            disabled={disablePicker}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="พิมพ์ค้นหา SKU หรือชื่อสินค้า"
            className={`${inputCls} disabled:bg-zinc-100 disabled:text-zinc-400`}
            aria-label="ค้นหา SKU"
          />
          <datalist id="production-sku-options">
            {skuOptions.map((o) => (
              <option key={o.productId} value={optionLabel(o)} />
            ))}
          </datalist>
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          step={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className={`${inputCls} sm:w-28`}
          aria-label="จำนวนที่วางแผนผลิต"
        />
        <Button type="button" size="sm" loading={pending} disabled={!canSubmit} onClick={submit} className="sm:shrink-0">
          เพิ่มรายการ
        </Button>
      </div>

      {!skuOptionsError && skuOptions.length === 0 && (
        <p className="mt-1 text-xs text-zinc-400">
          ยังไม่มี SKU ที่เลือกได้ (ต้อง active และไม่ใช่ SKU เฉพาะไลฟ์) — สร้างใหม่ได้ที่ปุ่ม &quot;สินค้าใหม่&quot; ด้านบน
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
