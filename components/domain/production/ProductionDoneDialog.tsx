"use client";

// ProductionDoneDialog — the confirm-before-"ผลิตเสร็จ" gate the P1b brief
// requires (item 3): every number shown here comes straight from
// analytics.production_order_preview (0131 §11), fetched FRESH the moment
// this dialog opens — never reused from a stale list-page fetch — so "ที่เห็น
// ก่อนกด = ที่จะถูก stamp" (design-production-order.md §"RPC 8 ตัว") holds
// literally: production_order_done (§12) calls the exact same
// production_cost_calc function with the exact same spot-price resolution
// preview does. Quantity edits in this dialog do NOT invalidate that cost
// preview — production_cost_calc computes a PER-UNIT price that never
// depends on quantity, only qty_planned vs qty_done differs.
//
// No client-side cost math anywhere below — unitCost/prevUnitCost/
// spotPriceThbPerGram are all read straight off the RPC response.
//
// 🔴 0132 (security review 18 ก.ย., M1): preview and done are still two
// separate transactions, and analytics.oem_metal_price for today CAN be
// upserted over between them (0125-0128 pull from the sheet multiple times a
// day) — so "ที่เห็นก่อนกด = ที่จะถูก stamp" is no longer just true by
// construction, it's enforced server-side too: this dialog sends
// preview.spotPriceThbPerGram back as expectedSpotThbPerGram, and
// production_order_done raises (instead of silently stamping a different
// price) if it doesn't match what it resolves at confirm time.

import { useEffect, useState } from "react";
import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { doneProductionOrder, previewProductionOrder } from "@/lib/actions/production";
import type { ProductionOrderItemRow, ProductionOrderPreview, ProductionOrderRow } from "@/lib/production/types";
import { formatTHB } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface DoneRow {
  productId: string;
  sku: string;
  productName: string;
  qtyPlanned: number;
  qtyDoneInput: string;
  unitCost: number | null;
  prevUnitCost: number | null;
  costType: "fixed" | "spot" | null;
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
  const [preview, setPreview] = useState<ProductionOrderPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [rows, setRows] = useState<DoneRow[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    previewProductionOrder(order.id).then((result) => {
      if (cancelled) return;
      setPreviewLoading(false);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      setPreview(result.data);
      const byProductId = new Map(result.data.items.map((it) => [it.productId, it]));
      setRows(
        items.map((item) => {
          const calc = byProductId.get(item.productId);
          return {
            productId: item.productId,
            sku: item.sku,
            productName: item.productName,
            qtyPlanned: item.qtyPlanned,
            qtyDoneInput: String(item.qtyPlanned),
            unitCost: calc?.unitCost ?? null,
            prevUnitCost: calc?.prevUnitCost ?? null,
            costType: calc?.costType ?? null,
          };
        })
      );
    });
    return () => {
      cancelled = true;
    };
    // order.id/items identity is stable for the lifetime of this dialog
    // instance (parent only mounts it while the confirm flow is open) —
    // intentionally fetch exactly once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  function updateQty(productId: string, value: string) {
    setRows((prev) => prev.map((r) => (r.productId === productId ? { ...r, qtyDoneInput: value } : r)));
  }

  function parsedQty(r: DoneRow): number | null {
    const n = Number(r.qtyDoneInput);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100000) return null;
    return n;
  }

  const allQtyValid = rows.length > 0 && rows.every((r) => parsedQty(r) !== null);
  const totalQtyDone = rows.reduce((sum, r) => sum + (parsedQty(r) ?? 0), 0);
  const canSubmit = !previewLoading && !previewError && allQtyValid && totalQtyDone > 0 && !pending;

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    startTransition(async () => {
      const result = await doneProductionOrder({
        productionOrderId: order.id,
        items: rows.map((r) => ({ productId: r.productId, qtyDone: parsedQty(r) ?? 0 })),
        // 0132 M1 — ราคาที่ preview ตัวนี้เห็นจริงตอนเปิดหน้าต่าง ส่งกลับให้ DB
        // เทียบกับราคาที่ resolve ได้จริง ณ ตอนกดยืนยัน (กันราคาเลื่อนระหว่างที่
        // หน้าต่างนี้เปิดค้างไว้ — security review 18 ก.ย., M1)
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
        ต้นทุนของ SKU ในแคตตาล็อกไม่เปลี่ยน (SKU ที่คิดตามราคาเงินยังขยับตามราคาเงินทุกวันเหมือนเดิม)
      </p>

      {previewLoading && <p className="mt-3 text-sm text-zinc-500">กำลังคำนวณต้นทุนตัวอย่าง...</p>}

      {previewError && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-700">{previewError}</p>
        </div>
      )}

      {!previewLoading && !previewError && (
        <>
          {preview?.spotPriceThbPerGram != null ? (
            <p className="mt-3 text-xs text-zinc-500">
              ราคาเงินที่จะใช้ในใบนี้: <span className="font-semibold text-zinc-700">{formatTHB(preview.spotPriceThbPerGram)}/กรัม</span>
            </p>
          ) : (
            <p className="mt-3 text-xs text-zinc-400">ทุกรายการในใบนี้เป็นต้นทุนคงที่ — ไม่ใช้ราคาเงิน</p>
          )}

          <div className="mt-2 space-y-2">
            {rows.map((r) => {
              const qty = parsedQty(r);
              const qtyInvalid = qty === null;
              const changed = r.unitCost != null && r.prevUnitCost != null && Math.abs(r.unitCost - r.prevUnitCost) > 0.005;
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
                      value={r.qtyDoneInput}
                      onChange={(e) => updateQty(r.productId, e.target.value)}
                      aria-label={`จำนวนที่ผลิตได้จริง ${r.sku}`}
                      aria-invalid={qtyInvalid}
                      className={`min-h-9 w-24 shrink-0 rounded-md border px-2 text-right text-sm tabular-nums ${
                        qtyInvalid ? "border-red-400" : "border-zinc-300"
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    แผนไว้ {r.qtyPlanned.toLocaleString("en-US")} ชิ้น
                    {r.unitCost != null && (
                      <>
                        {" · ต้นทุน/ชิ้น: "}
                        {r.prevUnitCost != null && changed ? (
                          <>
                            <span className="line-through text-zinc-400">{formatTHB(r.prevUnitCost)}</span>{" "}
                            <span className="font-semibold text-zinc-800">{formatTHB(r.unitCost)}</span>
                          </>
                        ) : (
                          <span className="font-semibold text-zinc-800">{formatTHB(r.unitCost)}</span>
                        )}
                      </>
                    )}
                  </p>
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
