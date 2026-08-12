import { LineItemRow } from "./LineItemRow";
import { formatTHB } from "@/lib/format";
import type { OrderItemRow } from "@/lib/types";

export function OrderSummaryBlock({ items, totalAmount }: { items: OrderItemRow[]; totalAmount: number }) {
  return (
    <section aria-labelledby="order-summary-heading" className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 id="order-summary-heading" className="text-sm font-semibold text-zinc-500">
        รายการสินค้า
      </h2>
      <div className="mt-2 divide-y divide-zinc-100">
        {items.map((item) => (
          <LineItemRow key={item.id} item={item} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3 text-base font-semibold text-zinc-900">
        <span>ยอดรวม</span>
        <span>{formatTHB(totalAmount)}</span>
      </div>
    </section>
  );
}
