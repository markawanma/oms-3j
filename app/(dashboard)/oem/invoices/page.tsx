import { Lock } from "lucide-react";
import { getInvoices } from "@/lib/actions/oem";
import { getEffectiveRole } from "@/lib/auth/role";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { TruncatedDataNotice } from "@/components/ui/TruncatedDataNotice";
import { InvoicesPageClient } from "@/components/domain/oem/InvoicesPageClient";

export const dynamic = "force-dynamic";

// /oem/invoices — ทะเบียนใบแจ้งหนี้ทั้งร้าน (0179 · ไม่ใช่ใบกำกับภาษี). Owner/admin only เหมือนทั้งโมดูล OEM
// (แถวมีชื่อ/ที่อยู่ผู้ซื้อ). ไม่ส่ง quoteId = ทุกใบของร้าน (ดู getInvoices).
export default async function OemInvoicesPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบแจ้งหนี้งาน OEM ได้"
      />
    );
  }

  let invoicesResult;
  try {
    invoicesResult = await getInvoices();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!invoicesResult.ok) return <ErrorState message={invoicesResult.error} />;

  return (
    <>
      {invoicesResult.data.truncated && (
        <TruncatedDataNotice totalCount={invoicesResult.data.totalCount} shownCount={invoicesResult.data.rows.length} />
      )}
      <InvoicesPageClient invoices={invoicesResult.data.rows} />
    </>
  );
}
