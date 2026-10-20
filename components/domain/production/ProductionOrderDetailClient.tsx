"use client";

// ProductionOrderDetailClient — /production/[id]. Single page for the whole
// "add items -> ผลิตเสร็จ/ยกเลิก" flow (0131's design has no separate
// edit-vs-view mode split — the RPCs themselves gate what's possible by
// order.status, this component just mirrors that in the UI: done/cancelled
// orders render read-only, matching the P1b brief's item 5 ("ใบที่
// done/cancelled = อ่านอย่างเดียว — DB ปฏิเสธอยู่แล้ว แต่ UI ต้องไม่หลอกให้กด").
//
// PM-B (UX spec A.2–A.3): รายการเป็นการ์ด ProductionItemCard (โลหะ/เนื้อ/น้ำหนัก/ชิ้นต่อรายการ) แทนตาราง ·
// เช็คลิสต์ก่อนผลิตเสร็จ + ปุ่ม aria-disabled พร้อมเหตุผล · การ์ดที่แก้ค้างยังไม่บันทึก = ข้อติด + beforeunload เตือน
// (DB อ่านเฉพาะค่าที่บันทึกแล้ว — ปล่อยผ่านจะคิดต้นทุนจากค่าเก่าเงียบๆ)
//
// 🔴 No "คงเหลือ"/"สต็อกคงเหลือ" wording anywhere in this file (P1b brief
// item 1) — every quantity shown is a fact about THIS order only.

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { removeProductionOrderItemById, saveProductionOrder } from "@/lib/actions/production";
import type { ProductionOrderItemRow, ProductionOrderRow, ProductionOrderStatus, ProductionSkuOption } from "@/lib/production/types";
import {
  PRODUCTION_ORDER_STATUS_LABEL_TH,
  PRODUCTION_SPOT_OVERRIDE_MAX,
  PRODUCTION_SPOT_OVERRIDE_MIN,
} from "@/lib/production/types";
import { closeBlockers, closeReasonLine, itemShortName, stripFnPrefix } from "@/lib/production/metal-ui";
import { formatBangkokTime } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ProductionAddItemForm } from "./ProductionAddItemForm";
import { ProductionDoneDialog } from "./ProductionDoneDialog";
import { ProductionCancelDialog } from "./ProductionCancelDialog";
import { ProductionItemCard } from "./ProductionItemCard";
import { CLOSE_CHECKLIST_ID, ProductionCloseChecklist } from "./ProductionCloseChecklist";

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
      <p className="mt-1 text-xs text-zinc-500">
        ใช้เฉพาะใบนี้ (ราคาเงินเท่านั้น — ทอง/ทองเหลืองไม่มีราคาเฉพาะใบ) — ถ้าราคาเงินวันนี้ยังไม่เข้าระบบ กรอกราคาที่ซื้อมาจริงตรงนี้แทนได้ (ไม่กระทบราคาใบเสนอราคา OEM)
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
  activeJobs,
}: {
  order: ProductionOrderRow;
  items: ProductionOrderItemRow[];
  skuOptions: ProductionSkuOption[];
  skuOptionsError: string | null;
  /** itemId → เลขใบงานที่ยังเดินอยู่ (ล็อกโลหะของรายการนั้น — UX A.3.2) · ว่าง/ไม่ส่ง = ไม่รู้/ไม่มี (DB ยังกันซ้ำที่ metal_locked) */
  activeJobs?: Record<string, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const reasonId = useId();
  const [doneDialogOpen, setDoneDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());

  const isOpen = order.status === "open";

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleDirtyChange = useCallback((itemId: string, dirty: boolean) => {
    setDirtyIds((prev) => {
      if (prev.has(itemId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  // การ์ดที่แก้ค้างยังไม่บันทึก → เตือนก่อนปิดแท็บ/รีโหลด (UX A.3 trade-off ของการบันทึกด้วยปุ่ม)
  useEffect(() => {
    if (dirtyIds.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyIds]);

  const blockers = isOpen ? closeBlockers(items, dirtyIds) : [];
  const blocked = blockers.length > 0;
  const reason = closeReasonLine(blockers);

  function onDoneClick() {
    if (blocked) {
      // aria-disabled: กดแล้วพาไปเช็คลิสต์ ไม่เปิด dialog (ผู้ใช้คีย์บอร์ดได้ยินเหตุผลผ่าน aria-describedby)
      const el = document.getElementById(CLOSE_CHECKLIST_ID);
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }
    setDoneDialogOpen(true);
  }

  function removeItem(item: ProductionOrderItemRow) {
    if (!window.confirm(`ลบ ${itemShortName(item)} ออกจากใบผลิต ${order.poNo}?`)) return;
    setRemovingItemId(item.id);
    // 0186: ลบด้วย id ทุกกรณี (รายการไม่มี SKU ลบด้วย productId ไม่ได้) — มีใบงานผูกอยู่ DB ตอบ job_exists/job_history พร้อมเลขใบงานและทางออก
    removeProductionOrderItemById({ productionOrderId: order.id, itemId: item.id }).then((result) => {
      setRemovingItemId(null);
      if (!result.ok) {
        toast.push(stripFnPrefix(result.error), "error");
        return;
      }
      toast.push(`ลบ ${itemShortName(item)} แล้ว`);
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
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCancelDialogOpen(true)}>
                ยกเลิกใบ
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                aria-disabled={blocked ? true : undefined}
                aria-describedby={blocked ? reasonId : undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-300 aria-disabled:hover:bg-zinc-300"
                onClick={onDoneClick}
              >
                ผลิตเสร็จ
              </Button>
            </div>
            {reason && (
              <p id={reasonId} className="max-w-md text-sm text-amber-900 sm:text-right">
                {reason}
              </p>
            )}
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

      {isOpen && <ProductionCloseChecklist blockers={blockers} />}

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
        <h2 className="text-sm font-bold text-zinc-800">รายการ ({items.length})</h2>
        {items.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              title="ยังไม่มีรายการในใบนี้"
              description={isOpen ? "เพิ่มรายการด้านล่างได้เลย (มี SKU หรือไม่มี SKU ก็ได้)" : undefined}
            />
          </div>
        ) : (
          <ul className="mt-2 space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <ProductionItemCard
                  order={order}
                  row={item}
                  activeJobNo={activeJobs?.[item.id] ?? null}
                  removing={removingItemId === item.id}
                  onRemove={removeItem}
                  onSaved={refresh}
                  onDirtyChange={handleDirtyChange}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {isOpen && (
        <ProductionAddItemForm
          productionOrderId={order.id}
          skuOptions={skuOptions}
          skuOptionsError={skuOptionsError}
          existingProductIds={items.flatMap((i) => (i.productId ? [i.productId] : []))}
          existingLabels={items.flatMap((i) => (i.pendingProductLabel ? [i.pendingProductLabel] : []))}
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
