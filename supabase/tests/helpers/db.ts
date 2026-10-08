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
//   TEST_DB_ADMIN_URL            owner-role connection string used ONLY to delete test shops in
//                                 teardown — without it the whole suite is skipped (hasDbEnv)
//   ALLOW_SHARED_DB_TEARDOWN=1   required when TEST_DB_ADMIN_URL host is not localhost/127.0.0.1
//                                 (this project has a single shared DB — see .env.test.example)
//   (R2-3) TEST_DB_ADMIN_URL must point at the SAME project as SUPABASE_URL (project ref compared) — a
//   mismatch throws before any shop is created; ALLOW_SHARED_DB_TEARDOWN does not bypass it
//
// No secrets are hardcoded here (CLAUDE.md hard rule) — every credential comes
// from process.env, and tests that need them skip loudly (not silently) via
// hasDbEnv()/requireEnv() when they're absent.

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

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

/**
 * Guard used by every test file's `describe.skipIf(!hasDbEnv())` — see report for why we skip instead of fail.
 *
 * ต้องมี TEST_DB_ADMIN_URL ด้วย: ชุดทดสอบนี้ลบร้านทดสอบผ่าน connection ของเจ้าของตาราง (0161 ถอน DELETE ของ
 * service_role) ⇒ ถ้าขาดตัวนี้ seedTenant จะสร้างร้านแล้วลบไม่ได้ = ของค้างใน DB จริง → skip ทั้ง suite แทน throw
 * (บอกเหตุผลทาง stderr ครั้งเดียว ไม่ใช่ skip เงียบ)
 */
let warnedMissingAdminUrl = false;
export function hasDbEnv(): boolean {
  const hasApi = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!hasApi) return false;
  if (!process.env.TEST_DB_ADMIN_URL?.trim()) {
    if (!warnedMissingAdminUrl) {
      warnedMissingAdminUrl = true;
      console.warn(
        "[supabase/tests] ข้าม DB integration suite: ตั้ง SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY แล้วแต่ไม่มี TEST_DB_ADMIN_URL " +
          "(ใช้ลบร้านทดสอบตอน teardown — ถ้าไม่มี ร้านทดสอบจะค้างใน DB) · ดู .env.test.example",
      );
    }
    return false;
  }
  return true;
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
  // fail ก่อนสร้างอะไร — ถ้าลบทีหลังไม่ได้ ร้านทดสอบจะค้างใน DB (ดู cleanupTenant)
  requireAdminUrl();
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
 * Teardown ของร้านทดสอบ — รันผ่าน connection ของ "เจ้าของตาราง" (pg) ไม่ใช่ service_role
 *
 * ทำไมไม่ใช้ `db.from("shop").delete()` แบบเดิม: 0161 (H1) ถอนสิทธิ์ DELETE/TRUNCATE บน
 * public.shop / analytics.campaign / analytics.campaign_step จาก service_role (กัน cascade
 * พาประวัติแก้ยอดหาย) ⇒ supabase-js ได้ 42501 แต่ helper เดิมไม่เช็ค error ⇒ ร้านทดสอบค้างใน DB
 * (มี DB เดียว) และ verify ที่ assume "ร้านเดียว" พังเงียบๆ
 *
 * ตอนนี้: ลบเป็น owner ใน transaction เดียว เรียงลูกก่อนแม่ (stock_ledger.product_id เป็น
 * ON DELETE RESTRICT จึงไม่พึ่งลำดับ cascade) · พลาดตรงไหน ROLLBACK + throw ข้อความไทย ไม่กลืน error
 *
 * connection string มาจาก env `TEST_DB_ADMIN_URL` เท่านั้น (ไม่ hardcode) — ต้องชี้ DB เดียวกับ
 * SUPABASE_URL ของชุดทดสอบ (ดู .env.test.example)
 * guard: ลบเฉพาะร้านที่ชื่อขึ้นต้น "QA Test Shop " — เผลอส่ง id ร้านจริงมาจะถูกปฏิเสธ
 */
const TEST_SHOP_NAME_PREFIX = "QA Test Shop ";

const TEARDOWN_TABLES_IN_ORDER = [
  "stock_ledger",
  "order_item",
  "shipment",
  "orders",
  "central_stock",
  "product_mapping",
  "product",
  "sync_job",
  "channel_account",
  "shop_member",
] as const;

// query param ที่ pg-connection-string ใช้ทับค่าใน URL (R3-L1) — เทียบแบบไม่สนตัวพิมพ์
const CONNECTION_OVERRIDE_PARAMS = new Set(["host", "hostaddr", "user", "port", "dbname", "database"]);
// host ที่ถือว่าเป็นเครื่องตัวเอง (URL.hostname ของ IPv6 คงวงเล็บไว้)
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// ร้านทดสอบต้องเพิ่งถูกสร้าง — กันลบร้านเก่า/ร้านจริงที่ชื่อบังเอิญขึ้นต้นเหมือนกัน
const TEST_SHOP_MAX_AGE_SQL = "interval '1 hour'";

