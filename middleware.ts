// middleware.ts — Phase A1 (auth infra, additive only).
// See docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
//
// GATE OFF — A1 additive, refresh only; hard-gate (redirect unauthenticated
// requests to /login) comes in A2, after real auth replaces
// lib/dev/context.ts everywhere. Today every page still runs on
// DEV_ROLE/DEV_SHOP_ID (lib/dev/context.ts) + the service-role client
// (lib/supabase/server.ts getServiceClient) — there is no Supabase Auth user
// required to use this app yet. If this middleware redirected to /login, it
// would lock the current dev flow (and prod, which also has no auth users
// provisioned yet) out of every page. So all this does is refresh the
// Supabase Auth session cookie *if one exists* — harmless no-op for the
// current DEV_ROLE flow, and lets /login start working end-to-end ahead of
// A2 actually requiring it.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Anon key isn't provisioned in every environment yet (see
  // .env.local.example — this project has historically run on the service
  // role key only, see lib/supabase/server.ts). Skip refresh entirely rather
  // than throw on every request; additive means "never worse than today".
  if (!url || !anonKey) {
    return NextResponse.next();
  }

  // Start with a pass-through response; @supabase/ssr's setAll callback
  // rebuilds this whenever it needs to write refreshed cookies (pattern from
  // the @supabase/ssr README for Next.js middleware).
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refresh the session (rewrites cookies via setAll above if the access
  // token was near/past expiry). No branching on the result — no redirect,
  // no gate. If there's no session, this is just a no-op network call.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Exempt (per design §A.3 + owner decision §E.1): /shop (public storefront,
  // anon key + shop_catalog view already its own security boundary),
  // /api/webhooks/* (marketplace callers, no browser session, auth = webhook
  // signature), /login (must be reachable to log in), /stock/hero (public
  // wall-display screen, no money/PII), plus Next internals + static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/webhooks|login|shop|stock/hero|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
