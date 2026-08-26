import { listSkuPrefixes } from "@/lib/actions/catalog-sku";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkuPrefixPageClient } from "@/components/domain/catalog/SkuPrefixPageClient";

export const dynamic = "force-dynamic";

// /catalog/sku-prefix — config screen for the SKU-prefix generator (Phase
// 1a, docs/3j-jewelry/oem/design-email-sku-phase1.md). Deliberately NOT
// role-gated like its sibling /catalog (cost/margin) page — see
// lib/actions/catalog-sku.ts's header for why: frontline staff fill this in,
// and neither table here carries cost/margin data.
export default async function SkuPrefixPage() {
  let result;
  try {
    result = await listSkuPrefixes();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return <SkuPrefixPageClient prefixes={result.data} />;
}
