import { listSkuPrefixes } from "@/lib/actions/catalog-sku";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkuPrefixPageClient } from "@/components/domain/catalog/SkuPrefixPageClient";

export const dynamic = "force-dynamic";

// /catalog/sku-prefix — config screen for the SKU-prefix generator (Phase
// 1a, docs/3j-jewelry/oem/design-email-sku-phase1.md). The page itself isn't
// role-gated (frontline staff can view it, matching /catalog's read side) —
// but every write action behind it (upsertSkuPrefix, previewSkuSeed,
// createCatalogSku) now requires owner/admin, see
// lib/actions/catalog-sku.ts's header. A staff viewer can look at this
// screen but "+ เพิ่ม prefix" will fail with a Thai permission error on
// submit rather than being hidden — same class of gap as leaving the button
// visible would be on /catalog; flagged, not fixed here since it wasn't in
// scope for this pass.
export default async function SkuPrefixPage() {
  let result;
  try {
    result = await listSkuPrefixes({ withLastNo: true });
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return <SkuPrefixPageClient prefixes={result.data} />;
}
