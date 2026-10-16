"use client";

// InvoiceSection — QuoteDetailClient's "ใบแจ้งหนี้" block (0179), วางเหนือ ReceiptSection.
// Pure display + dialog triggers: ทุกตัวเลขเงินมาจาก `quote` (v_oem_quote) หรือ `invoices` (v_oem_invoice —
// แช่แข็งตอนออกใบ) ไม่มีอะไรถูกบวก/คำนวณที่นี่ · ชนิดใบ + ด่านปุ่มตัดสินโดย lib/oem/invoiceDisplay.ts
// (resolveInvoiceGate — เปรียบเทียบอย่างเดียว) · ไม่สรุปยอดซ้ำกับ ReceiptSection
//
// ใบ void: ดูบนจอได้ พิมพ์ไม่ได้ (มติ Tech Lead) — แถว void จึงมีแค่ปุ่ม "ดู" ไม่มีปุ่ม "พิมพ์"

import { useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, CheckCircle2, Clock, Eye, FileText, Printer } from "lucide-react";
import type { OemInvoiceRow, OemInvoiceKind, OemQuoteRow } from "@/lib/oem/types";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import type { InvoiceDisplayStatus, InvoiceGate, InvoiceGateTone } from "@/lib/oem/invoiceDisplay";
import { INVOICE_DISPLAY_STATUS_LABEL_TH, formatDueText, resolveInvoiceDisplayStatus, resolveInvoiceGate } from "@/lib/oem/invoiceDisplay";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InvoiceIssueDialog } from "./InvoiceIssueDialog";
import { VoidInvoiceDialog } from "./VoidInvoiceDialog";
import type { InvoiceVoidedInfo } from "./VoidInvoiceDialog";

const STATUS_TONE: Record<InvoiceDisplayStatus, BadgeTone> = {
  void: "slate",
  paid: "green",
  stale: "orange",
  overdue: "red",
  pending: "blue",
};

const STATUS_ICON: Record<InvoiceDisplayStatus, typeof Ban> = {
  void: Ban,
  paid: CheckCircle2,
  stale: AlertTriangle,
  overdue: Clock,
  pending: Clock,
};

const KIND_SHORT_TH: Record<OemInvoiceKind, string> = { deposit: "มัดจำ", balance: "คงเหลือ" };

const GATE_TONE_CLASS: Record<InvoiceGateTone, string> = {
  red: "border-red-300 bg-red-50 text-red-800",
  orange: "border-orange-300 bg-orange-50 text-orange-800",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

const actionLinkCls = "inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-2";

export function InvoiceSection({
  quote,
  invoices,
  invoicesError,
  sellerProfile,
  canEditFinancials,
  onChanged,
  onGoToBilling,
  onGoToDeposit,
}: {
  quote: OemQuoteRow;
  invoices: OemInvoiceRow[];
  /** ข้อความ error ถ้าโหลดรายการใบไม่สำเร็จ (null = โหลดได้) */
  invoicesError: string | null;
  sellerProfile: SellerProfile;
  /** quote.status draft/quoted — ปุ่ม "แก้มัดจำ" แสดงเฉพาะที่แก้ได้จริง */
  canEditFinancials: boolean;
  onChanged: () => void;
  onGoToBilling: () => void;
  onGoToDeposit: () => void;
}) {
  const gateMsgId = useId();
  const [issueState, setIssueState] = useState<{ kind: OemInvoiceKind; isFull: boolean; replacesInvoiceId: string | null } | null>(null);
  const [voidState, setVoidState] = useState<{ invoice: OemInvoiceRow; mode: "normal" | "stale" } | null>(null);

  const gate = resolveInvoiceGate({ quote, invoices, invoicesError, sellerProfile });

  function openViewTab(invoiceId: string) {
    window.open(`/oem/invoices/${invoiceId}/print`, "_blank", "noopener,noreferrer");
  }

  function handleVoided(info: InvoiceVoidedInfo) {
    setVoidState(null);
    onChanged();
    if (!info.reissueReplacing) return;
    // "ยกเลิกและออกใหม่": เปิด issue dialog ต่อทันที — ตัดสินด่านใหม่โดยไม่นับใบที่เพิ่ง void
    // (invoices ใน props ยังเป็นของเก่าจนกว่า refresh จะมา) ถ้ายังไม่ผ่านด่านอื่น ไม่เปิด — แถบเหตุผลจะบอกหลัง refresh
    const next = resolveInvoiceGate({ quote, invoices: [], invoicesError: null, sellerProfile });
    if (next.state === "ready") {
      setIssueState({ kind: next.kind, isFull: next.isFull, replacesInvoiceId: info.reissueReplacing });
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm" aria-label="ใบแจ้งหนี้">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
          <FileText className="h-4 w-4 text-zinc-500" aria-hidden="true" />
          ใบแจ้งหนี้
        </h2>
        {gate.state === "ready" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => setIssueState({ kind: gate.kind, isFull: gate.isFull, replacesInvoiceId: null })}
          >
            {gate.labelTh}
          </Button>
        )}
        {gate.state === "disabled" && (
          <Button type="button" variant="secondary" size="sm" className="min-h-11 w-full sm:w-auto" disabled aria-describedby={gateMsgId}>
            {gate.labelTh ?? "ออกใบแจ้งหนี้"}
          </Button>
        )}
      </div>

      {gate.state !== "ready" && (
        <GateNotice
          gate={gate}
          messageId={gateMsgId}
          canEditFinancials={canEditFinancials}
          onGoToBilling={onGoToBilling}
          onGoToDeposit={onGoToDeposit}
        />
      )}

      <div className="mt-3 border-t border-zinc-200 pt-3">
        {invoices.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีใบแจ้งหนี้สำหรับดีลนี้</p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                inv={inv}
                onView={() => openViewTab(inv.id)}
                onVoid={(mode) => setVoidState({ invoice: inv, mode })}
              />
            ))}
          </ul>
        )}
      </div>

      {issueState && (
        <InvoiceIssueDialog
          quote={quote}
          sellerProfile={sellerProfile}
          kind={issueState.kind}
          isFull={issueState.isFull}
          replacesInvoiceId={issueState.replacesInvoiceId}
          onClose={() => setIssueState(null)}
          onChanged={onChanged}
        />
      )}
      {voidState && (
        <VoidInvoiceDialog invoice={voidState.invoice} mode={voidState.mode} onClose={() => setVoidState(null)} onVoided={handleVoided} />
      )}
    </section>
  );
}

