"use client";

// ProductionAddItemForm — /production/[id]'s "เพิ่มรายการ" section, only
// rendered while the order is open. Each add is a LIVE persisted RPC call
// (analytics.production_order_item_set, 0131 §9/0186) — not client-side
// accumulation before a batch save like OEM's quote composer — 0131 has no
// "draft" concept for items.
//
// PM-B (UX spec A.4): segmented "มี SKU / ไม่มี SKU — ใส่ชื่อแบบ" แล้วขึ้น "การ์ดร่าง" (ช่องชุดเดียวกับการ์ดรายการ):
//  • มี SKU  → เลือก SKU → ขอค่าเริ่มจาก server (production_item_prefill — helper ตัวเดียวกับ preview/done) → prefill โลหะ/เนื้อ/น้ำหนัก แก้ได้
//  • ไม่มี SKU → ชื่อแบบ + โลหะ (ค่าเริ่ม เงิน 92.50 — มติ Q5) · ไม่มีต้นทุน/ช่องแบบใหม่ · หลังเพิ่มการ์ดมีป้าย "ยังไม่ผูก SKU"
// ส่ง "ค่าทั้งสามชัดเจน" ตอนเพิ่ม (client แค่ prefill ให้เห็น — server ตัดสินและตรวจซ้ำ)
// ไม่มีช่องราคา/ต้นทุนในฟอร์มนี้ (type boundary)
//
// "+ สินค้าใหม่" reuses OEM's CreateSkuDialog as-is (explicitly allowed by
// the P1b brief) — no seed weight/purity/category is passed, never guessed.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { getProductionItemPrefill, setProductionOrderItem } from "@/lib/actions/production";
import type { ProductionItemPrefill, ProductionSkuOption } from "@/lib/production/types";
import { PRODUCTION_LABEL_MAX_LEN } from "@/lib/production/types";
import {
  applyMetalChange,
  buildNewItemInput,
  defaultPurityText,
  labelKey,
  metalSpecIssues,
  MSG_LABEL_REQUIRED,
  skuSourceBadges,
  weightTextFromNumber,
  ALLOW_UNBOUND_ITEM_OFFICE,
} from "@/lib/production/metal-ui";
import type { ItemDraft, MetalSpecFieldErrors } from "@/lib/production/metal-ui";
import { purityFractionToPct } from "@/lib/units/purity";
import type { SkuPrefixRow } from "@/lib/catalog/sku-prefix";
import { listSkuPrefixes } from "@/lib/actions/catalog-sku";
import { CreateSkuDialog } from "@/components/domain/oem/CreateSkuDialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { MetalSpecFields } from "./MetalSpecFields";

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400";
const labelCls = "block text-sm font-medium text-zinc-700";

type AddMode = "sku" | "nosku";
type Selected = { productId: string; sku: string; name: string };
type PrefillState = { s: "idle" } | { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: ProductionItemPrefill };

function optionLabel(o: ProductionSkuOption): string {
  return `${o.sku} · ${o.name}`;
}

const EMPTY_DRAFT: ItemDraft = { metal: "silver", purityText: defaultPurityText("silver"), weightText: "", qtyText: "1", isNewDesign: false };

function draftFromPrefill(p: ProductionItemPrefill): ItemDraft {
  return {
    metal: p.metal,
    purityText: p.metal === "brass" ? "100.00" : p.purity != null ? purityFractionToPct(p.purity) : defaultPurityText(p.metal),
    weightText: weightTextFromNumber(p.weightG),
    qtyText: "1",
    isNewDesign: false,
  };
}

