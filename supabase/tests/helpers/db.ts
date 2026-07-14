// supabase/tests/helpers/db.ts
//
// Shared test scaffolding for the central-stock RPC integration suite
// (supabase/tests/*.test.ts). See docs/phase1-design.md §2 and
// supabase/migrations/0003_stock_functions.sql for the functions under test.
//
// WHY INTEGRATION TESTS AGAINST A REAL LOCAL POSTGRES (not pgTAP, not mocked):
// - reserve_stock/commit_stock/release_stock are SECURITY DEFINER functions
//   granted to `service_role` only (see 0003 header comment) — the ONLY way
//   to legitimately call them is through a Postgres/PostgREST connection
//   authenticated as service_role, which is exactly what supabase-js +
//   SUPABASE_SERVICE_ROLE_KEY gives us.
// - The single most important test in this suite (concurrent oversell) needs
//   TWO independent Postgres backend connections racing a row-level lock at
//   the same time. pgTAP tests run as SQL scripts inside one `psql` session
//   (typically one transaction, rolled back at the end) — that model cannot
//   express "two callers hit the same row simultaneously". Two parallel
//   supabase-js `.rpc()` calls (`Promise.all`) each open their own HTTP
//   request -> PostgREST -> its own Postgres backend connection, which is a
//   genuine two-connection race, not a simulation. See stock-concurrency.test.ts
//   for the honest caveat about timing (network jitter vs. a real two-connection
//   `pg` harness with manual BEGIN/COMMIT control).
// - The team already has `vitest` wired up (package.json) and no pgTAP/pg_prove
//   toolchain — adding pgTAP would mean a second, DB-native test runner for
//   only part of the suite. Trade-off accepted: these tests require a running
//   local Supabase instance (`supabase start`) and are slower / not hermetic
//   unit tests — that's the price of testing real row-locking behavior.
//
// REQUIRED ENV VARS (see ../../.env.test.example):
//   SUPABASE_URL                 e.g. http://127.0.0.1:54321 (from `supabase status`)
//   SUPABASE_SERVICE_ROLE_KEY    service_role JWT (from `supabase status -o env`)
//   SUPABASE_ANON_KEY            optional — only needed for the privilege
//                                 regression guard test in stock-validation.test.ts
//
// No secrets are hardcoded here (CLAUDE.md hard rule) — every credential comes
// from process.env, and tests that need them skip loudly (not silently) via
// hasDbEnv()/requireEnv() when they're absent.

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `${name} is not set. These are integration tests against a real local Supabase ` +
        `Postgres instance. Run \`supabase start\`, then \`supabase status -o env\` and ` +
        `export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY before running this suite.`,
    );
  }
  return value;
}

/** Guard used by every test file's `describe.skipIf(!hasDbEnv())` — see report for why we skip instead of fail. */
export function hasDbEnv(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function hasAnonEnv(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim());
}

/** service_role client — required because reserve_stock/commit_stock/release_stock/
 *  release_expired_reservations grant EXECUTE to service_role only (0003 header note). */
export function getServiceClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** anon client — used only by the privilege regression guard test. */
export function getAnonClient(): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface SeededTenant {
  shopId: string;
  shopeeChannelAccountId: string;
  tiktokChannelAccountId: string;
}

