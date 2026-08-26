"use client";

// ============================================================================
// ⚠️⚠️⚠️  READ THIS BEFORE TOUCHING THIS FILE — GOES DIRECTLY TO CUSTOMERS  ⚠️⚠️⚠️
//
// This is the ONLY component allowed to render inside
// app/(dashboard)/oem/receipts/[id]/print. It IS the tax document — printed
// or saved-as-PDF and handed to a customer/their accountant as-is.
//
// Same rule as PrintQuoteClient (see that file's header for the RSC-payload
// leak this pattern fixes): this component's prop type is PrintableReceipt
// (lib/oem/printableReceipt.ts), NEVER OemReceiptRow. That type is the actual
// security/legal boundary — this comment is not. If you want a field that
// isn't on PrintableReceipt, go add it there deliberately (field-by-field,
// never spread) — do not widen this component's prop type.
//
// NEVER render, even conditionally: cost/margin of any kind (the source
// table has none, but treat this rule as absolute anyway — see
// printableReceipt.ts's header), createdBy/voidedBy (internal user ids),
// anything about the shop's internal pricing gates/floors.
//
// This document is IMMUTABLE by design (see printableReceipt.ts) — unlike
// PrintQuoteClient there is no "preview mode" here: a receipt either exists
// with every legally required field already filled in (oem_receipt_issue's
// own DB gates guarantee that BEFORE a row can exist at all — see 0084 §9),
// or it doesn't exist yet. There is nothing to "preview".
// ============================================================================

import Link from "next/link";
import { Printer } from "lucide-react";
import type { PrintableReceipt } from "@/lib/oem/printableReceipt";
import { OEM_PAYMENT_METHOD_LABEL_TH, OEM_RECEIPT_KIND_LABEL_TH } from "@/lib/oem/types";
import { fmtPct, formatOemAddressLines } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Button } from "@/components/ui/Button";

