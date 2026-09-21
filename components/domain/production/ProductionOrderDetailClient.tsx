"use client";

// ProductionOrderDetailClient — /production/[id]. Single page for the whole
// "add items -> ผลิตเสร็จ/ยกเลิก" flow (0131's design has no separate
// edit-vs-view mode split — the RPCs themselves gate what's possible by
// order.status, this component just mirrors that in the UI: done/cancelled
// orders render read-only, matching the P1b brief's item 5 ("ใบที่
// done/cancelled = อ่านอย่างเดียว — DB ปฏิเสธอยู่แล้ว แต่ UI ต้องไม่หลอกให้กด").
//
// 🔴 No "คงเหลือ"/"สต็อกคงเหลือ" wording anywhere in this file (P1b brief
// item 1) — every quantity shown is a fact about THIS order only.

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { removeProductionOrderItem, saveProductionOrder, setProductionOrderItem } from "@/lib/actions/production";
import type { ProductionOrderItemRow, ProductionOrderRow, ProductionOrderStatus, ProductionSkuOption } from "@/lib/production/types";
import {
  PRODUCTION_COST_TYPE_LABEL_TH,
  PRODUCTION_ORDER_STATUS_LABEL_TH,
  PRODUCTION_SPOT_OVERRIDE_MAX,
  PRODUCTION_SPOT_OVERRIDE_MIN,
} from "@/lib/production/types";
import { formatBangkokTime, formatTHB } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ProductionAddItemForm } from "./ProductionAddItemForm";
import { ProductionDoneDialog } from "./ProductionDoneDialog";
import { ProductionCancelDialog } from "./ProductionCancelDialog";
import { ProductionSpecCostCard } from "./ProductionSpecCostCard";

const STATUS_TONE: Record<ProductionOrderStatus, BadgeTone> = {
  open: "blue",
  done: "green",
  cancelled: "slate",
};

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900";
const labelCls = "block text-sm font-medium text-zinc-700";