/** Creates a fresh shop + one shopee and one tiktok channel_account (both is_sandbox=true). */
export async function seedTenant(db: SupabaseClient): Promise<SeededTenant> {
  const { data: shop, error: shopErr } = await db
    .from("shop")
    .insert({ name: `QA Test Shop ${randomUUID()}` })
    .select("id")
    .single();
  if (shopErr || !shop) throw shopErr ?? new Error("seedTenant: shop insert returned no row");

  const { data: shopeeChannel, error: shopeeChannelErr } = await db
    .from("channel")
    .select("id")
    .eq("code", "shopee")
    .single();
  if (shopeeChannelErr || !shopeeChannel) {
    throw shopeeChannelErr ?? new Error("seedTenant: 'shopee' channel not found — was 0001_core_schema.sql seed data applied?");
  }

  const { data: tiktokChannel, error: tiktokChannelErr } = await db
    .from("channel")
    .select("id")
    .eq("code", "tiktok")
    .single();
  if (tiktokChannelErr || !tiktokChannel) {
    throw tiktokChannelErr ?? new Error("seedTenant: 'tiktok' channel not found — was 0001_core_schema.sql seed data applied?");
  }

  const { data: shopeeAcct, error: shopeeAcctErr } = await db
    .from("channel_account")
    .insert({
      shop_id: shop.id,
      channel_id: shopeeChannel.id,
      external_shop_id: `qa-shopee-${randomUUID()}`,
      is_sandbox: true,
    })
    .select("id")
    .single();
  if (shopeeAcctErr || !shopeeAcct) throw shopeeAcctErr ?? new Error("seedTenant: shopee channel_account insert failed");

  const { data: tiktokAcct, error: tiktokAcctErr } = await db
    .from("channel_account")
    .insert({
      shop_id: shop.id,
      channel_id: tiktokChannel.id,
      external_shop_id: `qa-tiktok-${randomUUID()}`,
      is_sandbox: true,
    })
    .select("id")
    .single();
  if (tiktokAcctErr || !tiktokAcct) throw tiktokAcctErr ?? new Error("seedTenant: tiktok channel_account insert failed");

  return {
    shopId: shop.id as string,
    shopeeChannelAccountId: shopeeAcct.id as string,
    tiktokChannelAccountId: tiktokAcct.id as string,
  };
}

/** Sets channel_account.reserve_ttl_hours (design D1) — used by release_expired tests. */
export async function setReserveTtlHours(db: SupabaseClient, channelAccountId: string, hours: number | null): Promise<void> {
  const { error } = await db.from("channel_account").update({ reserve_ttl_hours: hours }).eq("id", channelAccountId);
  if (error) throw error;
}

/** Creates a product + its central_stock row. Returns the product id. */
export async function seedProduct(
  db: SupabaseClient,
  shopId: string,
  opts: { sku?: string; qtyOnHand: number; qtyReserved?: number },
): Promise<string> {
  const sku = opts.sku ?? `SKU-${randomUUID()}`;
  const { data: product, error: productErr } = await db
    .from("product")
    .insert({ shop_id: shopId, sku, name: `QA product ${sku}` })
    .select("id")
    .single();
  if (productErr || !product) throw productErr ?? new Error("seedProduct: product insert failed");

  const { error: stockErr } = await db.from("central_stock").insert({
    product_id: product.id,
    qty_on_hand: opts.qtyOnHand,
    qty_reserved: opts.qtyReserved ?? 0,
  });
  if (stockErr) throw stockErr;

  return product.id as string;
}

/** Creates an `orders` row. `createdAt` lets release_expired tests backdate age past TTL. */
export async function seedOrder(
  db: SupabaseClient,
  shopId: string,
  channelAccountId: string,
  opts: { externalOrderId?: string; createdAt?: string; status?: string } = {},
): Promise<string> {
  const insertPayload: Record<string, unknown> = {
    shop_id: shopId,
    channel_account_id: channelAccountId,
    external_order_id: opts.externalOrderId ?? `ORD-${randomUUID()}`,
  };
  if (opts.createdAt) insertPayload.created_at = opts.createdAt;
  if (opts.status) insertPayload.status = opts.status;

  const { data, error } = await db.from("orders").insert(insertPayload).select("id").single();
  if (error || !data) throw error ?? new Error("seedOrder: orders insert failed");
  return data.id as string;
}

