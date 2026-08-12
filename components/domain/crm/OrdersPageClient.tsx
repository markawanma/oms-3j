"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Search } from "lucide-react";
import type { CrmOrderRow } from "@/lib/actions/crm";
import { CRM_ORDER_SORT_OPTIONS, isValidCrmOrderSortKey, type CrmOrderSortKey } from "@/lib/crm/orders";
import { EmptyState } from "@/components/ui/EmptyState";
import { CrmDateRangeFilter } from "./CrmDateRangeFilter";
import { formatCount, formatTHBCompact, formatThaiDateOnly } from "@/lib/tiktok/format";

const PROFIT_STATUS_LABEL_TH: Record<string, string> = {
  missing: "ไม่มีข้อมูล",
  estimated: "ประมาณการ 20%",
  actual: "ต้นทุนจริง",
};

/** Client-side search + channel filter + sort over the full order list —
 * same "334 rows fits fine in the browser" reasoning as CustomersPageClient
 * (design DoD §6). Revisit with server-side pagination only if order volume
 * grows an order of magnitude (YAGNI, per handoff "ห้าม over-engineer"). */
export function OrdersPageClient({
  rows,
  requestedFrom,
  requestedTo,
  minOrderDate,
  maxOrderDate,
  isFiltered,
}: {
  rows: CrmOrderRow[];
  requestedFrom: string | null;
  requestedTo: string | null;
  minOrderDate: string | null;
  maxOrderDate: string | null;
  isFiltered: boolean;
}) {
  const [query, setQuery] = useState("");
  const [channelId, setChannelId] = useState<string>("all");
  const [sortKey, setSortKey] = useState<CrmOrderSortKey>("date_desc");

  const channelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.channelId, r.channelName);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = rows.filter((r) => {
      if (channelId !== "all" && r.channelId !== channelId) return false;
      if (!q) return true;
      return (
        r.sourceOrderNo.toLowerCase().includes(q) ||
        (r.customerName ?? "").toLowerCase().includes(q)
      );
    });
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case "date_asc":
          return a.orderDate.localeCompare(b.orderDate);
        case "revenue_desc":
          return b.revenue - a.revenue;
        case "revenue_asc":
          return a.revenue - b.revenue;
        case "date_desc":
        default:
          return b.orderDate.localeCompare(a.orderDate);
      }
    });
    return result;
  }, [rows, query, channelId, sortKey]);

  const revenueSum = useMemo(() => filtered.reduce((sum, r) => sum + r.revenue, 0), [filtered]);

  // Concrete fallback for CrmDateRangeFilter's required from/to props — same
  // "always show a value, never blank" contract as /crm/overview, derived
  // from the already-fetched result set (see page.tsx header comment) rather
  // than a second scope query.
  const today = maxOrderDate ?? new Date().toISOString().slice(0, 10);
  const effectiveFrom = requestedFrom ?? minOrderDate ?? today;
  const effectiveTo = requestedTo ?? maxOrderDate ?? today;

  const dateRangeFilter = (
    <CrmDateRangeFilter
      basePath="/crm/orders"
      from={effectiveFrom}
      to={effectiveTo}
      minDate={minOrderDate}
      maxDate={maxOrderDate}
    />
  );

  const rangeLabel = isFiltered
    ? `แสดงออเดอร์ตั้งแต่ ${formatThaiDateOnly(effectiveFrom)} ถึง ${formatThaiDateOnly(effectiveTo)}`
    : "แสดงข้อมูลทั้งหมด";

  if (rows.length === 0 && !isFiltered) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="ยังไม่มีออเดอร์"
        description="นำเข้าออเดอร์ก่อน รายการจะขึ้นที่นี่อัตโนมัติ"
      />
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {dateRangeFilter}
        <p className="text-xs text-zinc-500">{rangeLabel}</p>
        <EmptyState
          icon={ClipboardList}
          title="ไม่มีออเดอร์ในช่วงที่เลือก"
          description="ลองขยายช่วงวันที่ หรือกลับไปดูข้อมูลทั้งหมด"
          action={
            <Link
              href="/crm/orders"
              className="inline-flex min-h-11 items-center rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
            >
              ดูข้อมูลทั้งหมด
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {dateRangeFilter}
      <p className="text-xs text-zinc-500">{rangeLabel}</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">ค้นหาเลขออเดอร์หรือชื่อลูกค้า</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเลขออเดอร์หรือชื่อลูกค้า..."
            className="min-h-11 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400"
          />
        </label>
        <label className="flex flex-col justify-center">
          <span className="sr-only">กรองช่องทาง</span>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          >
            <option value="all">ทุกช่องทาง</option>
            {channelOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col justify-center">
          <span className="sr-only">เรียงลำดับ</span>
          <select
            value={sortKey}
            onChange={(e) => {
              const v = e.target.value;
              if (isValidCrmOrderSortKey(v)) setSortKey(v);
            }}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          >
            {CRM_ORDER_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-zinc-400">
        พบ <span className="font-semibold text-zinc-600">{formatCount(filtered.length)}</span> ออเดอร์ · รวม{" "}
        <span className="font-semibold text-zinc-600">{formatTHBCompact(revenueSum)}</span>
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={Search} title="ไม่พบออเดอร์ที่ตรงเงื่อนไข" description="ลองล้างคำค้นหรือเปลี่ยนตัวกรองช่องทาง" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th scope="col" className="py-2 pl-3.5 pr-3">
                  วันที่
                </th>
                <th scope="col" className="py-2 pr-3">
                  เลขออเดอร์
                </th>
                <th scope="col" className="py-2 pr-3">
                  ลูกค้า
                </th>
                <th scope="col" className="py-2 pr-3">
                  ช่องทาง
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  ยอด
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  กำไร
                </th>
                <th scope="col" className="py-2 pr-3">
                  จังหวัด
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  ชิ้น
                </th>
                <th scope="col" className="py-2 pr-3.5">
                  Tracking
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="py-2 pl-3.5 pr-3 whitespace-nowrap text-zinc-600">{formatThaiDateOnly(o.orderDate)}</td>
                  <td className="py-2 pr-3 font-medium text-zinc-800">
                    {o.sourceOrderNo}
                    {o.isEdited && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[0.62rem] font-semibold text-amber-700">
                        แก้ไขแล้ว
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {o.customerId ? (
                      <Link href={`/crm/customers/${o.customerId}`} className="text-primary-700 hover:underline">
                        {o.customerName ?? "(ไม่มีชื่อ)"}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">(ไม่ระบุลูกค้า)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-zinc-600">{o.channelName}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-800">{formatTHBCompact(o.revenue)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">
                    {o.profit === null ? "—" : formatTHBCompact(o.profit)}
                    <span className="ml-1 text-[0.62rem] text-zinc-400">
                      ({PROFIT_STATUS_LABEL_TH[o.profitStatus] ?? o.profitStatus})
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-500">{o.provinceNameTh ?? o.provinceCode}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{o.itemCount ?? "—"}</td>
                  <td className="py-2 pr-3.5 text-zinc-500">{o.trackingNo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
