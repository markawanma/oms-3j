// supabase/functions/sync-worker/index.ts
//
// Supabase Edge Function (Deno) — invoked by pg_cron every minute via
// `net.http_post` (design §4). Claims queued sync_job rows with
// `FOR UPDATE SKIP LOCKED`, dispatches by job_type, retries with exponential
// backoff, and dead-letters jobs once max_attempts is exceeded.
//
// Connects directly to Postgres (not through PostgREST) because the claim
// query needs raw `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
// RETURNING` — this is the literal SQL pattern requested by the task, using
// `postgres.js` tagged templates so every value is parameterized (never
// string-concatenated into SQL).
//
// ASSUMPTION (not specified in the design): this function is reachable over
// HTTP like any Edge Function, so a shared-secret header check
// (SYNC_WORKER_SECRET) guards it from being invoked by anyone who finds the
// URL — pg_cron's `net.http_post` call must send the same secret.
//
// SECURITY (H2 fix): auth is fail-closed. If SYNC_WORKER_SECRET is not
// configured, the function refuses every request with 500 (server
// misconfigured) instead of skipping the check — a missing env var must
// never silently downgrade to "anyone can invoke this". The comparison
// itself uses a constant-time byte compare (timingSafeEqual below) instead
// of `!==`, which short-circuits on the first differing byte and can leak
// the secret's prefix length/content through response-timing side channels.

import postgres from "npm:postgres@3.4.4";
import { getConnector } from "../../../packages/connectors/registry.ts";
import type {
  CanonicalOrder,
  CanonicalOrderEvent,
  ChannelCode,
  MarketplaceConnector,
} from "../../../packages/connectors/types.ts";

const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("sync-worker: SUPABASE_DB_URL (or DATABASE_URL) env var is required");
}

// N3 fix (code-review bundle robustness): Number(...) on a garbled/empty env
// var silently produces NaN (or e.g. Number("-5") = -5, a nonsensical
// negative batch size) -- either would make `limit ${BATCH_SIZE}` below
// misbehave (Postgres `LIMIT NaN` / `LIMIT -5` raise, taking down every
// worker invocation). Validate and fall back to the default instead of
// trusting the env var blindly.
const DEFAULT_BATCH_SIZE = 20;
function parseBatchSize(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_BATCH_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`sync-worker: invalid SYNC_WORKER_BATCH_SIZE "${raw}" -- falling back to default ${DEFAULT_BATCH_SIZE}`);
    return DEFAULT_BATCH_SIZE;
  }
  return parsed;
}
const BATCH_SIZE = parseBatchSize(Deno.env.get("SYNC_WORKER_BATCH_SIZE"));
const WORKER_SECRET = Deno.env.get("SYNC_WORKER_SECRET");

const sql = postgres(DATABASE_URL, { max: 5 });

interface SyncJobRow {
  id: string;
  shop_id: string;
  channel_account_id: string | null;
  job_type: string;
  payload: unknown;
  idem_key: string;
  attempts: number;
  max_attempts: number;
}

function backoffSeconds(attempts: number): number {
  // 30s, 60s, 120s, 240s ... capped at 1h.
  return Math.min(30 * 2 ** Math.max(attempts - 1, 0), 3600);
}

// Constant-time string compare (H2 fix). Length is checked first (a length
// mismatch fails fast) — that's the same trade-off Node's own
// crypto.timingSafeEqual makes (it requires equal-length buffers); the
// secret's length is not considered sensitive here, only its content.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

async function claimJobs(): Promise<SyncJobRow[]> {
  return await sql<SyncJobRow[]>`
    update sync_job
    set status = 'processing', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from sync_job
      where status = 'queued' and run_at <= now()
      order by run_at
      limit ${BATCH_SIZE}
      for update skip locked
    )
    returning id, shop_id, channel_account_id, job_type, payload, idem_key, attempts, max_attempts
  `;
}

async function markDone(id: string): Promise<void> {
  await sql`update sync_job set status = 'done', updated_at = now() where id = ${id}`;
}

async function markFailedOrDead(job: SyncJobRow, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);

  if (job.attempts >= job.max_attempts) {
    await sql`
      update sync_job
      set status = 'dead', last_error = ${message}, updated_at = now()
      where id = ${job.id}
    `;
    return;
  }

  const delaySeconds = backoffSeconds(job.attempts);
  await sql`
    update sync_job
    set status = 'queued',
        last_error = ${message},
        run_at = now() + make_interval(secs => ${delaySeconds}),
        updated_at = now()
    where id = ${job.id}
  `;
}

