"use client";

import { useMemo, useState } from "react";
import { ImageOff, MessageCircle, Search } from "lucide-react";
import { lineOrderUrl } from "@/lib/shop/category";
import { EmptyState } from "@/components/ui/EmptyState";

export type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  selling_price: number | null;
  image_url: string | null;
  categoryKey: string;
  categoryLabel: string;
};

export type CategoryOption = { key: string; label: string };

function formatPrice(price: number | null): string {
  if (price === null) return "สอบถามราคา";
  return `฿${price.toLocaleString("th-TH")}`;
}

function ProductCard({ item }: { item: CatalogItem }) {
  const hasPrice = item.selling_price !== null;
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow hover:shadow-md">
      <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 p-2 text-center text-zinc-400">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- external/placeholder source, next/image not needed yet
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-1" aria-hidden="true">
            <ImageOff className="h-6 w-6" />
            <span className="text-[0.68rem] leading-tight">ยังไม่มีรูป</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3 pt-2.5">
        <span className="w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-[0.68rem] font-semibold text-zinc-600">
          {item.categoryLabel}
        </span>
        <h2 className="text-sm font-semibold leading-snug text-zinc-900">{item.name}</h2>
        <p className="text-xs text-zinc-500">รหัส {item.sku}</p>
        <p
          className={
            hasPrice
              ? "mb-1 mt-0.5 text-base font-bold text-[#A2191D]"
              : "mb-1 mt-0.5 text-sm font-medium text-zinc-500"
          }
        >
          {formatPrice(item.selling_price)}
        </p>
        <a
          href={lineOrderUrl(item.name, item.sku)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`สั่งซื้อ ${item.name} ผ่าน LINE`}
          className="mt-auto flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-[#06C755] px-3 text-sm font-semibold text-white transition hover:brightness-95"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          สั่งซื้อผ่าน LINE
        </a>
      </div>
    </article>
  );
}

export function CatalogGrid({
  items,
  categories,
}: {
  items: CatalogItem[];
  categories: CategoryOption[];
}) {
  const [activeKey, setActiveKey] = useState("all");

  const filtered = useMemo(
    () => (activeKey === "all" ? items : items.filter((item) => item.categoryKey === activeKey)),
    [items, activeKey],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="ยังไม่มีสินค้าในแคตตาล็อก"
        description="กำลังทยอยเพิ่มสินค้า กรุณากลับมาดูใหม่อีกครั้ง"
      />
    );
  }

  return (
    <div>
      <nav
        role="tablist"
        aria-label="กรองหมวดสินค้า"
        className="mb-5 flex flex-wrap justify-center gap-2 pt-5"
      >
        {categories.map((category) => {
          const isActive = category.key === activeKey;
          return (
            <button
              key={category.key}
              type="button"
              role="tab"
              aria-pressed={isActive}
              onClick={() => setActiveKey(category.key)}
              className={
                isActive
                  ? "min-h-11 rounded-full border border-[#A2191D] bg-[#A2191D] px-4 text-sm font-semibold text-white"
                  : "min-h-11 rounded-full border border-zinc-300 bg-white px-4 text-sm text-zinc-700 hover:border-[#A2191D]"
              }
            >
              {category.label}
            </button>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <EmptyState icon={Search} title="ยังไม่มีสินค้าในหมวดนี้" description="ลองเลือกหมวดอื่นดู" />
      ) : (
        <div
          aria-live="polite"
          className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 md:grid-cols-4"
        >
          {filtered.map((item) => (
            <ProductCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
