// middleware.ts — A2-lite (owner-approval auth gate), on top of Phase A1.
// See docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3
// and the owner decision log, 16 ก.ย. 69.
//
// GATE controlled by AUTH_GATE env var:
//   - AUTH_GATE !== "on"  -> IDENTICAL to A1: refresh the session cookie if
//     one exists, never redirect, never block anything. Every DEV_ROLE/
//     DEV_SHOP_ID page keeps working exactly as before. This is the
//     documented rollback lever — flip AUTH_GATE back off (or unset it), no
//     redeploy-of-code needed, just an env var change.
//   - AUTH_GATE === "on" -> hard-gate every page below:
//       (a) no session          -> 302 /login?next=<sanitized original path>
//       (b) session, no member  -> 302 /pending
//       (c) session + member    -> pass through
//     plus the reverse redirects so an already-authenticated user can't sit
//     on /login, /register, or /pending: session+member on any of those
//     three -> /dashboard; session-no-member on /login or /register -> the
//     canonical waiting room, /pending.
//
// Applies equally to GET (page loads) and POST (Next.js Server Actions post
// to the same route) — this file does not branch on method, so an
// unauthenticated POST to a gated route is redirected before the Server
// Action's code ever runs, exactly like a GET would be. That's what makes
// "server action POST ไม่มี session → redirect เหมือนกัน (ห้ามรัน)" true
// without any extra code: the action lives behind the same route match.
//
// Membership check below builds its OWN inline Supabase client with the
// service-role key, rather than importing getServiceClient() from
// lib/supabase/server.ts — that file is marked "server-only" (throws if
// pulled into a non-Node runtime) and this file runs on the Edge runtime.
// The inline client here uses plain @supabase/supabase-js (fetch-based, no
// Node APIs), same as scripts/provision-member.mjs's admin client, just
// constructed per-request instead of module-cached (Edge middleware
// instances are not guaranteed to persist a module-level singleton across
// requests the way a long-lived Node server would).
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { sanitizeNextParam } from "@/lib/auth/sanitize-next";

const AUTH_ENTRY_PATHS = new Set(["/login", "/register", "/pending"]);

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/** Copies every cookie set on `source` (the refreshed-session response from
 * supabase.auth.getUser()'s setAll callback below) onto `target` before it
 * goes out. Security review 2026-09-16 (M3): NextResponse.redirect()/
 * NextResponse.json() build a brand-new response object — any Set-Cookie
 * Supabase just queued on `response` (a refreshed/rotated session token) is
 * NOT carried over automatically. Skipping this drops the refreshed cookie
 * on every redirect this file issues, silently shortening (or breaking)
 * the user's session on exactly the requests where middleware had to do
 * the most work. */
function withCookiesFrom(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((c) => target.cookies.set(c));
  return target;
}

/** api/* callers get a JSON 401 instead of a redirect they can't follow
 * usefully (no browser navigation to honor a 302 with). Today the only
 * route under /api/ that reaches this file at all is /api/webhooks/* — and
 * that's excluded by config.matcher below (marketplace callers, signature
 * auth, no browser session to begin with) — so this branch is currently
 * unreachable in practice. Keeping it as an explicit, tested branch rather
 * than deleting it: any FUTURE /api/* route the web app calls with fetch()
 * needs this behavior on day one, not as a follow-up bug once someone
 * notices the browser silently "failed" to follow a JSON redirect.
 */
