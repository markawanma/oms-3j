"use client";

// ProductForm — add/edit a SKU (docs/3j-jewelry/analytics/phase-c1-sku-cost-
// margin.md §3.1). Rendered inside <Modal>. Two cost modes: 'fixed' (manual
// unit cost) and 'spot' (weight × silver spot × purity + labor) — the fields
// shown switch on the selected mode, and a live cost/margin preview mirrors
// v_dim_product's SQL (client-side estimate only; DB is source of truth on save).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertProduct } from "@/lib/actions/catalog";
import {
  CATEGORY_OPTIONS,
  computeEffectiveCost,
  type CostType,
  type ProductRow,
} from "@/lib/catalog/types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ProductImageSection } from "./ProductImageSection";

function fmtBaht(n: number): string {
  return `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ProductForm({
  initial,
  silverSpot,
  onDone,
  onCreated,
  onImagesBusyChange,
}: {
  /** present = edit (SKU locked), absent = create. */
  initial?: ProductRow;
  /** current shop silver spot (THB/g) for the spot-mode preview; null if unset. */
  silverSpot: number | null;
  onDone: () => void;
  /**
   * Fired right after a CREATE succeeds (never after an edit-save) with a
   * synthesized row for the just-created SKU. Tech Lead decision (feat/sku-
   * product-images design brief): creating a SKU must NOT close the modal —
   * there'd be no chance to add photos without hunting the new row back
   * down in a 303-row table. The parent is expected to fold this into
   * whatever it's passing as `initial` (e.g. via a `setEditing` call), which
   * flips this same form into edit mode (SKU field locks, title becomes
   * "แก้ไข XXX", the image section unlocks) WITHOUT unmounting it.
   */
  onCreated?: (product: ProductRow) => void;
  /** Bubbles the image section's "has in-flight work" flag up so the parent
   * can guard the modal's close (ESC/backdrop/Cancel) while an upload is
   * still running. */
  onImagesBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(initial);

  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [costType, setCostType] = useState<CostType>(initial?.costType ?? "fixed");
  const [unitCost, setUnitCost] = useState(initial?.manualUnitCost != null ? String(initial.manualUnitCost) : "");
  const [weight, setWeight] = useState(initial?.silverWeightG != null ? String(initial.silverWeightG) : "");
  const [purity, setPurity] = useState(initial?.silverPurity != null ? String(initial.silverPurity) : "");
  const [labor, setLabor] = useState(initial?.laborCost != null ? String(initial.laborCost) : "");
  const [listPrice, setListPrice] = useState(initial?.listPrice != null ? String(initial.listPrice) : "");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(() => {
    const cost = computeEffectiveCost(
      costType,
      unitCost.trim() ? Number(unitCost) : null,
      weight.trim() ? Number(weight) : null,
      purity.trim() ? Number(purity) : null,
      labor.trim() ? Number(labor) : null,
      silverSpot
    );
    const price = listPrice.trim() ? Number(listPrice) : null;
    const margin = cost != null && price != null && price > 0 ? (price - cost) / price : null;
    return { cost, margin };
  }, [costType, unitCost, weight, purity, labor, silverSpot, listPrice]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sku.trim()) return setError("กรุณากรอก SKU");
    if (!name.trim()) return setError("กรุณากรอกชื่อสินค้า");
    if (costType === "spot") {
      const w = Number(weight);
      if (!weight.trim() || !Number.isFinite(w) || w <= 0) {
        return setError("โหมดอิงราคาเงินต้องกรอกน้ำหนักเงิน (กรัม) มากกว่า 0");
      }
    }

    startTransition(async () => {
      const result = await upsertProduct({
        sku: sku.trim(),
        name: name.trim(),
        category: category.trim() || null,
        costType,
        unitCost: costType === "fixed" && unitCost.trim() ? Number(unitCost) : null,
        silverWeightG: weight.trim() ? Number(weight) : null,
        silverPurity: purity.trim() ? Number(purity) : null,
        laborCost: labor.trim() ? Number(labor) : null,
        listPrice: listPrice.trim() ? Number(listPrice) : null,
        barcode: barcode.trim() || null,
        supplier: supplier.trim() || null,
        note: note.trim() || null,
        isActive,
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }

      if (!isEdit) {
        // CREATE succeeded — stay open (see onCreated prop doc comment
        // above for why) instead of the old router.refresh()+onDone().
        // Synthesized row: upsertProduct only returns { productId }, not a
        // full v_dim_product read-back, so this is built from the form's
        // own fields + the client-side cost/margin preview (same estimate
        // already shown above — "DB is source of truth on save", this is
        // just enough to unlock ProductImageSection and drive the modal
        // title reactively; the very next router.refresh() below replaces
        // it with real server data once the parent's list re-fetches).
        const created: ProductRow = {
          productId: result.data.productId,
          sku: sku.trim(),
          name: name.trim(),
          category: category.trim() || null,
          costType,
          manualUnitCost: costType === "fixed" && unitCost.trim() ? Number(unitCost) : null,
          silverWeightG: weight.trim() ? Number(weight) : null,
          silverPurity: purity.trim() ? Number(purity) : null,
          laborCost: labor.trim() ? Number(labor) : null,
          listPrice: listPrice.trim() ? Number(listPrice) : null,
          effectiveUnitCost: preview.cost,
          marginPct: preview.margin,
          barcode: barcode.trim() || null,
          supplier: supplier.trim() || null,
          note: note.trim() || null,
          isActive,
          // both null: a SKU created seconds ago cannot have images yet —
          // ProductImageSection starts empty and fills in as uploads land
          primaryImageUrl: null,
          primaryImageSmUrl: null,
        };
        toast.push(`เพิ่ม SKU ${sku.trim()} แล้ว — เพิ่มรูปได้เลย`);
        router.refresh();
        onCreated?.(created);
        return;
      }

      toast.push("บันทึกการแก้ไขแล้ว");
      router.refresh();
      onDone();
    });
  }

  const inputCls = "min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";
  const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <label className={labelCls}>
          SKU
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className={`${inputCls} disabled:bg-zinc-100 disabled:text-zinc-500`}
            disabled={isEdit}
            required
          />
        </label>
        <label className={labelCls}>
          หมวด
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="catalog-categories"
            placeholder="เช่น แหวน"
            className={inputCls}
          />
          <datalist id="catalog-categories">
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>

      <label className={labelCls}>
        ชื่อสินค้า
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
      </label>

      <fieldset className="rounded-md border border-zinc-200 p-2.5">
        <legend className="px-1 text-xs font-semibold text-zinc-600">โหมดต้นทุน</legend>
        <div className="flex gap-4 pb-2 pt-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={costType === "fixed"} onChange={() => setCostType("fixed")} />
            ต้นทุนคงที่ (เครื่องประดับ)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={costType === "spot"} onChange={() => setCostType("spot")} />
            อิงราคาเงิน (เงินแท่ง)
          </label>
        </div>

        {costType === "fixed" ? (
          <label className={labelCls}>
            ต้นทุนต่อชิ้น (บาท)
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </label>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            <label className={labelCls}>
              น้ำหนักเงิน (ก.)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              ความบริสุทธิ์
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step="0.001"
                value={purity}
                onChange={(e) => setPurity(e.target.value)}
                placeholder="0.925"
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              ค่ากำเหน็จ
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </label>
          </div>
        )}
        {costType === "spot" && silverSpot == null && (
          <p className="pt-2 text-xs text-amber-600">
            ยังไม่ได้ตั้งราคาเงินสปอต — ตั้งที่หน้า “ราคา &amp; มาร์จิ้น” ก่อน ต้นทุนถึงจะคำนวณได้
          </p>
        )}
      </fieldset>

      <label className={labelCls}>
        ราคาตั้ง/ป้าย (บาท)
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={listPrice}
          onChange={(e) => setListPrice(e.target.value)}
          placeholder="0.00"
          className={inputCls}
        />
      </label>

      {/* live preview */}
      <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
        <span className="text-zinc-500">ต้นทุนที่คำนวณ</span>
        <span className="font-semibold text-zinc-800">{preview.cost == null ? "—" : fmtBaht(preview.cost)}</span>
        <span className="text-zinc-300">·</span>
        <span className="text-zinc-500">margin</span>
        <span
          className={`font-semibold ${
            preview.margin == null ? "text-zinc-400" : preview.margin < 0.1 ? "text-red-600" : "text-zinc-800"
          }`}
        >
          {preview.margin == null ? "—" : `${(preview.margin * 100).toFixed(1)}%`}
        </span>
      </div>

      <details className="rounded-md border border-zinc-200 px-2.5 py-1.5">
        <summary className="min-h-9 cursor-pointer list-none py-1 text-xs font-semibold text-zinc-600">
          ข้อมูลเพิ่มเติม (บาร์โค้ด / ซัพพลายเออร์ / หมายเหตุ)
        </summary>
        <div className="flex flex-col gap-2.5 pt-2 pb-1">
          <div className="grid grid-cols-2 gap-2.5">
            <label className={labelCls}>
              บาร์โค้ด
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} />
            </label>
            <label className={labelCls}>
              ซัพพลายเออร์/OEM
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className={labelCls}>
            หมายเหตุ
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        เปิดใช้งาน <span className="text-xs text-zinc-400">(ปิด = ซ่อน/พักไว้ ไม่ลบ — ใช้กับสินค้าตามฤดูกาล)</span>
      </label>

      <ProductImageSection product={initial} onBusyChange={onImagesBusyChange} />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isEdit ? "บันทึก" : "เพิ่ม SKU"}
        </Button>
      </div>
    </form>
  );
}