export function PrintReceiptClient({ receipt }: { receipt: PrintableReceipt }) {
  const isVoid = receipt.status === "void";
  const sellerAddressLines = receipt.seller.addressLines;
  const buyerAddressLines = formatOemAddressLines(receipt.buyerAddress);
  const sellerContactLine = receipt.seller.phone ?? "";
  // หัวเอกสาร: เป็น "ใบกำกับภาษี" ได้ก็ต่อเมื่อผู้ซื้อมีครบทั้ง 3 อย่างตาม
  // ป.รัษฎากร ม.86/4 (เลขผู้เสียภาษี + สาขา + ที่อยู่ของผู้ซื้อ) — security fix
  // (0086/0087 ตรวจพบ): ใบที่ออกก่อนบังคับด่านสาขา (0086) มี buyerTaxId แต่ไม่มี
  // buyerBranchLabel/ที่อยู่ ถ้าตัดสินจาก buyerTaxId ตัวเดียวจะพาดหัวว่าใบกำกับ
  // ภาษีทั้งที่ข้อมูลไม่ครบองค์ประกอบตามกฎหมาย — fail-safe: ขาดอย่างใดอย่างหนึ่ง
  // ตกกลับเป็น "ใบเสร็จรับเงิน" เฉยๆ เสมอ (ใบเสร็จธรรมดาที่ถูกต้อง ดีกว่าใบกำกับ
  // ภาษีที่ไม่ครบ) — seller ฝั่งนี้จด VAT แล้วเสมอ (oem_receipt_issue เองปฏิเสธ
  // ออกใบถ้า seller_vat_registered ไม่ true, 0084 §งานหลัก) ดังนั้นท่อนแยก VAT
  // (ก่อนภาษี/VAT/รวม) ด้านล่างต้องคงไว้เหมือนกันทั้งสองกรณี ไม่ผูกกับ
  // เงื่อนไขนี้ — ต่างกันแค่พาดหัว/ประเภทเอกสารเท่านั้น (ห้ามแตะท่อน VAT)
  const isFullTaxInvoice = !!receipt.buyerTaxId && !!receipt.buyerBranchLabel && buyerAddressLines.length > 0;
  const documentTitleTh = isFullTaxInvoice ? "ใบเสร็จรับเงิน/ใบกำกับภาษี" : "ใบเสร็จรับเงิน";
  const documentTitleEn = isFullTaxInvoice ? "Receipt / Tax Invoice · ต้นฉบับ" : "Receipt · ต้นฉบับ";

  return (
    <div className="mx-auto max-w-[210mm] pb-10">
      {/* on-screen-only toolbar */}
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-1 py-3 print:hidden">
        <Link href="/oem/receipts" className="text-xs font-medium text-zinc-500 hover:text-zinc-700">
          ← กลับไปรายการใบเสร็จ
        </Link>
        <Button type="button" variant="primary" size="sm" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
          พิมพ์ / บันทึกเป็น PDF
        </Button>
      </div>

      {isVoid && (
        <div className="mb-3 rounded-md border-2 border-red-400 bg-red-50 px-3 py-2 text-center text-sm font-bold text-red-700">
          {/* "ใบนี้ถูกยกเลิกแล้ว" + วันที่ ต้องคงอยู่บนกระดาษ (จำเป็นทางเอกสาร)
              แต่เหตุผลเป็นข้อความอิสระที่พนักงานพิมพ์เอง (เช่น "คิดต้นทุนผิด
              ลืมบวกค่าแฟลสก์") — ใช้ตรวจสอบภายในเท่านั้น ห้ามติดไปบนกระดาษที่
              ส่งลูกค้า (บทเรียนเดิม: เคยหลุดมาแล้วกับข้อความ "ตรวจสอบมัดจำก่อน
              ส่งเอกสารนี้ให้ลูกค้า" — ดู oem-quote-invariants §8) */}
          <span>
            ใบนี้ถูกยกเลิกแล้ว{receipt.voidedAt ? ` เมื่อ ${formatThaiDateOnly(receipt.voidedAt.slice(0, 10))}` : ""}
          </span>
          {receipt.voidReason && <span className="print:hidden"> — เหตุผล (ดูจอเท่านั้น): {receipt.voidReason}</span>}
        </div>
      )}

      <div className="oem-print-doc relative overflow-hidden border border-zinc-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        {isVoid && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <span className="rotate-[-30deg] select-none whitespace-nowrap text-6xl font-black tracking-widest text-red-200">
              ยกเลิกแล้ว · VOID
            </span>
          </div>
        )}

        {/* header: seller + document meta */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/3j-logo.png" alt="3J Jewelry" className="h-14 w-auto object-contain" />
            <div className="text-xs text-zinc-600">
              <p className="text-base font-bold text-zinc-900">{receipt.seller.legalName}</p>
              {receipt.seller.branchLabel && <p>{receipt.seller.branchLabel}</p>}
              {sellerAddressLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <p>เลขประจำตัวผู้เสียภาษี {receipt.seller.taxId}</p>
              {sellerContactLine && <p>{sellerContactLine}</p>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <h1 className="text-xl font-bold text-zinc-900">{documentTitleTh}</h1>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{documentTitleEn}</p>
            <p className="mt-2 text-sm font-semibold text-zinc-800">เลขที่ {receipt.receiptNo}</p>
            <p className="text-xs text-zinc-600">วันที่ออก {formatThaiDateOnly(receipt.issueDate.slice(0, 10))}</p>
            {receipt.receivedDate !== receipt.issueDate && (
              <p className="text-xs text-zinc-600">วันที่รับเงิน {formatThaiDateOnly(receipt.receivedDate.slice(0, 10))}</p>
            )}
            <p className="text-xs text-zinc-600">อ้างอิงใบเสนอราคาเลขที่ {receipt.quoteNoSnapshot}</p>
          </div>
        </div>

        {/* buyer */}
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ได้รับเงินจาก</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{receipt.buyerLegalName}</p>
          {receipt.buyerTaxId && <p className="text-xs text-zinc-600">เลขประจำตัวผู้เสียภาษี {receipt.buyerTaxId}</p>}
          {receipt.buyerBranchLabel && <p className="text-xs text-zinc-600">{receipt.buyerBranchLabel}</p>}
          {buyerAddressLines.map((line, i) => (
            <p key={i} className="text-xs text-zinc-600">
              {line}
            </p>
          ))}
        </div>

        {/* the one line item */}
        <table className="oem-print-table mt-4 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b-2 border-zinc-800 text-zinc-700">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                รายการ
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                ประเภทการรับเงิน
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                จำนวนเงิน
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-zinc-200">
              <td className="py-1.5 pr-2 align-top text-zinc-800">{receipt.description}</td>
              <td className="py-1.5 pr-2 align-top text-zinc-600">{OEM_RECEIPT_KIND_LABEL_TH[receipt.kind]}</td>
              <td className="py-1.5 text-right align-top tabular-nums font-medium text-zinc-900">{formatTHB(receipt.amountThb)}</td>
            </tr>
          </tbody>
        </table>

        {/* totals — VAT split ALWAYS shown, distinctly, on this document type
            (unlike the quotation's optional included/breakdown toggle — a tax
            invoice must separate the VAT amount explicitly, no exceptions —
            see oem-quote-invariants §7). Every figure read straight off
            `receipt`, nothing summed here. */}
        <div className="mt-3 flex justify-end">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between text-zinc-600">
              <dt>มูลค่าก่อนภาษีมูลค่าเพิ่ม</dt>
              <dd className="tabular-nums">{formatTHB(receipt.vatBaseThb)}</dd>
            </div>
            <div className="flex justify-between text-zinc-600">
              <dt>ภาษีมูลค่าเพิ่ม {fmtPct(receipt.vatRate)}</dt>
              <dd className="tabular-nums">{formatTHB(receipt.vatAmountThb)}</dd>
            </div>
            <div className="flex justify-between border-t-2 border-zinc-800 pt-1.5 text-base font-bold">
              <dt className="text-zinc-900">จำนวนเงินรวมทั้งสิ้น</dt>
              <dd className="tabular-nums text-zinc-900">{formatTHB(receipt.amountThb)}</dd>
            </div>
            <div className="pt-0.5 text-right text-xs italic text-zinc-500">({receipt.amountInWordsTh})</div>
          </dl>
        </div>

        {/* payment method */}
        <div className="mt-3 flex justify-end">
          <dl className="w-72 space-y-0.5 border-t border-dashed border-zinc-300 pt-2 text-xs text-zinc-600">
            <div className="flex justify-between">
              <dt>ช่องทางรับเงิน</dt>
              <dd>{receipt.paymentMethod ? OEM_PAYMENT_METHOD_LABEL_TH[receipt.paymentMethod] : "—"}</dd>
            </div>
            {receipt.paymentRef && (
              <div className="flex justify-between">
                <dt>เลขอ้างอิง</dt>
                <dd>{receipt.paymentRef}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* deal context — informational, historical snapshot (see
            printableReceipt.ts's comments on these 3 fields: they describe
            the deal AS OF the day this receipt was issued, not today). */}
        <div className="mt-4 border-t border-dashed border-zinc-300 pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">สรุปยอดในดีล ณ วันที่ออกใบนี้</p>
          <dl className="mt-1.5 grid grid-cols-3 gap-x-3 text-xs text-zinc-600">
            <div>
              <dt>ยอดรวมใบเสนอราคา</dt>
              <dd className="tabular-nums font-medium text-zinc-800">{formatTHB(receipt.grandTotalSnapshot)}</dd>
            </div>
            <div>
              <dt>รับไปแล้วก่อนหน้า</dt>
              <dd className="tabular-nums font-medium text-zinc-800">{formatTHB(receipt.paidBeforeThb)}</dd>
            </div>
            <div>
              <dt>คงเหลือหลังใบนี้</dt>
              <dd className={`tabular-nums font-medium ${receipt.balanceAfterThb < 0 ? "text-red-700" : "text-zinc-800"}`}>
                {formatTHB(receipt.balanceAfterThb)}
              </dd>
            </div>
          </dl>
        </div>

        {/* signature */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-zinc-600">
          <div>
            <div className="h-16 border-b border-zinc-400" />
            <p className="mt-1">ผู้รับเงิน</p>
            <p className="text-zinc-400">วันที่ ____________</p>
          </div>
          <div>
            <div className="h-16 border-b border-zinc-400" />
            <p className="mt-1">ผู้จ่ายเงิน</p>
            <p className="text-zinc-400">วันที่ ____________</p>
          </div>
        </div>
      </div>
    </div>
  );
}
