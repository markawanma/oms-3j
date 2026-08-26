"use client";

// QuoteDetailClient — /oem/quotes/[id] (T6v2): a saved quote's item table
// (each row's `calc` = oem_price_calc's return AT THE TIME it was quoted —
// reprint-safe even if today's rates have since changed), discount/grand
// total, renegotiate action, and won/lost actions. Reads v_oem_quote_item
// (via getQuoteItems, fetched server-side by the page) instead of a single
// quote.input/calc — every quote (pre-0075 and v2) has at least one item
// thanks to 0075's backfill.

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Printer } from "lucide-react";
import { setQuoteStatus } from "@/lib/actions/oem";
import type { OemDepositMode, OemProvinceOption, OemQuoteItemRow, OemQuoteRow, OemReceiptRow } from "@/lib/oem/types";
import { OEM_BAR_SIZE_LABEL_TH, OEM_METAL_LABEL_TH, OEM_QUOTE_STATUS_LABEL_TH } from "@/lib/oem/types";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { formatBangkokTime, formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { fmtPct, formatOemAddressLines } from "@/lib/oem/display";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { OemBarCalcSummary } from "./OemBarCalcSummary";
import { OemCalcBreakdown } from "./OemCalcBreakdown";
import { LostQuoteDialog } from "./LostQuoteDialog";
import { RenegotiateDialog } from "./RenegotiateDialog";
import { BillingDialog } from "./BillingDialog";
import { DepositDialog } from "./DepositDialog";
import { VatModeDialog } from "./VatModeDialog";
import { ReceiptSection } from "./ReceiptSection";

/** RAW deposit fields (mode + input, never the computed amount) of the
 * quote's parent, when it has one — used only to detect the 0081 renegotiate
 * clamp (see this file's depositChangedFromParent). null when this quote has
 * no parent, or the parent failed to load. */
export interface ParentDepositInfo {
  mode: OemDepositMode | null;
  input: number | null;
}

/** "มัดจำ 50%" / "มัดจำ ฿5,000" / "ไม่มีมัดจำ" — formats a RAW deposit
 * mode+input pair (never a computed amount) for the renegotiate-clamp
 * warning banner. Safe to call with either this quote's own fields or the
 * parent's — both are plain stored values, not money derived here. */
function depositInputLabel(mode: OemDepositMode | null, input: number | null): string {
  if (mode == null || input == null) return "ไม่มีมัดจำ";
  return mode === "pct" ? `มัดจำ ${fmtPct(input)}` : `มัดจำ ${formatTHB(input)}`;
}

/** Why the VAT-mode / deposit edit buttons are hidden — mirrors the
 * canEditFinancials gate (oem_quote_set_deposit / oem_quote_set_vat_mode
 * both hard-gate status IN ('draft','quoted') server-side) so the owner
 * sees a reason instead of a silently missing button. Only called when
 * canEditFinancials is false, so 'draft'/'quoted' never reach here. */
function financialsLockedReasonTh(status: OemQuoteRow["status"]): string {
  switch (status) {
    case "won":
    case "lost":
    case "rejected":
      return "ใบนี้ปิดงานแล้ว แก้เงื่อนไขภาษี/มัดจำย้อนหลังไม่ได้ — เอกสารที่ส่งลูกค้าไปแล้วต้องตรงกับที่บันทึกไว้";
    case "superseded":
      return "ใบนี้ถูกแทนที่ด้วยใบต่อราคาใหม่แล้ว — ไปแก้ที่ใบใหม่แทน";
    case "expired":
      return "ใบนี้เลยวันยืนราคาแล้ว";
    default:
      return "";
  }
}

const STATUS_TONE: Record<OemQuoteRow["status"], BadgeTone> = {
  draft: "slate",
  quoted: "blue",
  won: "green",
  lost: "red",
  expired: "orange",
  rejected: "slate",
  superseded: "slate",
};

export function QuoteDetailClient({
  quote,
  items,
  provinces,
  sellerProfile,
  parentDeposit,
  receipts,
}: {
  quote: OemQuoteRow;
  items: OemQuoteItemRow[];
  provinces: OemProvinceOption[];
  sellerProfile: SellerProfile;
  parentDeposit: ParentDepositInfo | null;
  receipts: OemReceiptRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [lostOpen, setLostOpen] = useState(false);
  const [renegotiateOpen, setRenegotiateOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [vatModeOpen, setVatModeOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [wonPending, startWon] = useTransition();

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPrintTab() {
    // window.open (not <Link target="_blank">) so this stays a plain
    // <button> — nesting an interactive <button> inside an <a> is invalid
    // HTML and breaks screen-reader navigation.
    window.open(`/oem/quotes/${quote.id}/print`, "_blank", "noopener,noreferrer");
  }

  function markWon() {
    startWon(async () => {
      const result = await setQuoteStatus({ quoteId: quote.id, status: "won" });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ปิดงานแล้ว");
      router.refresh();
    });
  }

  // 0085: oem_quote_renegotiate now accepts 'won' too (the owner explicitly
  // asked to be able to renegotiate a deal after a deposit was received —
  // see 0084's header §3 / 0085's header). 'quoted' still hard-checks
  // quote_valid_until server-side; 'won' skips that check server-side (the
  // pricing-window guarantee is moot once the customer already committed
  // money) — mirror BOTH halves here so this button never opens a dialog
  // that can only ever fail.
  const canRenegotiate = (quote.status === "quoted" && !quote.isExpiredTh) || quote.status === "won";
  // 0085 §ผลข้างเคียง: renegotiating a deal that already has money collected
  // can push outstandingThb negative (a refund the shop now owes) — the DB
  // does not block this on purpose (0084 header §3), so the warning has to
  // live here, before the dialog even opens.
  const hasReceivedPayment = !!quote.paidThb && quote.paidThb > 0;
  // oem_quote_set_billing (0075 §7) hard-gates status IN ('quoted','won')
  // server-side — mirror that here so the edit button never opens a dialog
  // that can only ever fail. Draft quotes haven't been sent to a customer
  // yet, and every other status (lost/rejected/expired/superseded) is
  // already closed — nothing left to bill.
  const canEditBilling = quote.status === "quoted" || quote.status === "won";
  // Print/PDF: owner's own rule — nothing below "quoted" has been shown to
  // a customer yet, so there is nothing worth printing. superseded IS
  // printable (with a watermark, handled on the print page itself).
  const canOpenPrint = quote.status !== "draft";
  const billAddressLines = formatOemAddressLines(quote.billAddress);
  // 0081/0082: oem_quote_set_deposit / oem_quote_set_vat_mode both hard-gate
  // status IN ('draft','quoted') server-side — mirror that here so these two
  // buttons never open a dialog that can only ever fail with a Thai error.
  const canEditFinancials = quote.status === "draft" || quote.status === "quoted";
  // 0081 §6: oem_quote_renegotiate clamps (or clears) a THB-mode deposit
  // down when the new grand_total can't cover the parent's deposit_input —
  // silently, with no warning channel back through the RPC. Detect it here
  // by comparing this quote's RAW deposit fields against its parent's (both
  // raw stored values, never a computed amount — see ParentDepositInfo).
  const depositChangedFromParent =
    !!quote.parentQuoteId &&
    parentDeposit != null &&
    (parentDeposit.mode !== quote.depositMode || parentDeposit.input !== quote.depositInput);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/oem/quotes" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          กลับไปทะเบียนใบเสนอราคา
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold text-zinc-900">{quote.quoteNo}</h1>
            <Badge tone={STATUS_TONE[quote.status]}>{OEM_QUOTE_STATUS_LABEL_TH[quote.status]}</Badge>
            {quote.isExpiredTh && <Badge tone="red">หมดอายุแล้ว</Badge>}
          </div>
          {canOpenPrint && (
            <Button type="button" variant="secondary" size="sm" onClick={openPrintTab}>
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              พิมพ์ / บันทึก PDF
            </Button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-zinc-400">
          ใช้เรตต้นทุน ณ วันที่ {formatThaiDateOnly(quote.createdAt.slice(0, 10))} · บันทึกเมื่อ {formatBangkokTime(quote.createdAt)}
        </p>
        {quote.status === "superseded" && (
          <p className="mt-1 text-xs text-zinc-500">ใบนี้ถูกแทนที่ด้วยใบใหม่ (ลูกค้าต่อราคา) — ราคาที่ยืนอยู่คือใบใหม่ ไม่ใช่ใบนี้</p>
        )}
        {quote.parentQuoteNo && quote.parentQuoteId && (
          <p className="mt-1 text-xs text-zinc-500">
            ต่อราคาจากใบ{" "}
            <Link href={`/oem/quotes/${quote.parentQuoteId}`} className="font-medium text-primary-700 hover:underline">
              {quote.parentQuoteNo}
            </Link>
          </p>
        )}
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h2 className="text-sm font-bold text-zinc-800">ลูกค้า</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">ลูกค้า</dt>
            <dd className="text-zinc-800">{quote.customerName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">ช่องทางติดต่อ</dt>
            <dd className="text-zinc-800">{quote.customerContact || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">จำนวนรายการ</dt>
            <dd className="text-zinc-800">{quote.itemCount || items.length} รายการ</dd>
          </div>
        </dl>
        {quote.quoteValidUntil && (
          <p className="mt-2 text-xs text-zinc-500">
            ยืนราคาถึง {formatThaiDateOnly(quote.quoteValidUntil)}
            {quote.daysLeftTh != null && !quote.isExpiredTh && ` (เหลือ ${quote.daysLeftTh} วัน)`}
          </p>
        )}
        {quote.approvalNote && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">เหตุผลที่ต่ำกว่า floor: {quote.approvalNote}</p>
        )}
        {quote.status === "lost" && (
          <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
            แพ้งาน: {quote.lostReason}
            {quote.lostTo && ` · ได้ไปที่ ${quote.lostTo}`}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-bold text-zinc-800">ข้อมูลลูกค้าสำหรับออกเอกสาร</h2>
          {canEditBilling && (
            <Button type="button" variant="ghost" size="sm" className="border border-zinc-300" onClick={() => setBillingOpen(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              {quote.billLegalName ? "แก้ไข" : "กรอกข้อมูล"}
            </Button>
          )}
        </div>
        {quote.billLegalName ? (
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-zinc-500">ชื่อออกบิล</dt>
              <dd className="text-zinc-800">{quote.billLegalName}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">เลขประจำตัวผู้เสียภาษี</dt>
              <dd className="tabular-nums text-zinc-800">{quote.billTaxId || "— (บุคคลธรรมดา)"}</dd>
            </div>
            {(quote.billPhone || quote.billContactChannel) && (
              <div>
                <dt className="text-xs text-zinc-500">ติดต่อ</dt>
                <dd className="text-zinc-800">{[quote.billPhone, quote.billContactChannel].filter(Boolean).join(" · ")}</dd>
              </div>
            )}
            {billAddressLines.length > 0 && (
              <div>
                <dt className="text-xs text-zinc-500">ที่อยู่</dt>
                <dd className="text-zinc-800">
                  {billAddressLines.map((line, i) => (
                    <span key={i} className="block">
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            ยังไม่ได้กรอกข้อมูลลูกค้าสำหรับออกเอกสาร — ใบพิมพ์จะใช้ชื่อ/ช่องทางติดต่อจาก &quot;ลูกค้า&quot; ด้านบนแทนไปก่อน
          </p>
        )}
        {!canEditBilling && (
          <p className="mt-2 text-xs text-zinc-400">
            {quote.status === "draft"
              ? "กรอกข้อมูลลูกค้าสำหรับออกเอกสารได้หลังออกใบเสนอราคาแล้ว (สถานะ \"เสนอราคาแล้ว\" ขึ้นไป)"
              : "ใบนี้ปิดแล้ว แก้ไขข้อมูลลูกค้าไม่ได้"}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="p-3.5">
          <h2 className="text-sm font-bold text-zinc-800">รายการ ({items.length})</h2>
          <p className="mt-0.5 text-xs text-zinc-400">แตะแถวเพื่อดูรายละเอียดต้นทุน/margin ของรายการนั้น</p>
        </div>
        {items.length === 0 ? (
          <p className="px-3.5 pb-3.5 text-sm text-zinc-500">ไม่พบรายการในใบเสนอราคานี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-y border-zinc-200 text-xs font-semibold text-zinc-500">
                  <th scope="col" className="py-2 pl-3.5 pr-2">
                    #
                  </th>
                  <th scope="col" className="py-2 pr-2">
                    รายการ
                  </th>
                  <th scope="col" className="py-2 pr-2">
                    วัสดุ
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right">
                    จำนวน
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right">
                    ราคา/ชิ้น
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right">
                    รวม
                  </th>
                  <th scope="col" className="py-2 pr-3.5 text-right">
                    margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const expanded = expandedIds.has(it.id);
                  return (
                    <Fragment key={it.id}>
                      <tr
                        className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                        onClick={() => toggleExpand(it.id)}
                        aria-expanded={expanded}
                      >
                        <td className="py-2 pl-3.5 pr-2 text-zinc-500">
                          <span className="inline-flex items-center gap-1">
                            {expanded ? (
                              <ChevronUp className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                            )}
                            {it.seq}
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-zinc-800">
                          {it.skuSnapshot && <span className="font-semibold">{it.skuSnapshot} · </span>}
                          {it.productNameSnapshot ||
                            (it.input.metal === "silver999" && it.input.barSize
                              ? `เงินแท่ง 99.99% ขนาด ${OEM_BAR_SIZE_LABEL_TH[it.input.barSize]}`
                              : it.input.itemKind)}
                        </td>
                        <td className="py-2 pr-2 text-zinc-600">{OEM_METAL_LABEL_TH[it.input.metal]}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-zinc-700">{it.qty}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-zinc-700">{it.pricePerPiece != null ? formatTHB(it.pricePerPiece) : "—"}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-zinc-800">{it.itemTotal != null ? formatTHB(it.itemTotal) : "—"}</td>
                        <td className="py-2 pr-3.5 text-right tabular-nums text-zinc-700">{fmtPct(it.marginChargedPct)}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-zinc-100 bg-zinc-50/60 last:border-0">
                          <td colSpan={7} className="p-3">
                            {it.input.metal === "silver999" ? (
                              <OemBarCalcSummary calc={it.calc} />
                            ) : (
                              <OemCalcBreakdown calc={it.calc} metal={it.input.metal} />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-600">ยอดรวมก่อนส่วนลด</dt>
            <dd className="tabular-nums text-zinc-800">{quote.quoteTotal != null ? formatTHB(quote.quoteTotal) : "—"}</dd>
          </div>
          {quote.discountThb > 0 && (
            <div className="flex justify-between text-red-600">
              <dt>ส่วนลด{quote.discountReason ? ` (${quote.discountReason})` : ""}</dt>
              <dd className="tabular-nums">-{formatTHB(quote.discountThb)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-zinc-200 pt-1.5 text-base font-bold">
            <dt className="text-zinc-800">ยอดสุทธิ</dt>
            <dd className="tabular-nums text-primary-700">
              {quote.grandTotal != null ? formatTHB(quote.grandTotal) : quote.quoteTotal != null ? formatTHB(quote.quoteTotal) : "—"}
            </dd>
          </div>
          {quote.marginAfterDiscountPct != null && (
            <div className="flex justify-between text-xs text-zinc-500">
              <dt>margin หลังหักส่วนลด</dt>
              <dd className="tabular-nums">{fmtPct(quote.marginAfterDiscountPct)}</dd>
            </div>
          )}
        </dl>

        {/* 0082: VAT display mode — grandTotal above never changes with this,
            said explicitly so the owner doesn't worry a click here moves the
            price (see VatModeDialog). */}
        <div className="mt-3 border-t border-zinc-200 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-zinc-600">
              ภาษีมูลค่าเพิ่ม: {quote.vatMode === "breakdown" ? `แยกแสดง (VAT ${fmtPct(quote.vatRate)})` : "รวมในราคาเดียว"}
            </p>
            {canEditFinancials && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="border border-zinc-300"
                onClick={() => setVatModeOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                เปลี่ยน
              </Button>
            )}
          </div>
          {quote.vatMode === "breakdown" && quote.vatBaseThb != null && quote.vatAmountThb != null && (
            <dl className="mt-1.5 space-y-0.5 text-xs text-zinc-500">
              <div className="flex justify-between">
                <dt>ราคาก่อน VAT</dt>
                <dd className="tabular-nums">{formatTHB(quote.vatBaseThb)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>VAT {fmtPct(quote.vatRate)}</dt>
                <dd className="tabular-nums">{formatTHB(quote.vatAmountThb)}</dd>
              </div>
            </dl>
          )}
          <p className="mt-1 text-[11px] text-zinc-400">
            {canEditFinancials ? "เปลี่ยนโหมดนี้ไม่กระทบยอดที่ลูกค้าจ่าย แค่เปลี่ยนวิธีแสดงในเอกสาร" : financialsLockedReasonTh(quote.status)}
          </p>
        </div>

        {/* 0081: มัดจำ — depositAmountThb/balanceThb read STRAIGHT off the
            view (v_oem_quote), never computed here (see this file's header
            + depositInputLabel). */}
        <div className="mt-3 border-t border-zinc-200 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-zinc-600">มัดจำ</p>
            {canEditFinancials && (
              <Button
                type="button"
                variant={quote.depositMode ? "ghost" : "primary"}
                size="sm"
                className={quote.depositMode ? "border border-zinc-300" : ""}
                onClick={() => setDepositOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {quote.depositMode ? "แก้ไข" : "ตั้งมัดจำ"}
              </Button>
            )}
          </div>
          {quote.depositMode && quote.depositAmountThb != null && quote.balanceThb != null ? (
            <p className="mt-1 text-sm text-zinc-800">
              มัดจำ {quote.depositPctEffective != null ? fmtPct(quote.depositPctEffective) : "—"} = {formatTHB(quote.depositAmountThb)} ·
              คงเหลือ{" "}
              <span className={quote.balanceThb < 0 ? "font-semibold text-red-600" : ""}>{formatTHB(quote.balanceThb)}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">
              {canEditFinancials ? "ยังไม่ได้ตั้งมัดจำสำหรับใบนี้" : financialsLockedReasonTh(quote.status)}
            </p>
          )}
          {!canEditFinancials && quote.depositMode && (
            <p className="mt-1 text-[11px] text-zinc-400">{financialsLockedReasonTh(quote.status)}</p>
          )}
          {quote.balanceThb != null && quote.balanceThb < 0 && (
            <p className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              ยอดคงเหลือติดลบ — มัดจำที่ตั้งไว้ (เป็นจำนวนเงิน) มากกว่ายอดสุทธิปัจจุบันแล้ว ตรวจสอบ/แก้ไขมัดจำก่อนส่งเอกสารให้ลูกค้า
            </p>
          )}
          {depositChangedFromParent && (
            <p className="mt-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              มัดจำของใบนี้ถูกปรับจากใบเดิมอัตโนมัติตอนต่อราคา (ใบเดิม {depositInputLabel(parentDeposit!.mode, parentDeposit!.input)} → ใบนี้{" "}
              {depositInputLabel(quote.depositMode, quote.depositInput)}) เพราะยอดใหม่เปลี่ยนไป — ตรวจสอบก่อนแจ้งลูกค้า
            </p>
          )}
        </div>
      </section>

      <ReceiptSection
        quote={quote}
        receipts={receipts}
        onChanged={() => router.refresh()}
        onGoToBilling={() => setBillingOpen(true)}
      />

      {(quote.status === "quoted" || canRenegotiate) && (
        <div className="flex flex-wrap gap-2">
          {quote.status === "quoted" && (
            <>
              <Button type="button" variant="secondary" className="flex-1" loading={wonPending} onClick={markWon}>
                ปิดงาน (ชนะ)
              </Button>
              <Button type="button" variant="danger" className="flex-1" onClick={() => setLostOpen(true)}>
                แพ้งาน
              </Button>
            </>
          )}
          {canRenegotiate && (
            <Button type="button" variant="ghost" className="flex-1 border border-zinc-300" onClick={() => setRenegotiateOpen(true)}>
              ลูกค้าต่อราคา
            </Button>
          )}
        </div>
      )}
      {canRenegotiate && hasReceivedPayment && (
        <p className="-mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          ใบนี้รับเงินไปแล้ว {formatTHB(quote.paidThb!)} — ต่อราคาลงต่ำกว่านี้ได้ แต่จะทำให้ยอดคงค้างติดลบ (ร้านต้องคืนเงินลูกค้า) ระบบไม่กันไว้ ตรวจสอบก่อนกด
        </p>
      )}

      {lostOpen && (
        <LostQuoteDialog
          quote={quote}
          onClose={() => setLostOpen(false)}
          onConfirmed={() => {
            setLostOpen(false);
            router.refresh();
          }}
        />
      )}

      {renegotiateOpen && <RenegotiateDialog quote={quote} hasReceivedPayment={hasReceivedPayment} onClose={() => setRenegotiateOpen(false)} />}

      {billingOpen && (
        <BillingDialog
          quote={quote}
          provinces={provinces}
          onClose={() => setBillingOpen(false)}
          onSaved={() => {
            setBillingOpen(false);
            router.refresh();
          }}
        />
      )}

      {depositOpen && (
        <DepositDialog
          quote={quote}
          onClose={() => setDepositOpen(false)}
          onSaved={() => {
            setDepositOpen(false);
            router.refresh();
          }}
        />
      )}

      {vatModeOpen && (
        <VatModeDialog
          quote={quote}
          sellerProfile={sellerProfile}
          onClose={() => setVatModeOpen(false)}
          onSaved={() => {
            setVatModeOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
