"use client";

// ReceiptsPageClient — /oem/receipts (0084): shop-wide registry of every
// ใบเสร็จรับเงิน/ใบกำกับภาษี ever issued, VOID ones included and NEVER hidden
// (see design-oem-payment-invoice.md §14.9 — a tax-document list must let you
// verify the number sequence has no gap, which requires seeing every number,
// issued or void). Same list/filter pattern as QuotesPageClient — status tabs
// + a month filter (receipts get filed for VAT reporting by calendar month).

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Printer, Search } from "lucide-react";
import type { OemReceiptRow, OemReceiptStatus } from "@/lib/oem/types";
import { OEM_RECEIPT_KIND_LABEL_TH, OEM_RECEIPT_STATUS_LABEL_TH } from "@/lib/oem/types";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_TONE: Record<OemReceiptStatus, BadgeTone> = {
  issued: "green",
  void: "red",
};

const STATUS_TABS: { value: OemReceiptStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "issued", label: "ออกแล้ว" },
  { value: "void", label: "ยกเลิกแล้ว" },
];

const monthLabelFormatter = new Intl.DateTimeFormat("th-TH", { year: "numeric", month: "long", timeZone: "Asia/Bangkok" });

/** "2026-08" -> "สิงหาคม 2569" — derived from receivedDate (the tax-point
 * date reports actually file by), not issueDate. */
function monthLabel(monthKey: string): string {
  // Anchor to noon UTC so this never rolls to the previous/next calendar day
  // depending on the reader's local timezone offset.
  const d = new Date(`${monthKey}-01T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return monthLabelFormatter.format(d);
}

export function ReceiptsPageClient({ receipts }: { receipts: OemReceiptRow[] }) {
  const [statusFilter, setStatusFilter] = useState<OemReceiptStatus | "all">("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const months = useMemo(() => {
    const set = new Set(receipts.map((r) => r.receivedDate.slice(0, 7)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [receipts]);

  const visible = useMemo(
    () =>
      receipts.filter(
        (r) => (statusFilter === "all" || r.status === statusFilter) && (monthFilter === "all" || r.receivedDate.startsWith(monthFilter))
      ),
    [receipts, statusFilter, monthFilter]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ใบเสร็จรับเงิน / ใบกำกับภาษี</h1>
        <p className="mt-0.5 text-sm text-zinc-500">ทะเบียนเอกสารทั้งหมด — ยกเลิกแล้วก็ยังแสดงในรายการนี้เสมอ เพื่อตรวจความต่อเนื่องของเลขที่ได้</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setStatusFilter(t.value)}
              className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors ${
                statusFilter === t.value ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {months.length > 0 && (
          <select
            aria-label="กรองตามเดือนที่รับเงิน"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="min-h-9 rounded-md border border-zinc-300 px-2 text-xs font-medium text-zinc-700"
          >
            <option value="all">ทุกเดือน</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={receipts.length === 0 ? ClipboardList : Search}
          title={receipts.length === 0 ? "ยังไม่มีใบเสร็จ/ใบกำกับภาษี" : "ไม่พบเอกสารตามตัวกรองนี้"}
          description={receipts.length === 0 ? "ออกใบแรกได้จากหน้าใบเสนอราคาที่บันทึกรับเงิน" : "ลองเปลี่ยนตัวกรองสถานะ/เดือน"}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th scope="col" className="py-2 pl-3.5 pr-3">
                  เลขที่
                </th>
                <th scope="col" className="py-2 pr-3">
                  วันที่รับเงิน
                </th>
                <th scope="col" className="py-2 pr-3">
                  ลูกค้า
                </th>
                <th scope="col" className="py-2 pr-3">
                  ประเภท
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  ยอด
                </th>
                <th scope="col" className="py-2 pr-3">
                  สถานะ
                </th>
                <th scope="col" className="py-2 pr-3">
                  ใบเสนอราคาต้นทาง
                </th>
                <th scope="col" className="py-2 pr-3.5">
                  พิมพ์
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 ${r.status === "void" ? "opacity-60" : ""}`}>
                  <td className="py-2 pl-3.5 pr-3 font-medium text-zinc-800">{r.receiptNo}</td>
                  <td className="py-2 pr-3 text-zinc-600">{formatThaiDateOnly(r.receivedDate)}</td>
                  <td className="py-2 pr-3 text-zinc-700">{r.buyerLegalName || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-600">{OEM_RECEIPT_KIND_LABEL_TH[r.kind]}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-800">{formatTHB(r.amountThb)}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={STATUS_TONE[r.status]}>{OEM_RECEIPT_STATUS_LABEL_TH[r.status]}</Badge>
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/oem/quotes/${r.quoteId}`} className="text-primary-700 hover:underline">
                      {r.quoteNoSnapshot}
                    </Link>
                  </td>
                  <td className="py-2 pr-3.5">
                    <Link href={`/oem/receipts/${r.id}/print`} target="_blank" rel="noopener noreferrer">
                      <Button type="button" variant="ghost" size="sm" className="border border-zinc-300">
                        <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {receipts.length > 0 && (
        <p className="text-xs text-zinc-400">
          แสดง {visible.length}/{receipts.length} ใบ
        </p>
      )}
    </div>
  );
}
