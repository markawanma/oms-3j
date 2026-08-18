"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import type { CrmCustomerListRow } from "@/lib/actions/crm";
import type { RfmSegment } from "@/lib/crm/segments";
import { RFM_SEGMENTS, SEGMENT_LABEL_TH, SEGMENT_DESC_TH, VALUE_TIER_DESC_TH } from "@/lib/crm/segments";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { formatTHBCompact, formatThaiDateOnly } from "@/lib/tiktok/format";
import { SegmentBadge } from "./SegmentBadge";

/** 'champion' splits into two tiers by value_tier — NOT new RfmSegments, just
 * client-side filter refinements (see lib/crm/segments.ts ValueTier comment).
 * Bare "champion" is kept meaning ALL champions (both tiers) so the
 * SegmentBreakdown deep-link (/crm/customers?segment=champion, whose count is
 * core+high) lands on the same set it advertised; the dropdown instead offers
 * the two explicit tiers (champion_core / champion_high). */
type SegmentFilter = RfmSegment | "all" | "champion_core" | "champion_high";

/** Dropdown options in RFM_SEGMENTS order, with 'champion' expanded into its
 * two tiers right where 'champion' would sit (bare 'champion' stays valid for
 * deep-links but is not offered as its own dropdown row). */
const SEGMENT_FILTER_OPTIONS: { value: SegmentFilter; label: string }[] = RFM_SEGMENTS.flatMap((s) =>
  s === "champion"
    ? [
        { value: "champion_core" as SegmentFilter, label: "ลูกค้าชั้นดี (ยอดทั่วไป)" },
        { value: "champion_high" as SegmentFilter, label: "ลูกค้าชั้นดี · ยอดเยอะ ⭐" },
      ]
    : [{ value: s as SegmentFilter, label: SEGMENT_LABEL_TH[s] }]
);

function isValidSegment(v: string): v is SegmentFilter {
  return v === "champion_core" || v === "champion_high" || (RFM_SEGMENTS as string[]).includes(v);
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
      if (segment === "champion") {
        // deep-link: ALL champions (both tiers) — matches SegmentBreakdown's count
        if (r.segment !== "champion") return false;
      } else if (segment === "champion_core") {
        if (!(r.segment === "champion" && r.valueTier === "core")) return false;
      } else if (segment === "champion_high") {
        if (!(r.segment === "champion" && r.valueTier === "high")) return false;
      } else if (segment !== "all" && r.segment !== segment) {
        return false;
      }
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อลูกค้า..."
            className="min-h-11 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400"
          />
        </label>
        <label className="flex flex-col justify-center">
          <span className="sr-only">กรองตามกลุ่ม</span>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value as SegmentFilter)}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          >
            <option value="all">ทุกกลุ่ม</option>
            {SEGMENT_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-zinc-400">
        พบ <span className="font-semibold text-zinc-600">{filtered.length}</span> จาก {rows.length} คน
      </p>

      <details className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-zinc-600">
        <summary className="cursor-pointer select-none font-medium text-zinc-700">
          กลุ่มลูกค้าแต่ละแบบคืออะไร?
        </summary>
        <ul className="mt-2 space-y-1.5">
          {RFM_SEGMENTS.flatMap((s) =>
            s === "champion"
              ? [
                  <li key="champion" className="flex flex-wrap items-start gap-1.5">
                    <SegmentBadge segment="champion" />
                    <span>{SEGMENT_DESC_TH.champion}</span>
                  </li>,
                  <li key="champion_high" className="flex flex-wrap items-start gap-1.5">
                    <SegmentBadge segment="champion" />
                    <Badge tone="amber">⭐ ยอดเยอะ</Badge>
                    <span>{VALUE_TIER_DESC_TH.high}</span>
                  </li>,
                ]
              : [
                  <li key={s} className="flex flex-wrap items-start gap-1.5">
                    <SegmentBadge segment={s} />
                    <span>{SEGMENT_DESC_TH[s]}</span>
                  </li>,
                ]
          )}
        </ul>
      </details>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="ไม่พบลูกค้าที่ตรงเงื่อนไข" description="ลองล้างคำค้นหรือเปลี่ยนตัวกรองกลุ่ม" />
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.customerId}>
              <Link
                href={`/crm/customers/${c.customerId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm hover:border-primary-300 hover:bg-primary-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">{c.displayName ?? "(ไม่มีชื่อ)"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <SegmentBadge segment={c.segment} />
                    {c.valueTier === "high" && <Badge tone="amber">⭐ ยอดเยอะ</Badge>}
                    <span className="text-xs text-zinc-500">{c.orderCount} ออเดอร์</span>
                    {c.province && <span className="text-xs text-zinc-500">· {c.province}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums text-zinc-900">{formatTHBCompact(c.revenueSum)}</p>
                  <p className="text-[0.68rem] text-zinc-400">ล่าสุด {formatThaiDateOnly(c.lastOrderAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
