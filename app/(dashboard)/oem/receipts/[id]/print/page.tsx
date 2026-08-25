import { Lock } from "lucide-react";
import { getReceipt } from "@/lib/actions/oem";
import { getDevRole } from "@/lib/dev/context";
import { toPrintableReceipt } from "@/lib/oem/printableReceipt";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PrintReceiptClient } from "@/components/domain/oem/PrintReceiptClient";

export const dynamic = "force-dynamic";

// /oem/receipts/[id]/print — printable A4 ใบเสร็จรับเงิน/ใบกำกับภาษี (0084).
// Same auth gate as the rest of the OEM module. toPrintableReceipt() here is
// the actual security boundary (see lib/oem/printableReceipt.ts's header) —
// this is the one and only place that narrows the full DB row down to the
// print-safe shape. Do not pass receiptResult.data to PrintReceiptClient
// directly.
//
// Unlike the quote print page, there is no "missing seller info" gate here:
// oem_receipt_issue's own DB gates (0084 §9) already refuse to create a row
// at all unless seller/buyer info was complete AT ISSUE TIME — every receipt
// that exists is, by construction, already printable.
export default async function OemReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่พิมพ์ใบเสร็จ/ใบกำกับภาษีงาน OEM ได้"
      />
    );
  }

  const { id } = await params;

  let receiptResult;
  try {
    receiptResult = await getReceipt(id);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!receiptResult.ok) return <ErrorState message={receiptResult.error} />;

  return <PrintReceiptClient receipt={toPrintableReceipt(receiptResult.data)} />;
}
