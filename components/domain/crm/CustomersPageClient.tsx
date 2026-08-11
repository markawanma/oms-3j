"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import type { CrmCustomerListRow } from "@/lib/actions/crm";
import type { RfmSegment } from "@/lib/crm/segments";
import { RFM_SEGMENTS, SEGMENT_LABEL_TH } from "@/lib/crm/segments";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatTHBCompact, formatThaiDateOnly } from "@/lib/tiktok/format";
import { SegmentBadge } from "./SegmentBadge";

type SegmentFilter = RfmSegment | "all";

function isValidSegment(v: string): v is RfmSegment {
  return (RFM_SEGMENTS as string[]).includes(v);
}

/** Client-side search + segment filter over the full customer list — data
 * volume is ~310 rows (design DoD §6), well within what filtering in the
 * browser can handle instantly without a server round-trip per keystroke;
 * revisit with server-side pagination/search only if the customer count
 * grows an order of magnitude (YAGNI, per handoff "ห้าม over-engineer"). */
export function CustomersPageClient({
  rows,
  initialSegment,
}: {
  rows: CrmCustomerListRow[];
  initialSegment?: string;
}) {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<SegmentFilter>(
    initialSegment && isValidSegment(initialSegment) ? initialSegment : "all"
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (segment !== "all" && r.segment !== segment) return false;
      if (q && !(r.displayName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, segment]);

  if (rows.length === 0) {
    return (
      <EmptyState icon={Users} title="ยังไม่มีลูกค้า" description="นำเข้าออเดอร์ก่อน รายชื่อลูกค้าจะขึ้นที่นี่อัตโนมัติ" />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">ค้นหาชื่อลูกค้า</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อลูกค้า..."
            className="min-h-11 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </label>
        <label className="flex flex-col justify-center">
          <span className="sr-only">กรองตามกลุ่ม</span>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as SegmentFilter)}
            className="min-h-11 rounded-md border border-slate-300 px-2.5 text-sm text-slate-900"
          >
            <option value="all">ทุกกลุ่ม</option>
            {RFM_SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABEL_TH[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-slate-400">
        พบ <span className="font-semibold text-slate-600">{filtered.length}</span> จาก {rows.length} คน
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="ไม่พบลูกค้าที่ตรงเงื่อนไข" description="ลองล้างคำค้นหรือเปลี่ยนตัวกรองกลุ่ม" />
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.customerId}>
              <Link
                href={`/crm/customers/${c.customerId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm hover:border-primary-300 hover:bg-primary-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{c.displayName ?? "(ไม่มีชื่อ)"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <SegmentBadge segment={c.segment} />
                    <span className="text-xs text-slate-500">{c.orderCount} ออเดอร์</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums text-slate-900">{formatTHBCompact(c.revenueSum)}</p>
                  <p className="text-[0.68rem] text-slate-400">ล่าสุด {formatThaiDateOnly(c.lastOrderAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
