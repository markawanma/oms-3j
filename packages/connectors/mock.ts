// packages/connectors/mock.ts
//
// MockConnector — used whenever channel_account.is_sandbox is true (design §4),
// and as the only connector this batch ships (real shopee/lazada/tiktok
// connectors are deferred — no marketplace credentials yet, see R1/R2).
// In-memory only: no network calls, safe to use in unit/integration tests.

import { Buffer } from "node:buffer";
import type {
  CanonicalOrder,
  CanonicalOrderEvent,
  ChannelCode,
  MarketplaceConnector,
  OrderStatus,
  PushResult,
  ShipmentPackage,
  StockPushItem,
} from "./types.ts";

// Status mapping table verified against docs, per design §3.
const STATUS_MAP: Record<ChannelCode, Record<string, OrderStatus>> = {
  shopee: {
    UNPAID: "new",
    READY_TO_SHIP: "confirmed",
    PROCESSED: "to_ship",
    SHIPPED: "shipped",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    IN_CANCEL: "cancelled",
  },
  lazada: {
    unpaid: "new",
    pending: "new",
    packed: "confirmed",
    ready_to_ship: "to_ship",
    shipped: "shipped",
    delivered: "completed",
    canceled: "cancelled",
  },
  tiktok: {
    UNPAID: "new",
    ON_HOLD: "new",
    AWAITING_SHIPMENT: "confirmed",
    AWAITING_COLLECTION: "to_ship",
    IN_TRANSIT: "shipped",
    DELIVERED: "completed",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  },
};

export class MockConnector implements MarketplaceConnector {
  readonly channelCode: ChannelCode;

  private readonly eventQueue: CanonicalOrderEvent[] = [];
  private readonly pushedStock = new Map<string, number>();

  constructor(channelCode: ChannelCode) {
    this.channelCode = channelCode;
  }

  async pullOrders(since: Date): Promise<CanonicalOrder[]> {
    if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
      throw new Error('MockConnector.pullOrders: "since" must be a valid Date');
    }

