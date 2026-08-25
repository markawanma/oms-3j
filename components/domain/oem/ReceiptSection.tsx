"use client";

// ReceiptSection — QuoteDetailClient's "การรับเงิน / ใบเสร็จ" block (0084).
// Pure display + dialog triggers; every money figure comes straight off
// `quote` (v_oem_quote's paidThb/outstandingThb/isFullyPaid, computed fresh
// server-side every read — see OemQuoteRow's 0084 comment) or `receipts`
// (v_oem_receipt rows, each an immutable snapshot) — nothing is summed or
// derived in this component.

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, Printer, Receipt as ReceiptIcon } from "lucide-react";
import type { OemQuoteRow, OemReceiptRow } from "@/lib/oem/types";
import { OEM_RECEIPT_KIND_LABEL_TH, OEM_RECEIPT_STATUS_LABEL_TH } from "@/lib/oem/types";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ReceiptIssueDialog } from "./ReceiptIssueDialog";
import { VoidReceiptDialog } from "./VoidReceiptDialog";

// oem_receipt_issue (0084 §4) only accepts a quote whose status is quoted,
// expired, or won — mirror that here so the button never opens a dialog that
// can only ever fail server-side (same posture as every other gate in
// QuoteDetailClient).
const RECEIPT_ISSUABLE_STATUSES: OemQuoteRow["status"][] = ["quoted", "expired", "won"];

export function ReceiptSection({
  quote,
  receipts,
  onChanged,
}: {
  quote: OemQuoteRow;
  receipts: OemReceiptRow[];
  onChanged: () => void;
}) {
  const [issueOpen, setIssueOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<OemReceiptRow | null>(null);

  const canIssue = RECEIPT_ISSUABLE_STATUSES.includes(quote.status);
  const outstandingNegative = quote.outstandingThb != null && quote.outstandingThb < 0;

  function openPrintTab(receiptId: string) {
    window.open(`/oem/receipts/${receiptId}/print`, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold text-zinc-800">การรับเงิน / ใบเสร็จ</h2>
        {canIssue && (
          <Button type="button" variant="primary" size="sm" onClick={() => setIssueOpen(true)}>
            <ReceiptIcon className="h-3.5 w-3.5" aria-hidden="true" />
            บันทึกรับเงิน
          </Button>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">ยอดสุทธิ</dt>
          <dd className="tabular-nums font-semibold text-zinc-800">{quote.grandTotal != null ? formatTHB(quote.grandTotal) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">รับแล้ว</dt>
          <dd className="tabular-nums font-semibold text-green-700">{quote.paidThb != null ? formatTHB(quote.paidThb) : formatTHB(0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">คงค้าง</dt>
          <dd className={`tabular-nums font-semibold ${outstandingNegative ? "text-red-600" : "text-zinc-800"}`}>
            {quote.outstandingThb != null ? formatTHB(quote.outstandingThb) : "—"}
          </dd>
        </div>
      </dl>

      {quote.isFullyPaid && !outstandingNegative && (
        <p className="mt-2">
          <Badge tone="green">รับเงินครบแล้ว</Badge>
        </p>
      )}

      {/* ⚠️ ด่านเดียวที่มีจริง — DB จงใจไม่กันเคสนี้ (0084/0085): ต่อราคาลงหลัง
          รับเงินไปแล้วทำให้คงค้างติดลบได้ ไม่มีอะไรกันทั้งระบบนอกจากคำเตือน
          ตรงนี้ ห้ามลบ/ย่อ/ทำให้เตือนน้อยลง */}
      {outstandingNegative && (
        <div className="mt-3 flex items-start gap-2 rounded-md border-2 border-red-400 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-red-800">ร้านค้างคืนเงินลูกค้า {formatTHB(Math.abs(quote.outstandingThb!))}</p>
            <p className="mt-0.5 text-xs text-red-700">
              เกิดจากต่อราคาลงต่ำกว่ายอดที่รับเงินไปแล้ว — ระบบยังไม่มีใบลดหนี้/ขั้นตอนคืนเงินอัตโนมัติ ต้องจัดการนอกระบบ (โอนคืน/หักงานถัดไป) แล้วบันทึกเป็น
              หมายเหตุงานให้ทีมบัญชีทราบ
            </p>
          </div>
        </div>
      )}

      {!canIssue && receipts.length === 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          {quote.status === "draft" || quote.status === "lost" || quote.status === "rejected" || quote.status === "expired"
            ? "บันทึกรับเงินได้เมื่อใบอยู่สถานะเสนอราคาแล้ว/ปิดงานแล้วเท่านั้น"
            : "ใบนี้ถูกแทนที่ด้วยใบต่อราคาใหม่แล้ว — ไปบันทึกรับเงินที่ใบใหม่แทน"}
        </p>
      )}

      <div className="mt-3 border-t border-zinc-200 pt-3">
        {receipts.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีใบเสร็จ/ใบกำกับภาษีสำหรับดีลนี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                  <th scope="col" className="py-1.5 pr-2">
                    เลขที่
                  </th>
                  <th scope="col" className="py-1.5 pr-2">
                    วันที่รับ
                  </th>
                  <th scope="col" className="py-1.5 pr-2">
                    ประเภท
                  </th>
                  <th scope="col" className="py-1.5 pr-2 text-right">
                    ยอด
                  </th>
                  <th scope="col" className="py-1.5 pr-2">
                    สถานะ
                  </th>
                  <th scope="col" className="py-1.5 pr-2">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className={`border-b border-zinc-100 last:border-0 ${r.status === "void" ? "opacity-60" : ""}`}>
                    <td className="py-1.5 pr-2 font-medium text-zinc-800">{r.receiptNo}</td>
                    <td className="py-1.5 pr-2 text-zinc-600">{formatThaiDateOnly(r.receivedDate)}</td>
                    <td className="py-1.5 pr-2 text-zinc-600">{OEM_RECEIPT_KIND_LABEL_TH[r.kind]}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-800">{formatTHB(r.amountThb)}</td>
                    <td className="py-1.5 pr-2">
                      <Badge tone={r.status === "issued" ? "green" : "red"}>{OEM_RECEIPT_STATUS_LABEL_TH[r.status]}</Badge>
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex gap-1.5">
                        <Button type="button" variant="ghost" size="sm" className="border border-zinc-300" onClick={() => openPrintTab(r.id)}>
                          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        {r.status === "issued" && (
                          <Button type="button" variant="ghost" size="sm" className="border border-zinc-300 text-red-700" onClick={() => setVoidTarget(r)}>
                            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                            ยกเลิก
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11px] text-zinc-400">
              ดูใบเสร็จ/ใบกำกับภาษีทุกใบของร้าน (ทุกดีล) ได้ที่{" "}
              <Link href="/oem/receipts" className="font-medium text-primary-700 hover:underline">
                รายการใบเสร็จทั้งหมด
              </Link>
            </p>
          </div>
        )}
      </div>

      {issueOpen && <ReceiptIssueDialog quote={quote} onClose={() => setIssueOpen(false)} onSaved={() => { setIssueOpen(false); onChanged(); }} />}
      {voidTarget && (
        <VoidReceiptDialog
          receipt={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={() => {
            setVoidTarget(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
