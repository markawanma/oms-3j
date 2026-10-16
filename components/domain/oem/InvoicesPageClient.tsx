"use client";

// InvoicesPageClient — /oem/invoices (0179): ทะเบียนใบแจ้งหนี้ทั้งร้าน · ใบ void ไม่ซ่อน (ตรวจความต่อเนื่องของเลขที่ได้)
// แท็บสถานะ = สถานะที่ "แสดง" (resolveInvoiceDisplayStatus — void → paid → stale → overdue → pending) พร้อมจำนวน ·
// กรองเดือนที่ออก (issueDate) · ไม่มีการคำนวณเงิน: ยอดทุกตัวมาจากแถวที่ DB แช่แข็งตอนออกใบ — นับแต่จำนวนใบ ไม่รวมยอด
// พิมพ์: void = "ดูใบ" (พิมพ์ไม่ได้ · มติ Tech Lead) · stale = ปิดปุ่ม (หน้าพิมพ์บล็อกอยู่แล้ว) · ที่เหลือเปิดแท็บใหม่

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Eye, Printer, Search } from "lucide-react";
import type { OemInvoiceKind, OemInvoiceRow } from "@/lib/oem/types";
import type { InvoiceDisplayStatus } from "@/lib/oem/invoiceDisplay";
import { INVOICE_DISPLAY_STATUS_LABEL_TH, formatDueText, resolveInvoiceDisplayStatus } from "@/lib/oem/invoiceDisplay";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { INVOICE_STATUS_ICON, INVOICE_STATUS_TONE } from "./invoiceStatusStyle";

type StatusFilter = InvoiceDisplayStatus | "all";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "pending", label: INVOICE_DISPLAY_STATUS_LABEL_TH.pending },
  { value: "overdue", label: INVOICE_DISPLAY_STATUS_LABEL_TH.overdue },
  { value: "stale", label: INVOICE_DISPLAY_STATUS_LABEL_TH.stale },
  { value: "paid", label: INVOICE_DISPLAY_STATUS_LABEL_TH.paid },
  { value: "void", label: INVOICE_DISPLAY_STATUS_LABEL_TH.void },
];

const KIND_SHORT_TH: Record<OemInvoiceKind, string> = { deposit: "มัดจำ", balance: "คงเหลือ" };

const monthLabelFormatter = new Intl.DateTimeFormat("th-TH", { year: "numeric", month: "long", timeZone: "Asia/Bangkok" });

