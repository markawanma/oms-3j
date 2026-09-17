"use client";

// AudiencePageClient — pick an RFM segment, see the customer list, export a CSV
// for LINE-broadcast planning (docs/3j-jewelry/marketing/campaign-plan-99-
// winback.md). Owner/admin only (page-gated). All rows are server-fetched once;
// this component filters + exports client-side.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Users } from "lucide-react";
import type { AudienceRow, ProductAffinity } from "@/lib/marketing/types";
import { AUDIENCE_AFFINITY_LABEL_TH, AUDIENCE_SEGMENTS, audienceSegmentLabel } from "@/lib/marketing/types";
import { EmptyState } from "@/components/ui/EmptyState";

/** ตัวกรองสายสินค้า (0099) — CMO ยืนยันสองกลุ่มทับกันแค่ 2.7% ยิงคอนเทนต์
 * ผิดฝั่ง = เผาเงิน "all" = ไม่กรอง */
const AFFINITY_FILTERS = ["all", "jewelry_only", "bar_only", "both"] as const;
type AffinityFilter = (typeof AFFINITY_FILTERS)[number];

function affinityFilterLabel(f: AffinityFilter): string {
  return f === "all" ? "ทั้งหมด" : AUDIENCE_AFFINITY_LABEL_TH[f as ProductAffinity];
}

function fmtBaht(n: number): string {
  return `฿${Math.round(n).toLocaleString("en-US")}`;
}

/** คอลัมน์ที่กดเรียงได้ — เพิ่มคอลัมน์ใหม่ในอนาคตแค่เพิ่มใน union + SORT_COLUMNS */
type SortKey = "orderCount" | "revenueSum" | "recencyDays";

interface SortState {
  key: SortKey;
  /** ทิศเรียงของ "ค่าตัวเลขดิบ" ของคอลัมน์นั้น: 1 = น้อย→มาก, -1 = มาก→น้อย
   * (ไม่ใช่ทิศของ "ความน่าสนใจ" — ดู initialDir ของ recencyDays ด้านล่าง) */
  dir: 1 | -1;
}

/** ทิศที่กดครั้งแรก (สลับคอลัมน์) ของแต่ละคอลัมน์ — ออเดอร์/ยอดซื้อ มาก→น้อยคือคน
 * น่าสนใจสุดก่อน (dir -1) ส่วนซื้อล่าสุด "คนน่าสนใจสุด" คือเพิ่งซื้อ = recencyDays
 * น้อยสุดก่อน (dir 1) — เลขคนละความหมายกับสองคอลัมน์แรก ตั้งใจ ไม่ใช่พิมพ์ผิด */
const SORT_COLUMNS: { key: SortKey; label: string; initialDir: 1 | -1 }[] = [
  { key: "orderCount", label: "ออเดอร์", initialDir: -1 },
  { key: "revenueSum", label: "ยอดซื้อ", initialDir: -1 },
  { key: "recencyDays", label: "ซื้อล่าสุด", initialDir: 1 },
];

/** เปรียบเทียบสองแถวตาม sort ปัจจุบัน
 *
 * recencyDays ต้องเช็ค lastOrderAt ก่อนเชื่อค่าตัวเลข: ฝั่ง server
 * (lib/actions/marketing.ts) ใช้ `Number(r.recency_days) || 0` แปลง
 * recency_days ที่เป็น null (ลูกค้าที่ order_count=0 ไม่เคยมี last_order_at —
 * ดู supabase/migrations/0120_crm_retention.sql B3) ให้กลายเป็น 0 ซึ่งหน้าตา
 * เหมือน "ซื้อวันนี้" ทั้งที่จริงคือ "ไม่เคยซื้อเลย" ถ้าไม่กันจุดนี้ คนกลุ่มนี้จะ
 * ลอยขึ้นหัวตารางตอนเรียง "ใหม่→เก่า" — ใช้ lastOrderAt เป็นตัวเช็คแทนเพราะ
 * เป็น null คู่กับ recency_days เสมอ (เงื่อนไขเดียวกันจาก view) */
function compareAudienceRows(a: AudienceRow, b: AudienceRow, sort: SortState): number {
  if (sort.key === "recencyDays") {
    const aMissing = a.lastOrderAt == null;
    const bMissing = b.lastOrderAt == null;
    if (aMissing !== bMissing) return aMissing ? 1 : -1; // ไม่มีข้อมูลจริง -> ท้ายตารางเสมอ ทั้งสองทิศ
    if (!aMissing && !bMissing) {
      const diff = (a.recencyDays - b.recencyDays) * sort.dir;
      if (diff !== 0) return diff;
    }
    return a.customerId.localeCompare(b.customerId); // ลำดับรองคงที่ กันสลับไปมาทุก render
  }
  const diff = (a[sort.key] - b[sort.key]) * sort.dir;
  if (diff !== 0) return diff;
  return a.customerId.localeCompare(b.customerId);
}

function SortHeaderButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  const Icon = active ? (dir === -1 ? ArrowDown : ArrowUp) : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 ${
        active ? "text-zinc-800" : "text-zinc-500"
      }`}
    >
      {label}
      <Icon className={`h-3 w-3 shrink-0 ${active ? "text-zinc-700" : "text-zinc-300"}`} aria-hidden="true" />
    </button>
  );
}

/** CSV-escape one field (quote if it contains comma/quote/newline). */
function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: AudienceRow[], segment: string) {
  const header = ["display_name", "segment", "channel", "province", "order_count", "revenue_sum", "last_order_at", "recency_days"];
  const lines = rows.map((r) =>
    [
      csvCell(r.displayName),
      csvCell(r.segment),
      csvCell(r.channelName ?? r.channelCode),
      csvCell(r.provinceNameTh ?? r.provinceCode),
      r.orderCount,
      r.revenueSum,
      csvCell(r.lastOrderAt),
      r.recencyDays,
    ].join(",")
  );
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audience-${segment}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AudiencePageClient({ rows }: { rows: AudienceRow[] }) {
  const [segment, setSegment] = useState<string>("all");
  const [affinity, setAffinity] = useState<AffinityFilter>("all");
  // ค่าเริ่มต้น: ยอดซื้อ มาก→น้อย (คนที่น่าสนใจที่สุดขึ้นก่อน) — เปลี่ยน filter ไม่รีเซ็ตค่านี้
  const [sort, setSort] = useState<SortState>({ key: "revenueSum", dir: -1 });

  function handleSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: (prev.dir * -1) as 1 | -1 }; // กดซ้ำคอลัมน์เดิม -> สลับทิศ
      const col = SORT_COLUMNS.find((c) => c.key === key)!;
      return { key, dir: col.initialDir }; // สลับคอลัมน์ -> เริ่มที่ทิศ "น่าสนใจสุดก่อน" ของคอลัมน์นั้น
    });
  }

  // counts per segment (present in the data), preserving canonical order
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.segment, (m.get(r.segment) ?? 0) + 1);
    return m;
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => segment === "all" || r.segment === segment)
        .filter((r) => affinity === "all" || r.affinity === affinity),
    [rows, segment, affinity]
  );

  const totalRevenue = useMemo(() => filtered.reduce((s, r) => s + r.revenueSum, 0), [filtered]);

  // ลำดับที่เห็นบนตาราง + ที่ export CSV ต้องตรงกัน — ทั้งคู่อ่านจาก sorted
  const sorted = useMemo(() => [...filtered].sort((a, b) => compareAudienceRows(a, b, sort)), [filtered, sort]);

  const segmentTabs = ["all", ...AUDIENCE_SEGMENTS.filter((s) => counts.has(s))];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <EmptyState icon={Users} title="ยังไม่มีข้อมูลลูกค้า" description="จะแสดงกลุ่มลูกค้าที่นี่เมื่อมีออเดอร์เข้าระบบ" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header />

      <div className="flex flex-wrap gap-1.5">
        {segmentTabs.map((s) => {
          const active = segment === s;
          const n = s === "all" ? rows.length : counts.get(s) ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSegment(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-primary-600 text-white" : "bg-white text-zinc-600 border border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              {s === "all" ? "ทั้งหมด" : audienceSegmentLabel(s)} <span className={active ? "opacity-80" : "text-zinc-400"}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {AFFINITY_FILTERS.map((f) => {
          const active = affinity === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setAffinity(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? "bg-zinc-800 text-white" : "bg-white text-zinc-500 border border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              {affinityFilterLabel(f)}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-600">
            <span className="font-semibold text-zinc-800">{filtered.length}</span> คน · รวมยอดซื้อ{" "}
            <span className="font-semibold text-zinc-800">{fmtBaht(totalRevenue)}</span>
          </p>
          <button
            type="button"
            onClick={() => downloadCsv(sorted, segment)}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            ดาวน์โหลด CSV ({sorted.length})
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th className="py-2 pr-3">ลูกค้า</th>
                <th className="py-2 pr-3">กลุ่ม</th>
                <th className="py-2 pr-3">ช่องทาง</th>
                <th className="py-2 pr-3">จังหวัด</th>
                {SORT_COLUMNS.map((col, i) => (
                  <th
                    key={col.key}
                    className={`py-2 text-right ${i < SORT_COLUMNS.length - 1 ? "pr-3" : ""}`}
                    aria-sort={sort.key === col.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  >
                    <SortHeaderButton
                      label={col.label}
                      active={sort.key === col.key}
                      dir={sort.key === col.key ? sort.dir : col.initialDir}
                      onClick={() => handleSort(col.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.customerId} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 pr-3 font-medium text-zinc-800">{r.displayName}</td>
                  <td className="py-2 pr-3 text-zinc-500">{audienceSegmentLabel(r.segment)}</td>
                  <td className="py-2 pr-3 text-zinc-600">{r.channelName ?? "—"}</td>
                  <td className="py-2 pr-3 text-zinc-600">{r.provinceNameTh ?? r.provinceCode ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">{r.orderCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.revenueSum)}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">
                    {r.lastOrderAt ?? "—"}
                    <span className="ml-1 text-xs text-zinc-400">({r.recencyDays}ว.)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-lg font-bold text-zinc-900">กลุ่มลูกค้า (Audience)</h1>
      <p className="mt-0.5 text-sm text-zinc-500">
        เลือกกลุ่มลูกค้า (RFM) เพื่อดึงรายชื่อไปทำ broadcast บน LINE OA · กด “ดาวน์โหลด CSV” เพื่อเอาไปใช้ต่อ
      </p>
    </div>
  );
}
