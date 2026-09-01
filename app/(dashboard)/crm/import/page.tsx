import { Lock } from "lucide-react";
import { getImportBatches } from "@/lib/actions/import-orders";
import { getOrphanBacklog, type OrphanBacklog } from "@/lib/actions/import-line-items";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OrderImportClient } from "@/components/domain/crm/OrderImportClient";
import { ImportBatchHistory } from "@/components/domain/crm/ImportBatchHistory";
import { OrphanBacklogPanel } from "@/components/domain/crm/OrphanBacklogPanel";

export const dynamic = "force-dynamic";

// /crm/import (docs/3j-jewelry/analytics/phase-import-ui-design.md §3.3, D6):
// upload -> preview -> confirm the monthly sales report (all channels in one
// file, see D6 note below) that feeds fact_order/dim_customer. Owner/admin
// only (D5) — same getDevRole() app-level gate as every other CRM page,
// staff see an EmptyState instead of the form (not just a disabled button).
export default async function CrmImportPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่นำเข้ารายงานยอดขายได้"
      />
    );
  }

  let result;
  try {
    result = await getImportBatches();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  // Feature B (orphan backlog) — fail-soft on purpose (task brief): a
  // problem here must never take down the rest of the page, which is why
  // this is a separate try/catch from getImportBatches above (that one DOES
  // fail the whole page — different contract, existing behavior, not
  // touched). A failed/thrown fetch just leaves orphanBacklog null, and
  // OrphanBacklogPanel simply isn't rendered below.
  let orphanBacklog: OrphanBacklog | null = null;
  try {
    const orphanResult = await getOrphanBacklog();
    if (orphanResult.ok) {
      orphanBacklog = orphanResult.data;
    } else {
      console.error("CrmImportPage: getOrphanBacklog returned error", orphanResult.error);
    }
  } catch (err) {
    console.error("CrmImportPage: getOrphanBacklog threw", err);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">นำเข้ายอดขาย</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          รายงานยอดขายรายเดือน (ทุกช่องทาง LINE/TikTok/Facebook อยู่ในไฟล์เดียว) หรือรายงาน &quot;สินค้าในออเดอร์&quot;
          จาก Shipnity เพื่อคำนวณกำไรจริงต่อออเดอร์ — อัปโหลดที่เดียว ระบบตรวจชนิดไฟล์ให้อัตโนมัติ
        </p>
      </div>

      <OrderImportClient />

      {orphanBacklog && <OrphanBacklogPanel backlog={orphanBacklog} />}

      <div>
        <h2 className="mb-2 text-sm font-bold text-zinc-800">ประวัติการนำเข้า</h2>
        {result.data.length === 0 ? (
          <EmptyState title="ยังไม่มีประวัติการนำเข้า" description="อัปโหลดไฟล์รายงานยอดขายด้านบนเพื่อเริ่มต้น" />
        ) : (
          <ImportBatchHistory initialRows={result.data} />
        )}
      </div>
    </div>
  );
}
