// supabase/tests/stock-concurrency.test.ts
//
// THE most important test in this suite (per task priority #1 and design §2):
// two channels racing to reserve the last unit of stock must never both win.
//
// HOW CONCURRENCY IS SIMULATED HERE (read before trusting this test blindly):
// `Promise.all([reserveStock(orderA, ...), reserveStock(orderB, ...)])` fires
// two independent HTTP requests to PostgREST, each of which opens its own
// Postgres backend connection and executes reserve_stock() as its own
// transaction. That is genuine two-connection concurrency, not a simulation —
// there is no shared client-side lock forcing the calls to interleave nicely.
// However, `Promise.all` does NOT guarantee both requests are executing their
// `UPDATE central_stock ...` statement at literally the same instant; network/
// event-loop jitter could occasionally let one request fully complete before
// the other's bytes even leave the process, which would "pass" this test even
// if the underlying UPDATE had a race condition (i.e., false negative risk on
// any single trial). Two mitigations used below, in place of a raw two-
// connection `pg` harness with manual BEGIN/pg_sleep-controlled interleaving
// (a stronger technique deferred — see report "ช่องโหว่ที่ยังไม่ครอบคลุม"):
//   1. Repeat the race many times (TRIALS) with fresh stock each trial — the
//      probability that every single trial "gets lucky" and serializes
//      cleanly by accident, across dozens of runs hitting a shared local
//      Postgres over the loopback interface, is low enough to catch a real bug.
//   2. A second scenario fires 5 concurrent callers (not just 2) at one unit
//      of stock, which shrinks the "lucky serialization" window further.
// This suite requires `supabase start` running locally and env vars
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — see ../../.env.test.example.
// NOT YET EXECUTED — see final QA report; run with:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx vitest run supabase/tests/stock-concurrency.test.ts

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MockConnector } from "../../packages/connectors/mock.ts";
import {
  cleanupTenant,
  countLedgerRows,
  getServiceClient,
  getStock,
  hasDbEnv,
  reserveStock,
  seedOrder,
  seedProduct,
  seedTenant,
} from "./helpers/db.ts";

const RUN_DB = hasDbEnv();
const TRIALS = 15;
const N_WAY_TRIALS = 8;

describe.skipIf(!RUN_DB)("reserve_stock — concurrent oversell (design §2, priority #1)", () => {
  let db: SupabaseClient;
  let currentShopId: string | null = null;

  beforeAll(() => {
    db = getServiceClient();
  });

  afterEach(async () => {
    if (currentShopId) {
      await cleanupTenant(db, currentShopId);
      currentShopId = null;
    }
  });

  it(
    `two channels (shopee + tiktok) firing reserve_stock at the same time for the ` +
      `last unit: exactly one wins, qty_reserved never exceeds qty_on_hand (repeated ${TRIALS}x)`,
    async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const tenant = await seedTenant(db);
        currentShopId = tenant.shopId;

        const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 1 });
        const orderAId = await seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId);
        const orderBId = await seedOrder(db, tenant.shopId, tenant.tiktokChannelAccountId);

        // Exercise the QA helper the task explicitly calls out as ready-to-use.
        const { orderA, orderB } = MockConnector.buildConcurrentLastUnitOrders({
          masterSku: "QA-LAST-UNIT",
          channelA: { externalShopId: "shopee-shop-1", externalItemId: "shopee-item-1", externalOrderId: `shopee-ord-${trial}` },
          channelB: { externalShopId: "tiktok-shop-1", externalItemId: "tiktok-item-1", externalOrderId: `tiktok-ord-${trial}` },
        });
        expect(orderA.items[0].qty).toBe(1);
        expect(orderB.items[0].qty).toBe(1);

        const [resA, resB] = await Promise.all([
          reserveStock(db, {
            shopId: tenant.shopId,
            orderId: orderAId,
            idemKey: `evt-shopee-${trial}`,
            items: [{ product_id: productId, qty: orderA.items[0].qty }],
          }),
          reserveStock(db, {
            shopId: tenant.shopId,
            orderId: orderBId,
            idemKey: `evt-tiktok-${trial}`,
            items: [{ product_id: productId, qty: orderB.items[0].qty }],
          }),
        ]);

        const outcomes = [resA, resB];
        const successes = outcomes.filter((r) => r.error === null);
        const failures = outcomes.filter((r) => r.error !== null);

        expect(successes.length, `trial ${trial}: expected exactly 1 success, got ${successes.length}`).toBe(1);
        expect(failures.length, `trial ${trial}: expected exactly 1 failure, got ${failures.length}`).toBe(1);
        expect(failures[0].error?.message ?? "").toMatch(/insufficient stock/i);

        const stock = await getStock(db, productId);
        // The invariant that actually matters: never oversold, regardless of trial.
        expect(stock.qty_reserved, `trial ${trial}: qty_reserved must never exceed qty_on_hand`).toBeLessThanOrEqual(
          stock.qty_on_hand,
        );
        expect(stock.qty_reserved).toBe(1);
        expect(stock.qty_on_hand).toBe(1);

        const reserveLedgerCount = await countLedgerRows(db, tenant.shopId, { productId, moveType: "reserve" });
        expect(reserveLedgerCount, `trial ${trial}: exactly one reserve ledger row expected, no double-write`).toBe(1);

        await cleanupTenant(db, tenant.shopId);
        currentShopId = null;
      }
    },
  );

  it(
    `N-way race: 5 concurrent callers reserve_stock qty=1 against a single-unit ` +
      `product: exactly one wins, the other 4 fail cleanly (repeated ${N_WAY_TRIALS}x)`,
    async () => {
      for (let trial = 0; trial < N_WAY_TRIALS; trial++) {
        const tenant = await seedTenant(db);
        currentShopId = tenant.shopId;
        const productId = await seedProduct(db, tenant.shopId, { qtyOnHand: 1 });

        const callers = await Promise.all(
          Array.from({ length: 5 }, (_, i) => seedOrder(db, tenant.shopId, tenant.shopeeChannelAccountId)),
        );

        const results = await Promise.all(
          callers.map((orderId, i) =>
            reserveStock(db, {
              shopId: tenant.shopId,
              orderId,
              idemKey: `evt-nway-${trial}-${i}`,
              items: [{ product_id: productId, qty: 1 }],
            }),
          ),
        );

        const successes = results.filter((r) => r.error === null);
        const failures = results.filter((r) => r.error !== null);

        expect(successes.length, `trial ${trial}: expected exactly 1 of 5 to succeed`).toBe(1);
        expect(failures.length, `trial ${trial}: expected exactly 4 of 5 to fail`).toBe(4);
        for (const f of failures) {
          expect(f.error?.message ?? "").toMatch(/insufficient stock/i);
        }

        const stock = await getStock(db, productId);
        expect(stock.qty_reserved).toBeLessThanOrEqual(stock.qty_on_hand);
        expect(stock.qty_reserved).toBe(1);

        await cleanupTenant(db, tenant.shopId);
        currentShopId = null;
      }
    },
  );
});

if (!RUN_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    "[stock-concurrency.test.ts] SKIPPED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. " +
      "Run `supabase start` and export them to actually exercise the concurrent-oversell tests.",
  );
}
