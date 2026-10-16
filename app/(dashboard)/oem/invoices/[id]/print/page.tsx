import { Lock } from "lucide-react";
import { getInvoice } from "@/lib/actions/oem";
import { getEffectiveRole } from "@/lib/auth/role";
import { toInvoicePrintNotices, toPrintableInvoice } from "@/lib/oem/printableInvoice";
import { formatTHB } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PrintInvoiceClient } from "@/components/domain/oem/PrintInvoiceClient";
import { InvoicePrintBlocked } from "@/components/domain/oem/InvoicePrintBlocked";

export const dynamic = "force-dynamic";

// /oem/invoices/[id]/print — ใบแจ้งหนี้ A4 (0179 · ไม่ใช่ใบกำกับภาษี). Owner/admin only เหมือนทั้งโมดูล OEM.
// toPrintableInvoice() เป็นด่านความปลอดภัยจริง (lib/oem/printableInvoice.ts) — ที่นี่คือที่เดียวที่ย่อ row เต็มจาก DB
// ให้เหลือรูปที่พิมพ์ได้ ห้ามส่ง invoiceResult.data เข้า PrintInvoiceClient ตรงๆ
//
// ใบ stale (ออกอยู่แต่ยอดดีลเปลี่ยนแล้ว) = ไม่ render เอกสาร และไม่เรียก toPrintableInvoice เลย → การ์ดแดงบอกทางออก
// ใบ void = PrintInvoiceClient แสดงบนจอ (เอกสาร print:hidden ไม่มีปุ่มพิมพ์)
export default async function OemInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่พิมพ์ใบแจ้งหนี้งาน OEM ได้"
      />
    );
  }

  const { id } = await params;

  let invoiceResult;
  try {
    invoiceResult = await getInvoice(id);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!invoiceResult.ok) return <ErrorState message={invoiceResult.error} />;

  const row = invoiceResult.data;
  const notices = toInvoicePrintNotices(row);

  if (notices.blockPrint) {
    return (
      <InvoicePrintBlocked
        invoiceNo={row.invoiceNo}
        amountText={formatTHB(row.amountThb)}
        issueDateText={formatThaiDateOnly(row.issueDate)}
        quoteHref={`/oem/quotes/${notices.activeQuoteId ?? row.quoteId}`}
      />
    );
  }

  return <PrintInvoiceClient invoice={toPrintableInvoice(row)} notices={notices} />;
}
