"use client";

// ProductionDoneDialog — the confirm-before-"ผลิตเสร็จ" gate the P1b brief
// requires (item 3): every number shown here comes straight from
// analytics.production_order_preview (0131 §11), fetched FRESH the moment
// this dialog opens — never reused from a stale list-page fetch — so "ที่เห็น
// ก่อนกด = ที่จะถูก stamp" (design-production-order.md §"RPC 8 ตัว") holds
// literally: production_order_done (§12) calls the exact same
// production_cost_calc function with the exact same spot-price resolution
// preview does.
//
// No client-side cost math anywhere below — unitCost/prevUnitCost/
// spotPriceThbPerGram/costCalc are all read straight off the RPC response.
//
// 🔴 0132 (security review 18 ก.ย., M1): preview and done are still two
// separate transactions, and analytics.oem_metal_price for today CAN be
// upserted over between them (0125-0128 pull from the sheet multiple times a
// day) — so "ที่เห็นก่อนกด = ที่จะถูก stamp" is no longer just true by
// construction, it's enforced server-side too: this dialog sends
// preview.spotPriceThbPerGram back as expectedSpotThbPerGram, and
// production_order_done raises (instead of silently stamping a different
// price) if it doesn't match what it resolves at confirm time.
//
// 🔴 0141/0142 (spec-cost-ui task brief §2b): unlike fixed/spot, a
// cost_type='spec' line's unit cost DEPENDS on qty (batch/flask/NRE amortize
// over however many pieces actually got produced) — the brief's own test
// numbers: 5 ชิ้น=305.07, 3 ชิ้น=325.07, same SKU. So editing a qty input
// below must re-run the preview with that same qty, not just recompute the
// total client-side (which would violate oem-quote-invariants §2 anyway) —
// see the debounced effect below. The array sent to previewProductionOrder
// is built with the EXACT SAME function (buildDoneItems) that submit() sends
// to doneProductionOrder, so what's shown on screen is provably what gets
// stamped (task brief's "เคสห้ามผ่าน #3").

import { useEffect, useMemo, useState } from "react";
import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { doneProductionOrder, previewProductionOrder } from "@/lib/actions/production";
import type {
  DoneItemInput,
  ProductionOrderItemRow,
  ProductionOrderPreview,
  ProductionOrderPreviewItem,
  ProductionOrderRow,
} from "@/lib/production/types";
import { PRODUCTION_COST_TYPE_LABEL_TH } from "@/lib/production/types";
import { formatTHB } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ProductionSpecCostCard } from "./ProductionSpecCostCard";

interface DoneRow {
  productId: string;
  sku: string;
  productName: string;
  qtyPlanned: number;
  qtyDoneInput: string;
  makeSpec: ProductionOrderItemRow["makeSpec"];
}

const DEBOUNCE_MS = 350;

function parsedQty(input: string): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100000) return null;
  return n;
}

