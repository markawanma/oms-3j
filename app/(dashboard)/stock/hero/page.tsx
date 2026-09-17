import { getHeroStock, getProductPickerOptions } from "@/lib/actions/hero-stock";
import { ErrorState } from "@/components/ui/ErrorState";
import { HeroStockClient } from "@/components/domain/stock/HeroStockClient";

export const dynamic = "force-dynamic"; // live counter — must never serve a cached snapshot

// /stock/hero — Hero-SKU live stock counter (ops-plan-99 §1). Public,
// unauthenticated wall-display screen by design (exempt from middleware.ts's
// AUTH_GATE) — no role gate here. Security review 2026-09-17 (H1): reads
// (getHeroStock/getProductPickerOptions) carry no cost/price/PII, so there is
// nothing to protect by gating this page; gating it would break its only
// real audience (the live-selling host's phone, never logged in). Mutations
// (add/remove hero watch) stay fully gated in lib/actions/hero-stock.ts.
export default async function StockHeroPage() {
  let heroResult, productsResult;
  try {
    [heroResult, productsResult] = await Promise.all([getHeroStock(), getProductPickerOptions()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!heroResult.ok) return <ErrorState message={heroResult.error} />;
  if (!productsResult.ok) return <ErrorState message={productsResult.error} />;

  return <HeroStockClient rows={heroResult.data} products={productsResult.data} />;
}