async function resolveChannelContext(
  channelAccountId: string | null,
): Promise<{ code: ChannelCode; isSandbox: boolean } | null> {
  if (!channelAccountId) return null;
  const rows = await sql<{ code: ChannelCode; is_sandbox: boolean }[]>`
    select c.code, ca.is_sandbox
    from channel_account ca
    join channel c on c.id = ca.channel_id
    where ca.id = ${channelAccountId}
  `;
  const row = rows[0];
  return row ? { code: row.code, isSandbox: row.is_sandbox } : null;
}

async function upsertCanonicalOrder(
  shopId: string,
  channelAccountId: string,
  order: CanonicalOrder,
  connector: MarketplaceConnector,
): Promise<void> {
  // SECURITY (M3, defense-in-depth): re-derive the canonical status from the
  // connector rather than trusting `order.status` as handed to us — even
  // though MockConnector.parseWebhook already derives it correctly (root-fix
  // in mock.ts), the worker reads this order back out of `sync_job.payload`
  // (jsonb), a hop removed from parseWebhook. Recomputing it here means the
  // worker never blindly executes a payload-controlled status regardless of
  // how the job got enqueued.
  //
  // SECURITY (P0 #5 fix): mapStatus() returns `null` (never a fallback "new")
  // when order.externalStatus is empty/unrecognized. `orders.status` is
  // NOT NULL, so a brand-new row still has to get *some* value on INSERT —
  // insertStatus defaults to "new" only for that structural reason — but we
  // immediately treat `derivedStatus === null` the same as an unmapped SKU
  // below (-> oversold_hold, manual review) instead of letting an
  // unmappable status silently stand in as a live, reservation-backed "new"
  // order.
  const derivedStatus = connector.mapStatus(order.externalStatus);
  const insertStatus = derivedStatus ?? "new";

  // SECURITY (P0 #2 fix): wrap order + order_item + reserve_stock in a
  // single DB transaction (design §9 P0.2 #2). Previously each statement ran
  // as its own auto-committed round trip — a crash/retry between the order
  // insert and reserve_stock (or between two order_item upserts) could leave
  // an order row with mismatched items / no matching reservation for a retry
  // to reconcile inconsistently. sql.begin gives BEGIN/COMMIT/ROLLBACK around
  // the whole sequence: any unexpected error rolls everything back and
  // processJob's existing retry/dead-letter logic re-runs the function
  // cleanly from scratch.
  await sql.begin(async (sql) => {
    // Lock any existing row for this (channel_account_id, external_order_id)
    // up front, inside the transaction, so a concurrent redelivery of the
    // same webhook can't race this function.
    const existingRows = await sql<{ id: string; status: string }[]>`
      select id, status from orders
      where channel_account_id = ${channelAccountId} and external_order_id = ${order.externalOrderId}
      for update
    `;
    const existingOrder = existingRows[0] ?? null;

    // SECURITY (P0 #2 fix, forged-duplicate-mutation): if this order already
    // has a 'reserve' ledger entry, it has already been ingested and
    // committed to a specific product/qty set. A redelivered or forged
    // order_created event for the same external_order_id must NOT be allowed
    // to mutate order_item qty/product mapping afterwards — that's exactly
    // the griefing vector red-team flagged: resend the same order with a
    // different qty to force a real, already-reserved order into
    // oversold_hold (or to try to reserve additional stock a second time).
    let alreadyReserved = false;
    if (existingOrder) {
      const reserveRows = await sql<{ id: string }[]>`
        select id from stock_ledger where order_id = ${existingOrder.id} and move_type = 'reserve' limit 1
      `;
      alreadyReserved = reserveRows.length > 0;
    }

    const [orderRow] = await sql<{ id: string }[]>`
      insert into orders (
        shop_id, channel_account_id, external_order_id, status, external_status,
        buyer_name, buyer_phone, shipping_address, total_amount, currency, placed_at
      ) values (
        ${shopId}, ${channelAccountId}, ${order.externalOrderId}, ${insertStatus}, ${order.externalStatus},
        ${order.buyerName}, ${order.buyerPhone}, ${sql.json(order.shippingAddress ?? {})},
        ${order.totalAmount}, ${order.currency}, ${order.placedAt}
      )
      on conflict (channel_account_id, external_order_id)
      do update set external_status = excluded.external_status, updated_at = now()
      returning id
    `;

    if (existingOrder && alreadyReserved) {
      // Only external_status (updated above) is allowed to move once an
      // order is already reserved — ignore any item/qty mutation this
      // payload is trying to smuggle in and stop here.
      return;
    }

    const reservableItems: { productId: string; qty: number }[] = [];
    let hasUnmappedSku = false;

    for (const item of order.items) {
      const mapping = await sql<{ product_id: string }[]>`
        select product_id from product_mapping
        where channel_account_id = ${channelAccountId} and external_item_id = ${item.externalItemId}
      `;
      const productId = mapping[0]?.product_id ?? null;
      if (!productId) hasUnmappedSku = true;

      await sql`
        insert into order_item (shop_id, order_id, product_id, external_item_id, external_sku, qty, unit_price)
        values (${shopId}, ${orderRow.id}, ${productId}, ${item.externalItemId}, ${item.externalSku}, ${item.qty}, ${item.unitPrice})
        on conflict (order_id, external_item_id) do update
          set product_id = excluded.product_id, qty = excluded.qty, unit_price = excluded.unit_price, updated_at = now()
      `;

      if (productId) reservableItems.push({ productId, qty: item.qty });
    }

    if (hasUnmappedSku || derivedStatus === null) {
      // Design §3 (unmapped SKU) + P0 #5 fix (unrecognized/empty
      // externalStatus): both cases mean we cannot safely reserve stock for
      // this order, so route it to manual review (D2) instead of silently
      // leaving a live 'new' order with no real reservation behind it.
      await sql`update orders set status = 'oversold_hold' where id = ${orderRow.id} and status = 'new'`;
      return;
    }

    if (reservableItems.length === 0) return;

    try {
      // Nested in a savepoint: reserve_stock's "insufficient stock" error
      // aborts the current Postgres subtransaction only, not the whole
      // outer transaction opened by sql.begin above — without the
      // savepoint, catching this in JS would leave the outer transaction in
      // Postgres's "current transaction is aborted" state and the
      // oversold_hold UPDATE below would itself fail.
      await sql.savepoint(async (sql) => {
        await sql`
          select * from reserve_stock(
            ${shopId}::uuid,
            ${orderRow.id}::uuid,
            ${"order:" + orderRow.id},
            ${sql.json(reservableItems.map((i) => ({ product_id: i.productId, qty: i.qty })))}
          )
        `;
      });
    } catch (err) {
      // Mace (Low) fix: only swallow the two *expected* business outcomes --
      // 'P0001' (reserve_stock's own "insufficient stock" raise) and '23505'
      // (idem_key reused with a different qty) -- and convert those to
      // oversold_hold per design §2/§3 (manual review, D2). Anything else
      // (e.g. a dropped connection, an actual bug, a constraint violation we
      // didn't anticipate) must bubble up so processJob's catch rolls back
      // this whole transaction and lets the job retry/dead-letter normally,
      // instead of silently masking an unknown failure as "insufficient
      // stock".
      const code = (err as { code?: string } | undefined)?.code;
      if (code === "P0001" || code === "23505") {
        await sql`update orders set status = 'oversold_hold' where id = ${orderRow.id} and status = 'new'`;
      } else {
        throw err;
      }
    }
  });
}