function GateNotice({
  gate,
  messageId,
  canEditFinancials,
  onGoToBilling,
  onGoToDeposit,
}: {
  gate: Exclude<InvoiceGate, { state: "ready" }>;
  messageId: string;
  canEditFinancials: boolean;
  onGoToBilling: () => void;
  onGoToDeposit: () => void;
}) {
  return (
    <div
      id={messageId}
      role={gate.tone === "red" ? "alert" : undefined}
      className={`mt-2 rounded-md border px-3 py-2 text-xs ${GATE_TONE_CLASS[gate.tone]}`}
    >
      <p>{gate.message}</p>
      {gate.action === "rates" && (
        <Link href="/oem/rates" className={actionLinkCls}>
          ไปกรอกข้อมูลร้านเรา
        </Link>
      )}
      {gate.action === "payment_lines" && (
        <Link href="/oem/rates#oem-payment-lines" className={actionLinkCls}>
          ไปตั้งช่องทางชำระ
        </Link>
      )}
      {gate.action === "billing" && (
        <button type="button" className={actionLinkCls} onClick={onGoToBilling}>
          กรอกข้อมูลลูกค้า
        </button>
      )}
      {gate.action === "deposit" && canEditFinancials && (
        <button type="button" className={actionLinkCls} onClick={onGoToDeposit}>
          แก้มัดจำ
        </button>
      )}
    </div>
  );
}

function InvoiceRow({ inv, onView, onVoid }: { inv: OemInvoiceRow; onView: () => void; onVoid: (mode: "normal" | "stale") => void }) {
  const status = resolveInvoiceDisplayStatus(inv);
  const StatusIcon = STATUS_ICON[status];
  const isVoid = status === "void";
  const isPaid = status === "paid";
  const isStale = status === "stale";
  const isOverdue = status === "overdue";

  return (
    <li className={`rounded-md border border-zinc-200 p-2.5 text-sm ${isVoid ? "text-zinc-500" : "text-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-semibold ${isVoid ? "line-through" : ""}`}>{inv.invoiceNo}</span>
        <Badge tone="slate">{KIND_SHORT_TH[inv.kind]}</Badge>
        <Badge tone={STATUS_TONE[status]}>
          <StatusIcon className="h-3 w-3" aria-hidden="true" />
          {INVOICE_DISPLAY_STATUS_LABEL_TH[status]}
        </Badge>
      </div>

      <p className="mt-1 whitespace-nowrap tabular-nums">
        {formatTHB(inv.amountThb)} <span className="font-normal">· ออก {formatThaiDateOnly(inv.issueDate)}</span>
      </p>
      <p className={`text-xs ${isOverdue ? "text-red-700" : "text-zinc-500"}`}>กำหนดชำระ: {formatDueText(inv)}</p>

      {isPaid && (
        <div className="mt-1 text-xs text-zinc-600">
          <p>
            ชำระแล้ว ·{" "}
            {inv.receiptNo && inv.receiptId ? (
              <Link href={`/oem/receipts/${inv.receiptId}/print`} className="font-medium text-primary-700 hover:underline">
                {inv.receiptNo}
              </Link>
            ) : (
              <span>{inv.receiptNo ?? "—"}</span>
            )}
          </p>
          <p className="text-[11px] text-zinc-500">ใบนี้ชำระแล้ว — ยกเลิกใบเสร็จก่อนจึงยกเลิกได้</p>
        </div>
      )}

      {isStale && (
        <div className="mt-2 rounded-md border border-orange-300 bg-orange-50 px-2.5 py-2 text-xs text-orange-800">
          <p>ยอดใบเสนอราคา/เงินที่รับเปลี่ยนหลังออกใบนี้ — พิมพ์ไม่ได้ ต้องยกเลิกแล้วออกใหม่</p>
          <Button type="button" variant="primary" size="sm" className="mt-2 min-h-11 w-full" onClick={() => onVoid("stale")}>
            ยกเลิกและออกใหม่
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {isVoid ? (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 border border-zinc-300" onClick={onView}>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ดูใบ
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 border border-zinc-300"
            disabled={isStale}
            aria-label={`พิมพ์ใบแจ้งหนี้ ${inv.invoiceNo}`}
            onClick={onView}
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            พิมพ์
          </Button>
        )}
        {(status === "pending" || status === "overdue") && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 border border-zinc-300 text-red-700" onClick={() => onVoid("normal")}>
            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
            ยกเลิก
          </Button>
        )}
      </div>
    </li>
  );
}
