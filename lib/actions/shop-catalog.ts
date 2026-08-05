// lib/actions/shop-catalog.ts
//
// Read-only data access for the public /shop catalog. NO mutation path here
// and none should ever be added — see design §6 checklist
// (docs/3j-jewelry/web/shop-route-design.md). Must use the anon-key client
// (lib/supabase/public.ts) only; never import getServiceClient here.
import "server-only";
import { getPublicClient } from "@/lib/supabase/public";

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  selling_price: number | null;
  image_url: string | null;
}

/**
 * Fetches the public product catalog from the `shop_catalog` view
 * (supabase/migrations/0009_public_catalog.sql) — allowlisted columns only,
 * already filtered to `is_active AND is_public` and pinned to the 3J shop.
 * Returns an empty array on error (fail-safe for a public page — never
 * throw and crash the storefront over a transient DB hiccup).
 */
export async function getCatalog(): Promise<CatalogItem[]> {
  try {
    const supabase = getPublicClient();
    const { data, error } = await supabase
      .from("shop_catalog")
      .select("id, sku, name, selling_price, image_url")
      .order("sku", { ascending: true });

    if (error) {
      console.error("getCatalog failed", error);
      return [];
    }

    return (data ?? []) as CatalogItem[];
  } catch (err) {
    console.error("getCatalog failed", err);
    return [];
  }
}
