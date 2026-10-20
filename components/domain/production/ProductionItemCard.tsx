"use client";

// ProductionItemCard — 1 การ์ด/รายการในใบผลิต (แทนตารางแถวเดียว · UX spec A.3) — "เหมือนหน้าผลิต OEM" ด้วย primitive ร่วม ไม่ใช่ component ร่วม
// (ไม่ reuse QuoteJobItemCard: type พก floors/margin — ดู design-production-item-metal.md §3 ข้อ ค)
//  • ใบ open  = แก้ได้ · บันทึกต่อการ์ดด้วยปุ่ม (ไม่ auto-save ตอน blur: เนื้อทอง/น้ำหนักขับต้นทุนทั้งล็อต พิมพ์ผิดแล้ว blur = เขียน DB ทันที)
//  • ใบ done/cancelled = อ่านอย่างเดียวจาก snapshot ใน production_order_item (ไม่ใช่ SKU ปัจจุบัน)
//  • รายการไม่มี SKU = ป้าย "ยังไม่ผูก SKU" (สถานะปกติของงานจากหน้างาน ไม่ใช่ error แดง) · ยังไม่มีปุ่มผูก (RPC ผูก SKU เป็นของ W1)
// 🔴 ไม่มีการคิดเงินที่นี่ · ไม่มีช่องราคา/margin · ต้นทุนที่โชว์ = ของเดิมเป๊ะ (fixed โชว์เลข · spot/spec "คำนวณตอนกดผลิตเสร็จ" · done = ค่าที่ล็อก)
// 4 state: loading (ปุ่ม loading + ช่องทั้งการ์ด disabled ตอนบันทึก) · empty (อยู่ที่ผู้เรียก) · error (role=alert บนการ์ด ค่าที่กรอกคงอยู่) · success (toast + refresh)

