// app/api/webhooks/[channel]/route.ts
//
// Marketplace webhook ingest — design §4 + §9 (P0, CEO decision / red-team #1):
//   verifyWebhook(channel, req) -> connector.parseWebhook -> INSERT sync_job -> 202
// Deliberately does NOT do any heavy work inline (marketplace webhook timeouts
// are short) — everything else happens asynchronously in sync-worker.
//
// P0 SECURITY POSTURE (fail-closed by default, BOTH modes — CEO decision:
// "webhook ที่ไม่มี verifier = ประมวลผลไม่ได้เชิงโครงสร้าง"):
//
//   - prod    (MARKETPLACE_SANDBOX !== "true"): no live per-marketplace HMAC
//     verifier ships in this batch -> EVERY request is rejected (501). This
//     is intentional and matches design R1/R2/R5 + go-live gates G-1/G-2
//     (§9): a real connector must never exist without its signature
//     verifier wired in, so there is structurally nothing here that could
//     process a forged webhook in prod.
//
//   - sandbox (MARKETPLACE_SANDBOX === "true"): requires a shared secret —
//     header `x-webhook-sandbox-secret`, constant-time compared against env
//     `WEBHOOK_SANDBOX_SECRET`. If that env var isn't set, sandbox mode
//     fails closed too (403) instead of silently becoming an open,
//     unauthenticated endpoint.
//
// verifyWebhook() is the seam a real per-channel-account HMAC verifier
// (go-live gate G-2, batch connector work) plugs into later — today it only
// implements the fail-closed gate above, but the call site (POST) doesn't
// care *how* verification happened, only whether it passed and which
// connector to use.
//
// KNOWN LIMITATION (go-live gate G-3, documented per CEO §9 — not fully
// closed this batch): `channel_account.is_sandbox` is per-account in the
// schema (design §1), but the decision of "is this endpoint globally in
// sandbox mode" is still a single process-wide env var
// (MARKETPLACE_SANDBOX). We close part of that gap below by re-checking the
// *resolved* channel_account's own `is_sandbox` flag once we know which
// account the webhook claims to be for, and refusing to process it if that
// account is not itself marked sandbox (a "live" account can never be driven
// through the sandbox shared-secret path, even while the endpoint is
// globally in sandbox mode). There is still only one global
// WEBHOOK_SANDBOX_SECRET shared by every sandbox account, not a distinct
// secret/HMAC per channel_account — full per-account binding lands with the
// real connectors (G-2).

import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getConnector } from "../../../../packages/connectors/registry";
import type { ChannelCode, MarketplaceConnector } from "../../../../packages/connectors/types";

const SUPPORTED_CHANNELS: readonly ChannelCode[] = ["shopee", "lazada", "tiktok"];

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables");
  }
  // service role client — required to write sync_job (RLS: service role only, 0002).
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// Constant-time string compare — avoids leaking the secret's content (or
// prefix length) through response-timing side channels. This route runs on
// the Node.js runtime (not Vercel Edge — no `export const runtime = "edge"`
// here), so node:crypto's own timingSafeEqual (genuinely constant-time,
// unlike `===` or a hand-rolled loop) is available and preferred.
function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  // Length itself isn't treated as sensitive here (same trade-off Node's
  // crypto.timingSafeEqual forces on all callers — it requires equal-length
  // buffers), only the secret's content is.
  if (aBuf.length !== bBuf.length) return false;
  return nodeTimingSafeEqual(aBuf, bBuf);
}

type WebhookVerification =
  | { ok: true; connector: MarketplaceConnector }
  | { ok: false; status: number; error: string };