async function handlePullOrders(job: SyncJobRow): Promise<void> {
  const ctx = await resolveChannelContext(job.channel_account_id);
  if (!ctx) throw new Error(`pull_orders: channel_account ${job.channel_account_id} not found`);

  const connector = getConnector(ctx.code, { sandbox: ctx.isSandbox });
  const payload = job.payload as { since?: string } | null;
  const since = payload?.since ? new Date(payload.since) : new Date(Date.now() - 24 * 3600 * 1000);

  const orders = await connector.pullOrders(since);
  for (const order of orders) {
    await upsertCanonicalOrder(job.shop_id, job.channel_account_id as string, order, connector);
  }
}

async function handlePushStock(job: SyncJobRow): Promise<void> {
  const ctx = await resolveChannelContext(job.channel_account_id);
  if (!ctx) throw new Error(`push_stock: channel_account ${job.channel_account_id} not found`);

  const connector = getConnector(ctx.code, { sandbox: ctx.isSandbox });

  const rows = await sql<{ external_item_id: string; qty_on_hand: number; qty_reserved: number }[]>`
    select pm.external_item_id, cs.qty_on_hand, cs.qty_reserved
    from product_mapping pm
    join central_stock cs on cs.product_id = pm.product_id
    where pm.channel_account_id = ${job.channel_account_id}
  `;

  if (rows.length === 0) return;

  const items = rows.map((r) => ({
    externalItemId: r.external_item_id,
    qtyAvailable: Math.max(r.qty_on_hand - r.qty_reserved, 0),
  }));

  const results = await connector.pushStock(items);
  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    throw new Error(`push_stock: ${failed.length}/${results.length} item(s) failed: ${JSON.stringify(failed)}`);
  }
}

