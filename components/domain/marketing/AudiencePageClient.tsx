"use client";

// AudiencePageClient — pick an RFM segment, see the customer list, export a CSV
// for LINE-broadcast planning (docs/3j-jewelry/marketing/campaign-plan-99-
// winback.md). Owner/admin only (page-gated). All rows are server-fetched once;
// this component filters + exports client-side.

import { useMemo, useState } from "react";
import { Download, Users } from "lucide-react";
import type { AudienceRow } from "@/lib/marketing/types";
import { AUDIENCE_SEGMENTS, audienceSegmentLabel } from "@/lib/marketing/types";
import { EmptyState } from "@/components/ui/EmptyState";

function fmtBaht(n: number): string {
  return `฿${Math.round(n).toLocaleString("en-US")}`;
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

  // counts per segment (present in the data), preserving canonical order
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.segment, (m.get(r.segment) ?? 0) + 1);
    return m;
  }, [rows]);

  const filtered = useMemo(
    () => (segment === "all" ? rows : rows.filter((r) => r.segment === segment)),
    [rows, segment]
  );

  const totalRevenue = useMemo(() => filtered.reduce((s, r) => s + r.revenueSum, 0), [filtered]);

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

      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-600">
            <span className="font-semibold text-zinc-800">{filtered.length}</span> คน · รวมยอดซื้อ{" "}
            <span className="font-semibold text-zinc-800">{fmtBaht(totalRevenue)}</span>
          </p>
          <button
            type="button"
            onClick={() => downloadCsv(filtered, segment)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            ดาวน์โหลด CSV ({filtered.length})
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
                <th className="py-2 pr-3 text-right">ออเดอร์</th>
                <th className="py-2 pr-3 text-right">ยอดซื้อ</th>
                <th className="py-2 text-right">ซื้อล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
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