export function ProductionDoneDialog({
  order,
  items,
  onClose,
  onDone,
}: {
  order: ProductionOrderRow;
  items: ProductionOrderItemRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [rows] = useState<DoneRow[]>(() =>
    items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      qtyPlanned: item.qtyPlanned,
      qtyDoneInput: String(item.qtyPlanned),
      makeSpec: item.makeSpec,
    }))
  );
  const [qtyByProductId, setQtyByProductId] = useState<Map<string, string>>(
    () => new Map(items.map((item) => [item.productId, String(item.qtyPlanned)]))
  );
  const [preview, setPreview] = useState<ProductionOrderPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** built once per (rows × qtyByProductId) change — the EXACT array sent to
   * both preview (below) and done (submit()), so what's shown is provably
   * what gets stamped. */
  const doneItems = useMemo<{ items: DoneItemInput[]; allValid: boolean }>(() => {
    const parsed: DoneItemInput[] = [];
    let allValid = true;
    for (const r of rows) {
      const input = qtyByProductId.get(r.productId) ?? r.qtyDoneInput;
      const qty = parsedQty(input);
      if (qty === null) {
        allValid = false;
        continue;
      }
      parsed.push({ productId: r.productId, qtyDone: qty });
    }
    return { items: parsed, allValid };
  }, [rows, qtyByProductId]);

  const itemsSignature = rows.map((r) => `${r.productId}:${qtyByProductId.get(r.productId) ?? ""}`).join("|");

  // re-preview (debounced) whenever a qty input changes — including the very
  // first run on mount (qtyByProductId starts seeded with qty_planned, so the
  // first fetch is equivalent to the old no-args preview call, just now
  // explicit and going through the exact same code path every time).
  useEffect(() => {
    if (!doneItems.allValid) {
      // ผู้ใช้กำลังพิมพ์เลขที่ยังไม่สมบูรณ์อยู่ — รอให้ครบก่อนค่อยยิง ไม่ล้าง
      // preview เดิมทิ้ง (กันตัวเลขกระพริบระหว่างพิมพ์)
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = setTimeout(() => {
      previewProductionOrder(order.id, doneItems.items).then((result) => {
        if (cancelled) return;
        setPreviewLoading(false);
        if (!result.ok) {
          setPreviewError(result.error);
          return;
        }
        setPreview(result.data);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, itemsSignature]);

  function updateQty(productId: string, value: string) {
    setQtyByProductId((prev) => {
      const next = new Map(prev);
      next.set(productId, value);
      return next;
    });
  }

  const previewByProductId = new Map<string, ProductionOrderPreviewItem>(
    (preview?.items ?? []).map((it) => [it.productId, it])
  );

  const totalQtyDone = doneItems.items.reduce((sum, it) => sum + it.qtyDone, 0);
  const canSubmit = !previewLoading && !previewError && doneItems.allValid && totalQtyDone > 0 && !pending;

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    startTransition(async () => {
      const result = await doneProductionOrder({
        productionOrderId: order.id,
        items: doneItems.items,
        // 0132 M1 — ราคาที่ preview ตัวนี้เห็นจริงตอนเปิดหน้าต่าง (หลังพิมพ์
        // จำนวนล่าสุดแล้ว) ส่งกลับให้ DB เทียบกับราคาที่ resolve ได้จริง ณ ตอน
        // กดยืนยัน (กันราคาเลื่อนระหว่างที่หน้าต่างนี้เปิดค้างไว้)
        expectedSpotThbPerGram: preview?.spotPriceThbPerGram ?? null,
      });
      if (!result.ok) {
        setSubmitError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกผลิตเสร็จ ${result.data.poNo} แล้ว — ของเข้าสต็อกและล็อกต้นทุนของรอบผลิตนี้แล้ว`);
      onDone();
    });
  }

  return (
    <Modal open onClose={onClose} title={`ยืนยันผลิตเสร็จ — ${order.poNo}`}>
      <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
        กดยืนยันแล้วต้นทุนของ <span className="font-semibold">รอบผลิตนี้</span> จะถูกล็อกตามราคาเงินวันนี้
        และจำนวนที่ระบุจะถูกบวกเข้าสต็อกกลางทันที — แก้ไขไม่ได้ ต้องเปิดใบผลิตใหม่หากจำนวนผิด
        ต้นทุนของ SKU ในแคตตาล็อกไม่เปลี่ยน (SKU ที่คิดตามราคาเงิน/สเปคยังขยับตามราคาเงินทุกวันเหมือนเดิม)
      </p>

      {previewLoading && !preview && <p className="mt-3 text-sm text-zinc-500">กำลังคำนวณต้นทุนตัวอย่าง...</p>}

      {previewError && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-700">{previewError}</p>
        </div>
      )}

      {preview && !previewError && (
        <>
          {preview.spotPriceThbPerGram != null ? (
            <p className="mt-3 text-xs text-zinc-500">
              ราคาเงินที่จะใช้ในใบนี้: <span className="font-semibold text-zinc-700">{formatTHB(preview.spotPriceThbPerGram)}/กรัม</span>
              {previewLoading && <span className="ml-1.5 text-zinc-400">(กำลังคำนวณใหม่...)</span>}
            </p>
          ) : (
            <p className="mt-3 text-xs text-zinc-400">
              ทุกรายการในใบนี้เป็นต้นทุนคงที่ — ไม่ใช้ราคาเงิน
              {previewLoading && <span className="ml-1.5 text-zinc-400">(กำลังคำนวณใหม่...)</span>}
            </p>
          )}

          <div className="mt-2 space-y-2">
            {rows.map((r) => {
              const calc = previewByProductId.get(r.productId);
              const qtyInput = qtyByProductId.get(r.productId) ?? r.qtyDoneInput;
              const qtyInvalid = parsedQty(qtyInput) === null;
              const changed =
                calc?.unitCost != null && calc?.prevUnitCost != null && Math.abs(calc.unitCost - calc.prevUnitCost) > 0.005;
              return (
                <div key={r.productId} className="rounded-md border border-zinc-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-zinc-800">
                      {r.sku} <span className="font-normal text-zinc-500">· {r.productName}</span>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100000}
                      step={1}
                      value={qtyInput}
                      onChange={(e) => updateQty(r.productId, e.target.value)}
                      aria-label={`จำนวนที่ผลิตได้จริง ${r.sku}`}
                      aria-invalid={qtyInvalid}
                      className={`min-h-9 w-24 shrink-0 rounded-md border px-2 text-right text-sm tabular-nums ${
                        qtyInvalid ? "border-red-400" : "border-zinc-300"
                      }`}
                    />
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                    แผนไว้ {r.qtyPlanned.toLocaleString("en-US")} ชิ้น
                    {calc && (
                      <Badge tone={calc.costType === "spot" ? "cyan" : calc.costType === "spec" ? "indigo" : "slate"}>
                        {PRODUCTION_COST_TYPE_LABEL_TH[calc.costType]}
                      </Badge>
                    )}
                    {calc?.skipped && <span className="text-amber-700">— ไม่ได้ผลิตชิ้นนี้ในรอบนี้ (0 ชิ้น)</span>}
                    {calc?.unitCost != null && (
                      <>
                        {"· ต้นทุน/ชิ้น: "}
                        {calc.prevUnitCost != null && changed ? (
                          <>
                            <span className="line-through text-zinc-400">{formatTHB(calc.prevUnitCost)}</span>{" "}
                            <span className="font-semibold text-zinc-800">{formatTHB(calc.unitCost)}</span>
                          </>
                        ) : (
                          <span className="font-semibold text-zinc-800">{formatTHB(calc.unitCost)}</span>
                        )}
                      </>
                    )}
                  </p>

                  {calc?.costType === "spec" && calc.costCalc && (
                    <ProductionSpecCostCard
                      makeSpec={r.makeSpec}
                      silverWeightG={calc.silverWeightG}
                      silverPurity={calc.silverPurity}
                      costCalc={calc.costCalc}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {totalQtyDone === 0 && (
            <p className="mt-2 text-xs text-amber-700">
              ทุกรายการเป็น 0 ชิ้น — ถ้าไม่ได้ผลิตจริงเลย ให้ปิดหน้าต่างนี้แล้วกด &quot;ยกเลิกใบ&quot; แทน
            </p>
          )}
        </>
      )}

      {submitError && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {submitError}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={pending} disabled={!canSubmit} onClick={submit}>
          ยืนยันผลิตเสร็จ
        </Button>
      </div>
    </Modal>
  );
}
