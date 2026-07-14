import Link from "next/link";
import { ChannelBadge } from "./ChannelBadge";
import { StatusBadge } from "./StatusBadge";
import { formatTHB, formatBangkokTime } from "@/lib/format";
import type { OrderListRow } from "@/lib/types";

export function OrderListItem({ order }: { order: OrderListRow }) {
  return (
    <Link
      href={`/orders/${order.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-300 focus-visible:border-primary-600"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChannelBadge channel={order.channelCode} />
          <StatusBadge status={order.status} />
        </div>
        <span className="text-sm font-semibold text-slate-900">{formatTHB(order.totalAmount)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
        <span className="truncate">{order.buyerName ?? "ไม่ระบุชื่อผู้ซื้อ"}</span>
        <span className="shrink-0 text-slate-400">#{order.externalOrderId}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">{formatBangkokTime(order.placedAt ?? order.createdAt)}</div>
    </Link>
  );
}
