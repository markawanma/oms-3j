import { Lock } from "lucide-react";
import { getHeroStock } from "@/lib/actions/hero-stock";
import { getProducts } from "@/lib/actions/catalog";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { HeroStockClient } from "@/components/domain/stock/HeroStockClient";

export const dynamic = "force-dynamic"; // live counter — must never serve a cached snapshot

// /stock/hero — Hero-SKU live stock counter (ops-plan-99 §1). Owner/admin
// only: same reasoning as /catalog — the SKU list here doubles as the
// picker source (getProducts), and deciding which SKUs to push live is a
// business call, not a staff one.
export default async function StockHeroPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูจอสต็อก Hero SKU ได้"
      />
    );
  }

  let heroResult, productsResult;
  try {
    [heroResult, productsResult] = await Promise.all([getHeroStock(), getProducts()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!heroResult.ok) return <ErrorState message={heroResult.error} />;
  if (!productsResult.ok) return <ErrorState message={productsResult.error} />;

  return <HeroStockClient rows={heroResult.data} products={productsResult.data.rows} />;
}