    return this.eventQueue
      .filter((event) => event.eventType === "order_created" && new Date(event.occurredAt) >= since)
      .map((event) => event.order)
      .filter((order): order is CanonicalOrder => order !== undefined);
  }

  parseWebhook(raw: unknown): CanonicalOrderEvent | null {
    if (raw === null || typeof raw !== "object") return null;

    const payload = raw as { headers?: unknown; body?: unknown };
    const bodyText =
      typeof payload.body === "string"
        ? payload.body
        : payload.body !== undefined
          ? JSON.stringify(payload.body)
          : null;

    if (bodyText === null || bodyText.trim() === "") return null;

    // Real connectors verify an HMAC/bearer signature from `payload.headers`
    // here before trusting the body. Sandbox mode intentionally trusts any
    // well-formed payload — this is a known limitation, see report.
    let parsed: Partial<CanonicalOrderEvent>;
    try {
      parsed = JSON.parse(bodyText) as Partial<CanonicalOrderEvent>;
    } catch {
      return null; // malformed JSON -> reject, never insert a sync_job for it
    }

    if (!parsed.externalOrderId || !parsed.externalShopId || !parsed.eventType) {
      return null;
    }

    const externalStatus = parsed.externalStatus ?? "";

    // SECURITY (M3 fix, root cause): `status` (canonical) must always be
    // *derived* from `externalStatus` via mapStatus() — never trusted
    // verbatim from the payload. `status`/`order.status` are attacker-
    // controlled fields in a forged/tampered webhook body; if we passed them
    // through as-is, a forged delivery could claim e.g. status="completed"
    // regardless of what externalStatus says, bypassing the whole state
    // machine (order state transitions are validated against `status`, not
    // `externalStatus`). Same applies to the nested `order.status` used when
    // eventType === "order_created" — it's re-derived from
    // order.externalStatus (falling back to the event's externalStatus)
    // rather than trusting whatever `order.status` the payload supplied.
    const status = this.mapStatus(externalStatus);

    // SECURITY (P0 #5 fix): mapStatus() now returns `null` instead of
    // silently defaulting to "new" for an empty/unrecognized externalStatus
    // (see types.ts doc comment). At this ingest boundary we reject the
    // whole delivery rather than enqueue a sync_job we can't safely derive a
    // canonical status for — the worker independently re-derives status from
    // externalStatus again before acting on it (defense-in-depth, see
    // sync-worker's own #5 fix), but there's no reason to let an
    // unmappable-status payload past this point at all.
    if (status === null) return null;

    let order: CanonicalOrder | undefined;
    if (parsed.order) {
      const orderExternalStatus = parsed.order.externalStatus ?? externalStatus;
      const orderStatus = this.mapStatus(orderExternalStatus);
      if (orderStatus === null) return null;
      order = { ...parsed.order, status: orderStatus };
    }

    return {
      channelCode: this.channelCode,
      externalShopId: parsed.externalShopId,
      externalOrderId: parsed.externalOrderId,
      eventType: parsed.eventType,
      externalStatus,
      status,
      occurredAt: parsed.occurredAt ?? new Date().toISOString(),
      order,
    };
  }

  async pushStock(items: StockPushItem[]): Promise<PushResult[]> {
    if (!Array.isArray(items)) {
      throw new Error("MockConnector.pushStock: items must be an array");
    }

    return items.map((item) => {
      if (!item || typeof item.externalItemId !== "string" || item.externalItemId.trim() === "") {
        return { externalItemId: String(item?.externalItemId ?? "unknown"), success: false, error: "missing externalItemId" };
      }
      if (typeof item.qtyAvailable !== "number" || !Number.isFinite(item.qtyAvailable) || item.qtyAvailable < 0) {
        return { externalItemId: item.externalItemId, success: false, error: "qtyAvailable must be a non-negative number" };
      }
      this.pushedStock.set(item.externalItemId, item.qtyAvailable);
      return { externalItemId: item.externalItemId, success: true };
    });
  }

  async confirmShipment(externalOrderId: string, pkg: ShipmentPackage): Promise<void> {
    if (!externalOrderId || externalOrderId.trim() === "") {
      throw new Error("MockConnector.confirmShipment: externalOrderId is required");
    }
    if (!pkg || !pkg.carrierCode || !pkg.shipmentId) {
      throw new Error("MockConnector.confirmShipment: pkg.shipmentId and pkg.carrierCode are required");
    }
    // Sandbox: no-op success (no real carrier/marketplace call).
  }

  async getShippingLabel(externalOrderId: string): Promise<{ pdf: Buffer }> {
    if (!externalOrderId || externalOrderId.trim() === "") {
      throw new Error("MockConnector.getShippingLabel: externalOrderId is required");
    }
    return { pdf: Buffer.from(`MOCK-LABEL:${this.channelCode}:${externalOrderId}`, "utf-8") };
  }

  mapStatus(externalStatus: string): OrderStatus | null {
    // SECURITY (P0 #5 fix): empty/unrecognized externalStatus MUST NOT
    // default to "new" (see types.ts doc comment) — that previously let a
    // forged/garbled webhook silently push an already-oversold_hold order
    // back to "new" with no real reservation behind it. Return `null` and
    // let the caller decide (reject ingest / keep current order status /
    // route to manual review).
    if (typeof externalStatus !== "string" || externalStatus.trim() === "") return null;

    const table = STATUS_MAP[this.channelCode];
    // Lazada statuses are lower_snake_case in the docs, others are UPPER_CASE —
    // try the exact value first, then fall back to a case-insensitive match.
    if (table[externalStatus]) return table[externalStatus];
    const normalized = Object.keys(table).find((key) => key.toLowerCase() === externalStatus.toLowerCase());
    return normalized ? table[normalized] : null;
  }

  /**
   * Test-only helper: enqueue a canonical order so pullOrders()/a hand-built
   * webhook body can pick it up. Not part of the MarketplaceConnector
   * interface — QA/integration tests reach for this directly on a MockConnector instance.
   */
  enqueueOrder(order: CanonicalOrder, eventType: "order_created" | "order_status_updated" = "order_created"): void {
    this.eventQueue.push({
      channelCode: this.channelCode,
      externalShopId: order.externalShopId,
      externalOrderId: order.externalOrderId,
      eventType,
      externalStatus: order.externalStatus,
      status: order.status,
      occurredAt: order.placedAt,
      order,
    });
  }

  /** Returns whatever the last pushStock() call recorded for one external item — test assertion helper. */
  getLastPushedQty(externalItemId: string): number | undefined {
    return this.pushedStock.get(externalItemId);
  }

  /**
   * QA helper (per task spec: "จำลอง 2 ช่องทางยิงออเดอร์ชิ้นสุดท้ายพร้อมกัน") —
   * builds two CanonicalOrder payloads, one per channel, each ordering the very
   * last unit of the same master SKU. The caller is expected to feed both into
   * reserve_stock (e.g. via Promise.all) and assert exactly one succeeds and
   * the other raises the "insufficient stock" exception — reproducing the
   * cross-platform race described in design §2.
   */
  static buildConcurrentLastUnitOrders(params: {
    masterSku: string;
    channelA: { externalShopId: string; externalItemId: string; externalOrderId: string };
    channelB: { externalShopId: string; externalItemId: string; externalOrderId: string };
  }): { orderA: CanonicalOrder; orderB: CanonicalOrder } {
    const occurredAt = new Date().toISOString();

    const build = (leg: typeof params.channelA): CanonicalOrder => ({
      externalShopId: leg.externalShopId,
      externalOrderId: leg.externalOrderId,
      status: "new",
      externalStatus: "UNPAID",
      buyerName: "QA Mock Buyer",
      buyerPhone: null,
      shippingAddress: null,
      totalAmount: 0,
      currency: "THB",
      placedAt: occurredAt,
      items: [{ externalItemId: leg.externalItemId, externalSku: params.masterSku, qty: 1, unitPrice: 0 }],
    });

    return { orderA: build(params.channelA), orderB: build(params.channelB) };
  }
}
