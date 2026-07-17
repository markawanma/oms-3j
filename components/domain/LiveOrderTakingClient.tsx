"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Radio, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { ProductSearchCombobox } from "./ProductSearchCombobox";
import { closeLiveSession, getLiveSessionStats } from "@/lib/actions/live";
import { createQuickOrder } from "@/lib/actions/quick-order";
import { cancelOrder } from "@/lib/actions/orders";
import { formatTHB } from "@/lib/format";
import type { LiveSession, LiveSessionStats, ProductSearchRow } from "@/lib/types";

interface CartLine {
  key: string;
  productId: string;
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  available: number;
}

interface RecentOrder {
  orderId: string;
  externalOrderId: string;
  buyerName: string | null;
  totalAmount: number;
  itemCount: number;
  oversold: boolean;
  oversoldSkus: { sku: string; name: string; availableQty: number }[];
}

export function LiveOrderTakingClient({
  session,
  initialStats,
}: {
  session: LiveSession;
  initialStats: LiveSessionStats | null;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [buyerName, setBuyerName] = useState("");
  const [recentBuyerNames, setRecentBuyerNames] = useState<string[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [stats, setStats] = useState<LiveSessionStats | null>(initialStats);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const toast = useToast();
  const router = useRouter();

  const refetchStats = useCallback(async () => {
    const result = await getLiveSessionStats(session.id);
    if (result.ok) setStats(result.data);
  }, [session.id]);

  function addProduct(product: ProductSearchRow) {
    setFormError(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          key: `${product.id}-${Date.now()}`,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          qty: 1,
          unitPrice: 0,
          available: product.available,
        },
      ];
    });
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l)).filter(Boolean)
    );
  }

  function setQty(key: string, value: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return;
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: n } : l)));
  }

  function setUnitPrice(key: string, value: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, unitPrice: n } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (cart.length === 0) {
      setFormError("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    setSubmitting(true);
    const result = await createQuickOrder({
      liveSessionId: session.id,
      buyerName,
      items: cart.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.push(result.error, "error");
      setFormError(result.error);
      return;
    }

    const oversoldSkus = result.data.oversold
      ? cart
          .filter((l) => result.data.availableQty && l.productId in result.data.availableQty)
          .map((l) => ({ sku: l.sku, name: l.name, availableQty: result.data.availableQty![l.productId] }))
      : [];

    setRecentOrders((prev) => [
      {
        orderId: result.data.orderId,
        externalOrderId: result.data.externalOrderId,
        buyerName: buyerName.trim() || null,
        totalAmount: cartTotal,
        itemCount: cart.reduce((sum, l) => sum + l.qty, 0),
        oversold: result.data.oversold,
        oversoldSkus,
      },
      ...prev,
    ]);

    if (buyerName.trim()) {
      setRecentBuyerNames((prev) =>
        prev.includes(buyerName.trim()) ? prev : [buyerName.trim(), ...prev].slice(0, 20)
      );
    }

    if (result.data.oversold) {
      toast.push(`บันทึกแล้ว — แต่มีของไม่พอในบางรายการ`, "error");
    } else {
      toast.push("บันทึกแล้ว", "success");
    }

    // Reset for the next buyer.
    setCart([]);
    setBuyerName("");
    setResetKey((k) => k + 1);
    void refetchStats();
  }

  async function handleCancelLatest(orderId: string) {
    setCancellingId(orderId);
    const result = await cancelOrder(orderId, "ยกเลิกจากหน้าจดไลฟ์ (กดพลาด)");
    setCancellingId(null);

    if (!result.ok) {
      toast.push(result.error, "error");
      return;
    }

    toast.push("ยกเลิกรายการแล้ว", "success");
    setRecentOrders((prev) => prev.filter((o) => o.orderId !== orderId));
    void refetchStats();
  }

  async function handleCloseLive() {
    setClosing(true);
    const result = await closeLiveSession(session.id);
    setClosing(false);

    if (!result.ok) {
      toast.push(result.error, "error");
      return;
    }

    toast.push("ปิดไลฟ์แล้ว", "success");
    router.push(`/live/${session.id}/summary`);
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          {formError && <ErrorBanner message={formError} />}

          <ProductSearchCombobox onSelect={addProduct} resetKey={resetKey} />

          {cart.length > 0 && (
            <ul className="space-y-2">
              {cart.map((line) => (
                <li key={line.key} className="flex items-center gap-2 rounded-md border border-slate-200 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{line.name}</p>
                    <p className="text-xs text-slate-400">
                      SKU: {line.sku} · เหลือ {line.available}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`ลดจำนวน ${line.name}`}
                      onClick={() => updateQty(line.key, -1)}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50"
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <label htmlFor={`qty-${line.key}`} className="sr-only">
                      จำนวน {line.name}
                    </label>
                    <input
                      id={`qty-${line.key}`}
                      type="number"
                      min={1}
                      step={1}
                      value={line.qty}
                      onChange={(e) => setQty(line.key, e.target.value)}
                      className="h-9 w-14 rounded-md border border-slate-300 text-center text-sm"
                    />
                    <button
                      type="button"
                      aria-label={`เพิ่มจำนวน ${line.name}`}
                      onClick={() => updateQty(line.key, 1)}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="shrink-0">
                    <label htmlFor={`price-${line.key}`} className="sr-only">
                      ราคาต่อชิ้น {line.name}
                    </label>
                    <input
                      id={`price-${line.key}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => setUnitPrice(line.key, e.target.value)}
                      placeholder="ราคา/ชิ้น"
                      className="h-9 w-24 rounded-md border border-slate-300 px-2 text-right text-sm"
                    />
                  </div>

                  <button
                    type="button"
                    aria-label={`ลบ ${line.name} ออกจากรายการ`}
                    onClick={() => removeLine(line.key)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label htmlFor="buyer-name" className="block text-sm font-medium text-slate-700">
              ชื่อผู้ซื้อ (CF)
            </label>
            <input
              id="buyer-name"
              list="recent-buyer-names"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="พิมพ์ชื่อผู้ซื้อ..."
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 text-base focus-visible:border-primary-600"
            />
            <datalist id="recent-buyer-names">
              {recentBuyerNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          {cart.length > 0 && (
            <p className="text-right text-sm font-semibold text-slate-700">รวม {formatTHB(cartTotal)}</p>
          )}

          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            บันทึกออเดอร์ (Enter)
          </Button>
        </form>

        <Button variant="danger" loading={closing} onClick={handleCloseLive} className="w-full">
          ปิดไลฟ์
        </Button>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-700">ยอดรวมไลฟ์นี้</h2>
          </div>
          {stats ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">ออเดอร์</dt>
                <dd className="font-medium text-slate-900">{stats.orderCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">ยอดขาย (GMV)</dt>
                <dd className="font-medium text-slate-900">{formatTHB(stats.gmv)}</dd>
              </div>
              {stats.oversoldCount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-red-600">ของไม่พอ</dt>
                  <dd className="font-medium text-red-600">{stats.oversoldCount}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-400">ยังไม่มีข้อมูล</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">รายการล่าสุดที่จด</h2>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-slate-400">ยังไม่มีรายการในไลฟ์นี้</p>
          ) : (
            <ul className="space-y-2">
              {recentOrders.map((order, index) => (
                <li key={order.orderId} className="rounded-md border border-slate-200 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">
                      {order.buyerName ?? "ไม่ระบุชื่อผู้ซื้อ"}
                    </span>
                    <span className="shrink-0 text-slate-600">{formatTHB(order.totalAmount)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                    <span>{order.itemCount} ชิ้น · #{order.externalOrderId}</span>
                    {index === 0 && (
                      <button
                        type="button"
                        onClick={() => handleCancelLatest(order.orderId)}
                        disabled={cancellingId === order.orderId}
                        className="flex items-center gap-1 font-medium text-red-600 hover:underline disabled:text-slate-300"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        ยกเลิกรายการนี้
                      </button>
                    )}
                  </div>
                  {order.oversold && (
                    <div className="mt-1 rounded-sm bg-red-50 px-2 py-1 text-xs text-red-700">
                      {order.oversoldSkus.length > 0 ? (
                        order.oversoldSkus.map((s) => (
                          <div key={s.sku}>
                            <Badge tone="red" className="mr-1">
                              ⚠ ของไม่พอ
                            </Badge>
                            {s.sku} เหลือ {s.availableQty}
                          </div>
                        ))
                      ) : (
                        <span>⚠ ของไม่พอ — กรุณาตรวจสอบสต็อก</span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
