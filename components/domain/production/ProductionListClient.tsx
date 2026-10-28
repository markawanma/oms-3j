"use client";

// ProductionListClient — /production (registry). Read-only table; all
// writes (create/edit/done/cancel) happen on /production/new or
// /production/[id]. Mirrors QuotesPageClient's overall shape (filter tabs +
// table + empty state) but has no per-row action buttons — every action
// needs the confirm-dialog treatment 0131 §12 requires, which only makes
// sense on the detail page where the full item list is visible.
//
// W1 (UX B.10.2): ป้ายซ้อนบรรทัดเล็กใต้เลขที่ (ไม่เพิ่มคอลัมน์): "จากหน้างาน" · "รอรับทราบ"/"ค้าง n วัน" (วันปฏิทินไทย) · "ยังไม่ผูก SKU n"
// กลุ่มตัวกรองที่สอง "ต้องจัดการ" (toggle · aria-pressed) ทำงานแบบ AND กับแถบสถานะ · ตัวนับนับเฉพาะใบ open · ใบที่ออฟฟิศเปิดเอง = จอเดิมเป๊ะ

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, PlusCircle, Search } from "lucide-react";
import type { ProductionOrderRow, ProductionOrderStatus } from "@/lib/production/types";
import { PRODUCTION_ORDER_STATUS_LABEL_TH } from "@/lib/production/types";
import { NEED_FILTER_LABEL, ackPending, calendarDaysOpen, isStale, matchesNeed, needCounts, needEmptyText } from "@/lib/production/office-ack";
import type { NeedFilter } from "@/lib/production/office-ack";
import { bkkDateOf } from "@/lib/jobs/dates";
import { formatBangkokTime } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_TONE: Record<ProductionOrderStatus, BadgeTone> = {
  open: "blue",
  done: "green",
  cancelled: "slate",
};

const FILTER_TABS: { value: ProductionOrderStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "open", label: "กำลังผลิต" },
  { value: "done", label: "เข้าสต็อกแล้ว" },
  { value: "cancelled", label: "ยกเลิก" },
];

const NEEDS: NeedFilter[] = ["unacked", "unbound"];

