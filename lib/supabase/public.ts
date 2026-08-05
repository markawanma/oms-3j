// lib/supabase/public.ts
//
// Anon-key Supabase client, server-only — used EXCLUSIVELY by the public
// /shop catalog (lib/actions/shop-catalog.ts). Do not import this from any
// authenticated/internal code path, and do not import getServiceClient
// (lib/supabase/server.ts) into anything reachable from /shop.
//
// WHY anon key here (unlike server.ts, which deliberately uses service role
// for every other read/write — see the WHY comment in server.ts): /shop has
// no session to attach to either, but unlike the internal dashboard it must
// stay safe to expose with zero auth in front of it. The public.shop_catalog
// view (supabase/migrations/0009_public_catalog.sql) is the actual security
// boundary — anon is granted SELECT on that view only, nothing else. Using
// the anon key here means a coding mistake (e.g. querying `product` instead
// of `shop_catalog`) fails closed (permission denied) instead of silently
// returning unit_cost/shop_id/etc. through the service role. Never swap this
// for getServiceClient() to "fix" an empty result — that defeats the whole
// point of this file existing.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getPublicClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "environment variables. Copy .env.local.example to .env.local and " +
        "fill them in."
    );
  }

  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
