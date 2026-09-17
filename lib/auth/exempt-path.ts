// lib/auth/exempt-path.ts — A2-lite (security review 2026-09-16, H3).
//
// middleware.ts's `config.matcher` is what ACTUALLY decides which routes
// bypass the auth gate — Next.js skips running the middleware function
// entirely for any path that fails to match that pattern. This file is a
// pure, unit-testable mirror of that same anchoring logic, kept ONLY so
// exempt-path.test.ts can prove the anchoring is correct without spinning
// up the Edge middleware runtime.
//
// ⚠️ Next.js requires `matcher` to be a statically-analyzable literal (no
// imported constant, no template literal built from a shared module) — so
// this can NOT be imported into middleware.ts and used to build the actual
// matcher. The two regexes are hand-kept in sync; if you change one, change
// the other, then run this file's test.
//
// Deliberately does NOT cover /login, /register, /pending — those are
// exempted differently, via `AUTH_ENTRY_PATHS.has(pathname)` (an exact Set
// lookup in middleware.ts), which has no prefix-match failure mode to
// anchor against in the first place.
const EXEMPT_PATTERN =
  /^(?:_next\/static|_next\/image|favicon\.ico|api\/webhooks(?:\/|$)|shop(?:\/|$)|stock\/hero(?:\/|$)|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$)/;

/** true if `pathname` bypasses the auth gate entirely (middleware.ts never
 * runs for it) — mirrors config.matcher's negative-lookahead exactly. */
export function isExemptPath(pathname: string): boolean {
  const rest = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return EXEMPT_PATTERN.test(rest);
}
