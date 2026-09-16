// lib/auth/sanitize-next.ts — A2-lite (owner-approval auth gate).
//
// Pure, side-effect-free — deliberately NOT "server-only" — so it can run in
// both the Edge middleware runtime (middleware.ts constructs the outgoing
// `?next=` value with this) and be unit-tested directly with plain vitest,
// no mocking required.
//
// Guards the post-login redirect target against open-redirect payloads.
// Only a same-origin relative path is ever allowed through:
//   - must start with exactly one "/"           (rejects "http://evil.com",
//                                                 "javascript:...", bare host)
//   - must not start with "//"                  (protocol-relative URL —
//                                                 browsers resolve
//                                                 "//evil.com" against the
//                                                 current scheme)
//   - must not start with "/\" or "\"            (some browsers normalize a
//                                                 leading backslash to "/",
//                                                 turning "/\evil.com" into
//                                                 the same protocol-relative
//                                                 bypass above)
//   - must not contain any control character or  (security review
//     whitespace anywhere in the string (L1)      2026-09-16: a tab/newline
//                                                 hiding mid-string can
//                                                 survive the checks above
//                                                 yet still get normalized
//                                                 away by a browser/proxy —
//                                                 e.g. "/\t/evil.com" — or
//                                                 be used for header/log
//                                                 injection if this value
//                                                 is ever concatenated
//                                                 somewhere less careful
//                                                 than NextResponse.redirect's
//                                                 URL parsing)
// Anything else falls back to DEFAULT_NEXT.
export const DEFAULT_NEXT = "/dashboard";

// \x00-\x20 covers every ASCII control char (incl. tab/newline/CR) AND the
// plain space; \x7F is DEL. Checked against the whole string, not just a
// prefix — a control char anywhere is grounds for rejection.
const CONTROL_OR_WHITESPACE = /[\x00-\x20\x7F]/;

export function sanitizeNextParam(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_NEXT;
  if (!raw.startsWith("/")) return DEFAULT_NEXT;
  if (raw.startsWith("//")) return DEFAULT_NEXT;
  if (raw.startsWith("/\\") || raw.startsWith("\\")) return DEFAULT_NEXT;
  if (CONTROL_OR_WHITESPACE.test(raw)) return DEFAULT_NEXT;
  return raw;
}
