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
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

// --- Phase A1 (auth infra, additive) --------------------------------------
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3
//
// Per-request, user-scoped Supabase client (RLS enforced via auth.uid() once
// a real Supabase Auth session's cookie is attached). Deliberately NOT
// cached at module scope like getServiceClient() above: cookies() is
// request-scoped in the Next.js App Router, so a module-level singleton here
// would leak one request's session into another's — call this fresh, every
// time, inside the server action / RSC that needs it.
//
// A1 note: this is additive. Nothing in lib/actions/*.ts calls this yet —
// every existing action/page still goes through getServiceClient() +
// lib/dev/context.ts unchanged. getUserClient() exists so /login can
// authenticate and middleware.ts can refresh sessions ahead of A2, which is
// the phase that actually swaps action/page seams over to it.
export async function getUserClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY environment " +
        "variables (Supabase dashboard -> Settings -> API -> Project URL / anon public key). " +
        "Copy .env.local.example to .env.local and fill them in — these are separate from " +
        "SUPABASE_SERVICE_ROLE_KEY, which getServiceClient() above uses instead."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // cookies().set() throws when called from a Server Component
          // render (as opposed to a Server Action or Route Handler) —
          // cookies are read-only there. That just means this particular
          // call site can't refresh the session cookie itself; middleware.ts
          // already covers the refresh path for normal page navigations, so
          // this is safe to swallow.
        }
      },
    },
  });
}
