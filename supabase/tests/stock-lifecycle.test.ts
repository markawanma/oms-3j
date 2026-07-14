// supabase/tests/stock-lifecycle.test.ts
//
// Covers, per docs/phase1-design.md §2/§3/D1:
//   - all-or-nothing multi-item reservation (one insufficient item rolls back the whole batch)
//   - reserve -> commit (shipped): on_hand -n, reserved -n
//   - commit_stock idempotency + insufficient-balance rejection
//   - release_stock (cancel) + idempotency + insufficient-balance rejection
//   - release_expired_reservations (D1 TTL auto-release) including negative cases
//     (order within TTL, order not in 'new' status) and the 0-rows-expired boundary.
//
// NOT YET EXECUTED — see final QA report. Run with:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run supabase/tests/stock-lifecycle.test.ts

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupTenant,
  commitStock,
  countLedgerRows,
  getLedgerRows,
  getOrderStatus,
  getServiceClient,
  getStock,
  hasDbEnv,
  releaseExpiredReservations,
  releaseStock,
  reserveStock,
  type SeededTenant,
  seedOrder,
  seedOrderItem,
  seedProduct,
  seedTenant,
  setReserveTtlHours,
} from "./helpers/db.ts";

const RUN_DB = hasDbEnv();
const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(!RUN_DB)("stock lifecycle: all-or-nothing / reserve -> commit / release / release_expired", () => {
  let db: SupabaseClient;
  let tenant: SeededTenant;

  beforeAll(() => {
    db = getServiceClient();
  });

  beforeEach(async () => {
    tenant = await seedTenant(db);
  });

  afterEach(async () => {
    await cleanupTenant(db, tenant.shopId);
  });

  describe("all-or-nothing multi-item reservation", () => {
    it("one insufficient product in a 2-item order rolls back the WHOLE order, including the item that had enough stock", async () => {
      const productA = await seedProduct(db, tenant.shopId, { qtyOnHand: 5 }); // plenty available
      const productB = await seedProduct(db, tenant.shopId, { qtyOnHand: 1, qtyReserved: 1 }); // 0 available
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      const { error } = await reserveStock(db, {
        shopId: tenant.shopId,
        orderId,
        idemKey: "evt-multi-item-order",
        items: [
          // A is listed FIRST deliberately: its UPDATE succeeds inside the
          // function before B's failure is hit, so this specifically proves
          // the earlier successful write for A gets rolled back too, not just
          // that B never reserves.
          { product_id: productA, qty: 2 },
          { product_id: productB, qty: 1 },
        ],
      });

      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/insufficient stock/i);

      const stockA = await getStock(db, productA);
      const stockB = await getStock(db, productB);
      expect(stockA.qty_reserved, "product A must NOT be left reserved after the batch rolled back").toBe(0);
      expect(stockB.qty_reserved, "product B unchanged").toBe(1);

      const ledgerA = await countLedgerRows(db, tenant.shopId, { productId: productA });
      const ledgerB = await countLedgerRows(db, tenant.shopId, { productId: productB });
      expect(ledgerA, "no orphaned ledger row for A").toBe(0);
      expect(ledgerB, "no ledger row was added for B either").toBe(0);
    });
  });

  describe("reserve -> commit (shipped)", () => {
    it("commit reduces qty_on_hand and qty_reserved correctly, and the ledger records both moves accurately", async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      const r1 = await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: "reserve:order-1", items: [{ product_id: productId, qty: 3 }] });
      expect(r1.error).toBeNull();
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 3 });

      const c1 = await commitStock(db, { shopId: tenant.shopId, orderId, idemKey: "commit:order-1", items: [{ product_id: productId, qty: 3 }] });
      expect(c1.error).toBeNull();
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 7, qty_reserved: 0 });

      const ledger = await getLedgerRows(db, tenant.shopId, productId);
      expect(ledger).toHaveLength(2);

      expect(ledger[0]).toMatchObject({
        move_type: "reserve",
        qty: 3,
        reserved_delta: 3,
        on_hand_delta: 0,
        qty_on_hand_after: 10,
        qty_reserved_after: 3,
      });
      expect(ledger[1]).toMatchObject({
        move_type: "commit",
        qty: 3,
        reserved_delta: -3,
        on_hand_delta: -3,
        qty_on_hand_after: 7,
        qty_reserved_after: 0,
      });
    });

    it("commit_stock replayed with the same idem_key does not double-decrement qty_on_hand", async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: "reserve:order-2", items: [{ product_id: productId, qty: 3 }] });

      const idemKey = "commit:order-2-webhook-retry";
      const first = await commitStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 3 }] });
      expect(first.error).toBeNull();

      const second = await commitStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 3 }] });
      expect(second.error).toBeNull();

      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 7, qty_reserved: 0 });
      const commitCount = await countLedgerRows(db, tenant.shopId, { productId, moveType: "commit" });
      expect(commitCount).toBe(1);
    });

    it("commit_stock rejects committing more than what is currently reserved, and leaves stock untouched", async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: "reserve:order-3", items: [{ product_id: productId, qty: 2 }] });

      const { error } = await commitStock(db, {
        shopId: tenant.shopId,
        orderId,
        idemKey: "commit:order-3-overshoot",
        items: [{ product_id: productId, qty: 5 }],
      });

      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/insufficient reserved\/on_hand balance/i);
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 2 });
    });
  });

  describe("release_stock (cancel)", () => {
    it("releases a reservation on cancel without touching qty_on_hand", async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: "reserve:order-4", items: [{ product_id: productId, qty: 4 }] });
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 4 });

      const { error } = await releaseStock(db, { shopId: tenant.shopId, orderId, idemKey: "release:order-4-cancel", items: [{ product_id: productId, qty: 4 }] });
      expect(error).toBeNull();
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 0 });

      const ledger = await getLedgerRows(db, tenant.shopId, productId);
      const releaseRow = ledger.find((r) => r.move_type === "release");
      expect(releaseRow).toMatchObject({ qty: 4, reserved_delta: -4, on_hand_delta: 0, qty_on_hand_after: 10, qty_reserved_after: 0 });
    });

    it("rejects releasing more than currently reserved, and leaves stock untouched", async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: "reserve:order-5", items: [{ product_id: productId, qty: 2 }] });

      const { error } = await releaseStock(db, { shopId: tenant.shopId, orderId, idemKey: "release:order-5-overshoot", items: [{ product_id: productId, qty: 5 }] });
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/reserved balance insufficient/i);
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 2 });
    });

    it("release_stock replayed with the same idem_key is a no-op the second time", async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);
      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: "reserve:order-6", items: [{ product_id: productId, qty: 4 }] });

      const idemKey = "release:order-6-dup";
      const first = await releaseStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 4 }] });
      expect(first.error).toBeNull();

      const second = await releaseStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 4 }] });
      expect(second.error).toBeNull();

      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 0 });
      const releaseCount = await countLedgerRows(db, tenant.shopId, { productId, moveType: "release" });
      expect(releaseCount).toBe(1);
    });
  });

  describe("release_expired_reservations (design D1 — TTL auto-release for unpaid orders)", () => {
    it("releases reservations for a 'new' order past its channel's TTL, and cancels the order", async () => {
      await setReserveTtlHours(db, tenant.shopeeChannelAccountId, 1); // 1h TTL for a clear test signal
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId, {
        createdAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(), // 2h old > 1h TTL
      });
      await seedOrderItem(db, orderId, productId, 3);
      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: `reserve:${orderId}`, items: [{ product_id: productId, qty: 3 }] });
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 3 });

      const { data: count, error } = await releaseExpiredReservations(db);
      expect(error).toBeNull();
      expect(count as number).toBeGreaterThanOrEqual(1);

      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 0 });
      const orderStatus = await getOrderStatus(db, orderId);
      expect(orderStatus).toEqual({ status: "cancelled", cancel_reason: "reservation_expired" });

      const ledger = await getLedgerRows(db, tenant.shopId, productId);
      const releaseRow = ledger.find((r) => r.move_type === "release");
      expect(releaseRow?.idempotency_key).toBe(`expire:${orderId}:${productId}`);
    });

    it("does NOT release an order that is within its TTL window (negative case)", async () => {
      await setReserveTtlHours(db, tenant.shopeeChannelAccountId, 48); // default-ish TTL
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId, {
        createdAt: new Date(Date.now() - 1 * HOUR_MS).toISOString(), // only 1h old, well within 48h
      });
      await seedOrderItem(db, orderId, productId, 3);
      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: `reserve:${orderId}`, items: [{ product_id: productId, qty: 3 }] });

      await releaseExpiredReservations(db);

      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 3 });
      const orderStatus = await getOrderStatus(db, orderId);
      expect(orderStatus.status).toBe("new");
    });

    it("does NOT release an old order that is no longer in 'new' status (e.g. already confirmed) — negative case", async () => {
      await setReserveTtlHours(db, tenant.shopeeChannelAccountId, 1);
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId, {
        createdAt: new Date(Date.now() - 5 * HOUR_MS).toISOString(),
      });
      await seedOrderItem(db, orderId, productId, 3);
      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: `reserve:${orderId}`, items: [{ product_id: productId, qty: 3 }] });
      // Confirm the order (valid transition new -> confirmed per 0001 trigger) before it "expires".
      const { error: updateErr } = await db.from("orders").update({ status: "confirmed" }).eq("id", orderId);
      expect(updateErr).toBeNull();

      await releaseExpiredReservations(db);

      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 3 });
      const orderStatus = await getOrderStatus(db, orderId);
      expect(orderStatus.status).toBe("confirmed");
    });

    it("boundary: with zero expired orders, returns 0 and raises no error", async () => {
      await setReserveTtlHours(db, tenant.shopeeChannelAccountId, 48);
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId, {
        createdAt: new Date().toISOString(),
      });
      await seedOrderItem(db, orderId, productId, 1);

      const { error } = await releaseExpiredReservations(db);
      expect(error).toBeNull();

      const orderStatus = await getOrderStatus(db, orderId);
      expect(orderStatus.status).toBe("new"); // untouched
    });

    it("calling release_expired_reservations twice in a row is idempotent (second call finds nothing new to do)", async () => {
      await setReserveTtlHours(db, tenant.shopeeChannelAccountId, 1);
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId, {
        createdAt: new Date(Date.now() - 3 * HOUR_MS).toISOString(),
      });
      await seedOrderItem(db, orderId, productId, 2);
      await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey: `reserve:${orderId}`, items: [{ product_id: productId, qty: 2 }] });

      await releaseExpiredReservations(db); // first pass releases + cancels
      expect(await getStock(db, productId)).toEqual({ qty_on_hand: 10, qty_reserved: 0 });

      // Second pass: order is now 'cancelled', so the `where status = 'new'`
      // filter excludes it — must not error and must not touch the ledger again.
      const { error } = await releaseExpiredReservations(db);
      expect(error).toBeNull();

      const releaseCount = await countLedgerRows(db, tenant.shopId, { productId, moveType: "release" });
      expect(releaseCount).toBe(1);
    });
  });
});

if (!RUN_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    "[stock-lifecycle.test.ts] SKIPPED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. " +
      "Run `supabase start` and export them to actually exercise these tests.",
  );
}