function denyOrRedirect(request: NextRequest, target: URL, source: NextResponse): NextResponse {
  if (isApiPath(request.nextUrl.pathname)) {
    return withCookiesFrom(source, NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }
  return withCookiesFrom(source, NextResponse.redirect(target));
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const gateOn = process.env.AUTH_GATE === "on";

  // Anon key isn't provisioned in every environment yet — skip refresh (and,
  // by extension, the entire gate below) rather than throw on every
  // request. A missing anon key is a deliberate fail-OPEN for "auth isn't
  // configured at all" (matches A1) ONLY while AUTH_GATE is off — that's
  // the pre-A2-lite behavior every dev/preview environment relies on today.
  //
  // Security review 2026-09-16 (H1): once someone has explicitly turned
  // AUTH_GATE=on, a missing url/anonKey must NOT silently fall through to
  // "every page open to everyone" — that combination means "operator
  // intended a hard gate but the deploy is broken," and serving every
  // gated page unauthenticated in that state is worse than a visible
  // outage. Fail closed with 503 instead; fixing the env vars is the only
  // way out (same as any other genuine misconfiguration).
  if (!url || !anonKey) {
    if (!gateOn) return NextResponse.next();
    // No dedicated error page to redirect to here (that would need the same
    // Supabase client this branch exists because we don't have) — a flat
    // JSON 503 for both page and API requests is the honest answer.
    return NextResponse.json({ error: "auth misconfigured" }, { status: 503 });
  }

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!gateOn) {
    // A1 behavior, unchanged: refresh only, never branch on the result.
    return response;
  }

  const pathname = request.nextUrl.pathname;
  const isAuthEntry = AUTH_ENTRY_PATHS.has(pathname);

  // (a) No session.
  if (!user) {
    if (isAuthEntry) return response; // /login, /register, /pending must be reachable to start the flow
    const next = sanitizeNextParam(pathname + request.nextUrl.search);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", next);
    return denyOrRedirect(request, loginUrl, response);
  }

  // Has a session — resolve membership with a fresh, per-request
  // service-role client (see file header for why this isn't
  // getServiceClient()).
  const serviceUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let hasMembership = false;
  if (serviceUrl && serviceKey) {
    const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });
    const { count, error } = await admin
      .from("shop_member")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", user.id);
    // Fail CLOSED on error (network hiccup, misconfigured key, etc.) —
    // never treat "couldn't confirm membership" as "is a member". Worst
    // case an owner sees /pending for a moment on a flaky request; the
    // alternative (fail open) would let an unapproved session through.
    hasMembership = !error && (count ?? 0) > 0;
  }
  // else: service key missing while AUTH_GATE=on — same fail-closed
  // reasoning; hasMembership stays false, so this falls into the
  // no-membership branch below (-> /pending, or a redirect loop away from
  // real pages). A misconfigured service key with the gate on is a config
  // error worth being loud about in ops, not silently bypassing the gate.

  // (c) session + member.
  if (hasMembership) {
    if (isAuthEntry) return withCookiesFrom(response, NextResponse.redirect(new URL("/dashboard", request.url)));
    return response;
  }

  // (b) session, no member.
  if (pathname === "/pending") return response;
  return denyOrRedirect(request, new URL("/pending", request.url), response);
}

export const config = {
  // Exempt (per design §A.3 + owner decision §E.1, extended for A2-lite):
  // /shop (public storefront, anon key + shop_catalog view already its own
  // security boundary), /api/webhooks/* (marketplace callers, no browser
  // session, auth = webhook signature), /stock/hero (public wall-display
  // screen, no money/PII), plus Next internals + static assets.
  //
  // "login" was excluded here in A1 (gate never branched, so there was
  // nothing for middleware to do on the login page). A2-lite needs the gate
  // to run there too — to redirect an already-authenticated user OFF
  // /login — so it's no longer in this list. /register and /pending were
  // never excluded (they didn't exist in A1); they fall through to the
  // catch-all below same as every other page, which is what lets rule (b)
  // and the reverse "already authenticated" redirects apply to them. (These
  // three ARE anchored already: AUTH_ENTRY_PATHS.has(pathname) above is an
  // exact Set lookup, not a prefix/regex match, so there is no
  // "/loginx"-style bypass to guard against for them — see
  // lib/auth/exempt-path.ts's header for why the THREE below need the
  // explicit anchor instead.)
  //
  // Security review 2026-09-16 (H3): each alternative below is anchored
  // with `(?:/|$)` — a bare prefix like `shop` would ALSO match
  // "/shopee-import" (Next's negative-lookahead matcher only requires the
  // alternative to match a PREFIX of the remaining path, not the whole
  // segment), silently exempting a route that was never meant to bypass the
  // gate. `(?:/|$)` forces the match to end exactly at "shop" or continue
  // with a "/" — i.e. only "/shop" and "/shop/...". Keep this regex and
  // lib/auth/exempt-path.ts's isExemptPath() in sync by hand — Next.js's
  // `matcher` must be a statically-analyzable literal (no imported
  // constant/template literal allowed), so the two can't share one source
  // of truth; lib/auth/exempt-path.test.ts is what actually proves they
  // agree.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/webhooks(?:/|$)|shop(?:/|$)|stock/hero(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