export function ProductionListClient({ orders }: { orders: ProductionOrderRow[] }) {
  const [filter, setFilter] = useState<ProductionOrderStatus | "all">("all");
  const [needs, setNeeds] = useState<ReadonlySet<NeedFilter>>(() => new Set());
  // วันนี้ตามเวลาไทย — อ่านหลัง mount (กัน hydration mismatch ของป้าย "ค้าง n วัน") · ก่อนอ่านได้ = ยังไม่ขึ้นป้ายค้าง (ขึ้น "รอรับทราบ" ธรรมดา)
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(bkkDateOf(new Date().toISOString())), []);

  const counts = useMemo(() => needCounts(orders), [orders]);
  const activeNeeds = NEEDS.filter((n) => needs.has(n));
  const visible = useMemo(() => {
    const byStatus = filter === "all" ? orders : orders.filter((o) => o.status === filter);
    return activeNeeds.length === 0 ? byStatus : byStatus.filter((o) => activeNeeds.every((n) => matchesNeed(o, n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, filter, needs]);

  const toggleNeed = (n: NeedFilter) =>
    setNeeds((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const clearFilters = () => {
    setFilter("all");
    setNeeds(new Set());
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">ใบผลิตเข้าสต็อก</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            บันทึกของที่ผลิตเองเข้าสต็อกกลาง — ต้นทุนของแต่ละรอบผลิตถูกล็อกตามราคาเงินวันที่ผลิตเสร็จ
          </p>
        </div>
        <Link href="/production/new">
          <Button type="button" variant="primary" size="sm">
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            สร้างใบผลิตใหม่
          </Button>
        </Link>
      </div>

      <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
        {FILTER_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setFilter(t.value)}
            className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors ${
              filter === t.value ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* W1: กลุ่ม "ต้องจัดการ" — แสดงเสมอแม้ n = 0 (สม่ำเสมอ · สีจาง) · AND กับแถบสถานะด้านบน */}
      {orders.length > 0 && (
        <div role="group" aria-label="ต้องจัดการ" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500">ต้องจัดการ</span>
          {NEEDS.map((n) => {
            const on = needs.has(n);
            const zero = counts[n] === 0;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => toggleNeed(n)}
                className={`min-h-9 shrink-0 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${
                  on ? "border-primary-600 bg-primary-100 text-primary-700" : zero ? "border-zinc-200 bg-zinc-50 text-zinc-500" : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                }`}
              >
                {NEED_FILTER_LABEL[n]} ({counts[n]})
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        orders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="ยังไม่มีใบผลิต"
            description="เริ่มสร้างใบผลิตใบแรกได้เลย"
            action={
              <Link href="/production/new">
                <Button type="button" variant="primary" size="sm">
                  สร้างใบผลิตใบแรก
                </Button>
              </Link>
            }
          />
        ) : activeNeeds.length > 0 ? (
          <EmptyState
            icon={Search}
            title={needEmptyText(activeNeeds)}
            description={filter === "all" ? "ลองปิดตัวกรอง หรือเปลี่ยนเงื่อนไข" : "ลองเปลี่ยนแถบสถานะ หรือปิดตัวกรอง"}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                ล้างตัวกรอง
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Search} title="ไม่พบใบผลิตในสถานะนี้" description="ลองเปลี่ยนตัวกรองสถานะ" />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th scope="col" className="py-2 pl-3.5 pr-3">เลขที่</th>
                <th scope="col" className="py-2 pr-3">สถานะ</th>
                <th scope="col" className="py-2 pr-3 text-right">รายการ (SKU)</th>
                <th scope="col" className="py-2 pr-3 text-right">แผนผลิต (ชิ้น)</th>
                <th scope="col" className="py-2 pr-3 text-right">ผลิตเข้าแล้ว (ชิ้น)</th>
                <th scope="col" className="py-2 pr-3">สร้างเมื่อ</th>
                <th scope="col" className="py-2 pr-3.5">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => {
                const pending = ackPending(o);
                const days = pending && today !== null ? calendarDaysOpen(o.createdAt, today) : null;
                const stale = today !== null && isStale(o, today);
                const showUnbound = o.status === "open" && o.unboundItemCount > 0;
                const fromShop = o.openedVia === "shopfloor";
                return (
                  <tr key={o.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="py-2 pl-3.5 pr-3 font-medium text-zinc-800">
                      <Link href={`/production/${o.id}`} className="text-primary-700 hover:underline">
                        {o.poNo}
                      </Link>
                      {/* ป้ายซ้อนบรรทัดเล็ก (ข้อความเสมอ ไม่พึ่งสี) — ใบที่ออฟฟิศเปิดเองและไม่มีรายการค้าง = ไม่มีบรรทัดนี้ (จอเดิมเป๊ะ) */}
                      {(fromShop || showUnbound) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {fromShop && <span className="inline-flex items-center rounded-sm bg-primary-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary-700">จากหน้างาน</span>}
                          {pending && (stale ? <Badge tone="red">ค้าง {days} วัน</Badge> : <Badge tone="amber">รอรับทราบ</Badge>)}
                          {showUnbound && (
                            <Badge tone="amber">
                              <span aria-hidden="true">⚑</span> ยังไม่ผูก SKU {o.unboundItemCount}
                            </Badge>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[o.status]}>{PRODUCTION_ORDER_STATUS_LABEL_TH[o.status]}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{o.itemCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{o.qtyPlannedTotal.toLocaleString("en-US")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                      {o.status === "open" ? "—" : o.qtyDoneTotal.toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">{formatBangkokTime(o.createdAt)}</td>
                    <td className="max-w-[220px] truncate py-2 pr-3.5 text-zinc-500">{o.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {orders.length > 0 && (
        <p className="text-xs text-zinc-400">
          แสดง {visible.length}/{orders.length} ใบ
        </p>
      )}
    </div>
  );
}