// project ref ของ Supabase อยู่ได้ 2 ที่: host (<ref>.supabase.co · db.<ref>.supabase.co) หรือ username แบบ pooler (postgres.<ref>)
const SUPABASE_API_HOST_RE = /^([a-z0-9]{10,40})\.supabase\.(?:co|in|net)$/;
const SUPABASE_DIRECT_DB_HOST_RE = /^db\.([a-z0-9]{10,40})\.supabase\.(?:co|in|net)$/;
const SUPABASE_POOLER_HOST_RE = /(?:^|\.)pooler\.supabase\.com$/;
const SUPABASE_POOLER_USER_RE = /^[a-z_][a-z0-9_]*\.([a-z0-9]{10,40})$/;

/** "local" = เครื่องตัวเอง · "<ref>" = project บน Supabase · null = ระบุไม่ได้ (custom domain ฯลฯ) — ห้ามใส่ raw ลงข้อความ error */
function projectOfSupabaseUrl(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (LOCAL_DB_HOSTS.has(host)) return "local";
    return SUPABASE_API_HOST_RE.exec(host)?.[1] ?? null;
  } catch {
    return null;
  }
}

function projectOfAdminUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (LOCAL_DB_HOSTS.has(host)) return "local";
    const direct = SUPABASE_DIRECT_DB_HOST_RE.exec(host)?.[1];
    if (direct) return direct;
    if (SUPABASE_POOLER_HOST_RE.test(host)) return SUPABASE_POOLER_USER_RE.exec(decodeURIComponent(u.username))?.[1] ?? null;
    return null;
  } catch {
    return null;
  }
}

/**
 * R2-3 (security): ชุดนี้สร้างร้านทดสอบผ่าน SUPABASE_URL แต่ "ลบ" ผ่าน TEST_DB_ADMIN_URL — ถ้าสองตัวชี้คนละ DB
 * (เช่น URL = DB จริง · ADMIN = localhost) ร้านที่สร้างจะลบไม่ได้และค้างใน DB จริง · ALLOW_SHARED_DB_TEARDOWN ไม่ข้ามด่านนี้
 * ระบุ project ไม่ได้ทั้งสองฝั่ง = ปฏิเสธแบบอนุรักษ์ (ไม่เดาว่าเป็น DB เดียวกัน)
 */
function assertSameProject(adminUrl: string): void {
  const apiUrl = process.env.SUPABASE_URL?.trim();
  if (!apiUrl) {
    throw new Error(
      "ไม่พบ SUPABASE_URL — เทียบไม่ได้ว่า TEST_DB_ADMIN_URL ชี้ DB เดียวกับที่ชุดทดสอบจะสร้างร้านทดสอบหรือไม่ " +
        "(ร้านที่สร้างจะลบไม่ได้ถ้าคนละ DB) · ยังไม่ได้สร้างร้านทดสอบ จึงหยุดก่อน",
    );
  }
  const apiProject = projectOfSupabaseUrl(apiUrl);
  const adminProject = projectOfAdminUrl(adminUrl);
  if (apiProject === null || adminProject === null || apiProject !== adminProject) {
    throw new Error(
      `SUPABASE_URL (project ${apiProject ?? "ระบุไม่ได้"}) กับ TEST_DB_ADMIN_URL (project ${adminProject ?? "ระบุไม่ได้"}) ไม่ใช่ DB เดียวกัน ` +
        "— ชุดทดสอบสร้างร้านผ่าน SUPABASE_URL แต่ลบผ่าน TEST_DB_ADMIN_URL ถ้าคนละ DB ร้านทดสอบจะค้างใน DB จริง · " +
        "ALLOW_SHARED_DB_TEARDOWN ไม่ข้ามด่านนี้ · ยังไม่ได้สร้างร้านทดสอบ จึงหยุดก่อน",
    );
  }
}

