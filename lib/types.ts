// lib/types.ts — frontend-facing domain types, mirroring the DB schema
// (supabase/migrations/0001_core_schema.sql) but shaped for the UI.

export type OrderStatus =
  | "new"
  | "confirmed"
  | "to_ship"
  | "shipped"
  | "completed"
  | "oversold_hold"
  | "cancelled";

export type ChannelCode = "shopee" | "tiktok" | "lazada";

export interface OrderListRow {
  id: string;
  externalOrderId: string;
  status: OrderStatus;
  buyerName: string | null;
  totalAmount: number;
  currency: string;
  placedAt: string | null;
  createdAt: string;
  channelCode: ChannelCode;
  channelName: string;
}

export interface OrderItemRow {
  id: string;
  productId: string | null;
  productName: string | null;
  externalSku: string | null;
  qty: number;
  unitPrice: number;
}

export interface OrderDetail extends OrderListRow {
  buyerPhone: string | null;
  shippingAddress: Record<string, unknown> | null;
  cancelReason: string | null;
  externalStatus: string;
  items: OrderItemRow[];
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  qtyOnHand: number;
  qtyReserved: number;
}

export interface PrioritySummary {
  newCount: number;
  oversoldCount: number;
  toShipCount: number;
}

/** Ordering used for the dashboard's "priority sort" (oversold first). */
export const STATUS_PRIORITY: Record<OrderStatus, number> = {
  oversold_hold: 0,
  new: 1,
  to_ship: 2,
  confirmed: 3,
  shipped: 4,
  completed: 5,
  cancelled: 6,
};

export const STATUS_LABEL_TH: Record<OrderStatus, string> = {
  new: "ใหม่",
  confirmed: "ยืนยันแล้ว",
  to_ship: "รอจัดส่ง",
  shipped: "จัดส่งแล้ว",
  completed: "สำเร็จ",
  oversold_hold: "ของไม่พอ (ระงับ)",
  cancelled: "ยกเลิก",
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
