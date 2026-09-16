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
// Anything else falls back to DEFAULT_NEXT.
export const DEFAULT_NEXT = "/dashboard";

export function sanitizeNextParam(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_NEXT;
  if (!raw.startsWith("/")) return DEFAULT_NEXT;
  if (raw.startsWith("//")) return DEFAULT_NEXT;
  if (raw.startsWith("/\\") || raw.startsWith("\\")) return DEFAULT_NEXT;
  return raw;
}