function ProductionOrderMetaForm({ order }: { order: ProductionOrderRow }) {
  const toast = useToast();
  const [note, setNote] = useState(order.note ?? "");
  const [spotOverride, setSpotOverride] = useState(
    order.spotOverrideThbPerGram != null ? String(order.spotOverrideThbPerGram) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  // ซิงก์ค่าฟอร์มใหม่ทุกครั้งที่ order เปลี่ยนจริงจากเซิร์ฟเวอร์ (router.refresh()
  // หลัง save สำเร็จ) — กัน input โชว์ค่าค้างจากก่อนบันทึก
  useEffect(() => {
    setNote(order.note ?? "");
    setSpotOverride(order.spotOverrideThbPerGram != null ? String(order.spotOverrideThbPerGram) : "");
  }, [order.id, order.updatedAt, order.note, order.spotOverrideThbPerGram]);

  function submit() {
    setError(null);
    let spotOverrideThbPerGram: number | null = null;
    if (spotOverride.trim() !== "") {
      const n = Number(spotOverride);
      if (!Number.isFinite(n) || n < PRODUCTION_SPOT_OVERRIDE_MIN || n > PRODUCTION_SPOT_OVERRIDE_MAX) {
        setError(
          `ราคาเงินเฉพาะใบนี้ต้องอยู่ระหว่าง ${PRODUCTION_SPOT_OVERRIDE_MIN}-${PRODUCTION_SPOT_OVERRIDE_MAX} บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท)`
        );
        return;
      }
      spotOverrideThbPerGram = n;
    }
    const trimmedNote = note.trim();
    setPending(true);
    saveProductionOrder({
      id: order.id,
      note: trimmedNote || null,
      spotOverrideThbPerGram,
      // 0132 M2 — this form only ever edits an existing order (order.id is
      // always set here; creating a new order goes through
      // ProductionOrderNewClient instead), so an empty field on submit is an
      // intentional "clear this" — not "leave it alone" (the old coalesce(p_x,
      // x) semantics made clearing impossible: the screen said "saved" but the
      // old value silently stayed. security review 18 ก.ย., M2).
      clearNote: trimmedNote === "",
      clearSpotOverride: spotOverride.trim() === "",
    }).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกใบผลิตแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <label className={labelCls} htmlFor="po-meta-note">
        หมายเหตุ
      </label>
      <textarea
        id="po-meta-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-300 p-2.5 text-base text-zinc-900"
      />
      <label className={`${labelCls} mt-3`} htmlFor="po-meta-spot">
        ราคาเงินเฉพาะใบนี้ บาท/กรัม
      </label>
      <input
        id="po-meta-spot"
        type="number"
        inputMode="decimal"
        min={PRODUCTION_SPOT_OVERRIDE_MIN}
        max={PRODUCTION_SPOT_OVERRIDE_MAX}
        step="0.01"
        value={spotOverride}
        onChange={(e) => setSpotOverride(e.target.value)}
        className={inputCls}
        placeholder="ไม่กรอก = ใช้ราคาเงินของวันนี้อัตโนมัติ"
      />
      <p className="mt-1 text-xs text-zinc-400">
        ใช้เฉพาะใบนี้ — ถ้าราคาเงินวันนี้ยังไม่เข้าระบบ กรอกราคาที่ซื้อมาจริงตรงนี้แทนได้ (ไม่กระทบราคาใบเสนอราคา OEM)
        ลบตัวเลขออกแล้วกดบันทึก = เลิกใช้ราคานี้ กลับไปใช้ราคาเงินของวันนี้อัตโนมัติ
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <Button type="button" size="sm" className="mt-3" loading={pending} onClick={submit}>
        บันทึก
      </Button>
    </div>
  );
}

export function ProductionOrderDetailClient({
  order,
  items,
  skuOptions,
  skuOptionsError,
}: {
  order: ProductionOrderRow;
  items: ProductionOrderItemRow[];
  skuOptions: ProductionSkuOption[];
  skuOptionsError: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [doneDialogOpen, setDoneDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [removingProductId, setRemovingProductId] = useState<string | null>(null);
  const [togglingNewDesignProductId, setTogglingNewDesignProductId] = useState<string | null>(null);

  const isOpen = order.status === "open";

  function refresh() {
    router.refresh();
  }

  // 0144 — ติ๊ก/ถอดติ๊ก "แบบใหม่" ของรายการที่มีอยู่แล้ว: บันทึกทันทีผ่าน RPC
  // เดียวกับฟอร์มเพิ่มรายการ (qtyPlanned ส่งค่าเดิมของแถวนั้นกลับไป ไม่แตะ —
  // upsert (production_order_id, product_id) จะแก้เฉพาะ is_new_design) แล้ว
  // router.refresh() ให้ตาราง + การ์ด breakdown ที่ /production/[id] เห็นค่า
  // ใหม่ทันที. ต่างจากฟอร์มเพิ่มรายการที่ไม่ส่ง `false` เลยเวลาไม่ติ๊ก (กันรีเซ็ต
  // ค่าที่อาจมีอยู่ก่อนโดยไม่ตั้งใจ) — ที่นี่การกดคือการ "ตั้งใจสั่งค่านี้ตรงๆ"
  // สำหรับ item ตัวเดียวที่รู้ id ชัดเจนอยู่แล้ว จึงส่ง true/false ตรงตัวได้ปลอดภัย
  function toggleNewDesign(item: ProductionOrderItemRow, checked: boolean) {
    setTogglingNewDesignProductId(item.productId);
    setProductionOrderItem({
      productionOrderId: order.id,
      productId: item.productId,
      qtyPlanned: item.qtyPlanned,
      isNewDesign: checked,
    }).then((result) => {
      setTogglingNewDesignProductId(null);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(
        checked
          ? `ติ๊ก "แบบใหม่" ${item.sku} แล้ว — ค่าออกแบบจะถูกคิดตอนกดผลิตเสร็จ`
          : `ถอดติ๊ก "แบบใหม่" ${item.sku} แล้ว`
      );
      refresh();
    });
  }

  function removeItem(item: ProductionOrderItemRow) {
    if (!window.confirm(`ลบ ${item.sku} ออกจากใบผลิต ${order.poNo}?`)) return;
    setRemovingProductId(item.productId);
    removeProductionOrderItem({ productionOrderId: order.id, productId: item.productId }).then((result) => {
      setRemovingProductId(null);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`ลบ ${item.sku} แล้ว`);
      refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Link href="/production" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายการใบผลิต
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-zinc-900">{order.poNo}</h1>
            <Badge tone={STATUS_TONE[order.status]}>{PRODUCTION_ORDER_STATUS_LABEL_TH[order.status]}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-zinc-500">สร้างเมื่อ {formatBangkokTime(order.createdAt)}</p>
        </div>

        {isOpen && (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setCancelDialogOpen(true)}>
              ยกเลิกใบ
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={items.length === 0}
              onClick={() => setDoneDialogOpen(true)}
            >
              ผลิตเสร็จ
            </Button>
          </div>
        )}
      </div>

      {order.status === "done" && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          ผลิตเข้าแล้ว {order.qtyDoneTotal.toLocaleString("en-US")} ชิ้น เมื่อ {formatBangkokTime(order.doneAt)}
        </p>
      )}
      {order.status === "cancelled" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          ยกเลิกเมื่อ {formatBangkokTime(order.cancelledAt)}
          {order.cancelReason ? ` · เหตุผล: ${order.cancelReason}` : ""}
        </p>
      )}

      {isOpen ? (
        <ProductionOrderMetaForm order={order} />
      ) : (
        order.note && (
          <div className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="text-xs font-semibold text-zinc-500">หมายเหตุ</p>
            <p className="mt-0.5 text-sm text-zinc-700">{order.note}</p>
          </div>
        )
      )}

      <div>
        <h2 className="text-sm font-bold text-zinc-800">รายการ SKU</h2>
        {items.length === 0 ? (
          <div className="mt-2">
            <EmptyState title="ยังไม่มีรายการในใบนี้" description={isOpen ? "เพิ่ม SKU ด้านล่างได้เลย" : undefined} />
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                  <th scope="col" className="py-2 pl-3.5 pr-3">SKU</th>
                  <th scope="col" className="py-2 pr-3 text-right">แผนผลิต</th>
                  {!isOpen && <th scope="col" className="py-2 pr-3 text-right">ผลิตเข้าแล้ว</th>}
                  <th scope="col" className="py-2 pr-3">โหมด</th>
                  {/* หัวคอลัมน์สั้น + title เป็น tooltip ของคำอธิบายเต็ม (ต่างจาก
                      ฟอร์มเพิ่มรายการที่มีแค่ 1 แถวเลยเขียนคำอธิบายเต็มใต้ช่องได้
                      ตรงๆ — ตารางนี้มีหลายแถว ขึ้นซ้ำทุกแถวจะรก) */}
                  <th scope="col" className="py-2 pr-3" title="ติ๊กเฉพาะรอบที่ออกแบบใหม่ — ผลิตซ้ำแบบเดิมไม่ต้องติ๊ก (มีผลเฉพาะโหมดคำนวณจากสเปค)">
                    แบบใหม่
                  </th>
                  {/* ใบยัง open = ตัวเลขนี้คือต้นทุนปัจจุบันใน /catalog "อ้างอิง" เท่านั้น
                      ยังไม่ใช่ค่าที่จะถูกล็อก (SKU โหมด spot จะคิดใหม่ตามราคาเงินตอนกด
                      ผลิตเสร็จ) — หัวคอลัมน์เดิมเขียนว่า "ต้นทุน/ชิ้น" เฉยๆ ซึ่งชวนให้
                      เข้าใจว่าเป็นค่าที่ล็อกแล้ว · ใบที่ปิดแล้วถึงจะเป็นค่าที่ stamp จริง */}
                  <th scope="col" className="py-2 pr-3 text-right">
                    {isOpen
                      ? "ต้นทุนปัจจุบัน (อ้างอิง)"
                      : order.status === "done"
                        ? "ต้นทุนที่ล็อกไว้"
                        : "ต้นทุน (ไม่ได้ผลิต)"}
                  </th>
                  {isOpen && <th scope="col" className="py-2 pr-3.5" />}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const costChanged =
                    item.stampedUnitCost != null &&
                    item.prevUnitCost != null &&
                    Math.abs(item.stampedUnitCost - item.prevUnitCost) > 0.005;
                  // ใบ done + บรรทัดโหมด spec = แสดงการ์ดสเปค/breakdown ที่ถูกล็อกไว้
                  // จริง (item.costCalc คือ snapshot จาก production_order_item.cost_calc
                  // — ไม่ใช่คำนวณสดอีกรอบ) task brief 2c ต้องเห็นที่มาแม้ย้อนดูทีหลัง
                  const showSpecCard = order.status === "done" && item.currentCostType === "spec" && item.costCalc;
                  return (
                    <Fragment key={item.id}>
                      <tr className="border-b border-zinc-100 last:border-0">
                        <td className="py-2 pl-3.5 pr-3">
                          <span className="font-medium text-zinc-800">{item.sku}</span>{" "}
                          <span className="text-zinc-500">· {item.productName}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                          {item.qtyPlanned.toLocaleString("en-US")}
                        </td>
                        {!isOpen && (
                          <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                            {item.qtyDone != null ? item.qtyDone.toLocaleString("en-US") : "—"}
                          </td>
                        )}
                        <td className="py-2 pr-3">
                          <Badge tone={item.currentCostType === "spot" ? "cyan" : item.currentCostType === "spec" ? "indigo" : "slate"}>
                            {PRODUCTION_COST_TYPE_LABEL_TH[item.currentCostType]}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          {item.currentCostType !== "spec" ? (
                            // ค่าออกแบบมีผลเฉพาะโหมด spec (production_cost_calc
                            // อ่าน is_new_design เฉพาะ branch 'spec') — ซ่อนช่องติ๊ก
                            // ทิ้งไปเลยสำหรับ fixed/spot แทนโชว์แบบ disabled+หมายเหตุ
                            // ต่อแถว เพราะตารางนี้มีหลายแถวพร้อมกัน "—" เทียบกับแถว
                            // spec ข้างๆ ที่มีช่องติ๊กจริงชัดเจนกว่าอยู่แล้วว่าไม่มีผล
                            <span className="text-zinc-300">—</span>
                          ) : isOpen ? (
                            <label className="inline-flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={item.isNewDesign}
                                disabled={togglingNewDesignProductId === item.productId}
                                onChange={(e) => toggleNewDesign(item, e.target.checked)}
                                aria-label={`แบบใหม่ (คิดค่าออกแบบ) ${item.sku}`}
                                className="h-5 w-5 rounded border-zinc-300 disabled:opacity-50"
                              />
                              {togglingNewDesignProductId === item.productId && (
                                <span className="text-xs text-zinc-400">กำลังบันทึก…</span>
                              )}
                            </label>
                          ) : item.isNewDesign ? (
                            <Badge tone="indigo">แบบใหม่</Badge>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                          {order.status === "done" ? (
                            item.stampedUnitCost != null ? (
                              costChanged && item.prevUnitCost != null ? (
                                <>
                                  <span className="text-zinc-400 line-through">{formatTHB(item.prevUnitCost)}</span>{" "}
                                  <span className="font-semibold text-zinc-800">{formatTHB(item.stampedUnitCost)}</span>
                                </>
                              ) : (
                                <span className="font-semibold text-zinc-800">{formatTHB(item.stampedUnitCost)}</span>
                              )
                            ) : (
                              "—"
                            )
                          ) : item.currentCostType === "spot" || item.currentCostType === "spec" ? (
                            // security review M5: SKU โหมด spot/spec — `product.unit_cost`
                            // ดิบ เป็นเลข manual เก่าที่มักล้าสมัย/เป็น null และ **ไม่ตรงกับ
                            // ที่ /catalog แสดง** (คำนวณจากน้ำหนัก × ราคาเงิน หรือจากสเปค)
                            // ⇒ ห้ามโชว์ตัวเลขที่จะทำให้ตัดสินใจผิดว่าจะผลิตไหม
                            <span className="text-zinc-400">คำนวณตอนกดผลิตเสร็จ</span>
                          ) : item.currentUnitCost != null ? (
                            <span title="ต้นทุนคงที่ที่ตั้งไว้ใน /catalog">
                              {formatTHB(item.currentUnitCost)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        {isOpen && (
                          <td className="py-2 pr-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeItem(item)}
                              disabled={removingProductId === item.productId}
                              aria-label={`ลบ ${item.sku}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </td>
                        )}
                      </tr>
                      {showSpecCard && (
                        <tr className="border-b border-zinc-100 last:border-0">
                          {/* 6 คอลัมน์เสมอ: SKU, แผนผลิต, [ผลิตเข้าแล้ว|ลบ] (มีเสมอ
                              1 ใน 2), โหมด, แบบใหม่, ต้นทุน — colSpan คงที่ได้เพราะ
                              แถว spec card render เฉพาะ order.status==='done' ซึ่ง
                              isOpen เป็น false เสมอ (คอลัมน์ "ลบ" ไม่โผล่ตอนนั้น) */}
                          <td colSpan={6} className="px-3.5 pb-2.5">
                            <ProductionSpecCostCard
                              makeSpec={item.makeSpec}
                              silverWeightG={item.currentSilverWeightG}
                              silverPurity={item.currentSilverPurity}
                              costCalc={item.costCalc!}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOpen && (
        <ProductionAddItemForm
          productionOrderId={order.id}
          skuOptions={skuOptions}
          skuOptionsError={skuOptionsError}
          onAdded={refresh}
        />
      )}

      {doneDialogOpen && (
        <ProductionDoneDialog
          order={order}
          items={items}
          onClose={() => setDoneDialogOpen(false)}
          onDone={() => {
            setDoneDialogOpen(false);
            refresh();
          }}
        />
      )}
      {cancelDialogOpen && (
        <ProductionCancelDialog
          order={order}
          onClose={() => setCancelDialogOpen(false)}
          onCancelled={() => {
            setCancelDialogOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
