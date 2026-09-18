"use client";

// ProductionListClient — /production (registry). Read-only table; all
// writes (create/edit/done/cancel) happen on /production/new or
// /production/[id]. Mirrors QuotesPageClient's overall shape (filter tabs +
// table + empty state) but has no per-row action buttons — every action
// needs the confirm-dialog treatment 0131 §12 requires, which only makes
// sense on the detail page where the full item list is visible.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, PlusCircle, Search } from "lucide-react";
import type { ProductionOrderRow, ProductionOrderStatus } from "@/lib/production/types";
import { PRODUCTION_ORDER_STATUS_LABEL_TH } from "@/lib/production/types";
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

export function ProductionListClient({ orders }: { orders: ProductionOrderRow[] }) {
  const [filter, setFilter] = useState<ProductionOrderStatus | "all">("all");

  const visible = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

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

      {visible.length === 0 ? (
        <EmptyState
          icon={orders.length === 0 ? ClipboardList : Search}
          title={orders.length === 0 ? "ยังไม่มีใบผลิต" : "ไม่พบใบผลิตในสถานะนี้"}
          description={orders.length === 0 ? "เริ่มสร้างใบผลิตใบแรกได้เลย" : "ลองเปลี่ยนตัวกรองสถานะ"}
          action={
            orders.length === 0 ? (
              <Link href="/production/new">
                <Button type="button" variant="primary" size="sm">
                  สร้างใบผลิตใบแรก
                </Button>
              </Link>
            ) : undefined
          }
        />
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
              {visible.map((o) => (
                <tr key={o.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="py-2 pl-3.5 pr-3 font-medium text-zinc-800">
                    <Link href={`/production/${o.id}`} className="text-primary-700 hover:underline">
                      {o.poNo}
                    </Link>
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
              ))}
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
