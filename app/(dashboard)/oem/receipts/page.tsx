import { Lock } from "lucide-react";
import { getReceipts } from "@/lib/actions/oem";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReceiptsPageClient } from "@/components/domain/oem/ReceiptsPageClient";

export const dynamic = "force-dynamic";

// /oem/receipts — shop-wide ใบเสร็จรับเงิน/ใบกำกับภาษี registry (0084).
// Owner/admin only, same reasoning as every other OEM page — these rows
// carry the BUYER's tax_id/address on top of everything the quote pages
// already gate on.
export default async function OemReceiptsPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบเสร็จ/ใบกำกับภาษีงาน OEM ได้"
      />
    );
  }

  let receiptsResult;
  try {
    // No quoteId -> every receipt for the shop (see getReceipts' comment).
    receiptsResult = await getReceipts();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!receiptsResult.ok) return <ErrorState message={receiptsResult.error} />;

  return <ReceiptsPageClient receipts={receiptsResult.data} />;
}
