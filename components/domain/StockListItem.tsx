import type { StockRow } from "@/lib/types";

// Available-stock color per ux-ui design: green (healthy) / amber (<5) / red (0).
function availableTone(available: number): string {
  if (available <= 0) return "text-red-700 bg-red-50";
  if (available < 5) return "text-amber-700 bg-amber-50";
  return "text-green-700 bg-green-50";
}

export function StockListItem({ stock, onAdjust }: { stock: StockRow; onAdjust: () => void }) {
  const available = stock.qtyOnHand - stock.qtyReserved;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-zinc-900">{stock.name}</p>
        <p className="text-xs text-zinc-400">SKU: {stock.sku}</p>
        <div className="mt-1 flex gap-3 text-xs text-zinc-500">
          <span>ในสต็อก {stock.qtyOnHand}</span>
          <span>จองแล้ว {stock.qtyReserved}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className={`rounded-md px-2 py-1 text-sm font-semibold ${availableTone(available)}`}>
          พร้อมขาย {available}
        </span>
        <button
          onClick={onAdjust}
          className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          ปรับสต็อก
        </button>
      </div>
    </div>
  );
}