async function handleConfirmShipment(job: SyncJobRow): Promise<void> {
  const ctx = await resolveChannelContext(job.channel_account_id);
  if (!ctx) throw new Error(`confirm_shipment: channel_account ${job.channel_account_id} not found`);

  const connector = getConnector(ctx.code, { sandbox: ctx.isSandbox });

  const payload = job.payload as {
    orderId?: string;
    externalOrderId?: string;
    shipmentId?: string;
    carrierCode?: string;
    trackingNo?: string;
  } | null;

  if (!payload?.orderId || !payload?.externalOrderId || !payload?.shipmentId || !payload?.carrierCode) {
    throw new Error("confirm_shipment: payload must include orderId, externalOrderId, shipmentId, carrierCode");
  }

  // Destructure into plain `const`s right after the guard above so every
  // field is a definite `string` (not `string | undefined`) both inside and
  // outside the sql.begin closure below, with no reliance on TS narrowing
  // surviving across a nested function boundary.
  const { orderId, externalOrderId, shipmentId, carrierCode, trackingNo } = payload;

  // SECURITY/CORRECTNESS (S2 fix): commit_stock + the orders/shipment status
  // updates now run inside a single DB transaction (sql.begin). Previously
  // each ran as its own auto-committed statement -- a crash between e.g.
  // commit_stock and the `orders` status UPDATE could leave stock committed
  // but the order still 'to_ship' (or the shipment row never marked
  // in_transit): a partial state a naive retry can't cleanly distinguish
  // from "never ran".
  //
  // Ordering (also S2): connector.confirmShipment() -- the external,
  // non-transactional marketplace call -- now happens AFTER this DB
  // transaction commits, not before. Calling the marketplace first and then
  // crashing before our own commit would leave the marketplace believing the
  // shipment is confirmed while our system still shows 'to_ship', which is
  // strictly worse than the reverse. With DB-first ordering, the worst case
  // is: DB commits shipped/committed stock, then the external call throws ->
  // processJob's catch retries/dead-letters the job -> a retry re-runs this
  // function. The DB writes below are idempotent on retry (commit_stock's
  // own idem_key guard; the `status = 'to_ship'` / shipment-status guards
  // are no-ops once already applied) -- but connector.confirmShipment() is
  // NOT guaranteed idempotent for a real marketplace API. This is an
  // accepted "at-least-once" debt for this batch (low-impact today: the only
  // connector shipped, MockConnector.confirmShipment, is a no-op). A real
  // connector must either tolerate a duplicate confirm-shipment call, or
  // this needs a dedicated "external call already sent" ledger before that
  // batch ships -- flagged in the report, not solved here.
  await sql.begin(async (sql) => {
    const itemRows = await sql<{ product_id: string; qty: number }[]>`
      select product_id, qty from order_item where order_id = ${orderId} and product_id is not null
    `;

    if (itemRows.length > 0) {
      await sql`
        select * from commit_stock(
          ${job.shop_id}::uuid,
          ${orderId}::uuid,
          ${"ship:" + job.idem_key},
          ${sql.json(itemRows.map((i) => ({ product_id: i.product_id, qty: i.qty })))}
        )
      `;
    }

    await sql`update orders set status = 'shipped' where id = ${orderId} and status = 'to_ship'`;
    await sql`
      update shipment set status = 'in_transit', shipped_at = now()
      where id = ${shipmentId}
    `;
  });

  await connector.confirmShipment(externalOrderId, {
    shipmentId,
    carrierCode,
    trackingNo,
  });
}

