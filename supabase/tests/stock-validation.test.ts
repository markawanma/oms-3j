// supabase/tests/stock-validation.test.ts
//
// reserve_stock: input validation, boundaries, idempotency, and cross-tenant
// isolation. See supabase/migrations/0003_stock_functions.sql.
// NOT YET EXECUTED — see final QA report. Run with:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run supabase/tests/stock-validation.test.ts

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  cleanupTenant,
  countLedgerRows,
  getAnonClient,
  getServiceClient,
  getStock,
  hasDbEnv,
  reserveStock,
  type SeededTenant,
  seedOrder,
  seedProduct,
  seedTenant,
} from "./helpers/db.ts";

const RUN_DB = hasDbEnv();

describe.skipIf(!RUN_DB)("reserve_stock — input validation & boundaries", () => {
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

  it("rejects qty = 0 with a clean validation error, no partial mutation", async () => {
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 5 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-zero-qty",
      items: [{ product_id: productId, qty: 0 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/qty must be a positive integer/i);

    const stock = await getStock(db, productId);
    expect(stock.qty_reserved).toBe(0);
  });

  it("rejects negative qty with a clean validation error", async () => {
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 5 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-negative-qty",
      items: [{ product_id: productId, qty: -3 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/qty must be a positive integer/i);

    const stock = await getStock(db, productId);
    expect(stock.qty_reserved).toBe(0);
  });

  it(
    "FIXED (G3): fractional qty is rejected with the friendly 'qty must be a positive " +
      "integer' validation message, not a raw Postgres cast error",
    async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 5 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      // 0005_stock_rpc_hardening.sql validates the raw JSON text against
      // `^[0-9]+$` before ever attempting an ::integer cast, so "1.5" (or any
      // non-integer literal) now raises the same friendly validation message
      // as qty=0/negative, instead of a raw "invalid input syntax" error.
      const { error } = await reserveStock(db, {
        shopId: tenant.shopId,
        orderId,
        idemKey: "evt-fractional-qty",
        items: [{ product_id: productId, qty: 1.5 }],
      });

      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/qty must be a positive integer/i);

      const stock = await getStock(db, productId);
      expect(stock.qty_reserved).toBe(0);
    },
  );

  it("rejects an item missing product_id", async () => {
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-missing-product-id",
      // deliberately malformed — cast through `any` at the call site since the
      // TS type requires product_id; this simulates a corrupted webhook payload.
      items: [{ qty: 1 } as unknown as { product_id: string; qty: number }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/missing product_id/i);
  });

  it("rejects an empty items array", async () => {
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-empty-items",
      items: [],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/non-empty jsonb array/i);
  });

  it("rejects null items", async () => {
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await db.rpc("reserve_stock", {
      p_shop_id: tenant.shopId,
      p_order_id: orderId,
      p_idem_key: "evt-null-items",
      p_items: null,
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/non-empty jsonb array/i);
  });

  it("rejects an empty/whitespace-only idem_key", async () => {
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 5 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "   ",
      items: [{ product_id: productId, qty: 1 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/p_shop_id, p_order_id and p_idem_key are required/i);
  });

  it("rejects a product_id that belongs to a different shop (cross-tenant isolation)", async () => {
    const otherTenant = await seedTenant(db);
    const otherProductId = await seedProduct(db, otherTenant.shopId, { qtyOnHand: 100 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    try {
      const { error } = await reserveStock(db, {
        shopId: tenant.shopId,
        orderId,
        idemKey: "evt-cross-tenant",
        items: [{ product_id: otherProductId, qty: 1 }],
      });

      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/does not belong to shop/i);

      const otherStock = await getStock(db, otherProductId);
      expect(otherStock.qty_reserved, "the other tenant's stock must be untouched").toBe(0);
    } finally {
      await cleanupTenant(db, otherTenant.shopId);
    }
  });

  it("rejects a product_id that does not exist at all (same error as cross-tenant, doesn't leak existence)", async () => {
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-nonexistent-product",
      items: [{ product_id: randomUUID(), qty: 1 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/does not belong to shop/i);
  });

  it("boundary: reserving exactly the available quantity succeeds (qty_reserved == qty_on_hand)", async () => {
    // on_hand=5, already reserved=2 -> available=3. Reserve exactly 3.
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 5, qtyReserved: 2 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-exact-boundary",
      items: [{ product_id: productId, qty: 3 }],
    });

    expect(error).toBeNull();
    const stock = await getStock(db, productId);
    expect(stock).toEqual({ qty_on_hand: 5, qty_reserved: 5 }); // hits chk_central_stock_reserved_le_on_hand exactly
  });

  it("boundary: reserving one more than available fails and leaves stock untouched", async () => {
    // on_hand=5, reserved=2 -> available=3. Reserve 4 (one over) must fail.
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 5, qtyReserved: 2 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-over-boundary",
      items: [{ product_id: productId, qty: 4 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/insufficient stock/i);

    const stock = await getStock(db, productId);
    expect(stock).toEqual({ qty_on_hand: 5, qty_reserved: 2 });
  });

  it("boundary: reserving against a product with zero stock (qty_on_hand=0) fails cleanly, no mutation", async () => {
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 0 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-zero-stock",
      items: [{ product_id: productId, qty: 1 }],
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/insufficient stock/i);
    expect(await getStock(db, productId)).toEqual({ qty_on_hand: 0, qty_reserved: 0 });
  });

  it("handles Thai characters, emoji, and long text in product sku/name without breaking reserve_stock", async () => {
    // Central-stock logic itself only ever operates on the product UUID, but a
    // malformed trigger/encoding issue on the product/central_stock insert path
    // could still break the flow before reserve_stock is even reachable —
    // worth a direct check given this is a Thai-market OMS (buyer names, SKUs
    // entered by Thai sellers routinely contain Thai script and emoji).
    const productId = await seedProduct(db, tenant.shopId, {
      sku: `สินค้า-ทดสอบ-🛒-${"x".repeat(100)}`,
      qtyOnHand: 5,
    });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

    const { error } = await reserveStock(db, {
      shopId: tenant.shopId,
      orderId,
      idemKey: "evt-thai-emoji-sku",
      items: [{ product_id: productId, qty: 2 }],
    });

    expect(error).toBeNull();
    expect(await getStock(db, productId)).toEqual({ qty_on_hand: 5, qty_reserved: 2 });
  });

  it("idempotency: replaying the same idem_key (simulated webhook retry) reserves stock only once", async () => {
    const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
    const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);
    const idemKey = "evt-webhook-retry-same-payload";

    const first = await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 2 }] });
    expect(first.error).toBeNull();

    const second = await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 2 }] });
    expect(second.error).toBeNull(); // idempotent no-op, not an error

    const stock = await getStock(db, productId);
    expect(stock.qty_reserved, "must not double-decrement on webhook retry").toBe(2);

    const ledgerCount = await countLedgerRows(db, tenant.shopId, { productId, moveType: "reserve" });
    expect(ledgerCount, "exactly one ledger row for the duplicate idem_key").toBe(1);
  });

  it(
    "FIXED (G1): replaying the same idem_key with a DIFFERENT qty raises a conflict " +
      "instead of being silently accepted as a no-op",
    async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);
      const idemKey = "evt-webhook-retry-mismatched-payload";

      const first = await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 2 }] });
      expect(first.error).toBeNull();

      // Same idem_key, but qty is now 5 instead of 2 — e.g. a corrupted retry
      // or a bug that regenerated the payload. 0005_stock_rpc_hardening.sql
      // compares the composed key's recorded qty against this call's qty and
      // raises instead of silently keeping the first call's result.
      const second = await reserveStock(db, { shopId: tenant.shopId, orderId, idemKey, items: [{ product_id: productId, qty: 5 }] });
      expect(second.error).not.toBeNull();
      expect(second.error?.message ?? "").toMatch(/already used for product .* with a different qty/i);

      const stock = await getStock(db, productId);
      // Unchanged from the first call — the conflicting second call must not
      // mutate stock at all.
      expect(stock.qty_reserved).toBe(2);
    },
  );

  it(
    "FIXED (G2): the same product_id listed twice in one order batch under a single " +
      "idem_key aggregates the qty (reserves the sum), not just the first occurrence",
    async () => {
      const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 10 });
      const orderId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);

      // Simulates a corrupted order payload with 2 order_items pointing at the
      // same master SKU/product (e.g. a mapping bug). 0005_stock_rpc_hardening.sql
      // aggregates (sums) qty per product_id before reserving, so the caller's
      // evident intent (1+1=2 units) is honored instead of silently
      // under-reserving.
      const { error } = await reserveStock(db, {
        shopId: tenant.shopId,
        orderId,
        idemKey: "evt-duplicate-product-in-batch",
        items: [
          { product_id: productId, qty: 1 },
          { product_id: productId, qty: 1 },
        ],
      });

      expect(error).toBeNull();
      const stock = await getStock(db, productId);
      expect(stock.qty_reserved).toBe(2);

      const ledgerCount = await countLedgerRows(db, tenant.shopId, { productId, moveType: "reserve" });
      expect(ledgerCount).toBe(1);
    },
  );
});

describe.skipIf(!RUN_DB || !process.env.SUPABASE_ANON_KEY)(
  "reserve_stock — privilege regression guard (bonus, only runs if SUPABASE_ANON_KEY is set)",
  () => {
    it("anon role cannot execute reserve_stock directly (EXECUTE revoked from PUBLIC per 0003 header note)", async () => {
      const anonDb = getAnonClient();

      const { error } = await anonDb.rpc("reserve_stock", {
        p_shop_id: randomUUID(),
        p_order_id: randomUUID(),
        p_idem_key: "anon-privilege-check",
        p_items: [{ product_id: randomUUID(), qty: 1 }],
      });

      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/permission denied/i);
    });
  },
);

if (!RUN_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    "[stock-validation.test.ts] SKIPPED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. " +
      "Run `supabase start` and export them to actually exercise these tests.",
  );
}
