import { Lock } from "lucide-react";
import { getProductionOrder, getProductionSkuOptions } from "@/lib/actions/production";
import { getJobsForSourceItems } from "@/lib/actions/job-office";
import { getEffectiveRole } from "@/lib/auth/role";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductionOrderDetailClient } from "@/components/domain/production/ProductionOrderDetailClient";
import { JobCreatePanel } from "@/components/domain/jobs/JobCreatePanel";

export const dynamic = "force-dynamic";

// /production/[id] — one production order: header (editable while open),
// items (add/remove while open), ผลิตเสร็จ/ยกเลิก. Owner/admin only, same
// reasoning as /production.
export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบผลิตเข้าสต็อกได้"
      />
    );
  }

  const { id } = await params;

  let detailResult, skuOptionsResult;
  try {
    [detailResult, skuOptionsResult] = await Promise.all([getProductionOrder(id), getProductionSkuOptions()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!detailResult.ok) return <ErrorState message={detailResult.error} />;

  // Degrade, don't block the whole order page over the SKU picker — an
  // owner should still be able to view/ผลิตเสร็จ/ยกเลิก an existing order
  // even if the picker read fails; ProductionAddItemForm shows the error
  // inline and disables adding new items until it's fixed.
  if (!skuOptionsResult.ok) console.error("getProductionSkuOptions failed:", skuOptionsResult.error);
  const skuOptions = skuOptionsResult.ok ? skuOptionsResult.data : [];
  const skuOptionsError = skuOptionsResult.ok ? null : skuOptionsResult.error;

  // J1: ใบงานผลิตต่อรายการ — ส่วนแยก ไม่แตะ logic ของหน้านี้ (เสนอสร้างเฉพาะใบผลิตที่ยังเปิด — RPC ปฏิเสธสถานะอื่นด้วย po_not_open)
  const jobItems = detailResult.data.items.map((it) => ({ id: it.id, label: `${it.sku ?? it.pendingProductLabel ?? "ยังไม่ผูก SKU"}${it.productName ? ` · ${it.productName}` : ""} × ${it.qtyPlanned}` }));

  // PM-B: ใบงานที่ยังเดินอยู่ของแต่ละรายการ → ล็อกช่องโลหะบนการ์ด (UX A.3.2) · อ่านไม่ได้ = ไม่ล็อกบนจอ (DB ยังกันซ้ำที่ metal_locked) ไม่ล้มทั้งหน้า
  const activeJobs: Record<string, string> = {};
  // 0189 W2: ใบงานของใบผลิตหน้างาน (1 รายการ 1 ใบงาน) — ให้การ์ด OfficeAck แสดงรูปจากหน้างาน · อ่านไม่ได้/ไม่ใช่ใบหน้างาน = ไม่มีแถบรูป
  let ackJob: { jobId: string; jobNo: string } | null = null;
  if (detailResult.data.order.status === "open" && detailResult.data.items.length > 0) {
    try {
      const jobsResult = await getJobsForSourceItems("production", detailResult.data.items.map((it) => it.id));
      if (jobsResult.ok) {
        for (const j of jobsResult.data) {
          if (!(j.itemId in activeJobs)) activeJobs[j.itemId] = j.jobNo;
          if (ackJob === null) ackJob = { jobId: j.jobId, jobNo: j.jobNo };
        }
      } else console.error("getJobsForSourceItems failed:", jobsResult.error);
    } catch (err) {
      console.error("getJobsForSourceItems threw:", err);
    }
  }

  return (
    <>
      <ProductionOrderDetailClient
        order={detailResult.data.order}
        items={detailResult.data.items}
        skuOptions={skuOptions}
        skuOptionsError={skuOptionsError}
        activeJobs={activeJobs}
        ackJob={ackJob}
      />
      {detailResult.data.order.status === "open" && <JobCreatePanel kind="production" items={jobItems} />}
    </>
  );
}
