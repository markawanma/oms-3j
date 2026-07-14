"use client";

import { Search } from "lucide-react";
import type { ChannelCode, OrderStatus } from "@/lib/types";
import { STATUS_LABEL_TH } from "@/lib/types";

const ALL_STATUSES: OrderStatus[] = ["new", "confirmed", "to_ship", "shipped", "completed", "oversold_hold", "cancelled"];

export interface FilterBarValue {
  channel: ChannelCode | "all";
  status: OrderStatus | "all";
  search: string;
}

export function FilterBar({
  value,
  onChange,
}: {
  value: FilterBarValue;
  onChange: (next: FilterBarValue) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {(["all", "shopee", "tiktok"] as const).map((c) => (
          <button
            key={c}
            onClick={() => onChange({ ...value, channel: c })}
            aria-pressed={value.channel === c}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${
              value.channel === c ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {c === "all" ? "ทั้งหมด" : c === "shopee" ? "Shopee" : "TikTok Shop"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor="order-search" className="sr-only">
            ค้นหาออเดอร์ (ชื่อผู้ซื้อ หรือ เลขที่ออเดอร์)
          </label>
          <input
            id="order-search"
            type="search"
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
            placeholder="ค้นหาชื่อผู้ซื้อ หรือ เลขที่ออเดอร์"
            className="min-h-11 w-full rounded-md border border-slate-300 pl-9 pr-3 text-base focus-visible:border-primary-600"
          />
        </div>

        <label htmlFor="order-status-filter" className="sr-only">
          กรองตามสถานะ
        </label>
        <select
          id="order-status-filter"
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value as OrderStatus | "all" })}
          className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-base"
        >
          <option value="all">ทุกสถานะ</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL_TH[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
