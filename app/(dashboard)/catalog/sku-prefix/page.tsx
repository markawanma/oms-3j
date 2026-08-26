import { Lock } from "lucide-react";
import { listSkuPrefixes } from "@/lib/actions/catalog-sku";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkuPrefixPageClient } from "@/components/domain/catalog/SkuPrefixPageClient";

export const dynamic = "force-dynamic";

// /catalog/sku-prefix — config screen for the SKU-prefix generator (Phase
// 1a, docs/3j-jewelry/oem/design-email-sku-phase1.md). Owner/admin only,
// gated at the page (same shape as /catalog): every write action behind it
// (upsertSkuPrefix, previewSkuSeed, createCatalogSku) already required
// owner/admin server-side — this was previously left ungated at the page
// level, so a staff viewer would see the "+ เพิ่ม prefix" button and only
// hit the Thai permission error on submit. Gating here instead shows a
// consistent EmptyState up front, matching /catalog's UX.
export default async function SkuPrefixPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ตั้งค่า prefix SKU ได้"
      />
    );
  }

  let result;
  try {
    result = await listSkuPrefixes({ withLastNo: true });
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return <SkuPrefixPageClient prefixes={result.data} />;
}
