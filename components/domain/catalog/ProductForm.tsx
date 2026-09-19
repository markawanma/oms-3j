"use client";

// ProductForm — add/edit a SKU (docs/3j-jewelry/analytics/phase-c1-sku-cost-
// margin.md §3.1). Rendered inside <Modal>. Three cost modes: 'fixed' (manual
// unit cost), 'spot' (weight × silver spot × purity + labor), and 'spec'
// (0141/0142 — weight + item_kind/polish_tier/plating/gem, cost computed by
// analytics.oem_cost_calc at production time, docs/3j-jewelry/oms/design-own-
// production-costing.md) — the fields shown switch on the selected mode. The
// live cost/margin preview mirrors v_dim_product's SQL for fixed/spot only
// (client-side estimate; DB is source of truth on save) — spec mode shows no
// number at all client-side, see computeEffectiveCost's doc comment for why.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertProduct } from "@/lib/actions/catalog";
import {
  CATEGORY_OPTIONS,
  computeEffectiveCost,
  type CostType,
  type ProductRow,
} from "@/lib/catalog/types";
import {
  OEM_GEM_TIER_OPTIONS,
  OEM_ITEM_KIND_OPTIONS,
  OEM_PLATING_OPTIONS,
  OEM_POLISH_TIER_OPTIONS,
} from "@/lib/oem/display";
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
  // 0141: โหมด 'spec' เท่านั้น — ค่าต้องตรงเป๊ะกับ scope ของเรตในฐานข้อมูล
  // (ใช้ตัวเลือกชุดเดียวกับฟอร์ม OEM lib/oem/display.ts ไม่พิมพ์เอง)
  const [itemKind, setItemKind] = useState(initial?.makeSpec?.itemKind ?? "");
  const [polishTier, setPolishTier] = useState(initial?.makeSpec?.polishTier ?? "");
  const [platingType, setPlatingType] = useState(initial?.makeSpec?.platingType ?? "");
  const [gemTier, setGemTier] = useState(initial?.makeSpec?.gemTier ?? "");
  const [gemCount, setGemCount] = useState(
    initial?.makeSpec?.gemTier && initial.makeSpec.gemCount != null ? String(initial.makeSpec.gemCount) : ""
  );
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

  /** null เมื่อ costType !== 'spec' — ใช้ทั้งตอนส่ง payload และตอนประกอบ
   * synthesized row (create path ด้านล่าง) ให้ตรงกันเป๊ะจุดเดียว. */
  function buildMakeSpec(): ProductRow["makeSpec"] {
    if (costType !== "spec") return null;
    return {
      metal: "silver",
      itemKind,
      polishTier,
      platingType: platingType || null,
      gemTier: gemTier || null,
      gemCount: gemTier ? Number(gemCount) || 0 : 0,
    };
  }

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
    if (costType === "spec") {
      const w = Number(weight);
      if (!weight.trim() || !Number.isFinite(w) || w <= 0) {
        return setError("โหมดคำนวณจากสเปคต้องกรอกน้ำหนักเงิน (กรัม) มากกว่า 0");
      }
      if (!itemKind) return setError("กรุณาเลือกชนิดงาน");
      if (!polishTier) return setError("กรุณาเลือกระดับงาน");
      if (gemTier) {
        const g = Number(gemCount);
        if (!gemCount.trim() || !Number.isFinite(g) || g < 0) {
          return setError("เลือกขนาดพลอยแล้วต้องกรอกจำนวนเม็ดพลอย (ตั้งแต่ 0 ขึ้นไป)");
        }
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
        laborCost: costType === "spec" ? null : labor.trim() ? Number(labor) : null,
        listPrice: listPrice.trim() ? Number(listPrice) : null,
        barcode: barcode.trim() || null,
        supplier: supplier.trim() || null,
        note: note.trim() || null,
        isActive,
        makeSpec: buildMakeSpec(),
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
          laborCost: costType === "spec" ? null : labor.trim() ? Number(labor) : null,
          listPrice: listPrice.trim() ? Number(listPrice) : null,
          makeSpec: buildMakeSpec(),
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
            placeholder="เช่น สร้อยคอ"
            className={inputCls}
          />
          <datalist id="catalog-categories">
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {/* หมวดตัดสินว่าสินค้าไปอยู่แท่งไหนใน "สัดส่วนตามสินค้า" บนแดชบอร์ด
              (ตรรกะใน analytics.dashboard_charts) — ที่สะกดไม่ตรงสตริงพิเศษ
              จะถูกนับเป็นเครื่องเงิน 925 หมด เขียนเตือนไว้เพราะคนกรอกมองไม่เห็น
              ผลข้างเคียงนี้เลยถ้าไม่บอก */}
          <span className="mt-1 block text-[0.7rem] font-normal text-zinc-500">
            มีผลต่อกราฟสัดส่วนสินค้า — <strong className="font-semibold">กล่อง/บรรจุภัณฑ์ · น้ำยาล้างเงิน · ทองจีน</strong>{" "}
            จะไม่ถูกนับเป็นเครื่องเงิน 925 · พิมพ์หมวดใหม่เองได้ถ้าไม่มีในรายการ
          </span>
        </label>
      </div>

      <label className={labelCls}>
        ชื่อสินค้า
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
      </label>

      <fieldset className="rounded-md border border-zinc-200 p-2.5">
        <legend className="px-1 text-xs font-semibold text-zinc-600">โหมดต้นทุน</legend>
        <div className="flex flex-col gap-1.5 pb-2 pt-1 text-sm">
          <label className="flex items-start gap-1.5">
            <input
              type="radio"
              checked={costType === "fixed"}
              onChange={() => setCostType("fixed")}
              className="mt-1"
            />
            <span>
              ใส่ต้นทุนเอง (ตัวเลขคงที่)
              <span className="block text-xs font-normal text-zinc-500">
                ต้องมาแก้เองทุกครั้งที่ต้นทุนเปลี่ยน
              </span>
            </span>
          </label>
          <label className="flex items-start gap-1.5">
            <input
              type="radio"
              checked={costType === "spot"}
              onChange={() => setCostType("spot")}
              className="mt-1"
            />
            <span>
              คำนวณจากน้ำหนักเงิน (ขยับตามราคาเงินเอง)
              <span className="block text-xs font-normal text-zinc-500">
                น้ำหนัก × ราคาเงินวันนั้น × ความบริสุทธิ์ + ค่าแรง — เลือกอันนี้ถ้ารู้น้ำหนักเป็นกรัม
              </span>
            </span>
          </label>
          <label className="flex items-start gap-1.5">
            <input
              type="radio"
              checked={costType === "spec"}
              onChange={() => setCostType("spec")}
              className="mt-1"
            />
            <span>
              คำนวณจากสเปค (กรอกครั้งเดียว ระบบคิดให้)
              <span className="block text-xs font-normal text-zinc-500">
                กรอกน้ำหนัก + ระดับงาน + พลอย + ชุบ แล้วระบบคำนวณต้นทุนจากค่าจริงของโรงงาน — ผลิตซ้ำไม่ต้องกรอกอีก
              </span>
            </span>
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
        ) : costType === "spot" ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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
              <span className="block pt-0.5 text-[11px] font-normal text-zinc-500">
                เครื่องประดับ 925 = 0.925 · เงินแท่ง 999 = 0.999
              </span>
            </label>
            <label className={labelCls}>
              ค่าแรง/ค่าบล็อก (บาท/ชิ้น)
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
              <span className="block pt-0.5 text-[11px] font-normal text-zinc-500">
                ต้นทุนขึ้นรูปเท่านั้น — ห้ามใส่กำไรหรือ VAT
              </span>
            </label>
          </div>
        ) : (
          // 0141 spec mode — ไม่มีช่อง "ค่าแรง/ค่าบล็อก" ในโหมดนี้เลยตั้งใจ:
          // ระบบคำนวณค่าแรงเองจากเรตโรงงาน (analytics.oem_cost_rate ผ่าน
          // analytics.oem_cost_calc) — โชว์ช่องกรอกเพิ่มจะชวนให้เข้าใจผิดว่า
          // ต้องกรอกอีกชั้น (ดู task brief เคสห้ามผ่าน #4 ก็ห้าม margin/ราคา
          // ไม่ใช่ห้ามช่องนี้ แต่หลักการเดียวกัน: ซ่อนสิ่งที่ระบบคำนวณเองให้)
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                required
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
              <span className="block pt-0.5 text-[11px] font-normal text-zinc-500">
                เครื่องประดับ 925 = 0.925
              </span>
            </label>
            <label className={labelCls}>
              ชนิดงาน
              <select value={itemKind} onChange={(e) => setItemKind(e.target.value)} className={inputCls} required>
                <option value="">— เลือก —</option>
                {OEM_ITEM_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              ระดับงาน
              <select value={polishTier} onChange={(e) => setPolishTier(e.target.value)} className={inputCls} required>
                <option value="">— เลือก —</option>
                {OEM_POLISH_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              ชุบ
              <select value={platingType} onChange={(e) => setPlatingType(e.target.value)} className={inputCls}>
                <option value="">ไม่ชุบ</option>
                {OEM_PLATING_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              ขนาดพลอย
              <select
                value={gemTier}
                onChange={(e) => {
                  setGemTier(e.target.value);
                  if (!e.target.value) setGemCount("");
                }}
                className={inputCls}
              >
                <option value="">ไม่มีพลอย</option>
                {OEM_GEM_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {gemTier && (
              <label className={labelCls}>
                จำนวนเม็ดพลอย
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  value={gemCount}
                  onChange={(e) => setGemCount(e.target.value)}
                  className={inputCls}
                  required
                />
              </label>
            )}
          </div>
        )}
        {(costType === "spot" || costType === "spec") && silverSpot == null && (
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

      {/* live preview — spec mode ไม่มีเลขให้โชว์เลย (ห้ามคำนวณเลขเงินใน client,
          oem-quote-invariants §2): ต้นทุนจริงมาจาก analytics.oem_cost_calc
          (สิบกว่าเรต + batch amortization) เห็นได้ตอนสั่งผลิตเท่านั้น */}
      {costType === "spec" ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          ต้นทุนโหมดนี้คำนวณตอนสั่งผลิต (ไม่ใช่ตอนบันทึก SKU) — ดูรายละเอียดที่หน้าใบผลิตเข้าสต็อกเมื่อสั่งผลิตจริง
        </p>
      ) : (
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
      )}

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