import { useEffect, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { setProductionOrderItem } from "@/lib/actions/production";
import type { ProductionOrderItemRow, ProductionOrderRow } from "@/lib/production/types";
import { PRODUCTION_COST_TYPE_LABEL_TH } from "@/lib/production/types";
import {
  applyMetalChange,
  buildItemSaveInput,
  draftFromRow,
  isDraftDirty,
  itemDisplayName,
  itemShortName,
  metalSpecIssues,
  stripFnPrefix,
  weightTextFromNumber,
} from "@/lib/production/metal-ui";
import type { ItemDraft, MetalSpecFieldErrors } from "@/lib/production/metal-ui";
import { formatTHB } from "@/lib/format";
import { formatPurityPct, purityFractionToPct } from "@/lib/units/purity";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { MetalTag } from "./MetalTag";
import { MetalSpecFields } from "./MetalSpecFields";
import { ProductionSpecCostCard } from "./ProductionSpecCostCard";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900 tabular-nums disabled:bg-zinc-100 disabled:text-zinc-500";
const labelCls = "block text-sm font-medium text-zinc-700";

function costModeTone(t: ProductionOrderItemRow["currentCostType"]) {
  return t === "spot" ? "cyan" : t === "spec" ? "indigo" : "slate";
}

function formatWeight(g: number | null): string {
  return g == null ? "ไม่ได้ระบุ" : `${g.toFixed(3)} g/ชิ้น`;
}

export function ProductionItemCard({
  order,
  row,
  activeJobNo,
  removing,
  onRemove,
  onSaved,
  onDirtyChange,
}: {
  order: Pick<ProductionOrderRow, "id" | "poNo" | "status">;
  row: ProductionOrderItemRow;
  /** เลขใบงานที่ยังเดินอยู่ของรายการนี้ (ล็อกโลหะ — UX A.3.2) · null/undefined = ไม่มี */
  activeJobNo?: string | null;
  removing?: boolean;
  onRemove?: (row: ProductionOrderItemRow) => void;
  onSaved?: () => void;
  onDirtyChange?: (itemId: string, dirty: boolean) => void;
}) {
  const toast = useToast();
  const idBase = useId();
  const isOpen = order.status === "open";
  const hasSku = row.productId !== null;

  const rowSig = JSON.stringify([row.id, row.updatedAt, row.qtyPlanned, row.effectiveMetal, row.effectivePurity, row.effectiveWeightG, row.effectiveWeightSource, row.isNewDesign]);
  const [base, setBase] = useState<ItemDraft>(() => draftFromRow(row));
  const [draft, setDraft] = useState<ItemDraft>(() => draftFromRow(row));
  const [baseWeightSource, setBaseWeightSource] = useState(row.effectiveWeightSource);
  const [metalNotes, setMetalNotes] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  // ค่าจากเซิร์ฟเวอร์เปลี่ยนจริง (หลัง router.refresh) → ตั้ง baseline ใหม่ · การ์ดอื่นที่ row ไม่เปลี่ยนจะไม่ถูกรีเซ็ตทับสิ่งที่พิมพ์ค้าง
  useEffect(() => {
    const d = draftFromRow(row);
    setBase(d);
    setDraft(d);
    setBaseWeightSource(row.effectiveWeightSource);
    setMetalNotes([]);
    setAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSig]);

  const dirty = isOpen && isDraftDirty(draft, base);
  useEffect(() => {
    onDirtyChange?.(row.id, dirty);
    return () => onDirtyChange?.(row.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, row.id]);

  const errors: MetalSpecFieldErrors = attempted ? metalSpecIssues({ metal: draft.metal, purityText: draft.purityText, weightText: draft.weightText, qtyText: draft.qtyText }) : {};

  function focusFirstInvalid(e: MetalSpecFieldErrors) {
    const id = e.purity ? `${idBase}-purity` : e.weight ? `${idBase}-weight` : e.qty ? `${idBase}-qty` : null;
    if (id) setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

  function changeMetal(next: ItemDraft["metal"]) {
    const res = applyMetalChange(draft, next, base, baseWeightSource);
    setDraft(res.draft);
    setMetalNotes(res.notes);
  }

  async function save() {
    if (!isOpen || saving) return;
    setAttempted(true);
    setCardError(null);
    const built = buildItemSaveInput({ orderId: order.id, row, draft, base });
    if (!built.ok) {
      if (built.formError) setCardError(built.formError);
      focusFirstInvalid(built.errors);
      return;
    }
    setSaving(true);
    const result = await setProductionOrderItem(built.input);
    setSaving(false);
    if (!result.ok) {
      // ค่าที่กรอกคงอยู่ — ไม่ reset ช่อง
      setCardError(stripFnPrefix(result.error));
      return;
    }
    // โชว์ค่าที่ server "เก็บจริง" (ไม่ใช่ค่าที่ส่งไป) — ช่องที่ server ไม่คืน (null) คงค่าเดิมที่เห็นอยู่
    const stored: ItemDraft = {
      metal: result.data.metal ?? draft.metal,
      purityText: result.data.metal === "brass" ? "100.00" : result.data.purity != null ? purityFractionToPct(result.data.purity) : draft.purityText,
      weightText: result.data.weightG != null || result.data.metal != null ? weightTextFromNumber(result.data.weightG) : draft.weightText,
      qtyText: String(result.data.qtyPlanned),
      isNewDesign: result.data.isNewDesign,
    };
    setBase(stored);
    setDraft(stored);
    setBaseWeightSource(result.data.weightSource);
    setMetalNotes([]);
    setAttempted(false);
    toast.push(`บันทึก ${itemShortName(row)} แล้ว`);
    onSaved?.();
  }

  const title = itemDisplayName(row);
  const costChanged = row.stampedUnitCost != null && row.prevUnitCost != null && Math.abs(row.stampedUnitCost - row.prevUnitCost) > 0.005;
  const showSpecCard = order.status === "done" && row.currentCostType === "spec" && row.costCalc;

  // ป้ายเทียบกับค่า SKU (แสดงผลอย่างเดียว ไม่ตัดสิน) — น้ำหนัก/เนื้อของ SKU คือของเงิน ใช้เทียบเมื่อรายการเป็นเงินเท่านั้น
  const weightBadge =
    hasSku && draft.metal === "silver" && row.skuWeightG != null && draft.weightText.trim() !== ""
      ? Number(draft.weightText) === row.skuWeightG
        ? "จาก SKU"
        : "แก้ในใบนี้"
      : null;
  const purityBadge =
    hasSku && draft.metal === "silver" && row.skuPurity != null && draft.purityText.trim() !== ""
      ? purityFractionToPct(row.skuPurity) === Number(draft.purityText).toFixed(2)
        ? "จาก SKU"
        : "แก้ในใบนี้"
      : null;

  const costLine = !hasSku ? (
    <p className="text-sm text-zinc-700">ต้นทุน: ยังคิดไม่ได้ — ต้องผูก SKU ก่อน</p>
  ) : order.status === "done" ? (
    row.stampedUnitCost != null ? (
      <p className="text-sm text-zinc-700">
        ต้นทุนที่ล็อกไว้:{" "}
        {costChanged && row.prevUnitCost != null && <span className="text-zinc-400 line-through">{formatTHB(row.prevUnitCost)} </span>}
        <span className="font-semibold text-zinc-800 tabular-nums">{formatTHB(row.stampedUnitCost)}</span>
      </p>
    ) : (
      <p className="text-sm text-zinc-500">ต้นทุนที่ล็อกไว้: —</p>
    )
  ) : order.status === "cancelled" ? (
    <p className="text-sm text-zinc-500">ต้นทุน: ไม่ได้ผลิต</p>
  ) : row.currentCostType === "spot" || row.currentCostType === "spec" ? (
    // security review M5: SKU โหมด spot/spec — product.unit_cost ดิบเป็นเลขเก่า ห้ามโชว์ (ไม่ตรงกับที่คำนวณจริง)
    <p className="text-sm text-zinc-500">ต้นทุน: คำนวณตอนกดผลิตเสร็จ</p>
  ) : row.currentUnitCost != null ? (
    <p className="text-sm text-zinc-700" title="ต้นทุนคงที่ที่ตั้งไว้ใน /catalog">
      ต้นทุนปัจจุบัน (อ้างอิง): <span className="tabular-nums">{formatTHB(row.currentUnitCost)}</span>
    </p>
  ) : (
    <p className="text-sm text-zinc-500">ต้นทุนปัจจุบัน (อ้างอิง): —</p>
  );

  return (
    <section
      id={`po-item-${row.id}`}
      aria-label={`รายการ ${title}`}
      tabIndex={-1}
      className="rounded-lg border border-zinc-200 bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
    >
      <header className="flex items-start justify-between gap-2 border-b border-zinc-100 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MetalTag metal={isOpen ? draft.metal : (row.effectiveMetal ?? "silver")} />
            <h3 className="min-w-0 break-words text-sm font-semibold text-zinc-900 [overflow-wrap:anywhere]">{title}</h3>
            {!hasSku && (
              <Badge tone="amber">
                <span aria-hidden="true">⚑</span> ยังไม่ผูก SKU
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-600">
            {row.currentCostType && <Badge tone={costModeTone(row.currentCostType)}>{PRODUCTION_COST_TYPE_LABEL_TH[row.currentCostType]}</Badge>}
            <span className="tabular-nums">แผน {row.qtyPlanned.toLocaleString("en-US")} ชิ้น</span>
            {!isOpen && <span className="tabular-nums">ผลิตเข้าแล้ว {row.qtyDone != null ? row.qtyDone.toLocaleString("en-US") : "—"} ชิ้น</span>}
            {dirty && (
              <span className="font-medium text-amber-800">
                ยังไม่บันทึก <span aria-hidden="true">●</span>
              </span>
            )}
          </div>
        </div>
        {isOpen && onRemove && (
          <button
            type="button"
            onClick={() => onRemove(row)}
            disabled={removing || saving}
            aria-label={`ลบ ${itemShortName(row)}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="space-y-3 p-3">
        {!hasSku && <div className="text-sm text-zinc-700">{costLine}</div>}

        {isOpen ? (
          <>
            <MetalSpecFields
              idBase={idBase}
              metal={draft.metal}
              purityText={draft.purityText}
              weightText={draft.weightText}
              onMetalChange={changeMetal}
              onPurityChange={(t) => setDraft((d) => ({ ...d, purityText: t }))}
              onWeightChange={(t) => setDraft((d) => ({ ...d, weightText: t }))}
              busy={saving}
              metalLockReason={activeJobNo ? `เปลี่ยนโลหะไม่ได้ — มีใบงาน ${activeJobNo} เดินอยู่ · ยกเลิกใบงานก่อน แล้วแก้โลหะ` : null}
              skuMetal={hasSku ? { metal: row.skuMetal, known: row.skuMetalKnown } : null}
              errors={errors}
              forceShow={attempted}
              metalNotes={metalNotes}
              purityBadge={purityBadge}
              weightBadge={weightBadge}
              weightHint={activeJobNo ? "น้ำหนักเป้าของใบงานไม่เปลี่ยนตาม — แก้ที่ใบงานถ้าต้องการ" : null}
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
                    disabled={saving}
                    onChange={(e) => setDraft((d) => ({ ...d, qtyText: e.target.value }))}
                    aria-invalid={errors.qty ? true : undefined}
                    aria-describedby={errors.qty ? `${idBase}-qty-err` : undefined}
                    className={`${inputCls} ${errors.qty ? "ring-1 ring-red-500" : ""}`}
                  />
                  {errors.qty && (
                    <p id={`${idBase}-qty-err`} role="alert" className="pt-0.5 text-[11px] text-red-600">
                      {errors.qty}
                    </p>
                  )}
                  {/* ค่าออกแบบมีผลเฉพาะโหมด spec (production_cost_calc อ่าน is_new_design เฉพาะ branch 'spec') — fixed/spot/ไม่มี SKU ซ่อนช่องไปเลย */}
                  {row.currentCostType === "spec" && (
                    <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={draft.isNewDesign}
                        disabled={saving}
                        onChange={(e) => setDraft((d) => ({ ...d, isNewDesign: e.target.checked }))}
                        className="h-5 w-5 rounded border-zinc-300"
                      />
                      แบบใหม่ (คิดค่าออกแบบ)
                    </label>
                  )}
                </div>
              }
            />

            {hasSku && <div>{costLine}</div>}

            {!hasSku && (
              <p className="text-xs text-zinc-600">
                ยังไม่มีปุ่มผูก SKU ในหน้านี้ — ถ้าลบรายการนี้ไม่ได้ (มีใบงานผูกอยู่) ให้ยกเลิกทั้งใบผลิตแล้วเปิดใหม่
              </p>
            )}

            {cardError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {cardError}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="button" size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
                บันทึกรายการ
              </Button>
            </div>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-zinc-500">เนื้อ</dt>
                <dd className="tabular-nums text-zinc-800">{row.effectivePurity != null ? formatPurityPct(row.effectivePurity) : "ไม่ได้ระบุ"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">น้ำหนัก</dt>
                <dd className="tabular-nums text-zinc-800">{formatWeight(row.effectiveWeightG)}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">แบบใหม่</dt>
                <dd className="text-zinc-800">{row.currentCostType === "spec" ? (row.isNewDesign ? "ใช่" : "ไม่ใช่") : "—"}</dd>
              </div>
            </dl>
            {costLine}
            {showSpecCard && row.costCalc && (
              <ProductionSpecCostCard
                makeSpec={row.makeSpec}
                silverWeightG={row.effectiveWeightG}
                silverPurity={row.effectivePurity}
                metal={row.effectiveMetal}
                costCalc={row.costCalc}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
