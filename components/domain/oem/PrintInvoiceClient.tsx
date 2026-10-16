"use client";

// ============================================================================
// ⚠️⚠️⚠️  READ THIS BEFORE TOUCHING THIS FILE — GOES DIRECTLY TO CUSTOMERS  ⚠️⚠️⚠️
//
// This is the ONLY component allowed to render inside
// app/(dashboard)/oem/invoices/[id]/print. ใบแจ้งหนี้ (ไม่ใช่ใบกำกับภาษี) พิมพ์/บันทึก PDF แล้วส่งลูกค้าตามที่เห็น
//
// Same rule as PrintQuoteClient / PrintReceiptClient: props are PrintableInvoice (+ InvoicePrintNotices แยก) from
// lib/oem/printableInvoice.ts — NEVER OemInvoiceRow / OemQuoteRow / OemCalcBreakdown. That type is the actual boundary
// (a "use client" component's whole props tree serializes into the RSC payload the browser downloads) — this comment is not.
//
// NEVER render, even conditionally: cost/margin of any kind, approval_note, discount_reason, price_reason, calc/rate_snapshot,
// buy-back prices, void_reason, user ids, paid/overdue/stale status, MOQ/floors. สถานะพนักงาน (paid / เลยกำหนด / หมดอายุ / ยกเลิก)
// อยู่ใน `notices` และต้องอยู่ใต้ print:hidden เสมอ (เคยหลุดไปบนกระดาษลูกค้ามาแล้ว — oem-quote-invariants §8)
//
// THE ONE THING THAT MUST ALWAYS BE ON PAPER (มติเจ้าของ 16 ต.ค. 69): invoice.notTaxInvoiceText "เอกสารนี้ไม่ใช่ใบกำกับภาษี"
// — render ทุกใบ ไม่ print:hidden ไม่ผูกเงื่อนไข (ไม่ขึ้นกับ kind / vatDisplay / status)
//
// ใบ void: ดูบนจอได้ พิมพ์ไม่ได้ — เอกสารทั้งก้อน print:hidden + ไม่มีปุ่มพิมพ์ + ข้อความ "พิมพ์ไม่ได้" (print-only) กัน Ctrl+P
// ใบ stale (ยอดเปลี่ยนหลังออกใบ): หน้า server ไม่ render component นี้เลย (ดู InvoicePrintBlocked)
//
// VAT: vatDisplay 'none' = ไม่มีคำ ภาษีมูลค่าเพิ่ม/VAT/อัตราภาษี ที่ไหนบนกระดาษ · 'included' = บรรทัดเดียว ·
// 'breakdown' = แยกในกล่อง "ยอดของใบนี้" เท่านั้น (ไม่แยกระดับใบเสนอราคา) — ทุกตัวเลขอ่านจาก invoice ไม่คำนวณที่นี่
// ============================================================================

import Link from "next/link";
import { Printer } from "lucide-react";
import type { InvoicePrintNotices, PrintableInvoice } from "@/lib/oem/printableInvoice";
import { formatDueText } from "@/lib/oem/invoiceDisplay";
import { fmtPct, formatOemAddressLines } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Button } from "@/components/ui/Button";

const dateTh = (iso: string) => formatThaiDateOnly(iso.slice(0, 10));