/** "2026-10" -> "ตุลาคม 2569" (anchor เที่ยง UTC กันวันเลื่อนตาม timezone ผู้อ่าน) */
function monthLabel(monthKey: string): string {
  const d = new Date(`${monthKey}-01T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return monthLabelFormatter.format(d);
}

const linkBtnCls =
  "inline-flex min-h-11 items-center gap-1 rounded-md border border-zinc-300 px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50";

export function InvoicesPageClient({ invoices }: { invoices: OemInvoiceRow[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");

  // สถานะที่แสดงของแต่ละใบ คำนวณครั้งเดียวต่อรอบ render ของ props
  const rows = useMemo(() => invoices.map((inv) => ({ inv, status: resolveInvoiceDisplayStatus(inv) })), [invoices]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: rows.length, pending: 0, overdue: 0, stale: 0, paid: 0, void: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const months = useMemo(() => {
    const set = new Set(invoices.map((i) => i.issueDate.slice(0, 7)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [invoices]);

  const visible = useMemo(
    () => rows.filter((r) => (statusFilter === "all" || r.status === statusFilter) && (monthFilter === "all" || r.inv.issueDate.startsWith(monthFilter))),
    [rows, statusFilter, monthFilter]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ใบแจ้งหนี้</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          ทะเบียนใบแจ้งหนี้ทั้งหมด (ไม่ใช่ใบกำกับภาษี) — ยกเลิกแล้วก็ยังแสดงในรายการนี้เสมอ เพื่อตรวจความต่อเนื่องของเลขที่ได้
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="กรองตามสถานะ">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={statusFilter === t.value}
              onClick={() => setStatusFilter(t.value)}
              className={`min-h-11 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors ${
                statusFilter === t.value ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {t.label} <span className="tabular-nums">({counts[t.value]})</span>
            </button>
          ))}
        </div>
        {months.length > 0 && (
          <select
            aria-label="กรองตามเดือนที่ออกใบ"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2 text-xs font-medium text-zinc-700"
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
          icon={invoices.length === 0 ? ClipboardList : Search}
          title={invoices.length === 0 ? "ยังไม่มีใบแจ้งหนี้" : "ไม่พบใบแจ้งหนี้ตามตัวกรองนี้"}
          description={invoices.length === 0 ? "ออกใบแรกได้จากหน้าใบเสนอราคา" : "ลองเปลี่ยนตัวกรองสถานะ/เดือน"}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th scope="col" className="py-2 pl-3.5 pr-3">
                  เลขที่
                </th>
                <th scope="col" className="py-2 pr-3">
                  วันที่ออก
                </th>
                <th scope="col" className="py-2 pr-3">
                  ลูกค้า
                </th>
                <th scope="col" className="py-2 pr-3">
                  ชนิด
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  ยอด
                </th>
                <th scope="col" className="py-2 pr-3">
                  กำหนดชำระ
                </th>
                <th scope="col" className="py-2 pr-3">
                  สถานะ
                </th>
                <th scope="col" className="py-2 pr-3">
                  ใบเสนอราคา
                </th>
                <th scope="col" className="py-2 pr-3.5">
                  พิมพ์
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ inv, status }) => {
                const Icon = INVOICE_STATUS_ICON[status];
                const isVoid = status === "void";
                return (
                  <tr key={inv.id} className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 ${isVoid ? "text-zinc-500" : "text-zinc-800"}`}>
                    <td className={`py-2 pl-3.5 pr-3 font-medium ${isVoid ? "line-through" : ""}`}>{inv.invoiceNo}</td>
                    <td className="py-2 pr-3 text-zinc-600">{formatThaiDateOnly(inv.issueDate)}</td>
                    <td className="py-2 pr-3">{inv.buyerLegalName || "—"}</td>
                    <td className="py-2 pr-3 text-zinc-600">{KIND_SHORT_TH[inv.kind]}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{formatTHB(inv.amountThb)}</td>
                    <td className={`py-2 pr-3 text-xs ${status === "overdue" ? "text-red-700" : "text-zinc-600"}`}>{formatDueText(inv)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={INVOICE_STATUS_TONE[status]}>
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {INVOICE_DISPLAY_STATUS_LABEL_TH[status]}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Link href={`/oem/quotes/${inv.activeQuoteId ?? inv.quoteId}`} className="text-primary-700 hover:underline">
                        {inv.quoteNoSnapshot}
                      </Link>
                    </td>
                    <td className="py-2 pr-3.5">
                      {isVoid ? (
                        <Link href={`/oem/invoices/${inv.id}/print`} target="_blank" rel="noopener noreferrer" className={linkBtnCls}>
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          ดูใบ
                          <span className="sr-only"> {inv.invoiceNo}</span>
                        </Link>
                      ) : status === "stale" ? (
                        <span
                          aria-disabled="true"
                          title="ยอดเปลี่ยนหลังออกใบ — พิมพ์ไม่ได้ ต้องยกเลิกแล้วออกใหม่ที่หน้าใบเสนอราคา"
                          className={`${linkBtnCls} cursor-not-allowed opacity-50 hover:bg-transparent`}
                        >
                          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                          พิมพ์ไม่ได้
                          <span className="sr-only"> {inv.invoiceNo} (ล้าสมัย)</span>
                        </span>
                      ) : (
                        <Link href={`/oem/invoices/${inv.id}/print`} target="_blank" rel="noopener noreferrer" className={linkBtnCls}>
                          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                          พิมพ์
                          <span className="sr-only"> ใบแจ้งหนี้ {inv.invoiceNo}</span>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {invoices.length > 0 && (
        <p className="text-xs text-zinc-400">
          แสดง {visible.length}/{invoices.length} ใบ
        </p>
      )}
    </div>
  );
}
