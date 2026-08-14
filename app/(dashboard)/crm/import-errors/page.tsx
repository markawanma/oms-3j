import { CheckCircle2 } from "lucide-react";
import { getCrmImportErrors } from "@/lib/actions/crm";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImportErrorGroupList } from "@/components/domain/crm/ImportErrorGroupList";

export const dynamic = "force-dynamic";

// /crm/import-errors (design §1 B1) — group by error_code. B1 data has 0
// errors in the DB today (handoff note), so the empty state below is the
// state most reviewers will actually see — deliberately a positive/reassuring
// empty state ("ไม่มี error"), not a generic "no data" placeholder.
//
// NOTE: v_import_error_summary is owner/admin-only by RLS design (§2.7);
// under the current service-role/no-auth dev shortcut that restriction isn't
// actually enforced (see lib/actions/crm.ts module header) — flagged for
// security-auditor same as the PII gap on the customer 360 page.
export default async function CrmImportErrorsPage() {
  let result;
  try {
    result = await getCrmImportErrors();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="ไม่มี error ในการนำเข้าล่าสุด"
        description="ทุกแถวที่นำเข้าถูกแปลงเป็นออเดอร์สำเร็จ — หน้านี้จะแสดงรายการที่แปลงไม่สำเร็จ พร้อมเหตุผล ถ้ามีในอนาคต"
      />
    );
  }

  return <ImportErrorGroupList rows={result.data} />;
}