export function PrintInvoiceClient({ invoice, notices }: { invoice: PrintableInvoice; notices: InvoicePrintNotices }) {
  const isVoid = invoice.status === "void";
  const isDeposit = invoice.kind === "deposit";
  const buyerAddressLines = formatOemAddressLines(invoice.buyerAddress);
  const payBeforeWork = invoice.payBeforeWorkText !== null;
  const dueText = formatDueText({ kind: invoice.kind, issueDate: invoice.issueDate, dueDate: invoice.dueDate, payBeforeWork });
  const isPaid = notices.paymentState === "paid";
  // ใบมัดจำ "ชำระก่อนเริ่มงาน" ไม่มีกำหนดวันจริง ไม่นับเลยกำหนด (กันซ้ำอีกชั้นจาก notices.isOverdue)
  const showOverdue = notices.isOverdue && !payBeforeWork && !isPaid && !isVoid;
  const showExpired = notices.dealQuoteExpired && !isPaid && !isVoid;
  const backHref = notices.activeQuoteId ? `/oem/quotes/${notices.activeQuoteId}` : "/oem/quotes";
  const vatBreakdown =
    invoice.vatDisplay === "breakdown" && invoice.vatRate !== null && invoice.vatBaseThb !== null && invoice.vatAmountThb !== null;

  return (
    <div className="mx-auto max-w-[210mm] pb-10">
      {/* ---- staff-only chrome: ทุกอย่างในนี้ print:hidden ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-1 py-3 print:hidden">
        <Link href={backHref} className="inline-flex min-h-11 items-center text-xs font-medium text-zinc-500 hover:text-zinc-700">
          ← กลับไปใบเสนอราคา
        </Link>
        {!isVoid && (
          <Button type="button" variant="primary" size="sm" className="min-h-11" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            พิมพ์ / บันทึกเป็น PDF
          </Button>
        )}
      </div>

      {isVoid && (
        <div role="status" className="mb-3 rounded-md border-2 border-red-400 bg-red-50 px-3 py-2 text-center text-sm text-red-700 print:hidden">
          <p className="font-bold">
            ใบนี้ถูกยกเลิกแล้ว
            {invoice.voidedAt ? ` เมื่อ ${dateTh(invoice.voidedAt)}` : ""} — ดูได้บนจอเท่านั้น พิมพ์ไม่ได้
          </p>
          {notices.voidReason && <p className="mt-0.5 text-xs">เหตุผล (ภายในร้าน): {notices.voidReason}</p>}
        </div>
      )}
      {showExpired && (
        <div role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          ใบเสนอราคาต้นทางหมดอายุแล้ว{notices.quoteValidUntil ? ` (ยืนราคาถึง ${dateTh(notices.quoteValidUntil)})` : ""} ควรยืนยันราคากับลูกค้าก่อนส่ง
        </div>
      )}
      {isPaid && !isVoid && (
        <div role="status" className="mb-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800 print:hidden">
          ใบนี้ชำระแล้ว{notices.receiptNo ? ` (${notices.receiptNo})` : ""} ส่งซ้ำลูกค้าหรือไม่?
        </div>
      )}
      {showOverdue && (
        <div role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          เลยกำหนดชำระแล้ว (กำหนด {dateTh(notices.dueDate)})
        </div>
      )}

      {/* ใบ void: Ctrl+P ก็ต้องไม่ได้กระดาษใบจริง — เห็นเฉพาะข้อความนี้ตอนพิมพ์ */}
      {isVoid && (
        <div className="hidden p-16 text-center print:block">
          <p className="text-lg font-semibold text-red-700">ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว — พิมพ์ไม่ได้</p>
        </div>
      )}

      <div
        className={`oem-print-doc relative overflow-hidden border border-zinc-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none ${
          isVoid ? "print:hidden" : ""
        }`}
      >
        {isVoid && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <span className="rotate-[-30deg] select-none whitespace-nowrap text-6xl font-black tracking-widest text-red-200">ยกเลิกแล้ว · VOID</span>
          </div>
        )}

        {/* header: seller + document meta */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/3j-logo.png" alt="3J Jewelry" className="h-14 w-auto object-contain" />
            <div className="text-xs text-zinc-600">
              <p className="text-base font-bold text-zinc-900">{invoice.seller.legalName}</p>
              {invoice.seller.branchLabel && <p>{invoice.seller.branchLabel}</p>}
              {invoice.seller.addressLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {invoice.seller.taxId && <p>เลขประจำตัวผู้เสียภาษี {invoice.seller.taxId}</p>}
              {invoice.seller.phone && <p>{invoice.seller.phone}</p>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <h1 className="text-xl font-bold text-zinc-900">ใบแจ้งหนี้</h1>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Invoice</p>
            {/* 🔴 บรรทัดคงที่ — บนกระดาษทุกใบ ห้าม print:hidden ห้ามผูกเงื่อนไข */}
            <p className="mt-1 text-xs font-bold text-zinc-800">{invoice.notTaxInvoiceText}</p>
            <p className="mt-2 text-sm font-semibold text-zinc-800">เลขที่ {invoice.invoiceNo}</p>
            <p className="text-xs text-zinc-600">วันที่ออก {dateTh(invoice.issueDate)}</p>
            <p className="text-xs text-zinc-600">อ้างอิงใบเสนอราคาเลขที่ {invoice.quoteNoSnapshot}</p>
          </div>
        </div>

        {/* buyer */}
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ลูกค้า / Bill to</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{invoice.buyerLegalName}</p>
          {invoice.buyerTaxId && <p className="text-xs text-zinc-600">เลขประจำตัวผู้เสียภาษี {invoice.buyerTaxId}</p>}
          {invoice.buyerBranchLabel && <p className="text-xs text-zinc-600">{invoice.buyerBranchLabel}</p>}
          {buyerAddressLines.map((line, i) => (
            <p key={i} className="text-xs text-zinc-600">
              {line}
            </p>
          ))}
        </div>

        {/* amount band */}
        <div className="mt-4 grid break-inside-avoid grid-cols-1 gap-3 rounded-md border-2 border-zinc-800 p-3 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ยอดที่ต้องชำระครั้งนี้</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-zinc-900">{formatTHB(invoice.amountThb)}</p>
            <p className="text-xs italic text-zinc-500">({invoice.amountInWordsTh})</p>
          </div>
          <div className="sm:text-right print:text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">กำหนดชำระ</p>
            <p className="mt-0.5 text-base font-semibold text-zinc-900">{dueText}</p>
          </div>
        </div>

        {/* description */}
        <p className="mt-4 whitespace-pre-wrap break-words text-sm text-zinc-800">{invoice.description}</p>

        {/* items (snapshot ของใบเสนอราคา) */}
        <div className="mt-3 overflow-x-auto print:overflow-visible">
          <table className="oem-print-table w-full min-w-[480px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b-2 border-zinc-800 text-zinc-700">
                <th scope="col" className="w-8 py-1.5 pr-2 font-semibold">
                  #
                </th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">
                  รายการ
                </th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                  จำนวน
                </th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                  ราคา/ชิ้น
                </th>
                <th scope="col" className="py-1.5 text-right font-semibold">
                  รวม
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.seq} className="border-b border-zinc-200">
                  <td className="py-1.5 pr-2 align-top text-zinc-500">{l.seq}</td>
                  <td className="py-1.5 pr-2 align-top text-zinc-800">
                    {l.sku && <span className="font-semibold">{l.sku} · </span>}
                    {l.name}
                  </td>
                  <td className="py-1.5 pr-2 text-right align-top tabular-nums">{l.qty}</td>
                  <td className="py-1.5 pr-2 text-right align-top tabular-nums">{formatTHB(l.unitPriceThb)}</td>
                  <td className="py-1.5 text-right align-top tabular-nums font-medium text-zinc-900">{formatTHB(l.lineTotalThb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* quote summary — ค่าที่ DB แช่แข็งไว้ตอนออกใบ (ไม่คำนวณที่นี่) */}
        <div className="mt-3 flex justify-end">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between text-zinc-600">
              <dt>ยอดรวมรายการ</dt>
              <dd className="tabular-nums">{formatTHB(invoice.piecesSubtotalThb)}</dd>
            </div>
            {invoice.nrePriceThb > 0 && (
              <div className="flex justify-between text-zinc-600">
                <dt>ค่าแบบ</dt>
                <dd className="tabular-nums">{formatTHB(invoice.nrePriceThb)}</dd>
              </div>
            )}
            {invoice.discountThb > 0 && (
              <div className="flex justify-between text-zinc-600">
                <dt>ส่วนลด</dt>
                <dd className="tabular-nums">−{formatTHB(invoice.discountThb)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-zinc-800 pt-1.5 font-bold text-zinc-900">
              <dt>ยอดสุทธิตามใบเสนอราคา</dt>
              <dd className="tabular-nums">{formatTHB(invoice.grandTotalThb)}</dd>
            </div>
          </dl>
        </div>

        {/* ยอดของใบนี้ */}
        <div className="mt-4 flex justify-end">
          <div className="w-72 break-inside-avoid rounded-md border border-zinc-300 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ยอดของใบนี้</p>
            <dl className="mt-1.5 space-y-1 text-sm">
              {!isDeposit && (
                <>
                  <div className="flex justify-between text-zinc-600">
                    <dt>ยอดสุทธิ</dt>
                    <dd className="tabular-nums">{formatTHB(invoice.grandTotalThb)}</dd>
                  </div>
                  {invoice.paidBeforeThb > 0 && (
                    <div className="flex justify-between text-zinc-600">
                      <dt>ชำระแล้ว</dt>
                      <dd className="tabular-nums">−{formatTHB(invoice.paidBeforeThb)}</dd>
                    </div>
                  )}
                </>
              )}
              {vatBreakdown ? (
                <>
                  <div className="flex justify-between text-zinc-600">
                    <dt>มูลค่าก่อนภาษีมูลค่าเพิ่ม</dt>
                    <dd className="tabular-nums">{formatTHB(invoice.vatBaseThb!)}</dd>
                  </div>
                  <div className="flex justify-between text-zinc-600">
                    <dt>ภาษีมูลค่าเพิ่ม {fmtPct(invoice.vatRate)}</dt>
                    <dd className="tabular-nums">{formatTHB(invoice.vatAmountThb!)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-zinc-300 pt-1 font-bold text-zinc-900">
                    <dt>ยอดที่ต้องชำระ</dt>
                    <dd className="tabular-nums">{formatTHB(invoice.amountThb)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between font-bold text-zinc-900">
                  <dt>{isDeposit ? "เงินมัดจำตามที่ตกลง" : "ยอดคงเหลือที่ต้องชำระ"}</dt>
                  <dd className="tabular-nums">{formatTHB(invoice.amountThb)}</dd>
                </div>
              )}
              {isDeposit && (
                <div className="flex justify-between text-zinc-600">
                  <dt>คงเหลือหลังชำระมัดจำ</dt>
                  <dd className="tabular-nums">{formatTHB(invoice.balanceAfterThb)}</dd>
                </div>
              )}
            </dl>
            {invoice.vatDisplay === "included" && <p className="mt-1.5 text-xs text-zinc-500">ราคารวมภาษีมูลค่าเพิ่มแล้ว</p>}
          </div>
        </div>

        {/* payment channels (snapshot ณ วันออกใบ) */}
        {invoice.paymentLines.length > 0 && (
          <div className="mt-4 break-inside-avoid border-t border-dashed border-zinc-300 pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ช่องทางชำระเงิน</p>
            <ul className="mt-1 space-y-0.5 text-sm text-zinc-800">
              {invoice.paymentLines.map((line, i) => (
                <li key={i} className="whitespace-pre-wrap break-words">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {invoice.note && (
          <div className="mt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">หมายเหตุ</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-800">{invoice.note}</p>
          </div>
        )}

        {/* signature */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-zinc-600">
          <div />
          <div>
            <div className="h-16 border-b border-zinc-400" />
            <p className="mt-1">ผู้ออกเอกสาร</p>
            <p className="text-zinc-400">วันที่ ____________</p>
          </div>
        </div>
      </div>
    </div>
  );
}
