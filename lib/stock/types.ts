// lib/stock/types.ts — types for the Hero-SKU live stock counter
// (docs/3j-jewelry ops-plan-99 §1 / supabase/migrations/0037_hero_stock_watch.sql).
// Kept OUT of the "use server" actions file, same convention as
// lib/catalog/types.ts.

/** One row of analytics.v_hero_stock — a watched hero SKU + its live
 * available count (on_hand - reserved) for the /stock/hero counter page. */
export interface HeroStockRow {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  qtyOnHand: number;
  qtyReserved: number;
  /** qtyOnHand - qtyReserved — the number the host can still sell. */
  available: number;
  lowStockThreshold: number;
  /** available <= 0 */
  isOut: boolean;
  /** available <= lowStockThreshold */
  isLow: boolean;
  note: string | null;
  stockUpdatedAt: string | null;
  addedAt: string;
}
