import type { Metadata } from "next";
import { getCatalog } from "@/lib/actions/shop-catalog";
import { categoryOf } from "@/lib/shop/category";
import { CatalogGrid, type CatalogItem, type CategoryOption } from "./CatalogGrid";

// ISR — ราคาปรับไม่บ่อย, ลด load DB (ดู shop-route-design.md §7)
export const revalidate = 300;

export const metadata: Metadata = {
  title: "แคตตาล็อกสินค้า — 3J JEWELRY",
  description: "เครื่องประดับเงินแท้ 92.5 · สั่งซื้อผ่าน LINE",
};

const ALL_CATEGORY: CategoryOption = { key: "all", label: "ทั้งหมด" };

export default async function ShopPage() {
  const products = await getCatalog();

  const items: CatalogItem[] = products.map((p) => {
    const category = categoryOf(p.sku);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      selling_price: p.selling_price,
      image_url: p.image_url,
      categoryKey: category.key,
      categoryLabel: category.label,
    };
  });

  // หมวดที่มีสินค้าจริงเท่านั้น (ลำดับตามที่เจอครั้งแรกในรายการ) + "ทั้งหมด" นำหน้าเสมอ
  const seen = new Set<string>();
  const categories: CategoryOption[] = [ALL_CATEGORY];
  for (const item of items) {
    if (!seen.has(item.categoryKey)) {
      seen.add(item.categoryKey);
      categories.push({ key: item.categoryKey, label: item.categoryLabel });
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10">
      <CatalogGrid items={items} categories={categories} />
    </div>
  );
}
