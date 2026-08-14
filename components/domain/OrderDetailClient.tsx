"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChannelBadge } from "./ChannelBadge";
import { StatusBadge } from "./StatusBadge";
import { BuyerInfoCard } from "./BuyerInfoCard";
import { OrderSummaryBlock } from "./OrderSummaryBlock";
import { StatusTimeline } from "./StatusTimeline";
import { StickyActionBar } from "./StickyActionBar";
import { OversoldAlertCard } from "./OversoldAlertCard";
import { SlaCountdownChip } from "./SlaCountdownChip";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { advanceOrder, markShipped, cancelOrder, getOrderDetail } from "@/lib/actions/orders";
import { formatBangkokTime } from "@/lib/format";
import type { OrderDetail } from "@/lib/types";

export function OrderDetailClient({ initialOrder }: { initialOrder: OrderDetail }) {
  const [order, setOrder] = useState<OrderDetail>(initialOrder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const result = await getOrderDetail(order.id);
    if (result.ok) setOrder(result.data);
  }, [order.id]);

  const handleAdvance = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await advanceOrder(order.id, order.status);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      toast.push(result.error, "error");
      return;
    }
    toast.push("อัพเดทสถานะเรียบร้อย", "success");
    router.refresh();
    await refresh();
  }, [order.id, order.status, refresh, router, toast]);

  const handleShip = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await markShipped(order.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      toast.push(result.error, "error");
      return;
    }
    toast.push("ยืนยันจัดส่งเรียบร้อย", "success");
    router.refresh();
    await refresh();
  }, [order.id, refresh, router, toast]);

  const handleCancel = useCallback(
    async (reason: string) => {
      setBusy(true);
      setError(null);
      const result = await cancelOrder(order.id, reason);
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("ยกเลิกออเดอร์เรียบร้อย", "success");
      router.refresh();
      await refresh();
    },
    [order.id, refresh, router, toast]
  );

  return (
    <div className="space-y-4 pb-4">
      <div>
        <div className="flex items-center gap-2">
          <ChannelBadge channel={order.channelCode} />
          <StatusBadge status={order.status} />
          <SlaCountdownChip shipByAt={null} />
        </div>
        <h1 className="mt-2 text-xl font-bold text-zinc-900">#{order.externalOrderId}</h1>
        <p className="text-sm text-zinc-500">สั่งซื้อเมื่อ {formatBangkokTime(order.placedAt ?? order.createdAt)}</p>
      </div>

      {error && <ErrorBanner message={error} />}

      {order.status === "oversold_hold" && <OversoldAlertCard busy={busy} onCancel={handleCancel} />}

      {order.status === "cancelled" && order.cancelReason && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          <span className="font-medium">เหตุผลการยกเลิก: </span>
          {order.cancelReason}
        </div>
      )}

      <StatusTimeline status={order.status} />
      <BuyerInfoCard buyerName={order.buyerName} buyerPhone={order.buyerPhone} shippingAddress={order.shippingAddress} />
      <OrderSummaryBlock items={order.items} totalAmount={order.totalAmount} />

      {order.status !== "oversold_hold" && (
        <StickyActionBar status={order.status} busy={busy} onAdvance={handleAdvance} onShip={handleShip} onCancel={handleCancel} />
      )}
    </div>
  );
}
