// lib/supabase/server.ts
//
// Service-role Supabase client, server-only. Used by every server action in
// this app (app/**/actions.ts) for both reads and writes.
//
// WHY service role for READS too (deviation from the literal "anon key +
// RLS" reading described in the task): every RLS policy in
// supabase/migrations/0002_rls.sql requires `auth.uid()` to resolve to a row
// in shop_member (design §1). There is no auth/onboarding UI in this batch
// (documented limitation, CLAUDE.md + .env.local.example) — there is no
// authenticated session for an anon-key client to attach to, so an anon-key
// read would just hit RLS default-deny and return empty rows. Using the
// service role uniformly (reads + writes) with an explicit `shop_id` filter
// on every query is the documented dev-only shortcut: it makes the app
// actually work for preview, at the cost of manually re-deriving what RLS
// would otherwise guarantee. Every query in lib/actions/*.ts filters by
// `shop_id = getDevShopId()` for exactly this reason — treat that filter as
// load-bearing, not optional, in any future edit.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables. " +
        "Copy .env.local.example to .env.local and fill them in."
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
