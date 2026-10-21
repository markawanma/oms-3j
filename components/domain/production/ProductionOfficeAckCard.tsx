"use client";

// ProductionOfficeAckCard — การ์ด "ใบนี้เปิดจากหน้างาน" บน /production/[id] (W1 · UX B.10.1 · ภาษาภาพ OfficeAck)
// • ก่อนรับทราบ = การ์ดเต็ม: ผู้เปิด · เวลา · ตาราง โลหะ/เนื้อ/น้ำหนัก/จำนวน "ที่หน้างานกรอก" โชว์เด่นสุด (เนื้อ+น้ำหนักที่ผู้จัดการพิมพ์คือตัวขับต้นทุนทอง — P8)
//   ปุ่มหลักเดียว "รับทราบ · <สรุปโลหะ>" = read-back ในตัวปุ่ม (ไม่เพิ่ม checkbox) · aria-disabled เมื่อมีค่าที่แก้ค้างยังไม่บันทึก (ค่าที่โชว์ต้องเป็นค่าที่บันทึกแล้ว)
// • หลังรับทราบ = แถบเดียว · ใบ done/cancelled = แถบข้อมูลอย่างเดียว (ไม่มีปุ่ม)
// • ไม่มีการแก้ค่าในการ์ดนี้ (แก้ที่การ์ดรายการ — แหล่งแก้เดียว) · โลหะแก้ไม่ได้เมื่อมีใบงาน → ยกเลิกใบงานแล้วเปิดใหม่
// 🔴 ไม่มีการคิดเงิน/ต้นทุน · ค่าที่ DB ตัดสิน (metal_mismatch · acknowledged_at) แสดงตามที่ DB ส่งมา ไม่คำนวณเอง
// 4 state: loading (ปุ่ม "กำลังบันทึก…") · empty (ไม่มี — ใบหน้างานมีรายการเสมอ) · error (role=alert + โหลดใหม่) · success (toast + การ์ดหดเป็นแถบ + ข้อติดหายจากเช็คลิสต์)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeProductionOrder } from "@/lib/actions/production";
import { ACK_CARD_ID, ackButtonLabel, calendarDaysOpen, effectiveMetalOf, effectivePurityPct, isShopfloor, relativeThai } from "@/lib/production/office-ack";
import { bkkDateOf } from "@/lib/jobs/dates";
import { PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import type { ProductionOrderItemRow, ProductionOrderRow } from "@/lib/production/types";
import { STALE_CALENDAR_DAYS } from "@/lib/production/office-ack";
import { formatBangkokTime } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { MetalTag } from "./MetalTag";

const HELP = "ผิดโลหะ? ยกเลิกใบงานแล้วเปิดใหม่ (โลหะล็อกพร้อมใบงาน) · เนื้อ/น้ำหนักแก้ได้ที่การ์ดรายการด้านล่าง";

function weightText(g: number | null): string {
  return g == null ? "ไม่ได้ระบุ" : `${g.toFixed(3)} กรัม`;
}

export function ProductionOfficeAckCard({
  order,
  items,
  dirty,
  onAcked,
}: {
  order: Pick<ProductionOrderRow, "id" | "poNo" | "status" | "openedVia" | "openedByWorkerName" | "acknowledgedAt" | "createdAt">;
  items: readonly ProductionOrderItemRow[];
  /** มีการ์ดรายการที่แก้ค้างยังไม่บันทึก */
  dirty: boolean;
  onAcked?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // เวลา "ตอนนี้" อ่านหลัง mount (กัน hydration mismatch ของข้อความ "n ชม. ที่แล้ว")
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  if (!isShopfloor(order)) return null;

  const by = order.openedByWorkerName ?? "ผู้จัดการ";
  const when = formatBangkokTime(order.createdAt);
  const rel = now === null ? "" : relativeThai(order.createdAt, now);
  const today = now === null ? null : bkkDateOf(new Date(now).toISOString());
  const days = today === null ? null : calendarDaysOpen(order.createdAt, today);
  const stale = days !== null && days >= STALE_CALENDAR_DAYS;

  // ---- หลังรับทราบ / ใบปิดแล้ว: แถบเดียว ----
  if (order.acknowledgedAt !== null || order.status !== "open") {
    const acked = order.acknowledgedAt !== null;
    return (
      <section id={ACK_CARD_ID} tabIndex={-1} aria-label="ใบนี้เปิดจากหน้างาน" className="rounded-lg border border-zinc-200 border-l-4 border-l-primary-600 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-800">
          <Badge tone="blue">จากหน้างาน</Badge>
          <span>
            เปิดโดย {by} · {when}
          </span>
          {acked ? (
            <span className="font-medium text-green-800">
              <span aria-hidden="true">✓ </span>รับทราบแล้ว · {formatBangkokTime(order.acknowledgedAt)}
            </span>
          ) : (
            <span className="text-zinc-600">ไม่ได้รับทราบก่อนปิด</span>
          )}
        </p>
        <details className="mt-1 text-xs text-zinc-600">
          <summary className="cursor-pointer select-none">ช่วยเหลือ</summary>
          <p className="mt-1">{HELP}</p>
        </details>
      </section>
    );
  }

  // ---- ก่อนรับทราบ: การ์ดเต็ม ----
  const unbound = items.filter((i) => i.productId === null);
  const mismatched = items.filter((i) => i.metalMismatch);
  const blocked = dirty;

  async function ack() {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    let r: Awaited<ReturnType<typeof acknowledgeProductionOrder>>;
    try {
      r = await acknowledgeProductionOrder({ productionOrderId: order.id });
    } catch {
      setError("รับทราบไม่สำเร็จ — ลองอีกครั้ง");
      return;
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      setError(r.error || "รับทราบไม่สำเร็จ — ลองอีกครั้ง");
      return;
    }
    toast.push(`รับทราบ ${order.poNo} แล้ว`);
    onAcked?.();
  }

  return (
    <section id={ACK_CARD_ID} tabIndex={-1} aria-label="ใบนี้เปิดจากหน้างาน — รอรับทราบ" aria-busy={busy} className="rounded-lg border border-zinc-200 border-l-4 border-l-primary-600 bg-white p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-zinc-900">ใบนี้เปิดจากหน้างาน</h2>
          <p className="mt-0.5 text-sm text-zinc-700">
            เปิดโดย {by} · {when}
            {rel && <span className="text-zinc-500"> ({rel})</span>}
          </p>
        </div>
        {stale ? <Badge tone="red">ค้าง {days} วัน</Badge> : <Badge tone="amber">ยังไม่รับทราบ</Badge>}
      </div>

      <div className="mt-3 overflow-x-auto rounded-md border border-zinc-300 bg-zinc-50">
        <table className="w-full min-w-[34rem] text-left">
          <caption className="px-3 pt-2 text-left text-xs font-semibold text-zinc-700">ที่หน้างานกรอก — ตรวจให้ตรงของจริง</caption>
          <thead>
            <tr className="text-[13px] font-medium text-zinc-600">
              <th scope="col" className="px-3 pt-2 pb-1 font-medium">รายการ</th>
              <th scope="col" className="px-3 pt-2 pb-1 font-medium">โลหะ</th>
              <th scope="col" className="px-3 pt-2 pb-1 font-medium">เนื้อโลหะ</th>
              <th scope="col" className="px-3 pt-2 pb-1 font-medium">น้ำหนัก/ชิ้น</th>
              <th scope="col" className="px-3 pt-2 pb-1 font-medium">จำนวน</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const m = effectiveMetalOf(i);
              const p = effectivePurityPct(i);
              return (
                <tr key={i.id} className="border-t border-zinc-200 align-middle">
                  <td className="max-w-[14rem] px-3 py-2 text-sm break-words text-zinc-800 [overflow-wrap:anywhere]">{i.sku ?? i.pendingProductLabel ?? "—"}</td>
                  <td className="px-3 py-2">
                    <MetalTag metal={m} className="!px-2.5 !py-1 !text-sm" />
                  </td>
                  <td className="px-3 py-2 text-xl font-bold tabular-nums text-zinc-900">{m === "brass" ? "100 %" : p === null ? <span className="text-base font-medium text-amber-900">ไม่ได้ระบุ</span> : `${p} %`}</td>
                  <td className={`px-3 py-2 text-xl font-bold tabular-nums ${i.effectiveWeightG == null ? "text-base font-medium text-zinc-600" : "text-zinc-900"}`}>{weightText(i.effectiveWeightG)}</td>
                  <td className="px-3 py-2 text-xl font-bold tabular-nums text-zinc-900">{i.qtyPlanned.toLocaleString("en-US")} ชิ้น</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        {mismatched.map((i) => (
          <p key={`mm-${i.id}`} role="note" className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-950">
            ⚠ ต่างจากสินค้าในระบบ: {i.sku ?? "SKU"} ระบุเป็น {i.skuMetal ? PRODUCTION_METAL_LABEL_TH[i.skuMetal] : "โลหะอื่น"} แต่หน้างานเลือก {PRODUCTION_METAL_LABEL_TH[effectiveMetalOf(i)]}
          </p>
        ))}
        {unbound.length > 0 && (
          <p className="text-zinc-700">
            ⓘ {unbound.length > 1 ? `${unbound.length} รายการ` : "รายการนี้"}ยังไม่มี SKU — ผูกที่การ์ดรายการด้านล่าง
          </p>
        )}
        {blocked && <p className="text-zinc-700">ⓘ มีค่าที่แก้ไว้ยังไม่บันทึกที่การ์ดด้านล่าง — รับทราบได้หลังบันทึก</p>}
      </div>

      {error && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">
            {error}
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={() => router.refresh()}>
            โหลดใหม่
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer select-none">ช่วยเหลือ</summary>
          <p className="mt-1 max-w-md">{HELP}</p>
        </details>
        <Button type="button" loading={busy} aria-disabled={blocked ? true : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-300 aria-disabled:hover:bg-zinc-300" onClick={() => void ack()}>
          {busy ? "กำลังบันทึก…" : (
            <>
              <span aria-hidden="true">✓</span> {ackButtonLabel(items)}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