async function handleProcessWebhook(job: SyncJobRow): Promise<void> {
  const event = job.payload as CanonicalOrderEvent | null;
  if (!event?.externalOrderId || !event?.eventType) {
    throw new Error("process_webhook: malformed event payload");
  }

  const ctx = await resolveChannelContext(job.channel_account_id);
  if (!ctx) throw new Error(`process_webhook: channel_account ${job.channel_account_id} not found`);
  const connector = getConnector(ctx.code, { sandbox: ctx.isSandbox });

  if (event.eventType === "order_created") {
    if (!event.order) throw new Error("process_webhook: order_created event missing `order`");
    if (!job.channel_account_id) throw new Error("process_webhook: missing channel_account_id");
    await upsertCanonicalOrder(job.shop_id, job.channel_account_id, event.order, connector);
    return;
  }

  const rows = await sql<{ id: string; status: string }[]>`
    select id, status from orders
    where channel_account_id = ${job.channel_account_id} and external_order_id = ${event.externalOrderId}
  `;
  const order = rows[0];
  if (!order) {
    // Status update for an order we haven't ingested yet — a later pull_orders
    // poll (or webhook retry) will pick it up once the order exists.
    return;
  }

  await sql`update orders set external_status = ${event.externalStatus} where id = ${order.id}`;

  // SECURITY (M3 fix): never branch on `event.status` — it travels through
  // sync_job.payload (jsonb) and is exactly the kind of value a forged or
  // tampered delivery can control. Re-derive the canonical status straight
  // from `event.externalStatus` via the connector's own mapping table, which
  // is server-side, fixed, and not influenced by request content.
  const canonicalStatus = connector.mapStatus(event.externalStatus);

  // SECURITY (P0 #5 fix): mapStatus() returns `null` (never a fallback
  // "new") for an empty/unrecognized externalStatus. Previously this
  // defaulted to "new", and the `canonicalStatus !== order.status` branch
  // below would then push e.g. an `oversold_hold` order straight back to
  // "new" with no real stock reservation behind it — exactly the forged/
  // garbled-webhook griefing vector red-team flagged. `external_status`
  // (raw) was already updated above for audit purposes; leave the canonical
  // state machine untouched here and let a later, recognizable status
  // update (or an admin via the oversold_hold review UI) move it forward.
  if (canonicalStatus === null) return;

  const isTerminal = order.status === "cancelled" || order.status === "shipped" || order.status === "completed";

  if (canonicalStatus === "cancelled" && !isTerminal) {
    const itemRows = await sql<{ product_id: string; qty: number }[]>`
      select product_id, qty from order_item where order_id = ${order.id} and product_id is not null
    `;
    if (itemRows.length > 0) {
      await sql`
        select * from release_stock(
          ${job.shop_id}::uuid,
          ${order.id}::uuid,
          ${"cancel:" + job.idem_key},
          ${sql.json(itemRows.map((i) => ({ product_id: i.product_id, qty: i.qty })))}
        )
      `;
    }
    await sql`update orders set status = 'cancelled', cancel_reason = 'marketplace_cancelled' where id = ${order.id}`;
    return;
  }

  if (canonicalStatus !== order.status) {
    // NOTE (known limitation): the DB trigger (0001) only allows forward
    // transitions in the state machine. A webhook that reports a status jump
    // (e.g. skipping straight to 'shipped' without an intermediate
    // 'to_ship') will make this UPDATE raise and the job will retry until
    // dead-lettered rather than being applied. Accepted trade-off per design
    // §3 ("กัน webhook มาสลับลำดับเขียนสถานะถอยหลัง") — flagged in the report.
    await sql`update orders set status = ${canonicalStatus} where id = ${order.id}`;
  }
}

async function processJob(job: SyncJobRow): Promise<void> {
  switch (job.job_type) {
    case "pull_orders":
      return handlePullOrders(job);
    case "push_stock":
      return handlePushStock(job);
    case "confirm_shipment":
      return handleConfirmShipment(job);
    case "process_webhook":
      return handleProcessWebhook(job);
    case "release_expired_reservations":
      await sql`select release_expired_reservations()`;
      return;
    default:
      throw new Error(`unknown job_type "${job.job_type}"`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  if (!WORKER_SECRET) {
    console.error("sync-worker: SYNC_WORKER_SECRET is not configured — refusing all requests (fail-closed)");
    return new Response(JSON.stringify({ error: "server misconfigured" }), { status: 500 });
  }

  const provided = req.headers.get("x-worker-secret") ?? "";
  if (!timingSafeEqual(provided, WORKER_SECRET)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const jobs = await claimJobs();
  const summary = { claimed: jobs.length, done: 0, retried: 0, dead: 0 };

  for (const job of jobs) {
    try {
      await processJob(job);
      await markDone(job.id);
      summary.done += 1;
    } catch (err) {
      console.error(`sync_job ${job.id} (${job.job_type}) failed:`, err);
      await markFailedOrDead(job, err);
      if (job.attempts >= job.max_attempts) summary.dead += 1;
      else summary.retried += 1;
    }
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