function requireAdminUrl(): string {
  const url = process.env.TEST_DB_ADMIN_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "ไม่พบ TEST_DB_ADMIN_URL — ชุดทดสอบนี้ต้องลบร้านทดสอบด้วย connection ของเจ้าของตาราง " +
        "เพราะ 0161 ถอนสิทธิ์ DELETE บน public.shop จาก service_role แล้ว (ลบผ่าน supabase-js ได้ 42501 " +
        "และร้านทดสอบจะค้างใน DB) · ตั้งเป็น connection string ของ DB เดียวกับ SUPABASE_URL " +
        "(ดู .env.test.example) · ยังไม่ได้สร้างร้านทดสอบ จึงหยุดก่อนเพื่อไม่ให้มีของค้าง",
    );
  }
  // ห้ามใส่ url ลงข้อความ error — มีรหัสผ่านอยู่ในนั้น
  let host: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    // R3-L1: pg-connection-string ให้ query param ทับ host/port/user/dbname ได้ (postgresql://u:p@localhost/db?host=evil.com ⇒ ต่อ evil.com)
    // ⇒ ด่านที่ดูแค่ hostname ถูกหลอกได้ — ปฏิเสธ URL ที่มี param เหล่านี้ (ใส่ชื่อ param ในข้อความได้ ไม่ใส่ค่า)
    for (const key of parsed.searchParams.keys()) {
      if (CONNECTION_OVERRIDE_PARAMS.has(key.toLowerCase())) {
        throw new Error(
          `TEST_DB_ADMIN_URL มี query param "${key}" ซึ่งทับ host/port/user/dbname ของ URL ได้ (pg-connection-string) — ด่านตรวจ host จะถูกหลอก · ลบ param นี้ออก ` +
            "(ใส่ host/port/user/ชื่อ DB ใน URL ตรงๆ เท่านั้น) · ยังไม่ได้สร้างร้านทดสอบ จึงหยุดก่อน",
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("TEST_DB_ADMIN_URL มี query param")) throw e;
    throw new Error(
      "TEST_DB_ADMIN_URL ไม่ใช่ URL ที่อ่านได้ (postgresql://user:pass@host:port/db — รหัสผ่านที่มีอักขระพิเศษต้อง URL-encode) · " +
        "ยังไม่ได้สร้างร้านทดสอบ จึงหยุดก่อน",
    );
  }
  if (!LOCAL_DB_HOSTS.has(host) && process.env.ALLOW_SHARED_DB_TEARDOWN !== "1") {
    throw new Error(
      `TEST_DB_ADMIN_URL ชี้ host "${host}" ซึ่งไม่ใช่เครื่องตัวเอง (localhost / 127.0.0.1) — ชุดทดสอบนี้เขียน+ลบแถวจริง ` +
        "ปฏิเสธเพื่อกันรันใส่ DB จริงโดยไม่ตั้งใจ · ถ้าตั้งใจใช้ DB ที่ใช้ร่วมกัน (โปรเจกต์นี้มี DB เดียว) ให้ตั้ง " +
        "ALLOW_SHARED_DB_TEARDOWN=1 เองทุกครั้งที่รัน (อย่าใส่ในไฟล์) · ยังไม่ได้สร้างร้านทดสอบ จึงหยุดก่อน",
    );
  }
  assertSameProject(url);
  return url;
}

export async function cleanupTenant(_db: SupabaseClient, shopId: string): Promise<void> {
  const client = new pg.Client({ connectionString: requireAdminUrl() });
  try {
    await client.connect();
    await client.query("begin");
    // 🔴 ตรวจร้านก่อนลบอะไรทั้งนั้น — เดิมวนลบตารางลูกตาม shop_id ก่อนแล้วค่อยเช็คชื่อตอนลบร้าน
    // (ROLLBACK ช่วยไว้ได้ แต่ลำดับนั้นพึ่ง transaction อย่างเดียว) · for update = ไม่มีใครแก้/ลบร้านระหว่างลบ
    const guard = await client.query(
      `select id from public.shop where id = $1 and name like $2 and created_at > now() - ${TEST_SHOP_MAX_AGE_SQL} for update`,
      [shopId, `${TEST_SHOP_NAME_PREFIX}%`],
    );
    if (guard.rowCount !== 1) {
      throw new Error(
        `ไม่พบร้านทดสอบที่ลบได้ — id ไม่มีอยู่ · ชื่อไม่ขึ้นต้นด้วย "${TEST_SHOP_NAME_PREFIX}" · หรือสร้างมานานกว่า 1 ชั่วโมง ` +
          "(guard กันลบร้านจริง) · ยังไม่ได้ลบอะไร",
      );
    }
    for (const table of TEARDOWN_TABLES_IN_ORDER) {
      // ชื่อตารางมาจากค่าคงที่ข้างบน ไม่ใช่ input ภายนอก · shopId ส่งเป็น parameter เสมอ
      await client.query(`delete from public.${table} where shop_id = $1`, [shopId]);
    }
    const res = await client.query("delete from public.shop where id = $1 and name like $2", [
      shopId,
      `${TEST_SHOP_NAME_PREFIX}%`,
    ]);
    if (res.rowCount !== 1) {
      throw new Error(
        `ลบร้านได้ ${res.rowCount ?? "null"} แถว (ต้อง 1) — id ไม่มีอยู่ หรือชื่อร้านไม่ขึ้นต้นด้วย "${TEST_SHOP_NAME_PREFIX}" ` +
          "(guard กันลบร้านจริง) · ROLLBACK แล้ว",
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`cleanupTenant ล้มเหลว (shop ${shopId}) — ร้านทดสอบอาจค้างใน DB ต้องเก็บกวาดมือด้วย id นี้: ${detail}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