/** Creates an order_item row (needed for release_expired_reservations, which joins order_item). */
export async function seedOrderItem(
  db: SupabaseClient,
  orderId: string,
  productId: string,
  qty: number,
  opts: { externalItemId?: string } = {},
): Promise<string> {
  const { data, error } = await db
    .from("order_item")
    .insert({
      order_id: orderId,
      product_id: productId,
      external_item_id: opts.externalItemId ?? `ITEM-${randomUUID()}`,
      qty,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seedOrderItem: order_item insert failed");
  return data.id as string;
}

export interface StockRow {
  qty_on_hand: number;
  qty_reserved: number;
}

export async function getStock(db: SupabaseClient, productId: string): Promise<StockRow> {
  const { data, error } = await db
    .from("central_stock")
    .select("qty_on_hand, qty_reserved")
    .eq("product_id", productId)
    .single();
  if (error || !data) throw error ?? new Error(`getStock: no central_stock row for product ${productId}`);
  return data as StockRow;
}

export async function getOrderStatus(db: SupabaseClient, orderId: string): Promise<{ status: string; cancel_reason: string | null }> {
  const { data, error } = await db.from("orders").select("status, cancel_reason").eq("id", orderId).single();
  if (error || !data) throw error ?? new Error(`getOrderStatus: no orders row for ${orderId}`);
  return data as { status: string; cancel_reason: string | null };
}

export async function countLedgerRows(
  db: SupabaseClient,
  shopId: string,
  opts: { productId?: string; orderId?: string; moveType?: string } = {},
): Promise<number> {
  let query = db.from("stock_ledger").select("*", { count: "exact", head: true }).eq("shop_id", shopId);
  if (opts.productId) query = query.eq("product_id", opts.productId);
  if (opts.orderId) query = query.eq("order_id", opts.orderId);
  if (opts.moveType) query = query.eq("move_type", opts.moveType);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export interface LedgerRow {
  move_type: string;
  qty: number;
  reserved_delta: number;
  on_hand_delta: number;
  qty_on_hand_after: number;
  qty_reserved_after: number;
  idempotency_key: string;
}

export async function getLedgerRows(db: SupabaseClient, shopId: string, productId: string): Promise<LedgerRow[]> {
  const { data, error } = await db
    .from("stock_ledger")
    .select("move_type, qty, reserved_delta, on_hand_delta, qty_on_hand_after, qty_reserved_after, idempotency_key")
    .eq("shop_id", shopId)
    .eq("product_id", productId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LedgerRow[];
}

export interface StockItem {
  product_id: string;
  qty: number;
}

export async function reserveStock(
  db: SupabaseClient,
  args: { shopId: string; orderId: string; idemKey: string; items: StockItem[] },
) {
  return db.rpc("reserve_stock", {
    p_shop_id: args.shopId,
    p_order_id: args.orderId,
    p_idem_key: args.idemKey,
    p_items: args.items,
  });
}

export async function commitStock(
  db: SupabaseClient,
  args: { shopId: string; orderId: string; idemKey: string; items: StockItem[] },
) {
  return db.rpc("commit_stock", {
    p_shop_id: args.shopId,
    p_order_id: args.orderId,
    p_idem_key: args.idemKey,
    p_items: args.items,
  });
}

export async function releaseStock(
  db: SupabaseClient,
  args: { shopId: string; orderId: string; idemKey: string; items: StockItem[] },
) {
  return db.rpc("release_stock", {
    p_shop_id: args.shopId,
    p_order_id: args.orderId,
    p_idem_key: args.idemKey,
    p_items: args.items,
  });
}

export async function releaseExpiredReservations(db: SupabaseClient) {
  return db.rpc("release_expired_reservations");
}

/**
 * Explicit dependency-ordered teardown. Deliberately NOT just `delete from shop`
 * relying on cascade: stock_ledger.product_id is ON DELETE RESTRICT (0001, by
 * design — audit trail must outlive a hard-deleted product). If a cascading
 * delete originating from `shop` reached `product` before it reached
 * `stock_ledger` (both reference shop_id directly with ON DELETE CASCADE),
 * Postgres would raise a foreign_key_violation on the RESTRICT edge and abort
 * the whole delete — leaking the tenant's rows and breaking later tests that
 * assume a clean product/sku namespace. Deleting child tables in explicit
 * dependency order avoids depending on unspecified multi-path cascade ordering.
 */
export async function cleanupTenant(db: SupabaseClient, shopId: string): Promise<void> {
  await db.from("stock_ledger").delete().eq("shop_id", shopId);
  await db.from("order_item").delete().eq("shop_id", shopId);
  await db.from("shipment").delete().eq("shop_id", shopId);
  await db.from("orders").delete().eq("shop_id", shopId);
  await db.from("central_stock").delete().eq("shop_id", shopId);
  await db.from("product_mapping").delete().eq("shop_id", shopId);
  await db.from("product").delete().eq("shop_id", shopId);
  await db.from("sync_job").delete().eq("shop_id", shopId);
  await db.from("channel_account").delete().eq("shop_id", shopId);
  await db.from("shop_member").delete().eq("shop_id", shopId);
  await db.from("shop").delete().eq("id", shopId);
}