// verifyWebhook — the seam future per-channel-account HMAC verification
// (go-live gate G-2, batch connector work) plugs into. Today it only
// implements the P0 fail-closed gate described in the file header: prod
// rejects unconditionally, sandbox requires a valid shared secret header.
async function verifyWebhook(channel: ChannelCode, request: NextRequest): Promise<WebhookVerification> {
  const isSandbox = process.env.MARKETPLACE_SANDBOX === "true";

  if (!isSandbox) {
    // PROD: no live shopee/lazada/tiktok connector or signature verifier
    // ships in this batch -> reject structurally (G-1). Never fall through
    // to any connector here.
    return {
      ok: false,
      status: 501,
      error: `no live connector implemented yet for "${channel}" (see design R1/R2, go-live gates G-1/G-2)`,
    };
  }

  const sandboxSecret = process.env.WEBHOOK_SANDBOX_SECRET;
  if (!sandboxSecret || sandboxSecret.trim() === "") {
    // Fail-closed: sandbox mode with no secret configured must never become
    // an open, unauthenticated webhook endpoint.
    return { ok: false, status: 403, error: "sandbox mode requires WEBHOOK_SANDBOX_SECRET to be configured" };
  }

  // Placeholder header name for the batch's only shipped connector (mock).
  // Real per-marketplace connectors replace this whole branch with their own
  // HMAC header(s) verified per channel_account credential (G-2) — this
  // shared-secret check is intentionally the *only* thing standing here
  // until then.
  const provided = request.headers.get("x-webhook-sandbox-secret") ?? "";
  if (!timingSafeEqual(provided, sandboxSecret)) {
    return { ok: false, status: 401, error: "invalid sandbox secret" };
  }

  try {
    return { ok: true, connector: getConnector(channel, { sandbox: true }) };
  } catch (err) {
    // Shouldn't happen — `channel` is already restricted to
    // SUPPORTED_CHANNELS before this is called — but never assume.
    return { ok: false, status: 501, error: (err as Error).message };
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;

  if (!SUPPORTED_CHANNELS.includes(channel as ChannelCode)) {
    return NextResponse.json({ error: `unsupported channel "${channel}"` }, { status: 404 });
  }
  const channelCode = channel as ChannelCode;

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "unable to read request body" }, { status: 400 });
  }

  if (!rawBody || rawBody.trim() === "") {
    return NextResponse.json({ error: "empty request body" }, { status: 400 });
  }

  const verification = await verifyWebhook(channelCode, request);
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: verification.status });
  }
  const { connector } = verification;

  // NOTE (limitation, documented in the report): full signature verification
  // is per-channel-account in real marketplaces (secret lives in
  // channel_account.credential_ref / Vault), but at this point in the
  // request we don't yet know which channel_account the webhook belongs to
  // — that's only resolved *after* parsing the body (below). Real connectors
  // will need a two-step verify (structural/shared-secret check first,
  // resolve account, then verify the per-account HMAC) once credentials
  // exist — this batch only ships the sandbox path, gated by
  // verifyWebhook() above rather than trusting any well-formed body.
  const event = connector.parseWebhook({
    headers: Object.fromEntries(Array.from(request.headers.entries())),
    body: rawBody,
  });

  if (!event) {
    // Invalid signature or malformed/unmappable payload — reject with
    // non-200 so the marketplace does not treat this delivery as consumed.
    return NextResponse.json({ error: "invalid signature or payload" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (err) {
    console.error("webhook route: service client init failed", err);
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const { data: channelRow, error: channelErr } = await supabase
    .from("channel")
    .select("id")
    .eq("code", channel)
    .maybeSingle();

  if (channelErr || !channelRow) {
    return NextResponse.json({ error: `channel "${channel}" not configured` }, { status: 404 });
  }

  const { data: accountRow, error: accountErr } = await supabase
    .from("channel_account")
    .select("id, shop_id, is_sandbox")
    .eq("channel_id", channelRow.id)
    .eq("external_shop_id", event.externalShopId)
    .maybeSingle();

  // SECURITY (P0 #4 fix — enumeration oracle): from here on, every outcome
  // (channel_account not found, account found but not sandbox, duplicate
  // delivery, freshly enqueued) responds with the exact same status/body
  // (202 `{ received: true }`). Previously a 404 for "not found" vs 200 for
  // "found" (and `duplicate: true` vs plain success) let an attacker probe
  // externalShopId values and learn which ones correspond to a real
  // channel_account. Any distinguishing detail is only ever logged
  // server-side, never reflected in the response.
  const buildAcceptedResponse = () => NextResponse.json({ received: true }, { status: 202 });

  if (accountErr || !accountRow) {
    console.warn(`webhook route: channel_account not found for channel="${channel}" (event dropped)`);
    return buildAcceptedResponse();
  }

  if (!accountRow.is_sandbox) {
    // KNOWN LIMITATION (G-3, see file header): this request already passed
    // the *global* sandbox shared-secret check, but the specific
    // channel_account it claims to be for is not itself marked sandbox
    // (i.e. it's meant to be a live account). Refuse to let a live account
    // be driven through the sandbox-only verification path.
    console.warn(`webhook route: channel_account ${accountRow.id} is not sandbox — refusing sandbox-verified webhook`);
    return buildAcceptedResponse();
  }

  const idemKey = `${channel}:${event.externalOrderId}:${event.eventType}:${event.occurredAt}`;

  const { error: insertErr } = await supabase.from("sync_job").insert({
    shop_id: accountRow.shop_id,
    channel_account_id: accountRow.id,
    job_type: "process_webhook",
    payload: event,
    idem_key: idemKey,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      // unique_violation on (job_type, idem_key) => marketplace redelivered
      // the same webhook — safe to ack (idempotency layer 1, design §4).
      // Normalized: same response as every other accepted/dropped outcome.
      return buildAcceptedResponse();
    }
    console.error("webhook route: sync_job insert failed", insertErr);
    return NextResponse.json({ error: "failed to enqueue job" }, { status: 500 });
  }

  return buildAcceptedResponse();
}
