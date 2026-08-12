import { Lock } from "lucide-react";
import { getProducts, getShopSetting } from "@/lib/actions/catalog";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductsPageClient } from "@/components/domain/catalog/ProductsPageClient";

export const dynamic = "force-dynamic"; // catalog + spot price change on save

// /catalog — SKU cost master (docs/3j-jewelry/analytics/phase-c1-sku-cost-
// margin.md §3.1). Owner/admin only: cost/margin is business-sensitive and
// editing it changes every profit/ROAS number downstream, so gate at the page
// (same reasoning as /marketing/ad-spend).
export default async function CatalogPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและแก้ไขต้นทุนสินค้าได้"
      />
    );
  }

  let productsResult, settingResult;
  try {
    [productsResult, settingResult] = await Promise.all([getProducts(), getShopSetting()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!productsResult.ok) return <ErrorState message={productsResult.error} />;
  if (!settingResult.ok) return <ErrorState message={settingResult.error} />;

  return (
    <ProductsPageClient products={productsResult.data} silverSpot={settingResult.data.silverSpotThbPerGram} />
  );
}
