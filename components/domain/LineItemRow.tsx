import { formatTHB } from "@/lib/format";
import type { OrderItemRow } from "@/lib/types";

export function LineItemRow({ item }: { item: OrderItemRow }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-800">{item.productName ?? item.externalSku ?? "สินค้าไม่ทราบชื่อ"}</p>
        {!item.productId && (
          <p className="text-xs text-red-600">SKU นี้ยังไม่ได้ map กับสินค้าในระบบ</p>
        )}
        <p className="text-xs text-slate-400">จำนวน {item.qty}</p>
      </div>
      <span className="shrink-0 font-medium text-slate-700">{formatTHB(item.unitPrice * item.qty)}</span>
    </div>
  );
}