export function ProductionAddItemForm({
  productionOrderId,
  skuOptions,
  skuOptionsError,
  existingProductIds = [],
  existingLabels = [],
  onAdded,
}: {
  productionOrderId: string;
  skuOptions: ProductionSkuOption[];
  skuOptionsError: string | null;
  /** SKU ที่อยู่ในใบแล้ว — เพิ่มซ้ำ = บล็อก (กันการ upsert ทับค่าโลหะ/เนื้อของการ์ดเดิมเงียบๆ) */
  existingProductIds?: readonly string[];
  existingLabels?: readonly string[];
  onAdded: () => void;
}) {
  const toast = useToast();
  const idBase = useId();
  const [mode, setMode] = useState<AddMode>("sku");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [metalNotes, setMetalNotes] = useState<string[]>([]);
  const [prefill, setPrefill] = useState<PrefillState>({ s: "idle" });
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Loaded on demand (only when the "+ สินค้าใหม่" dialog is actually opened)
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

  const selectedProductId = selected?.productId ?? null;
  const prefillReq = useRef(0);
  const loadPrefill = useCallback((productId: string) => {
    const req = ++prefillReq.current;
    setPrefill({ s: "loading" });
    getProductionItemPrefill(productId).then((r) => {
      // ผู้ใช้เปลี่ยน/ล้าง SKU ระหว่างรอ — ทิ้งผลของคำขอเก่า
      if (req !== prefillReq.current) return;
      if (r.ok) {
        setPrefill({ s: "ready", data: r.data });
        setDraft(draftFromPrefill(r.data));
        setMetalNotes([]);
      } else {
        setPrefill({ s: "error", message: r.error });
      }
    });
  }, []);

  useEffect(() => {
    if (selectedProductId) loadPrefill(selectedProductId);
    else {
      prefillReq.current++;
      setPrefill({ s: "idle" });
    }
  }, [selectedProductId, loadPrefill]);

  function resetAll() {
    setSelected(null);
    setText("");
    setLabel("");
    setDraft(EMPTY_DRAFT);
    setMetalNotes([]);
    setPrefill({ s: "idle" });
    setAttempted(false);
    setError(null);
  }

  function switchMode(next: AddMode) {
    if (next === mode) return;
    setMode(next);
    resetAll();
  }

  function handleTextChange(value: string) {
    setText(value);
    const match = skuOptions.find((o) => optionLabel(o) === value);
    setSelected(match ? { productId: match.productId, sku: match.sku, name: match.name } : null);
    setAttempted(false);
    setError(null);
  }

  const selectedCostType = selected ? skuOptions.find((o) => o.productId === selected.productId)?.costType : undefined;
  const prefillData = prefill.s === "ready" ? prefill.data : null;

  const duplicateSku = mode === "sku" && selected !== null && existingProductIds.includes(selected.productId);
  const duplicateLabel = mode === "nosku" && label.trim() !== "" && existingLabels.some((l) => labelKey(l) === labelKey(label));
  const labelIssue = mode === "nosku" && attempted && label.trim() === "" ? MSG_LABEL_REQUIRED : null;

  const showCard = mode === "nosku" || (selected !== null && prefill.s === "ready");
  const errors: MetalSpecFieldErrors = attempted ? metalSpecIssues({ metal: draft.metal, purityText: draft.purityText, weightText: draft.weightText, qtyText: draft.qtyText }) : {};

  function changeMetal(next: ItemDraft["metal"]) {
    // การ์ดร่างไม่มีค่า "ที่บันทึกแล้ว" — base = ค่า prefill (หรือค่าเริ่มของการ์ดไม่มี SKU) · กลับมาโลหะเดิม = คืนค่า prefill
    const base = prefillData ? draftFromPrefill(prefillData) : EMPTY_DRAFT;
    const res = applyMetalChange(draft, next, base, prefillData?.weightSource ?? null);
    setDraft(res.draft);
    setMetalNotes(res.notes);
  }

  function submit() {
    setAttempted(true);
    setError(null);
    if (mode === "sku" && !selected) return;
    if (mode === "nosku" && label.trim() === "") {
      setTimeout(() => document.getElementById(`${idBase}-label`)?.focus(), 0);
      return;
    }
    if (duplicateSku || duplicateLabel) return;
    const built = buildNewItemInput({
      orderId: productionOrderId,
      productId: mode === "sku" ? (selected?.productId ?? null) : null,
      label: mode === "nosku" ? label.trim() : null,
      draft,
      skuWeightG: prefillData?.weightG ?? null,
      isSpecSku: mode === "sku" && selectedCostType === "spec",
    });
    if (!built.ok) {
      if (built.formError) setError(built.formError);
      const e = built.errors;
      const id = e.purity ? `${idBase}-purity` : e.weight ? `${idBase}-weight` : e.qty ? `${idBase}-qty` : null;
      if (id) setTimeout(() => document.getElementById(id)?.focus(), 0);
      return;
    }
    void (async () => {
      // state saving ของเราเอง (ไม่ใช้ useTransition: React 18 ไม่ถือ pending ข้าม await — ช่องจะไม่ถูก disable ระหว่างบันทึกจริง)
      setPending(true);
      let result: Awaited<ReturnType<typeof setProductionOrderItem>>;
      try {
        result = await setProductionOrderItem(built.input);
      } catch {
        setError("เพิ่มรายการไม่สำเร็จ ลองอีกครั้ง (ค่าที่กรอกยังอยู่)");
        return;
      } finally {
        setPending(false);
      }
      if (!result.ok) {
        // ค่าที่กรอกคงอยู่ — ไม่ล้างฟอร์ม
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`เพิ่ม ${result.data.sku ?? result.data.name} จำนวน ${result.data.qtyPlanned} ชิ้นแล้ว`);
      resetAll();
      onAdded();
    })();
  }

  const disablePicker = !!skuOptionsError || skuOptions.length === 0;
  // ป้าย "จาก SKU / แก้ในใบนี้" — ฟังก์ชันเดียวกับการ์ดรายการ (เทียบค่าจริงในช่องกับค่า SKU)
  const badges = skuSourceBadges({
    hasSku: mode === "sku" && prefillData !== null,
    metal: draft.metal,
    skuMetal: prefillData?.metal ?? null,
    skuPurity: prefillData?.purity ?? null,
    skuWeightG: prefillData?.weightG ?? null,
    purityText: draft.purityText,
    weightText: draft.weightText,
  });

  return (
    <section aria-label="เพิ่มรายการ" className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-700">เพิ่มรายการ</h2>
        {mode === "sku" && (
          <button
            type="button"
            onClick={openCreateDialog}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-100"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            สินค้าใหม่
          </button>
        )}
      </div>

      {/* ซ่อนตัวเลือก "ไม่มี SKU" ไว้ก่อน (ALLOW_UNBOUND_ITEM_OFFICE = false) — ทางตัน: ยังไม่มีปุ่มผูก SKU จนถึง W1 · เหลือโหมด "มี SKU" โหมดเดียว ไม่แสดง segmented */}
      {ALLOW_UNBOUND_ITEM_OFFICE && (
        <div role="radiogroup" aria-label="รูปแบบรายการ" className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["sku", "มี SKU"],
              ["nosku", "ไม่มี SKU — ใส่ชื่อแบบ"],
            ] as const
          ).map(([value, text2]) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-600 ${
                mode === value ? "border-primary-600 bg-primary-100 text-primary-700" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <input type="radio" name={`${idBase}-mode`} value={value} checked={mode === value} onChange={() => switchMode(value)} className="sr-only" />
              {text2}
            </label>
          ))}
        </div>
      )}

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

      {skuOptionsError && mode === "sku" && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {skuOptionsError}
        </p>
      )}

      {mode === "sku" ? (
        <div className="mt-3">
          <label htmlFor={`${idBase}-sku`} className={labelCls}>
            ค้นหา SKU
          </label>
          <input
            id={`${idBase}-sku`}
            type="text"
            list={`${idBase}-sku-options`}
            value={text}
            disabled={disablePicker}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="พิมพ์ค้นหา SKU หรือชื่อสินค้า"
            className={`mt-1 ${inputCls}`}
          />
          <datalist id={`${idBase}-sku-options`}>
            {skuOptions.map((o) => (
              <option key={o.productId} value={optionLabel(o)} />
            ))}
          </datalist>
          {!skuOptionsError && skuOptions.length === 0 && (
            <p className="mt-1 text-xs text-zinc-600">
              ยังไม่มี SKU ที่เลือกได้ (ต้อง active และไม่ใช่ SKU เฉพาะไลฟ์) — สร้างใหม่ได้ที่ปุ่ม &quot;สินค้าใหม่&quot;{ALLOW_UNBOUND_ITEM_OFFICE ? <> หรือเลือก &quot;ไม่มี SKU — ใส่ชื่อแบบ&quot;</> : null}
            </p>
          )}
          {duplicateSku && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              SKU นี้มีอยู่ในใบผลิตนี้แล้ว — แก้จำนวนที่การ์ดเดิมแทน
            </p>
          )}
          {prefill.s === "loading" && (
            <p role="status" className="mt-2 text-sm text-zinc-600">
              กำลังโหลดค่าเริ่มของ SKU…
            </p>
          )}
          {prefill.s === "error" && (
            <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              <span>{prefill.message}</span>
              {selectedProductId && (
                <Button type="button" size="sm" variant="secondary" onClick={() => loadPrefill(selectedProductId)}>
                  ลองอีกครั้ง
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={`${idBase}-label`} className={labelCls}>
            ชื่อแบบ <span className="text-red-600">*</span>
          </label>
          <input
            id={`${idBase}-label`}
            type="text"
            value={label}
            maxLength={PRODUCTION_LABEL_MAX_LEN}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
            aria-invalid={labelIssue || duplicateLabel ? true : undefined}
            aria-describedby={labelIssue || duplicateLabel ? `${idBase}-label-err` : undefined}
            placeholder="เช่น แหวนทดลองลายใบไม้"
            className={`mt-1 ${inputCls}`}
          />
          {(labelIssue || duplicateLabel) && (
            <p id={`${idBase}-label-err`} role="alert" className="mt-1 text-xs text-red-700">
              {duplicateLabel ? "ชื่อแบบนี้มีอยู่ในใบผลิตนี้แล้ว — แก้ที่การ์ดเดิมแทน" : labelIssue}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-600">รายการนี้จะมีป้าย &quot;ยังไม่ผูก SKU&quot; — ต้นทุนคิดไม่ได้และผลิตเสร็จไม่ได้จนกว่าจะผูก SKU</p>
        </div>
      )}

      {showCard && (
        <div className="mt-3 space-y-3 rounded-md border border-zinc-200 bg-white p-3">
          <MetalSpecFields
            idBase={idBase}
            metal={draft.metal}
            purityText={draft.purityText}
            weightText={draft.weightText}
            onMetalChange={changeMetal}
            onPurityChange={(t) => setDraft((d) => ({ ...d, purityText: t }))}
            onWeightChange={(t) => setDraft((d) => ({ ...d, weightText: t }))}
            busy={pending}
            skuMetal={mode === "sku" && prefillData ? { metal: prefillData.metal, known: prefillData.metalKnown } : null}
            errors={errors}
            forceShow={attempted}
            metalNotes={metalNotes}
            purityBadge={badges.purity}
            weightBadge={badges.weight}
            extra={
              <div>
                <label htmlFor={`${idBase}-qty`} className={labelCls}>
                  จำนวน (ชิ้น)
                </label>
                <input
                  id={`${idBase}-qty`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100000}
                  step={1}
                  value={draft.qtyText}
                  disabled={pending}
                  onChange={(e) => setDraft((d) => ({ ...d, qtyText: e.target.value }))}
                  aria-invalid={errors.qty ? true : undefined}
                  aria-describedby={errors.qty ? `${idBase}-qty-err` : undefined}
                  className={`mt-1 ${inputCls} tabular-nums ${errors.qty ? "ring-1 ring-red-500" : ""}`}
                />
                {errors.qty && (
                  <p id={`${idBase}-qty-err`} role="alert" className="pt-0.5 text-[11px] text-red-600">
                    {errors.qty}
                  </p>
                )}
                {mode === "sku" && selectedCostType === "spec" && (
                  <div className="mt-2">
                    <label htmlFor={`${idBase}-newdesign`} className="flex items-center gap-2 text-sm text-zinc-700">
                      <input
                        id={`${idBase}-newdesign`}
                        type="checkbox"
                        checked={draft.isNewDesign}
                        onChange={(e) => setDraft((d) => ({ ...d, isNewDesign: e.target.checked }))}
                        className="h-5 w-5 rounded border-zinc-300"
                      />
                      แบบใหม่ (คิดค่าออกแบบ)
                    </label>
                    <p className="mt-0.5 pl-7 text-xs text-zinc-600">ติ๊กเฉพาะรอบที่ออกแบบใหม่ — ผลิตซ้ำแบบเดิมไม่ต้องติ๊ก</p>
                  </div>
                )}
              </div>
            }
          />

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="button" size="sm" className="w-full sm:w-auto" loading={pending} disabled={duplicateSku || duplicateLabel} onClick={submit}>
              เพิ่มรายการ
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
