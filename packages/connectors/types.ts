// packages/connectors/types.ts
//
// Shared types for the marketplace connector layer per docs/phase1-design.md §4.
// This file is imported from BOTH a Node/Next.js runtime (webhook route handler)
// and a Deno runtime (Supabase Edge Function sync-worker) — kept dependency-free
// and using the `node:buffer` specifier (not the bare global `Buffer`) so it
// resolves correctly under both. Relative imports elsewhere in this package use
// explicit `.ts` extensions for the same cross-runtime reason (Deno requires it).

import { Buffer } from "node:buffer";

export type ChannelCode = "shopee" | "lazada" | "tiktok";

// Design §3 order state machine.
export type OrderStatus =
  | "new"
  | "confirmed"
  | "to_ship"
  | "shipped"
  | "completed"
  | "oversold_hold"
  | "cancelled";

export interface CanonicalOrderItem {
  externalItemId: string;
  /** Raw SKU string reported by the marketplace, kept even when unmapped (for troubleshooting). */
  externalSku: string | null;
  qty: number;
  unitPrice: number;
}

export interface CanonicalOrder {
  /** The marketplace's own shop identifier — needed to resolve `channel_account` on webhook ingest. */
  externalShopId: string;
  externalOrderId: string;
  status: OrderStatus;
  /** Raw marketplace status string, kept verbatim (design §3: "เก็บ external_status ดิบไว้เทียบเสมอ"). */
  externalStatus: string;
  buyerName: string | null;
  buyerPhone: string | null;
  shippingAddress: Record<string, unknown> | null;
  totalAmount: number;
  currency: string;
  /** ISO-8601 timestamp (UTC) of when the order was placed on the marketplace. */
  placedAt: string;
  items: CanonicalOrderItem[];
}

export interface CanonicalOrderEvent {
  channelCode: ChannelCode;
  externalShopId: string;
  externalOrderId: string;
  eventType: "order_created" | "order_status_updated";
  externalStatus: string;
  status: OrderStatus;
  /** ISO-8601 timestamp (UTC) of when the event occurred at the marketplace. */
  occurredAt: string;
  /** Present only when eventType === 'order_created'. */
  order?: CanonicalOrder;
}

export interface StockPushItem {
  externalItemId: string;
  qtyAvailable: number;
}

export interface PushResult {
  externalItemId: string;
  success: boolean;
  error?: string;
}

export interface ShipmentPackage {
  shipmentId: string;
  carrierCode: string;
  trackingNo?: string;
}

/**
 * MarketplaceConnector — design §4.
 * Real implementations (shopee/lazada/tiktok) are out of scope for this batch
 * (credentials not available, see design R1/R2) — only MockConnector exists so
 * far; see registry.ts.
 */
export interface MarketplaceConnector {
  readonly channelCode: ChannelCode;

  /** Fallback poll — used by the `pull_orders` sync_job as a backup to webhooks. */
  pullOrders(since: Date): Promise<CanonicalOrder[]>;

  /**
   * Verifies the webhook signature and parses the payload. MUST verify the
   * signature before returning a non-null event — returning null means
   * "reject this delivery" (forged/invalid/malformed).
   */
  parseWebhook(raw: unknown): CanonicalOrderEvent | null;

  pushStock(items: StockPushItem[]): Promise<PushResult[]>;

  confirmShipment(externalOrderId: string, pkg: ShipmentPackage): Promise<void>;

  getShippingLabel(externalOrderId: string): Promise<{ pdf: Buffer }>;

  /**
   * Maps a marketplace's raw `externalStatus` string to our canonical
   * OrderStatus.
   *
   * SECURITY (P0 #5 fix): MUST return `null` — never a default/fallback
   * status such as "new" — when `externalStatus` is empty or unrecognized.
   * Silently defaulting to "new" let a forged/garbled webhook status push an
   * already-`oversold_hold` order straight back to "new" with no real stock
   * reservation behind it. Callers MUST treat `null` as "cannot safely
   * derive canonical status right now" and either reject the ingest
   * (webhook parse boundary) or leave the order's current status untouched /
   * route it to manual review (worker) — never fabricate a state.
   */
  mapStatus(externalStatus: string): OrderStatus | null;
}
