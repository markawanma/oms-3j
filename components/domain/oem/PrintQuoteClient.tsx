"use client";

// ============================================================================
// ⚠️⚠️⚠️  READ THIS BEFORE TOUCHING THIS FILE — GOES DIRECTLY TO CUSTOMERS  ⚠️⚠️⚠️
//
// This is the ONLY component allowed to render inside
// app/(dashboard)/oem/quotes/[id]/print. It is printed/saved-as-PDF and
// handed to a customer as-is — every field on screen here can leak to a
// competitor or a customer's negotiating position.
//
// NEVER render, even conditionally, even in a `details`/hidden/debug block:
//   - cost_piece / costPiece / any *cost* field (incl. nre_cost/nreCost —
//     the NRE **price** charged to the customer, nrePrice, is fine)
//   - margin_*, marginActualPct, marginChargedPct, marginAfterDiscountPct,
//     floors.margin.* — margin figures of any kind
//   - floors / MOQ / any internal pricing gate or threshold
//   - approvalNote / approval_note (why we accepted a low margin)
//   - lostReason / lostTo
//   - the raw `calc` object (OemPriceCalcResult) or its `breakdown` — do
//     NOT import OemCalcBreakdown here, ever. Build tables from named
//     fields on PrintableQuote/PrintableQuoteItem only.
//   - per-department labour cost, batch/flask cost lines, reject rates
//   - qRun / flaskCount / platingBatchCount (production planning, not the
//     customer's business)
//
// Every number shown here is read STRAIGHT off PrintableQuote/
// PrintableQuoteItem (already computed by analytics.oem_price_calc /
// oem_quote_save) — never add, subtract or derive a total in this file. If a
// number you need isn't there already, that's a sign it doesn't belong on
// this document.
//
// 0078 (เงินแท่ง): barSizeLabel/barPricePerPiece/engraveImageThb/
// engraveTextThb/silverPriceAsOf/silverPriceCapturedAt are new, deliberately
// SAFE fields on PrintableQuote(Item) — see that file's "0078 NARROW
// EXCEPTION" header note for exactly which 3 leaves of `calc` they're sourced
// from and why. barPricePerPiece prints as its OWN line, separate from
// engrave charges, ON PURPOSE: it must match the shop's public website price
// for that size exactly, or a customer who checks will think engrave was
// silently folded into the bar price.
//
// 0079: `sellerProfile` (the shop's OWN info — legal name/address/tax id/
// phone/VAT status/terms) is now a PROP, loaded server-side from
// analytics.oem_setting.seller_* via getSellerProfile (see print/page.tsx) —
// it used to be a hardcoded SELLER_PROFILE constant. This is NOT customer/
// cost-sensitive data (it's the shop's own info, meant to be printed to the
// customer anyway), so passing it as a client-component prop does not
// reopen the RSC-payload leak this file's header warns about elsewhere —
// that rule is about OemQuoteRow/OemQuoteItemRow's cost/margin fields only.
//
// SECOND LAYER, NOT JUST THIS COMMENT: this component's prop type is
// PrintableQuote (lib/oem/printableQuote.ts), not OemQuoteRow/OemQuoteItemRow
// — that file is the actual enforcement, not this comment. A client
// component's props serialize IN FULL into the RSC flight payload the
// browser downloads, whether or not the JSX below ever renders them — so
// "just don't render the field" was never a real guarantee here on its own
// (see that file's header for the leak this fixed: cost_piece/margin/
// approval_note were showing up in curl output even though this component
// never put them in the DOM). If you want a field that isn't on
// PrintableQuote, go add it there deliberately — do not widen this
// component's prop type back to the full DB row to save a step.
// ============================================================================

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Eye, Printer } from "lucide-react";
import type { PrintableQuote } from "@/lib/oem/printableQuote";
import { OEM_METAL_LABEL_TH } from "@/lib/oem/types";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { missingSellerFields, previewSellerProfile } from "@/lib/oem/sellerProfile";
import { formatOemAddressLines } from "@/lib/oem/display";
import { formatBangkokTimeOnly, formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function PrintQuoteClient({ quote, sellerProfile }: { quote: PrintableQuote; sellerProfile: SellerProfile }) {
  const [previewMode, setPreviewMode] = useState(false);
  const items = quote.items;
  const missing = missingSellerFields(sellerProfile);
  const isDraft = quote.status === "draft";
  // The owner's own rule: nothing before "quoted" has ever been shown to a
  // customer, so there's nothing here worth printing yet. 'superseded' is
  // deliberately allowed through (watermarked below) — it's still a real
  // document that was once sent to a customer.
  const canPrint = missing.length === 0 && !isDraft;
  // "ดูตัวอย่างรูปแบบเอกสาร" (2026-08 UAT: owner had never seen the layout
  // yet because seller info was empty) — only reachable when the REAL
  // document is blocked, and only ever a look, never a substitute for the
  // real print gate: canPrint (computed above, off the REAL sellerProfile)
  // still decides whether the "พิมพ์ / บันทึกเป็น PDF" button exists at all.
  const isPreview = !canPrint && previewMode;
  const effectiveSeller = isPreview ? previewSellerProfile(sellerProfile) : sellerProfile;

  if (!canPrint && !previewMode) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="rounded-lg border border-red-300 bg-red-50 p-5 print:hidden">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-red-800">พิมพ์ใบนี้ไม่ได้</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-sm text-red-700">
                {isDraft && (
                  <li>ใบเสนอราคานี้ยังเป็น &quot;ร่าง&quot; — ต้องออกใบเสนอราคาแล้ว (สถานะ &quot;เสนอราคาแล้ว&quot; ขึ้นไป) ก่อนถึงจะพิมพ์ได้</li>
                )}
                {missing.length > 0 && (
                  <li>
                    ข้อมูลร้านเรา (หัวกระดาษ) ยังไม่ได้กรอก: {missing.join(", ")} —{" "}
                    <Link href="/oem/rates" className="font-medium underline underline-offset-2">
                      ไปกรอกข้อมูลร้านเรา
                    </Link>
                  </li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link href={`/oem/quotes/${quote.id}`} className="text-sm font-medium text-primary-700 underline underline-offset-2">
                  กลับไปหน้าใบเสนอราคา
                </Link>
                <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewMode(true)}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  ดูตัวอย่างรูปแบบเอกสาร
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Belt-and-braces: Ctrl+P bypasses any JS-disabled button. If that
            happens anyway (button hidden but browser print still fires),
            the physical page must show a blocking message — never a blank
            page, and never a half-rendered document with placeholder seller
            info that looks like a real quotation. */}
        <div className="hidden p-16 text-center print:block">
          <p className="text-lg font-semibold text-red-700">เอกสารนี้ยังพิมพ์ไม่ได้</p>
          <p className="mt-2 text-sm text-zinc-600">
            {isDraft ? "ใบเสนอราคานี้ยังเป็นร่าง ยังไม่ได้ออกให้ลูกค้า" : "ข้อมูลร้านเรา (หัวกระดาษ) ในระบบยังกรอกไม่ครบ"}
          </p>
        </div>
      </div>
    );
  }

  const billAddressLines = formatOemAddressLines(quote.billAddress);
  const sellerContactLine = [effectiveSeller.phone, effectiveSeller.line ? `LINE: ${effectiveSeller.line}` : null, effectiveSeller.website]
    .filter(Boolean)
    .join("  ·  ");
  const customerContactLine = [quote.billPhone, quote.billContactChannel, !quote.billLegalName ? quote.customerContact : null]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className="mx-auto max-w-[210mm] pb-10">
      {/* on-screen-only toolbar (not sticky — OemSubNav above is already
          sticky top-16; stacking a second sticky bar at the same offset
          would overlap it) */}
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-1 py-3 print:hidden">
        {isPreview ? (
          // ปุ่ม JS-toggle จริงๆ ไม่ใช่ navigation — ใช้ <button> ไม่ใช่ <Link href="#">
          // เพื่อ semantic ที่ถูกต้อง (keyboard/screen reader คาดหวังปุ่ม ไม่ใช่ลิงก์)
          <button
            type="button"
            onClick={() => setPreviewMode(false)}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            ← ออกจากโหมดดูตัวอย่าง
          </button>
        ) : (
          <Link href={`/oem/quotes/${quote.id}`} className="text-xs font-medium text-zinc-500 hover:text-zinc-700">
            ← กลับไปหน้าใบเสนอราคา
          </Link>
        )}
        {isPreview ? (
          <Badge tone="amber">โหมดดูตัวอย่างเท่านั้น — พิมพ์จริงไม่ได้</Badge>
        ) : (
          <Button type="button" variant="primary" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            พิมพ์ / บันทึกเป็น PDF
          </Button>
        )}
      </div>

      {/* preview-mode banner — bold, on-screen AND printed (belt-and-braces
          against Ctrl+P while previewing), never quietly indistinguishable
          from a real document */}
      {isPreview && (
        <div className="mb-3 rounded-md border-2 border-amber-500 bg-amber-50 px-3 py-2 text-center text-sm font-bold text-amber-900 print:mb-4">
          ตัวอย่างรูปแบบ — ยังไม่ใช่เอกสารจริง ห้ามส่งลูกค้า
        </div>
      )}

      {/* on-screen-only notice — never printed, per spec */}
      {!isPreview && !quote.billLegalName && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          ยังไม่ได้กรอกข้อมูลลูกค้าสำหรับออกเอกสารอย่างเป็นทางการ — เอกสารนี้ใช้ชื่อ/ช่องทางติดต่อจาก &quot;ลูกค้า&quot; แทนไปก่อน{" "}
          <Link href={`/oem/quotes/${quote.id}`} className="font-medium underline underline-offset-2">
            ไปกรอกข้อมูลลูกค้า
          </Link>
        </div>
      )}

      {/* ---- the actual document ---- */}
      <div className="oem-print-doc relative overflow-hidden border border-zinc-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        {(quote.status === "superseded" || isPreview) && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <span className="rotate-[-30deg] select-none whitespace-nowrap text-6xl font-black tracking-widest text-red-200">
              {isPreview ? "ตัวอย่าง · ห้ามส่งลูกค้า" : "ถูกแทนที่แล้ว · SUPERSEDED"}
            </span>
          </div>
        )}

        {quote.status === "superseded" && !isPreview && (
          <div className="mb-4 rounded-md border-2 border-red-400 px-3 py-2 text-center text-sm font-bold text-red-700">
            ใบนี้ถูกแทนที่ด้วยใบใหม่แล้ว (ลูกค้าต่อราคา) — ไม่ใช่ใบที่ยืนราคาอยู่ในปัจจุบัน
          </div>
        )}

        {/* header: seller + document meta */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/3j-logo.png" alt="3J Jewelry" className="h-14 w-auto object-contain" />
            <div className="text-xs text-zinc-600">
              <p className="text-base font-bold text-zinc-900">{effectiveSeller.legalName}</p>
              {effectiveSeller.branchLabel && <p>{effectiveSeller.branchLabel}</p>}
              {effectiveSeller.addressLines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <p>เลขประจำตัวผู้เสียภาษี {effectiveSeller.taxId}</p>
              {sellerContactLine && <p>{sellerContactLine}</p>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <h1 className="text-xl font-bold text-zinc-900">ใบเสนอราคา</h1>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Quotation</p>
            <p className="mt-2 text-sm font-semibold text-zinc-800">เลขที่ {quote.quoteNo}</p>
            <p className="text-xs text-zinc-600">วันที่ออก {formatThaiDateOnly(quote.createdAt.slice(0, 10))}</p>
            {quote.quoteValidUntil && <p className="text-xs text-zinc-600">ยืนราคาถึง {formatThaiDateOnly(quote.quoteValidUntil)}</p>}
            {quote.parentQuoteNo && <p className="text-xs text-zinc-600">อ้างอิงใบเดิมเลขที่ {quote.parentQuoteNo}</p>}
          </div>
        </div>

        {/* customer */}
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">เสนอราคาถึง</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{quote.billLegalName || quote.customerName || "-"}</p>
          {quote.billTaxId && <p className="text-xs text-zinc-600">เลขประจำตัวผู้เสียภาษี {quote.billTaxId}</p>}
          {billAddressLines.map((line, i) => (
            <p key={i} className="text-xs text-zinc-600">
              {line}
            </p>
          ))}
          {customerContactLine && <p className="text-xs text-zinc-600">{customerContactLine}</p>}
        </div>

        {/* 0078: silver bar price snapshot — only present when this quote
            has at least one เงินแท่ง item. States the exact day/time the
            bar price(s) below were locked to, and that the quote does not
            stand past that day (bar quote_valid_days = 0, see D4). */}
        {quote.silverPriceAsOf && (
          <div className="mt-3 border-b border-dashed border-zinc-200 pb-3 text-xs text-zinc-600">
            อ้างอิงราคาเงินแท่ง ณ {formatThaiDateOnly(quote.silverPriceAsOf)}
            {quote.silverPriceCapturedAt && ` เวลา ${formatBangkokTimeOnly(quote.silverPriceCapturedAt)} น.`} — ใบเสนอราคานี้ยืนราคาเฉพาะวันดังกล่าว
          </div>
        )}

        {/* items */}
        <table className="oem-print-table mt-4 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b-2 border-zinc-800 text-zinc-700">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                #
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                รายการ
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                วัสดุ
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                น้ำหนัก/ชิ้น
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
            {items.map((it) => (
              <tr key={it.id} className="border-b border-zinc-200">
                <td className="py-1.5 pr-2 align-top text-zinc-600">{it.seq}</td>
                <td className="py-1.5 pr-2 align-top text-zinc-800">
                  {it.skuSnapshot && <span className="font-semibold">{it.skuSnapshot} · </span>}
                  {it.productNameSnapshot || it.barSizeLabel || it.itemKindFallback}
                  {/* 0078: engrave charges print as their OWN sub-lines here —
                      never folded into "ราคา/ชิ้น" — so the bar price stays
                      checkable against the shop's own website 1:1. */}
                  {(it.barPricePerPiece != null || it.engraveImageThb || it.engraveTextThb) && (
                    <dl className="mt-0.5 space-y-0 text-[10px] font-normal text-zinc-500">
                      {it.barPricePerPiece != null && (
                        <div className="flex justify-between gap-2">
                          <dt>ราคาเงินแท่ง</dt>
                          <dd className="tabular-nums">{formatTHB(it.barPricePerPiece)}/แท่ง</dd>
                        </div>
                      )}
                      {!!it.engraveImageThb && (
                        <div className="flex justify-between gap-2">
                          <dt>ค่ายิงเลเซอร์รูปภาพ</dt>
                          <dd className="tabular-nums">{formatTHB(it.engraveImageThb)}/ชิ้น</dd>
                        </div>
                      )}
                      {!!it.engraveTextThb && (
                        <div className="flex justify-between gap-2">
                          <dt>ค่ายิงเลเซอร์ตัวอักษร</dt>
                          <dd className="tabular-nums">{formatTHB(it.engraveTextThb)}/ชิ้น</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </td>
                <td className="py-1.5 pr-2 align-top text-zinc-600">{OEM_METAL_LABEL_TH[it.material]}</td>
                <td className="py-1.5 pr-2 text-right align-top tabular-nums text-zinc-600">{it.weightG != null ? `${it.weightG} ก.` : "-"}</td>
                <td className="py-1.5 pr-2 text-right align-top tabular-nums text-zinc-600">{it.qty.toLocaleString("th-TH")}</td>
                <td className="py-1.5 pr-2 text-right align-top tabular-nums text-zinc-800">
                  {it.pricePerPiece != null ? formatTHB(it.pricePerPiece) : "-"}
                </td>
                <td className="py-1.5 text-right align-top tabular-nums font-medium text-zinc-900">
                  {it.itemTotal != null ? formatTHB(it.itemTotal) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totals — every figure read straight off `quote`, nothing summed here */}
        <div className="mt-3 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-600">ยอดรวมรายการ</dt>
              <dd className="tabular-nums text-zinc-800">{quote.piecesSubtotal != null ? formatTHB(quote.piecesSubtotal) : "-"}</dd>
            </div>
            {quote.nrePrice != null && quote.nrePrice > 0 && (
              <div className="flex justify-between">
                <dt className="text-zinc-600">ค่าแบบ/ค่าเปิดพิมพ์ (เก็บครั้งเดียว)</dt>
                <dd className="tabular-nums text-zinc-800">{formatTHB(quote.nrePrice)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-zinc-300 pt-1 font-medium">
              <dt className="text-zinc-700">ยอดรวมก่อนส่วนลด</dt>
              <dd className="tabular-nums text-zinc-900">{quote.quoteTotal != null ? formatTHB(quote.quoteTotal) : "-"}</dd>
            </div>
            {quote.discountThb > 0 && (
              <div className="flex justify-between text-red-700">
                <dt>ส่วนลด{quote.discountReason ? ` (${quote.discountReason})` : ""}</dt>
                <dd className="tabular-nums">-{formatTHB(quote.discountThb)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-zinc-800 pt-1.5 text-base font-bold">
              <dt className="text-zinc-900">ยอดสุทธิ</dt>
              <dd className="tabular-nums text-zinc-900">
                {quote.grandTotal != null ? formatTHB(quote.grandTotal) : quote.quoteTotal != null ? formatTHB(quote.quoteTotal) : "-"}
              </dd>
            </div>
          </dl>
        </div>

        {/* VAT disclosure — legally load-bearing, gated on effectiveSeller.vatRegistered.
            When false: print NOTHING about VAT (not registered yet = illegal to claim). */}
        {effectiveSeller.vatRegistered && <p className="mt-2 text-right text-xs text-zinc-500">ราคารวมภาษีมูลค่าเพิ่มแล้ว</p>}

        {effectiveSeller.terms.length > 0 && (
          <div className="mt-6 border-t border-zinc-200 pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">เงื่อนไข</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-600">
              {effectiveSeller.terms.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}

        {/* signatures */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-zinc-600">
          <div>
            <div className="h-16 border-b border-zinc-400" />
            <p className="mt-1">ผู้เสนอราคา</p>
            <p className="text-zinc-400">วันที่ ____________</p>
          </div>
          <div>
            <div className="h-16 border-b border-zinc-400" />
            <p className="mt-1">ผู้อนุมัติสั่งซื้อ</p>
            <p className="text-zinc-400">วันที่ ____________</p>
          </div>
        </div>
      </div>
    </div>
  );
}
